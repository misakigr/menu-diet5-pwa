// Phase 18/19 — static, non-secret frontend configuration.
//
// This file is published to a public GitHub Pages site. It must never contain
// an API URL, an access key, a spreadsheet id, a chat id or any other
// credential. All of those arrive at runtime through the one-time pairing link
// and stay in device-local storage only.
//
// One bundle serves both environments. Which backend a device talks to is
// decided entirely by the pairing it holds.

export const APP_SCHEMA_VERSION = 1;
export const CACHE_SCHEMA_VERSION = 2;
// The database name is kept from Phase 18 so an already installed device keeps
// its existing store instead of orphaning it. Isolation between environments is
// done per record key, not per database.
export const CACHE_DB_NAME = "phase18-menu";
export const CACHE_STORE_NAME = "snapshots";
export const CACHE_LEGACY_RECORD_KEY = "current";
export const PAIRING_STORAGE_KEY = "phase18.pairing.v1";
export const PAIRING_FRAGMENT_PARAM = "s";
export const API_TIMEOUT_MS = 20000;
export const DAY_KEYS = ["today", "tomorrow"];
export const DAY_TITLES = {today: "Сегодня", tomorrow: "Завтра"};
export const ENVIRONMENTS = ["dev", "prod"];
export const ENVIRONMENT_LABELS = {dev: "DEV", prod: "PROD"};
