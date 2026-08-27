// Pure formatting helpers. No DOM, no network, no storage.

const WEEKDAYS = [
  "воскресенье", "понедельник", "вторник", "среда",
  "четверг", "пятница", "суббота"
];
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];

export function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isoParts(iso) {
  if (!isIsoDate(iso)) return null;
  const parts = iso.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2]) {
    return null;
  }
  return {year: parts[0], month: parts[1], day: parts[2], date};
}

export function weekdayLabel(iso) {
  const parts = isoParts(iso);
  return parts ? WEEKDAYS[parts.date.getUTCDay()] : "";
}

export function shortDateLabel(iso) {
  const parts = isoParts(iso);
  if (!parts) return "";
  return parts.day + " " + MONTHS_GENITIVE[parts.month - 1];
}

export function fullDateLabel(iso) {
  const parts = isoParts(iso);
  if (!parts) return "";
  const pad = value => String(value).padStart(2, "0");
  return pad(parts.day) + "." + pad(parts.month) + "." + parts.year;
}

export function dayHeadline(iso) {
  const short = shortDateLabel(iso);
  const weekday = weekdayLabel(iso);
  if (!short) return "";
  return weekday ? short + ", " + weekday : short;
}

// Mirrors phase16PersonLabel_ so the ingredient header text is identical to
// the accepted Telegram wording.
export function personLabel(persons) {
  const value = Number(persons);
  if (!isFinite(value)) return "персон";
  const mod100 = Math.abs(value) % 100;
  const mod10 = Math.abs(value) % 10;
  if (mod100 >= 11 && mod100 <= 14) return "персон";
  if (mod10 === 1) return "персону";
  if (mod10 >= 2 && mod10 <= 4) return "персоны";
  return "персон";
}

export function ingredientsHeading(persons) {
  return "Ингредиенты на " + persons + " " + personLabel(persons);
}

export function itemsLabel(count) {
  const value = Number(count) || 0;
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "позиций";
  if (mod10 === 1) return "позиция";
  if (mod10 >= 2 && mod10 <= 4) return "позиции";
  return "позиций";
}

export function relativeFreshness(fetchedAt, now) {
  const then = Number(fetchedAt);
  const current = Number(now);
  if (!isFinite(then) || !isFinite(current) || then <= 0) return "";
  const minutes = Math.max(0, Math.floor((current - then) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return minutes + " мин назад";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " ч назад";
  const days = Math.floor(hours / 24);
  return days + " дн назад";
}

// Local calendar day in the snapshot timezone, used for date-rollover checks.
export function localDateKey(timezone, now) {
  const date = now instanceof Date ? now : new Date(now);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map(part => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
