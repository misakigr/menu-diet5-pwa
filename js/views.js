// Pure view layer: every function returns an HTML string for a given state.
// Keeping rendering free of DOM access makes the whole UI testable in Node.

import {APP_VERSION} from "./release.js";
import {checklistDate, productIdentity} from "./checklist.js";
import {DAY_TITLES, ENVIRONMENT_LABELS} from "./config.js";
import {
  dayHeadline, escapeHtml, fullDateLabel, ingredientsHeading,
  itemsLabel, relativeFreshness
} from "./format.js";

export function renderTopbar(state) {
  const {route, snapshot} = state;
  const version = `<span class="app-version" aria-label="Версия приложения ${APP_VERSION}">v${APP_VERSION}</span>`;
  const refresh = state.refreshing ? `<span class="refresh-indicator" role="status"><svg class="hourglass" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M7 21h10M8 3v5l8 8v5M16 3v5l-8 8v5M9 7h6M9 18h6"/></svg><span>Обновляем</span></span>` : "";
  const tools = `<div class="topbar-tools">${version}${refresh}</div>`;
  if (route.name === "setup") {
    return `<div class="topbar-inner">${tools}<h1 class="topbar-title">Подключение</h1></div>`;
  }
  if (route.name === "dish") {
    const meal = findMeal(snapshot, route.day, route.dishId);
    const day = getDay(snapshot, route.day);
    return `<div class="topbar-inner topbar-inner--detail">${tools}
      <a class="backlink" href="#/${escapeHtml(route.day)}" data-nav>
        <span class="backlink-chevron" aria-hidden="true"></span>${escapeHtml(DAY_TITLES[route.day] || "Назад")}
      </a>
      <p class="topbar-eyebrow">${escapeHtml(meal ? meal.mealLabel : "Блюдо")}${
        day ? " · " + escapeHtml(fullDateLabel(day.date)) : ""}${renderEnvironmentBadge(state)}</p>${renderStatusPill(state)}
    </div>`;
  }
  const day = getDay(snapshot, route.day);
  const title = route.name === "shopping" ? "Покупки" : (DAY_TITLES[route.day] || "Сегодня");
  const subtitle = day ? dayHeadline(day.date) : "";
  return `<div class="topbar-inner">${tools}
    <h1 class="topbar-title">${escapeHtml(title)}${renderEnvironmentBadge(state)}</h1>
    ${subtitle ? `<p class="topbar-subtitle">${escapeHtml(subtitle)}</p>` : ""}
    ${renderStatusPill(state)}
  </div>`;
}

// The active environment is shown, never the endpoint or the key. Knowing
// whether the screen holds DEV or PROD data matters; the credential does not
// belong in any view.
export function renderEnvironmentBadge(state) {
  const label = ENVIRONMENT_LABELS[state.environment];
  if (!label) return "";
  return ` <span class="envbadge envbadge--${escapeHtml(state.environment)}">${escapeHtml(label)}</span>`;
}

export function renderStatusPill(state) {
  const {status} = state;
  if (!status || !status.kind || status.kind === "fresh") return "";
  const labels = {
    offline: "Офлайн · сохранённые данные",
    stale: "Данные за " + fullDateLabel(status.staleDate || ""),
    refreshing: "Обновление…",
    error: status.message || "Обновление не удалось"
  };
  const text = labels[status.kind] || "";
  if (!text) return "";
  const age = status.fetchedAt && status.kind !== "refreshing"
    ? relativeFreshness(status.fetchedAt, status.now)
    : "";
  return `<p class="statuspill statuspill--${escapeHtml(status.kind)}" role="status">
    <span class="statuspill-dot" aria-hidden="true"></span>${escapeHtml(text)}${
      age ? ` <span class="statuspill-age">· ${escapeHtml(age)}</span>` : ""}</p>`;
}

export function renderTabbar(state) {
  const tabs = [
    {id: "today", href: "#/today", label: "Сегодня", icon: iconToday()},
    {id: "tomorrow", href: "#/tomorrow", label: "Завтра", icon: iconTomorrow()},
    {id: "shopping", href: "#/shopping/" + (state.route.day || "today"), label: "Покупки", icon: iconCart()}
  ];
  return `<div class="tabbar-inner">${tabs.map(tab => `
    <a class="tab${state.activeTab === tab.id ? " tab--active" : ""}" href="${tab.href}" data-nav
       ${state.activeTab === tab.id ? 'aria-current="page"' : ""}>
      ${tab.icon}<span class="tab-label">${escapeHtml(tab.label)}</span>
    </a>`).join("")}</div>`;
}

export function renderScreen(state) {
  if (state.route.name === "setup") return renderSetup(state);
  if (!state.snapshot) return state.loading ? renderSkeleton() : renderNoData(state);
  if (state.route.name === "dish") return renderDish(state);
  if (state.route.name === "shopping") return renderShopping(state);
  return renderDay(state);
}

export function renderDay(state) {
  const day = getDay(state.snapshot, state.route.day);
  if (!day) return renderNoData(state);
  if (!day.available || day.meals.length === 0) {
    return section(`${renderEmpty(
      "Меню не сгенерировано",
      "На " + fullDateLabel(day.date) + " готового меню нет. Ничего не создаётся и не изменяется."
    )}`);
  }
  const persons = state.snapshot.meta.persons;
  const cards = day.meals.map(meal => `
    <a class="card meal" href="#/dish/${escapeHtml(day.day)}/${escapeHtml(meal.dishId)}" data-nav>
      <span class="meal-emoji" aria-hidden="true">${escapeHtml(meal.emoji)}</span>
      <span class="meal-body">
        <span class="meal-type">${escapeHtml(meal.mealLabel)}</span>
        <span class="meal-name">${escapeHtml(meal.dishName)}</span>
        <span class="meal-meta">${escapeHtml(meal.nutritionPerPerson.kcalText)} ккал · ${
          escapeHtml(meal.nutritionPerPerson.portionText)} на 1 человека</span>
      </span>
      <span class="chevron" aria-hidden="true"></span>
    </a>`).join("");
  return section(`
    <p class="section-caption">${escapeHtml(day.meals.length)} приёмов пищи · расчёт на ${
      escapeHtml(persons)} ${escapeHtml(state.snapshot.meta.personsLabel || "")}</p>
    <div class="stack">${cards}</div>
    ${renderShoppingLink(day)}`);
}

function renderShoppingLink(day) {
  if (!day.shopping || !day.shopping.available) return "";
  return `<a class="card rowlink" href="#/shopping/${escapeHtml(day.day)}" data-nav>
    <span class="rowlink-emoji" aria-hidden="true">🛒</span>
    <span class="rowlink-body">
      <span class="rowlink-title">Покупки на этот день</span>
      <span class="rowlink-meta">${escapeHtml(day.shopping.items.length)} ${
        escapeHtml(itemsLabel(day.shopping.items.length))}</span>
    </span>
    <span class="chevron" aria-hidden="true"></span>
  </a>`;
}

export function renderDish(state) {
  const day = getDay(state.snapshot, state.route.day);
  const meal = findMeal(state.snapshot, state.route.day, state.route.dishId);
  if (!day || !meal) {
    return section(renderEmpty("Блюдо не найдено", "Откройте меню заново — данные могли обновиться."));
  }
  const persons = state.snapshot.meta.persons;
  const nutrition = meal.nutritionPerPerson;
  const macros = [
    {label: "Ккал", value: nutrition.kcalText},
    {label: "Белки", value: nutrition.proteinText},
    {label: "Жиры", value: nutrition.fatText},
    {label: "Углеводы", value: nutrition.carbsText}
  ];
  const ingredients = meal.ingredients.length
    ? `<ul class="ingredients">${meal.ingredients.map(item => `
        <li class="ingredient"><span class="ingredient-name">${escapeHtml(item.name || item.text)}</span>${
          item.quantity ? `<span class="ingredient-qty">${escapeHtml(item.quantity)}</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">Ингредиенты недоступны для этого блюда.</p>`;
  const recipe = meal.recipe
    ? `<div class="recipe">${meal.recipe.split(/\n+/).filter(Boolean)
        .map(part => `<p>${escapeHtml(part)}</p>`).join("")}</div>`
    : `<p class="muted">Подробная инструкция недоступна для этого блюда.</p>`;
  return section(`
    <h2 class="dish-title">${escapeHtml(meal.dishName)}</h2>
    <div class="card macros">${macros.map(macro => `
      <div class="macro"><span class="macro-value">${escapeHtml(macro.value)}</span>
      <span class="macro-label">${escapeHtml(macro.label)}</span></div>`).join("")}</div>
    <p class="section-caption">Порция ${escapeHtml(nutrition.portionText)} · КБЖУ и порция указаны на 1 человека</p>
    <h3 class="section-title">${escapeHtml(ingredientsHeading(persons))}</h3>
    <div class="card">${ingredients}</div>
    <h3 class="section-title">Приготовление</h3>
    <div class="card">${recipe}</div>`);
}

export function renderShopping(state) {
  const day = getDay(state.snapshot, state.route.day);
  if (!day) return renderNoData(state);
  const persons = state.snapshot.meta.persons;
  const segmented = `<div class="segmented" role="tablist">
    ${["today", "tomorrow"].map(key => `
      <a class="segment${state.route.day === key ? " segment--active" : ""}"
         href="#/shopping/${key}" data-nav role="tab"
         aria-selected="${state.route.day === key ? "true" : "false"}">${escapeHtml(DAY_TITLES[key])}</a>`).join("")}
  </div>`;
  if (!day.shopping || !day.shopping.available) {
    return section(`${segmented}${renderEmpty(
      "Список покупок пуст",
      "На " + fullDateLabel(day.date) + " покупки не рассчитаны."
    )}`);
  }
  const enabled = Boolean(checklistDate(state.snapshot, state.route.day, state.status?.now));
  const checked = enabled ? (state.checklist?.checked || new Set()) : new Set();
  const count = day.shopping.items.filter(item => checked.has(productIdentity(item))).length;
  const progress = enabled ? `<p class="checklist-progress" role="status">${count} из ${day.shopping.items.length} куплено<span>Отметки на сегодня</span></p>${state.checklist?.persistent === false ? '<p class="section-caption">Хранилище недоступно: отметки сохранятся только до закрытия приложения.</p>' : ""}` : "";
  const rows = day.shopping.items.map(item => {
    const identity = productIdentity(item);
    const purchased = checked.has(identity);
    const content = `<span class="product-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span>
      <span class="product-name">${escapeHtml(item.product)}</span>
      <span class="product-qty">${escapeHtml(item.quantity)}</span>`;
    return `<li class="product${purchased ? " product--checked" : ""}${enabled ? " product--interactive" : ""}">${enabled && identity
      ? `<button type="button" class="purchase-row" data-purchase="${escapeHtml(identity)}" aria-pressed="${purchased}" aria-label="${escapeHtml(item.product + ", " + item.quantity)}"><span class="check-circle" aria-hidden="true">${purchased ? "✓" : ""}</span>${content}</button>`
      : content}</li>`;
  }).join("");
  return section(`
    ${segmented}
    <p class="section-caption">${escapeHtml(fullDateLabel(day.date))} · на ${escapeHtml(persons)} ${
      escapeHtml(state.snapshot.meta.personsLabel || "")} · ${escapeHtml(day.shopping.items.length)} ${
      escapeHtml(itemsLabel(day.shopping.items.length))}</p>
    ${progress}<div class="card shopping-card"><ul class="products">${rows}</ul></div>`);
}

export function renderSetup(state) {
  const error = state.setupError
    ? `<p class="formerror" role="alert">${escapeHtml(state.setupError)}</p>` : "";
  return section(`
    <div class="card intro">
      <h2 class="intro-title">Подключение к данным</h2>
      <p class="intro-text">Приложение не хранит адресов и ключей в опубликованном коде.
      Откройте одноразовую ссылку подключения — или вставьте её целиком в поле ниже.
      Данные подключения останутся только на этом устройстве.</p>
      <p class="intro-text">Одна и та же ссылка определяет, к какой среде подключено
      устройство. Повторное подключение заменяет текущую среду; кэш каждой среды
      хранится отдельно.</p>
      ${state.environment ? `<p class="intro-status">Текущая среда:
        <span class="envbadge envbadge--${escapeHtml(state.environment)}">${
          escapeHtml(ENVIRONMENT_LABELS[state.environment] || state.environment)}</span></p>` : ""}
    </div>
    <form class="card form" id="setup-form">
      <label class="field">
        <span class="field-label">Ссылка подключения</span>
        <textarea class="field-input" id="setup-link" rows="4" autocomplete="off"
          autocapitalize="off" autocorrect="off" spellcheck="false"
          placeholder="https://…/#s=…"></textarea>
      </label>
      ${error}
      <button class="button" type="submit">Подключить</button>
    </form>
    ${state.paired ? `<button class="button button--quiet" id="setup-forget" type="button">Отключить это устройство</button>` : ""}`);
}

export function renderNoData(state) {
  if (!state.paired) {
    return section(renderEmpty(
      "Приложение не подключено",
      "Откройте одноразовую ссылку подключения, чтобы загрузить меню.",
      `<a class="button" href="#/setup" data-nav>Подключить</a>`
    ));
  }
  const message = state.status && state.status.message
    ? state.status.message
    : "Нет сохранённых данных, а сервер сейчас недоступен.";
  return section(renderEmpty("Данные недоступны", message,
    `<button class="button" id="retry" type="button">Повторить</button>`));
}

export function renderEmpty(title, text, action) {
  return `<div class="empty">
    <p class="empty-title">${escapeHtml(title)}</p>
    <p class="empty-text">${escapeHtml(text)}</p>
    ${action || ""}</div>`;
}

export function renderSkeleton() {
  return section(`<div class="stack">${
    [0, 1, 2, 3].map(() => `<div class="card skeleton"><span class="skeleton-line skeleton-line--short"></span>
      <span class="skeleton-line"></span></div>`).join("")}</div>`);
}

function section(inner) {
  return `<div class="section">${inner}</div>`;
}

export function getDay(snapshot, dayKey) {
  if (!snapshot || !snapshot.days) return null;
  return snapshot.days[dayKey] || null;
}

export function findMeal(snapshot, dayKey, dishId) {
  const day = getDay(snapshot, dayKey);
  if (!day) return null;
  return day.meals.find(meal => meal.dishId === dishId) || null;
}

function iconToday() {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 6Z"/><circle cx="12" cy="14.5" r="1.6" fill="currentColor" stroke="none"/></svg>`;
}
function iconTomorrow() {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 6Z"/><path d="M10 13.5l2.4 2.2 2.4-3.4"/></svg>`;
}
function iconCart() {
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h7.7a1.6 1.6 0 0 0 1.6-1.2L20 7H6"/><circle cx="9.5" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="19" r="1.4" fill="currentColor" stroke="none"/></svg>`;
}
