// Read-only snapshot client. One request returns everything the app needs for
// Today, Tomorrow, every recipe and both shopping lists.

import {API_TIMEOUT_MS} from "./config.js";
import {buildSnapshotUrl} from "./pairing.js";
import {validateSnapshot} from "./store.js";

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function fetchSnapshot(pairing, options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) throw new ApiError("no_fetch", "Сеть недоступна в этом окружении");
  if (!pairing) throw new ApiError("not_paired", "Приложение не подключено к DEV-данным");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : API_TIMEOUT_MS;
  const timer = controller && typeof setTimeout === "function"
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;
  try {
    response = await fetchImpl(buildSnapshotUrl(pairing, "snapshot"), {
      method: "GET",
      // The access key is a query parameter on purpose: a custom header would
      // trigger a CORS preflight that Apps Script web apps cannot answer.
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: controller ? controller.signal : undefined
    });
  } catch (error) {
    throw new ApiError("network", "Не удалось связаться с сервером");
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response || !response.ok) throw new ApiError("http", "Сервер вернул ошибку");

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError("malformed", "Ответ сервера не распознан");
  }

  if (!payload || payload.ok !== true) {
    const code = payload && payload.error ? String(payload.error) : "unknown";
    if (code === "forbidden") throw new ApiError("forbidden", "Ключ доступа отклонён");
    throw new ApiError(code, "Данные недоступны");
  }
  if (!validateSnapshot(payload.snapshot)) {
    throw new ApiError("malformed", "Снимок данных не прошёл проверку");
  }
  return payload.snapshot;
}
