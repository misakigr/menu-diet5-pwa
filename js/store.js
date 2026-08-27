// Snapshot validation and cache-record lifecycle. Pure logic, no DOM and no
// storage engine: the caller injects an adapter, so the same code runs against
// IndexedDB in the browser and an in-memory map in tests.
//
// Every check is environment-aware. A snapshot only validates against the
// environment the device is actually paired to, so a DEV payload can never be
// rendered or stored as PROD data, or the other way round.

import {APP_SCHEMA_VERSION, CACHE_SCHEMA_VERSION, ENVIRONMENTS} from "./config.js";
import {isIsoDate, localDateKey} from "./format.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateMeal(meal) {
  if (!isPlainObject(meal)) return false;
  if (typeof meal.dishId !== "string" || !meal.dishId) return false;
  if (typeof meal.dishName !== "string" || !meal.dishName) return false;
  if (typeof meal.mealLabel !== "string") return false;
  if (!isPlainObject(meal.nutritionPerPerson)) return false;
  if (!Array.isArray(meal.ingredients)) return false;
  if (typeof meal.recipe !== "string") return false;
  return true;
}

function validateDay(day, expectedName) {
  if (!isPlainObject(day)) return false;
  if (day.day !== expectedName) return false;
  if (!isIsoDate(day.date)) return false;
  if (typeof day.available !== "boolean") return false;
  if (!Array.isArray(day.meals)) return false;
  if (!day.meals.every(validateMeal)) return false;
  if (!isPlainObject(day.shopping) || !Array.isArray(day.shopping.items)) return false;
  return true;
}

// A partially written or truncated payload must never replace a good cache.
export function validateSnapshot(snapshot, environment) {
  if (!isPlainObject(snapshot)) return false;
  const meta = snapshot.meta;
  if (!isPlainObject(meta)) return false;
  if (meta.schemaVersion !== APP_SCHEMA_VERSION) return false;
  if (typeof meta.dataVersion !== "string" || !/^[0-9a-f]{16,64}$/.test(meta.dataVersion)) return false;
  if (!Number.isInteger(meta.persons) || meta.persons < 1) return false;
  if (typeof meta.timezone !== "string" || !meta.timezone) return false;
  if (!isIsoDate(meta.todayDate) || !isIsoDate(meta.tomorrowDate)) return false;
  if (ENVIRONMENTS.indexOf(meta.environment) < 0) return false;
  // The backend must declare the same environment the device is paired to.
  if (environment !== undefined && meta.environment !== environment) return false;
  if (!isPlainObject(snapshot.days)) return false;
  if (!validateDay(snapshot.days.today, "today")) return false;
  if (!validateDay(snapshot.days.tomorrow, "tomorrow")) return false;
  if (snapshot.days.today.date !== meta.todayDate) return false;
  if (snapshot.days.tomorrow.date !== meta.tomorrowDate) return false;
  return true;
}

export function createRecord(snapshot, fetchedAt, recordKey) {
  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    environment: snapshot.meta.environment,
    recordKey: String(recordKey || ""),
    fetchedAt: Number(fetchedAt) || 0,
    dataVersion: snapshot.meta.dataVersion,
    snapshot
  };
}

export function isUsableRecord(record, environment, recordKey) {
  if (!isPlainObject(record)) return false;
  if (record.cacheSchemaVersion !== CACHE_SCHEMA_VERSION) return false;
  if (!Number.isFinite(record.fetchedAt)) return false;
  if (environment !== undefined && record.environment !== environment) return false;
  if (recordKey !== undefined && record.recordKey !== recordKey) return false;
  return validateSnapshot(record.snapshot, environment);
}

// A cached "today" that is no longer today must be shown as an explicitly dated
// archive, never silently presented as current data.
export function isRolledOver(record, now) {
  if (!isUsableRecord(record)) return false;
  const meta = record.snapshot.meta;
  return localDateKey(meta.timezone, now) !== meta.todayDate;
}

export function shouldReplace(currentRecord, incomingSnapshot, environment) {
  if (!validateSnapshot(incomingSnapshot, environment)) return false;
  if (!isUsableRecord(currentRecord, environment)) return true;
  if (currentRecord.snapshot.meta.dataVersion !== incomingSnapshot.meta.dataVersion) return true;
  if (currentRecord.snapshot.meta.todayDate !== incomingSnapshot.meta.todayDate) return true;
  return false;
}

export function createSnapshotStore(adapter, options) {
  const settings = options || {};
  const recordKey = String(settings.recordKey || "");
  const environment = settings.environment;
  const now = typeof settings.clock === "function" ? settings.clock : () => Date.now();
  return {
    recordKey,
    environment,
    async load() {
      let record = null;
      try {
        record = await adapter.get(recordKey);
      } catch (error) {
        record = null;
      }
      if (record && !isUsableRecord(record, environment, recordKey)) {
        // Corrupt, foreign-environment or stale-schema cache is dropped
        // instead of being rendered.
        try { await adapter.clear(recordKey); } catch (error) { /* nothing to recover */ }
        return null;
      }
      return record;
    },
    async save(snapshot) {
      if (!validateSnapshot(snapshot, environment)) return null;
      const record = createRecord(snapshot, now(), recordKey);
      await adapter.put(recordKey, record);
      return record;
    },
    async touch(record) {
      if (!isUsableRecord(record, environment, recordKey)) return record;
      const refreshed = Object.assign({}, record, {fetchedAt: now()});
      await adapter.put(recordKey, refreshed);
      return refreshed;
    },
    async clear() {
      try { await adapter.clear(recordKey); } catch (error) { /* nothing to recover */ }
    }
  };
}
