// Application shell: the only module that touches the DOM, storage engines and
// the network. All decision logic lives in the pure modules it imports.
//
// One bundle serves both environments. The active pairing decides which backend
// is called and which cache namespace is used; nothing about the environment is
// baked into the published code.

import {CHECKLIST_PREFIX, checklistDate, createChecklistStore, currentTomorrowDate, nextDateDelay, productIdentity} from "./checklist.js";
import {ApiError, fetchSnapshot} from "./api.js";
import {CACHE_LEGACY_RECORD_KEY} from "./config.js";
import {localDateKey} from "./format.js";
import {
  createPairingStore, isSamePairing, pairingRecordKey,
  parsePairingFragment, validatePairing
} from "./pairing.js";
import {activeTab, parseRoute, routeHref} from "./router.js";
import {createBestAdapter} from "./storage.js";
import {createSnapshotStore, isRolledOver, shouldReplace} from "./store.js";
import {renderScreen, renderTabbar, renderTopbar} from "./views.js";

const elements = {
  app: document.getElementById("app"),
  topbar: document.getElementById("topbar"),
  screen: document.getElementById("screen"),
  tabbar: document.getElementById("tabbar")
};

const state = {
  route: parseRoute(location.hash),
  snapshot: null,
  record: null,
  loading: true,
  paired: false,
  environment: "",
  status: {kind: "refreshing", now: Date.now()},
  setupError: "",
  activeTab: "today"
};

const localStorage = safeLocalStorage();
const pairingStore = createPairingStore(localStorage);
const checklistStore = createChecklistStore(localStorage);
let dateTimer = null;
let pairing = null;
let adapter = null;
let snapshotStore = null;
let refreshing = false;

function safeLocalStorage() {
  try {
    const storage = window.localStorage;
    const probe = "phase18.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch (error) {
    const memory = new Map();
    return {
      persistent: false,
      getItem: key => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: key => memory.delete(key)
    };
  }
}

function render() {
  state.route = parseRoute(location.hash);
  state.activeTab = activeTab(state.route);
  state.status.now = Date.now();
  const namespace = pairing ? pairingRecordKey(pairing) : "";
  if (namespace && state.snapshot) checklistStore.expire(namespace, currentTomorrowDate(state.snapshot.meta.timezone, state.status.now));
  const date = checklistDate(state.snapshot, state.route.day, state.status.now);
  state.checklist = {
    date,
    namespace,
    checked: date && namespace ? checklistStore.read(namespace, date) : new Set(),
    persistent: checklistStore.persistent
  };
  state.refreshing = refreshing && navigator.onLine;
  if (state.record && isRolledOver(state.record, state.status.now)) freshnessStatus();
  scheduleDateBoundary();
  elements.topbar.innerHTML = renderTopbar(state);
  elements.screen.innerHTML = renderScreen(state);
  elements.tabbar.hidden = state.route.name === "setup" || (!state.snapshot && !state.paired);
  elements.tabbar.innerHTML = elements.tabbar.hidden ? "" : renderTabbar(state);
  elements.app.dataset.route = state.route.name;
  elements.app.dataset.environment = state.environment || "";
}

function scheduleDateBoundary() {
  if (!window.setTimeout) return;
  window.clearTimeout(dateTimer);
  if (!state.snapshot || document.visibilityState === "hidden") return;
  dateTimer = window.setTimeout(() => {
    freshnessStatus();
    render();
    if (navigator.onLine) refresh();
  }, nextDateDelay(state.snapshot.meta.timezone));
}

function setStatus(kind, extra) {
  state.status = Object.assign({kind, now: Date.now()}, extra || {});
}

function applyRecord(record) {
  state.record = record;
  state.snapshot = record ? record.snapshot : null;
  state.loading = false;
}

function freshnessStatus() {
  if (!state.record) return setStatus("error");
  const now = Date.now();
  if (isRolledOver(state.record, now)) {
    return setStatus("stale", {
      staleDate: state.record.snapshot.meta.todayDate,
      fetchedAt: state.record.fetchedAt
    });
  }
  if (!navigator.onLine) {
    return setStatus("offline", {fetchedAt: state.record.fetchedAt});
  }
  return setStatus("fresh", {fetchedAt: state.record.fetchedAt});
}

// The store is rebuilt whenever the active pairing changes, so the record key
// and the expected environment always match the backend actually in use.
function useStore(activePairing) {
  pairing = activePairing;
  state.paired = Boolean(activePairing);
  state.environment = activePairing ? activePairing.env : "";
  snapshotStore = activePairing && adapter
    ? createSnapshotStore(adapter, {
        recordKey: pairingRecordKey(activePairing),
        environment: activePairing.env
      })
    : null;
}

async function loadCached() {
  if (!snapshotStore) {
    applyRecord(null);
    return null;
  }
  const record = await snapshotStore.load();
  applyRecord(record);
  if (record) freshnessStatus();
  return record;
}

async function refresh(options) {
  const settings = options || {};
  if (refreshing || !pairing || !snapshotStore) return;
  const activeStore = snapshotStore;
  const activePairing = pairing;
  refreshing = true;
  if (settings.showSpinner || !state.snapshot) setStatus("refreshing");
  render();
  try {
    const snapshot = await fetchSnapshot(activePairing);
    // A pairing change during the request invalidates this response entirely.
    if (!isSamePairing(activePairing, pairing)) return;
    if (shouldReplace(state.record, snapshot, activePairing.env)) {
      const record = await activeStore.save(snapshot);
      if (record) applyRecord(record);
    } else if (state.record) {
      // Same fingerprint: keep the stored snapshot and only refresh its age.
      applyRecord(await activeStore.touch(state.record));
    }
    state.loading = false;
    freshnessStatus();
  } catch (error) {
    if (!isSamePairing(activePairing, pairing)) return;
    state.loading = false;
    const code = error instanceof ApiError ? error.code : "unknown";
    if (state.record) {
      if (isRolledOver(state.record, Date.now())) {
        setStatus("stale", {
          staleDate: state.record.snapshot.meta.todayDate,
          fetchedAt: state.record.fetchedAt
        });
      } else {
        setStatus("offline", {fetchedAt: state.record.fetchedAt});
      }
    } else {
      setStatus("error", {message: code === "forbidden"
        ? "Ключ доступа отклонён. Откройте новую ссылку подключения."
        : "Не удалось загрузить данные. Проверьте подключение."});
    }
  } finally {
    refreshing = false;
    render();
    if (pairing && !isSamePairing(activePairing, pairing)) refresh();
  }
}

async function adoptPairing(candidate) {
  const valid = validatePairing(candidate);
  if (!valid) return false;
  if (isSamePairing(valid, pairing)) return true;
  const stored = pairingStore.write(valid);
  if (!stored) return false;
  // Switching backend must never show the previous environment's data: the
  // rendered snapshot is dropped before the new namespace is read.
  applyRecord(null);
  state.loading = true;
  useStore(stored);
  await loadCached();
  return true;
}

function consumePairingFragment() {
  const fromFragment = parsePairingFragment(location.hash);
  if (!fromFragment) return null;
  // Strip the credential from the address bar and history entry immediately.
  history.replaceState(null, "", location.pathname + location.search + "#/today");
  return fromFragment;
}

function onNavigate(event) {
  const purchase = event.target.closest("[data-purchase]");
  if (purchase) {
    event.preventDefault();
    const route = parseRoute(location.hash);
    const date = route.name === "shopping" ? checklistDate(state.snapshot, route.day) : "";
    const identity = purchase.dataset.purchase;
    const shopping = state.snapshot?.days.tomorrow.shopping;
    const items = shopping?.available ? shopping.items : [];
    if (date && pairing && purchase.dataset.purchaseDate === date &&
        purchase.dataset.purchaseNamespace === pairingRecordKey(pairing) &&
        items.some(item => productIdentity(item) === identity)) {
      checklistStore.toggle(pairingRecordKey(pairing), date, identity);
    }
    render();
    // Re-rendered buttons keep keyboard / assistive-technology focus.
    elements.screen.querySelectorAll?.("[data-purchase]").forEach(button => {
      if (button.dataset.purchase === identity) button.focus({preventScroll: true});
    });
    return;
  }
  const link = event.target.closest("a[data-nav]");
  if (link) {
    // Let the hash change drive rendering; no full page load on GitHub Pages.
    return;
  }
  const retry = event.target.closest("#retry");
  if (retry) {
    event.preventDefault();
    refresh({showSpinner: true});
    return;
  }
  const forget = event.target.closest("#setup-forget");
  if (forget) {
    event.preventDefault();
    if (snapshotStore) snapshotStore.clear();
    pairingStore.clear();
    useStore(null);
    applyRecord(null);
    location.hash = "#/setup";
    render();
  }
}

function onSubmit(event) {
  const form = event.target.closest("#setup-form");
  if (!form) return;
  event.preventDefault();
  const value = String((document.getElementById("setup-link") || {}).value || "").trim();
  const hashIndex = value.indexOf("#");
  const parsed = hashIndex >= 0 ? parsePairingFragment(value.slice(hashIndex)) : null;
  if (!parsed) {
    state.setupError = "Ссылка не распознана. Скопируйте её полностью, вместе с частью после «#».";
    render();
    return;
  }
  adoptPairing(parsed).then(adopted => {
    if (!adopted) {
      state.setupError = "Ссылка не распознана. Скопируйте её полностью, вместе с частью после «#».";
      render();
      return;
    }
    state.setupError = "";
    location.hash = "#/today";
    render();
    refresh({showSpinner: true});
  });
}

async function start() {
  const fromFragment = consumePairingFragment();
  adapter = await createBestAdapter(window);
  // A Phase 18 record was stored without an environment namespace; it is
  // dropped once rather than migrated, so nothing untyped can ever be rendered.
  try { await adapter.clear(CACHE_LEGACY_RECORD_KEY); } catch (error) { /* nothing to recover */ }

  useStore(fromFragment ? pairingStore.write(fromFragment) : pairingStore.read());
  if (pairing) {
    await loadCached();
    state.loading = !state.record;
  } else {
    applyRecord(null);
    setStatus("fresh");
  }
  render();

  if (pairing) refresh();

  window.addEventListener("hashchange", () => {
    state.setupError = "";
    render();
    elements.screen.focus({preventScroll: true});
    window.scrollTo(0, 0);
  });
  document.addEventListener("click", onNavigate);
  document.addEventListener("submit", onSubmit);
  window.addEventListener("storage", event => {
    if (event.key?.startsWith(CHECKLIST_PREFIX)) render();
  });
  window.addEventListener("pageshow", () => { freshnessStatus(); render(); });
  window.addEventListener("online", () => refresh());
  window.addEventListener("offline", () => { freshnessStatus(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      freshnessStatus(); render(); refresh();
    } else if (window.clearTimeout) window.clearTimeout(dateTimer);
  });
}

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", {scope: "./", updateViaCache: "none"}).catch(() => {
      // A blocked service worker only costs offline shell caching.
    });
  });
}

start().catch(() => {
  state.loading = false;
  setStatus("error", {message: "Приложение не удалось запустить."});
  render();
});

export {localDateKey, routeHref};
