// Device-local purchase state. No network, credentials or snapshot writes.
import {isoParts, localDateKey} from "./format.js";

// Today-only v1 records are deliberately not interpreted as Tomorrow purchases.
export const CHECKLIST_PREFIX = "menu.shopping.tomorrow.v1:";
const normalize = value => String(value || "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");

// The API aggregates canonical product names, but does not expose product IDs.
// Keep units distinct; never include quantity, emoji, ordering or a row index.
export function productIdentity(item) {
  const name = normalize(item && item.product);
  return name ? JSON.stringify([name, normalize(item.unit)]) : "";
}

export function checklistDate(snapshot, day, now = Date.now()) {
  if (!snapshot?.meta || day !== "tomorrow") return "";
  const date = localDateKey(snapshot.meta.timezone || "Europe/Moscow", now);
  const tomorrow = currentTomorrowDate(snapshot.meta.timezone, now);
  return snapshot.meta.todayDate === date && snapshot.days?.today?.date === date &&
    snapshot.meta.tomorrowDate === tomorrow && snapshot.days?.tomorrow?.date === tomorrow ? tomorrow : "";
}

export function currentTomorrowDate(timezone, now = Date.now()) {
  const date = isoParts(localDateKey(timezone || "Europe/Moscow", now)).date;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function createChecklistStore(storage) {
  const memory = new Map();
  const volatileKeys = new Set();
  let persistent = storage?.persistent !== false;
  function expire(namespace, date) {
    if (!namespace || !date) return;
    const prefix = CHECKLIST_PREFIX + namespace + ":", key = prefix + date;
    for (const old of memory.keys()) {
      if (old.startsWith(prefix) && old !== key) {
        memory.delete(old); volatileKeys.delete(old);
        try { storage.removeItem(old); } catch (_) { /* Session expiry still applies. */ }
      }
    }
    try {
      // Expire only checklist records in the active environment/deployment.
      for (let i = storage.length - 1; i >= 0; i--) {
        const old = storage.key(i);
        if (old?.startsWith(prefix) && old !== key) storage.removeItem(old);
      }
    } catch (_) { /* Rendering/date isolation still works with blocked storage. */ }
  }
  function read(namespace, date) {
    if (!namespace || !date) return new Set();
    expire(namespace, date);
    const key = CHECKLIST_PREFIX + namespace + ":" + date;
    if (volatileKeys.has(key)) return new Set(memory.get(key) || []);
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length > 2000 || !data.every(id => typeof id === "string" && id.length < 2000)) {
          memory.delete(key);
          throw new Error("invalid_checklist");
        }
        memory.set(key, data);
      } else if (persistent) memory.delete(key);
    } catch (error) {
      // Invalid JSON is recoverable; blocked storage keeps session state.
      if (error instanceof SyntaxError) memory.delete(key);
      try { storage.removeItem(key); } catch (_) { persistent = false; }
    }
    return new Set(memory.get(key) || []);
  }
  return {
    read,
    expire,
    get persistent() { return persistent; },
    toggle(namespace, date, identity) {
      if (!namespace || !date || !identity) return;
      const checked = read(namespace, date);
      if (checked.has(identity)) checked.delete(identity); else checked.add(identity);
      const key = CHECKLIST_PREFIX + namespace + ":" + date;
      memory.set(key, [...checked]);
      try { storage.setItem(key, JSON.stringify([...checked])); } catch (_) { persistent = false; volatileKeys.add(key); }
    }
  };
}

// Find the next calendar boundary in the app timezone, including DST zones.
export function nextDateDelay(timezone, now = Date.now()) {
  const date = localDateKey(timezone, now);
  let low = now, high = now + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDateKey(timezone, mid) === date) low = mid; else high = mid;
  }
  return high - now + 20;
}
