// Hash routing. Hash routes survive a hard refresh and direct navigation on
// GitHub Pages without any server-side rewrite rules.

import {DAY_KEYS} from "./config.js";

const DEFAULT_ROUTE = {name: "day", day: "today", dishId: ""};

export function parseRoute(hash) {
  const text = String(hash || "").replace(/^#/, "");
  if (!text || text.startsWith("s=")) return {...DEFAULT_ROUTE};
  const parts = text.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return {...DEFAULT_ROUTE};
  if (parts[0] === "setup") return {name: "setup", day: "today", dishId: ""};
  if (DAY_KEYS.includes(parts[0])) return {name: "day", day: parts[0], dishId: ""};
  if (parts[0] === "shopping") {
    const day = DAY_KEYS.includes(parts[1]) ? parts[1] : "today";
    return {name: "shopping", day, dishId: ""};
  }
  if (parts[0] === "dish" && DAY_KEYS.includes(parts[1]) && /^dish_[a-z0-9]+$/.test(parts[2] || "")) {
    return {name: "dish", day: parts[1], dishId: parts[2]};
  }
  return {...DEFAULT_ROUTE};
}

export function routeHref(route) {
  if (!route || route.name === "day") return "#/" + ((route && route.day) || "today");
  if (route.name === "setup") return "#/setup";
  if (route.name === "shopping") return "#/shopping/" + (route.day || "today");
  if (route.name === "dish") return "#/dish/" + (route.day || "today") + "/" + route.dishId;
  return "#/today";
}

export function activeTab(route) {
  if (!route) return "today";
  if (route.name === "shopping") return "shopping";
  if (route.name === "setup") return "";
  return route.day || "today";
}
