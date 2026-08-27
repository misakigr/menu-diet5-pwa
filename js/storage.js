// Storage adapters for the snapshot cache.
//
// IndexedDB is the primary engine: the snapshot is a structured object of a few
// hundred kilobytes, and IndexedDB keeps it off the synchronous main-thread
// path. A memory adapter is used when IndexedDB is unavailable (private mode,
// blocked site data) and by the automated tests.

import {CACHE_DB_NAME, CACHE_RECORD_KEY, CACHE_STORE_NAME, CACHE_SCHEMA_VERSION} from "./config.js";

export function createMemoryAdapter(initial) {
  let value = initial === undefined ? null : initial;
  return {
    engine: "memory",
    async get() { return value; },
    async put(record) { value = record; },
    async clear() { value = null; }
  };
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.createObjectStore(CACHE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb_open_failed"));
    request.onblocked = () => reject(new Error("indexeddb_blocked"));
  });
}

function runTransaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    let result;
    const transaction = db.transaction(CACHE_STORE_NAME, mode);
    const store = transaction.objectStore(CACHE_STORE_NAME);
    // The whole record is written in one transaction, so a failed or
    // interrupted write leaves the previous good snapshot untouched.
    result = action(store);
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
    transaction.onerror = () => reject(transaction.error || new Error("indexeddb_transaction_failed"));
    transaction.onabort = () => reject(transaction.error || new Error("indexeddb_transaction_aborted"));
  });
}

export function createIndexedDbAdapter(indexedDB) {
  let connection = null;
  async function db() {
    if (!connection) connection = await openDatabase(indexedDB);
    return connection;
  }
  return {
    engine: "indexeddb",
    async get() {
      return runTransaction(await db(), "readonly", store => store.get(CACHE_RECORD_KEY));
    },
    async put(record) {
      await runTransaction(await db(), "readwrite", store => store.put(record, CACHE_RECORD_KEY));
    },
    async clear() {
      await runTransaction(await db(), "readwrite", store => store.delete(CACHE_RECORD_KEY));
    }
  };
}

export async function createBestAdapter(globalScope) {
  const indexedDB = globalScope && globalScope.indexedDB;
  if (!indexedDB) return createMemoryAdapter(null);
  try {
    const adapter = createIndexedDbAdapter(indexedDB);
    await adapter.get();
    return adapter;
  } catch (error) {
    return createMemoryAdapter(null);
  }
}
