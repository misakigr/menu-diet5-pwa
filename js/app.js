// Application shell: the only module that touches the DOM, storage engines and
// the network. All decision logic lives in the pure modules it imports.

import {ApiError, fetchSnapshot} from "./api.js";
import {localDateKey} from "./format.js";
import {createPairingStore, parsePairingFragment, validatePairing} from "./pairing.js";
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
  status: {kind: "refreshing", now: Date.now()},
  setupError: "",
  activeTab: "today"
};

const pairingStore = createPairingStore(safeLocalStorage());
let pairing = null;
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
  elements.topbar.innerHTML = renderTopbar(state);
  elements.screen.innerHTML = renderScreen(state);
  elements.tabbar.hidden = state.route.name === "setup" || (!state.snapshot && !state.paired);
  elements.tabbar.innerHTML = elements.tabbar.hidden ? "" : renderTabbar(state);
  elements.app.dataset.route = state.route.name;
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

async function refresh(options) {
  const settings = options || {};
  if (refreshing || !pairing) return;
  refreshing = true;
  if (settings.showSpinner || !state.snapshot) setStatus("refreshing");
  render();
  try {
    const snapshot = await fetchSnapshot(pairing);
    if (shouldReplace(state.record, snapshot)) {
      const record = await snapshotStore.save(snapshot);
      if (record) applyRecord(record);
    } else if (state.record) {
      // Same fingerprint: keep the stored record and only refresh its age.
      state.record = Object.assign({}, state.record, {fetchedAt: Date.now()});
      await snapshotStore.save(state.record.snapshot);
    }
    state.loading = false;
    freshnessStatus();
  } catch (error) {
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
  }
}

function adoptPairing(candidate) {
  const valid = validatePairing(candidate);
  if (!valid) return false;
  pairing = pairingStore.write(valid);
  state.paired = Boolean(pairing);
  return state.paired;
}

function consumePairingFragment() {
  const fromFragment = parsePairingFragment(location.hash);
  if (!fromFragment) return false;
  const adopted = adoptPairing(fromFragment);
  // Strip the credential from the address bar and history entry immediately.
  history.replaceState(null, "", location.pathname + location.search + "#/today");
  return adopted;
}

function onNavigate(event) {
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
    pairingStore.clear();
    pairing = null;
    state.paired = false;
    snapshotStore.clear();
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
  if (!parsed || !adoptPairing(parsed)) {
    state.setupError = "Ссылка не распознана. Скопируйте её полностью, вместе с частью после «#».";
    render();
    return;
  }
  state.setupError = "";
  location.hash = "#/today";
  refresh({showSpinner: true});
}

async function start() {
  consumePairingFragment();
  pairing = pairing || pairingStore.read();
  state.paired = Boolean(pairing);

  const adapter = await createBestAdapter(window);
  snapshotStore = createSnapshotStore(adapter);

  const record = await snapshotStore.load();
  if (record) {
    applyRecord(record);
    freshnessStatus();
  } else {
    state.loading = Boolean(pairing);
    if (!pairing) setStatus("fresh");
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
  window.addEventListener("online", () => refresh());
  window.addEventListener("offline", () => { freshnessStatus(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", {scope: "./"}).catch(() => {
      // A blocked service worker only costs offline shell caching.
    });
  });
}

start().catch(() => {
  state.loading = false;
  setStatus("error", {message: "Приложение не удалось запустить."});
  render();
});

export {localDateKey};
