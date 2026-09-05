const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token");
}

function getSession() {
  let branches = [];
  try {
    branches = JSON.parse(localStorage.getItem("branches") || "[]");
  } catch (e) {}
  return {
    token: localStorage.getItem("token"),
    role: localStorage.getItem("role"),
    fullName: localStorage.getItem("full_name"),
    username: localStorage.getItem("username"),
    companyName: localStorage.getItem("company_name"),
    theme: localStorage.getItem("theme") || "dark-engineering",
    branchId: Number(localStorage.getItem("branch_id")) || null,
    branchName: localStorage.getItem("branch_name"),
    isAdminBranch: localStorage.getItem("is_admin_branch") === "true",
    isPlatformAdmin: localStorage.getItem("is_platform_admin") === "true",
    isDemo: localStorage.getItem("is_demo") === "true",
    branches,
  };
}

function storeSession(data) {
  localStorage.setItem("token", data.access_token);
  localStorage.setItem("role", data.role);
  localStorage.setItem("full_name", data.full_name);
  localStorage.setItem("username", data.username);
  localStorage.setItem("company_name", data.company_name || "");
  localStorage.setItem("theme", data.theme || "dark-engineering");
  localStorage.setItem("branch_id", data.branch_id);
  localStorage.setItem("branch_name", data.branch_name || "");
  localStorage.setItem("is_admin_branch", data.is_admin_branch ? "true" : "false");
  localStorage.setItem("is_platform_admin", data.is_platform_admin ? "true" : "false");
  localStorage.setItem("is_demo", data.is_demo ? "true" : "false");
  localStorage.setItem("branches", JSON.stringify(data.branches || []));
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("full_name");
  localStorage.removeItem("username");
  localStorage.removeItem("company_name");
  localStorage.removeItem("theme");
  localStorage.removeItem("branch_id");
  localStorage.removeItem("branch_name");
  localStorage.removeItem("is_admin_branch");
  localStorage.removeItem("is_platform_admin");
  localStorage.removeItem("is_demo");
  localStorage.removeItem("branches");
}

// Applies a UI theme immediately (for the theme switcher) and persists it so the
// next page load's early anti-flash script (see each page's <head>) picks it up
// before first paint.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch (e) {}
}

async function apiRequest(path, { method = "GET", body = null, form = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload = null;
  if (body !== null) {
    if (form) {
      payload = body; // URLSearchParams
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401) {
    clearSession();
    window.location.href = "/index.html";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody.detail) detail = typeof errBody.detail === "string" ? errBody.detail : JSON.stringify(errBody.detail);
    } catch (e) {}
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: "POST", body }),
  put: (path, body) => apiRequest(path, { method: "PUT", body }),
  del: (path) => apiRequest(path, { method: "DELETE" }),
};

function fmtMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shared healthy/warn/critical tiering used by the inventory heatmap and the
// dashboard's low-stock list, so the same numbers always mean the same color.
function stockSeverity(qty, reorderLevel) {
  if (qty <= 0 || qty <= reorderLevel * 0.5) return "critical";
  if (qty <= reorderLevel) return "warn";
  return "healthy";
}

function timeAgo(value) {
  if (!value) return "";
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(value);
  const d = new Date(hasTimezone ? value : value + "Z");
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fmtDate(value) {
  if (!value) return "";
  // The API stores/returns timestamps in UTC but without a timezone marker
  // (e.g. "2026-09-03T13:49:00"). Without a "Z" or offset, the JS Date
  // constructor treats that string as local time instead of UTC, silently
  // shifting every displayed time by the browser's UTC offset. Force UTC
  // parsing here so it converts to the viewer's local time correctly.
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(value);
  const d = new Date(hasTimezone ? value : value + "Z");
  return d.toLocaleString();
}

const _escapeHtmlEl = document.createElement("div");
// Every table/list render across the app builds rows via innerHTML template
// literals. Any user-entered text (product name, customer name, description,
// username, ...) MUST go through this before being interpolated in — otherwise
// a low-privileged user could store a <script>/onerror payload that runs in
// another user's browser (stored XSS) and steal their session token.
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  _escapeHtmlEl.textContent = String(value);
  return _escapeHtmlEl.innerHTML;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// columns: [{ key, label }] — rows: array of plain objects
function exportCSV(filename, columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(","));
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
