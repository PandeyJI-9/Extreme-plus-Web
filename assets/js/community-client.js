/**
 * PROJECT EXTREME++ — shared community client
 * Used by the profile and moderation pages. The main page keeps its own
 * auth flow; this file is intentionally dependency-free.
 */
(() => {
  "use strict";

  const config = window.EXTREME_CONFIG || {};
  const community = config.community || {};
  const publicConfig = community.supabase || {};
  const AUTH_KEY = "extreme_plus_auth_v1";
  const THEME_KEY = "extreme_plus_theme";
  const VISITOR_KEY = "extreme_plus_visitor_id";
  const REQUEST_TIMEOUT = 12000;

  function normaliseBase(value) {
    return String(value || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/auth\/v1$/i, "");
  }

  function validBase(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || (url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/i.test(url.hostname));
    } catch (error) {
      return false;
    }
  }

  const base = normaliseBase(publicConfig.url);
  const anonKey = String(publicConfig.anonKey || "").trim();
  const ready = validBase(base) && anonKey.length > 10;

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      // Storage can be disabled; the session simply won't persist.
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Ignore disabled storage.
    }
  }

  function randomId() {
    const crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (crypto && typeof crypto.getRandomValues === "function") {
      return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function getVisitorId() {
    let value = storageGet(VISITOR_KEY);
    if (!value || value.length < 16) {
      value = `v_${randomId()}`;
      storageSet(VISITOR_KEY, value);
    }
    return value;
  }

  function normaliseSession(payload) {
    if (!payload || !payload.access_token) return null;
    const rawExpires = Number(payload.expires_at) || 0;
    const expiresAt = rawExpires
      ? (rawExpires > 1e12 ? rawExpires : rawExpires * 1000)
      : Date.now() + (Number(payload.expires_in) || 3600) * 1000;
    return {
      access_token: String(payload.access_token),
      refresh_token: String(payload.refresh_token || ""),
      expires_at: expiresAt,
      token_type: String(payload.token_type || "bearer")
    };
  }

  function loadSession() {
    const raw = storageGet(AUTH_KEY);
    if (!raw) return null;
    try {
      return normaliseSession(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveSession(session) {
    if (!session) return;
    storageSet(AUTH_KEY, JSON.stringify(session));
  }

  function clearSession() {
    storageRemove(AUTH_KEY);
  }

  async function request(path, options = {}) {
    if (!ready) {
      const error = new Error("The community backend is not configured.");
      error.status = 503;
      throw error;
    }

    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      apikey: anonKey,
      Accept: "application/json",
      ...(options.headers || {})
    };
    const session = options.session !== undefined
      ? options.session
      : (options.auth ? loadSession() : null);

    if (options.auth) {
      if (!session || !session.access_token) {
        const error = new Error("Sign in required.");
        error.status = 401;
        throw error;
      }
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    let body = options.body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
      : 0;

    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body,
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      const next = new Error(error && error.name === "AbortError"
        ? "The community backend timed out."
        : "The community backend could not be reached.");
      next.status = 0;
      throw next;
    } finally {
      if (timer) window.clearTimeout(timer);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }

    if (!response.ok) {
      const message = (data && (data.msg || data.message || data.error_description || data.error))
        || `The community backend returned ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function refreshSession(session) {
    if (!session || !session.refresh_token) {
      const error = new Error("No refresh token available.");
      error.status = 401;
      throw error;
    }
    const payload = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token }
    });
    const next = normaliseSession(payload);
    if (!next) {
      const error = new Error("The community backend returned an invalid session.");
      error.status = 401;
      throw error;
    }
    saveSession(next);
    return next;
  }

  async function getValidSession() {
    let session = loadSession();
    if (!session) return null;
    if (!session.access_token || Date.now() >= Number(session.expires_at || 0) - 60000) {
      try {
        session = await refreshSession(session);
      } catch (error) {
        clearSession();
        return null;
      }
    }
    return session;
  }

  async function getUser(session) {
    return request("/auth/v1/user", { auth: true, session });
  }

  async function rpc(name, args = {}, options = {}) {
    const useAuth = options.auth !== false;
    const session = options.session !== undefined
      ? options.session
      : (useAuth ? loadSession() : null);
    return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      auth: useAuth,
      session,
      body: args || {}
    });
  }

  async function table(name, query = "", options = {}) {
    const suffix = query ? `?${query}` : "";
    const useAuth = options.auth !== false;
    const session = options.session !== undefined
      ? options.session
      : (useAuth ? loadSession() : null);
    return request(`/rest/v1/${encodeURIComponent(name)}${suffix}`, {
      method: options.method || "GET",
      auth: useAuth,
      session,
      body: options.body,
      headers: options.headers
    });
  }

  function encodeStoragePath(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  function storagePublicUrl(bucket, path) {
    if (!ready || !bucket || !path) return "";
    return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`;
  }

  async function storageUpload(bucket, path, file, session, contentType = "") {
    if (!ready) {
      const error = new Error("Storage is not configured.");
      error.status = 503;
      throw error;
    }
    if (!session || !session.access_token) {
      const error = new Error("Sign in required.");
      error.status = 401;
      throw error;
    }
    if (!file) {
      const error = new Error("Choose a file first.");
      error.status = 400;
      throw error;
    }

    const response = await fetch(
      `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": contentType || file.type || "application/octet-stream",
          "cache-control": "max-age=3600",
          "x-upsert": "false"
        },
        body: file
      }
    );

    if (!response.ok) {
      let message = "The file could not be uploaded.";
      try {
        const payload = await response.json();
        message = payload && (payload.message || payload.error) ? String(payload.message || payload.error) : message;
      } catch (error) {
        // Keep the friendly fallback.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    try {
      return await response.json();
    } catch (error) {
      return {};
    }
  }

  async function storageDelete(bucket, path, session) {
    if (!ready || !bucket || !path) return false;
    if (!session || !session.access_token) return false;
    try {
      const response = await fetch(
        `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`,
        {
          method: "DELETE",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  function normaliseAvatarUrl(value, size = 64) {
    if (!value) return "";
    let url;
    try {
      url = new URL(value, window.location.href);
    } catch (error) {
      return "";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";

    if (/(^|\.)githubusercontent\.com$/i.test(url.hostname) && /^avatars\./i.test(url.hostname)) {
      url.searchParams.set("s", String(size));
    } else if (/(^|\.)googleusercontent\.com$/i.test(url.hostname)) {
      const suffix = `=s${size}-c`;
      if (/=s\d+(?:-c)?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/=s\d+(?:-c)?$/i, suffix);
      } else {
        url.pathname = `${url.pathname}${suffix}`;
      }
    }
    return url.href;
  }

  function initials(value) {
    return String(value || "EX")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "EX";
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return new Intl.NumberFormat("en", {
      notation: number >= 1000 ? "compact" : "standard",
      maximumFractionDigits: 1
    }).format(number);
  }

  function formatDate(value, options) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", options || {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatDateTime(value) {
    return formatDate(value, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    const units = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60]
    ];
    for (const [unit, size] of units) {
      if (abs >= size) {
        return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(seconds / size), unit);
      }
    }
    return "just now";
  }

  function providerLabel(value) {
    const provider = String(value || "").toLowerCase();
    if (provider === "google") return "Google";
    if (provider === "github") return "GitHub";
    return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Community";
  }

  function initTheme() {
    const root = document.documentElement;
    const toggle = document.querySelector("#themeToggle");
    const meta = document.querySelector("#themeColorMeta");
    const system = window.matchMedia("(prefers-color-scheme: light)");
    const stored = storageGet(THEME_KEY);

    const sync = (theme) => {
      const next = theme === "light" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      root.style.colorScheme = next;
      if (meta) meta.setAttribute("content", next === "light" ? "#f3f5fa" : "#06070b");
      if (toggle) {
        const light = next === "light";
        toggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
        toggle.setAttribute("aria-pressed", String(light));
      }
    };

    sync(stored || (system.matches ? "light" : "dark"));

    if (toggle) {
      toggle.addEventListener("click", () => {
        const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
        storageSet(THEME_KEY, next);
        sync(next);
      });
    }

    const onChange = (event) => {
      if (storageGet(THEME_KEY)) return;
      sync(event.matches ? "light" : "dark");
    };
    if (typeof system.addEventListener === "function") system.addEventListener("change", onChange);
    else if (typeof system.addListener === "function") system.addListener(onChange);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    const text = button.querySelector("[data-button-label], span");
    if (busy) {
      button.dataset.busy = "true";
      if (!button.dataset.idleLabel && text) button.dataset.idleLabel = text.textContent;
      if (text && label) text.textContent = label;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else {
      delete button.dataset.busy;
      if (text && button.dataset.idleLabel) text.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  let toastTimer = 0;
  function showToast(message, duration = 4800) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = String(message || "");
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  async function signOut(session) {
    try {
      if (session && session.access_token) {
        await request("/auth/v1/logout", { method: "POST", auth: true, session });
      }
    } catch (error) {
      // Local sign-out is still valid if the remote call fails.
    }
    clearSession();
  }

  async function trackVisit(path) {
    if (!ready) return;
    try {
      await rpc("community_track_visit", {
        p_visitor_id: getVisitorId(),
        p_path: String(path || window.location.pathname || "/")
      }, { auth: false });
    } catch (error) {
      // Analytics must never block the page.
    }
  }

  window.ExtremeCommunity = Object.freeze({
    ready,
    base,
    anonKey,
    AUTH_KEY,
    THEME_KEY,
    request,
    rpc,
    table,
    getValidSession,
    getUser,
    refreshSession,
    loadSession,
    saveSession,
    clearSession,
    signOut,
    getVisitorId,
    trackVisit,
    storagePublicUrl,
    storageUpload,
    storageDelete,
    normaliseAvatarUrl,
    smallAvatar: normaliseAvatarUrl,
    initials,
    formatNumber,
    formatDate,
    formatDateTime,
    relativeTime,
    providerLabel,
    initTheme,
    setBusy,
    showToast
  });
})();
