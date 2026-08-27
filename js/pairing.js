// One-time device pairing.
//
// The published bundle contains no backend address and no credential. The owner
// opens a pairing link once; its payload lives in the URL fragment, which the
// browser never sends to any server. The parsed pairing is kept in
// device-local storage and the fragment is stripped immediately.

import {PAIRING_FRAGMENT_PARAM, PAIRING_STORAGE_KEY} from "./config.js";

const EXEC_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }
  return Buffer.from(padded, "base64").toString("utf8");
}

export function validatePairing(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const api = String(candidate.api || "").trim();
  const key = String(candidate.key || "").trim();
  if (!EXEC_URL_PATTERN.test(api)) return null;
  if (!KEY_PATTERN.test(key)) return null;
  return {api, key, env: String(candidate.env || "dev")};
}

export function parsePairingFragment(hash) {
  const text = String(hash || "").replace(/^#/, "");
  if (!text) return null;
  const params = new URLSearchParams(text);
  const payload = params.get(PAIRING_FRAGMENT_PARAM);
  if (!payload) return null;
  try {
    return validatePairing(JSON.parse(decodeBase64Url(payload)));
  } catch (error) {
    return null;
  }
}

export function buildSnapshotUrl(pairing, route) {
  const url = new URL(pairing.api);
  url.searchParams.set("p18", route || "snapshot");
  url.searchParams.set("k", pairing.key);
  return url.toString();
}

export function createPairingStore(storage) {
  return {
    read() {
      try {
        const raw = storage.getItem(PAIRING_STORAGE_KEY);
        return raw ? validatePairing(JSON.parse(raw)) : null;
      } catch (error) {
        return null;
      }
    },
    write(pairing) {
      const valid = validatePairing(pairing);
      if (!valid) return null;
      try {
        storage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(valid));
      } catch (error) {
        // A private-mode storage failure must not break the current session.
      }
      return valid;
    },
    clear() {
      try {
        storage.removeItem(PAIRING_STORAGE_KEY);
      } catch (error) {
        // Nothing to recover: the session simply stays unpaired.
      }
    }
  };
}
