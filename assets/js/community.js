/**
 * PROJECT EXTREME++ — The Garage
 * Telegram-inspired channel chat with a private bug desk.
 * Public reads, authenticated writes, server-validated forwards.
 */
(() => {
  "use strict";

  const EC = window.ExtremeCommunity;
  const config = window.EXTREME_CONFIG || {};
  const communityConfig = config.community || {};
  const supabaseConfig = communityConfig.supabase || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const OAUTH_STATE_KEY = "extreme_plus_oauth_state_v1";
  const COMMUNITY_REDIRECT_KEY = "extreme_plus_community_redirect_v1";
  const CHANNEL_KEY = "extreme_plus_last_channel";
  const OAUTH_STATE_TTL = 15 * 60 * 1000;
  const CHAT_POLL_MS = 6500;
  const STATS_POLL_MS = 60000;
  const MEMBERS_POLL_MS = 90000;

  const CHANNELS = {
    general: {
      label: "General",
      topic: "Daily garage talk, build logs and quick questions.",
      kicker: "PUBLIC CHANNEL",
      hash: "#",
      public: true
    },
    releases: {
      label: "Releases",
      topic: "Stable builds only. Latest release, changelog notes and download links.",
      kicker: "PUBLIC CHANNEL",
      hash: "#",
      public: true
    },
    bugs: {
      label: "Bug hunting",
      topic: "Private bug desk. Reports are visible only to you and the maintainer. No public messages.",
      kicker: "PRIVATE CHANNEL",
      hash: "▣",
      public: false
    },
    "off-topic": {
      label: "Off-topic",
      topic: "Phones, ROMs, gaming, music — keep it civil.",
      kicker: "PUBLIC CHANNEL",
      hash: "#",
      public: true
    }
  };

  const PUBLIC_CHANNELS = Object.keys(CHANNELS).filter((key) => CHANNELS[key].public);
  const USER_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.2" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const MENU_ICONS = {
    forward: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5 20 11l-6 6M20 11H8a4 4 0 0 0-4 4v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9v5M12 17.2v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  const state = {
    session: null,
    user: null,
    me: null,
    role: "",
    providers: [],
    channel: initialChannel(),
    messages: [],
    initializedChannels: {},
    loadingMessages: false,
    loadToken: 0,
    sending: false,
    cooldownUntil: 0,
    cooldownTimer: 0,
    stats: null,
    members: [],
    roleByUsername: {},
    bugs: [],
    bugsLoading: false,
    activeMenuId: "",
    forwardMessage: null,
    forwardTarget: "",
    reportMessage: null,
    authBusy: false,
    timers: { chat: 0, stats: 0, members: 0, heartbeat: 0 },
    lastAnnouncedId: ""
  };

  function initialChannel() {
    let hash = "";
    try {
      hash = window.location.hash.replace(/^#/, "");
    } catch (error) {
      hash = "";
    }
    if (CHANNELS[hash]) return hash;
    try {
      const stored = window.localStorage.getItem(CHANNEL_KEY);
      if (CHANNELS[stored]) return stored;
    } catch (error) {
      // Ignore disabled storage.
    }
    return "general";
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setText(selector, value) {
    $$(selector).forEach((node) => {
      node.textContent = value;
    });
  }

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
      // Ignore disabled storage.
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Ignore disabled storage.
    }
  }

  function sessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function sessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, String(value));
    } catch (error) {
      // Ignore disabled storage.
    }
  }

  function sessionRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      // Ignore disabled storage.
    }
  }

  function randomToken() {
    const crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (crypto && typeof crypto.getRandomValues === "function") {
      return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function isVisible(node) {
    return Boolean(node && !node.hidden && node.getClientRects().length);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function dayKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dayLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (dayKey(date) === dayKey(today)) return "Today";
    if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
    }).format(date);
  }

  function truncate(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function activeSessionLabel() {
    if (!state.session) return "Guest";
    return state.me && state.me.display_name
      ? state.me.display_name
      : authNameOf(state.user);
  }

  function authNameOf(user) {
    if (!user) return "Rider";
    if (state.me && state.me.display_name) return state.me.display_name;
    const meta = user.user_metadata || {};
    return truncate(
      meta.full_name
        || meta.name
        || meta.user_name
        || meta.preferred_username
        || (user.email ? String(user.email).split("@")[0] : "")
        || "Rider",
      42
    ) || "Rider";
  }

  function providerList(user) {
    if (!user) return [];
    const values = Array.isArray(user.identities)
      ? user.identities.map((identity) => String(identity && identity.provider || "").toLowerCase()).filter(Boolean)
      : [];
    if (!values.length && user.app_metadata && user.app_metadata.provider) {
      values.push(String(user.app_metadata.provider).toLowerCase());
    }
    return Array.from(new Set(values));
  }

  function providerText(user) {
    const values = providerList(user);
    if (!values.length) return "";
    return values.map((provider) => EC.providerLabel(provider)).join(" + ");
  }

  function primaryProvider(user) {
    const values = providerList(user);
    return values.length ? values[values.length - 1] : "";
  }

  function avatarUrlOf() {
    if (state.me && state.me.avatar_url) return state.me.avatar_url;
    const meta = state.user && state.user.user_metadata || {};
    return meta.avatar_url || meta.picture || "";
  }

  function roleFor(username) {
    const key = String(username || "").toLowerCase();
    if (!key) return "";
    if (state.roleByUsername[key]) return state.roleByUsername[key];
    if (state.me && String(state.me.username || "").toLowerCase() === key && state.role) {
      return state.role;
    }
    return "";
  }

  function roleLabel(role) {
    const value = String(role || "").toLowerCase();
    if (value === "owner") return "Owner";
    if (value === "admin") return "Admin";
    return "";
  }

  function renderAvatar(target, url, name) {
    if (!target) return;
    target.replaceChildren();
    const safe = EC.normaliseAvatarUrl(url, 96);
    if (!safe) {
      target.textContent = EC.initials(name || "EX");
      return;
    }
    const image = document.createElement("img");
    image.src = safe;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      target.textContent = EC.initials(name || "EX");
    }, { once: true });
    target.appendChild(image);
  }

  function renderAccountAvatar(target) {
    if (!target) return;
    if (!state.session) {
      target.innerHTML = USER_ICON;
      return;
    }
    renderAvatar(target, avatarUrlOf(), activeSessionLabel());
  }

  function profileHref(username) {
    return username ? `./profile.html?u=${encodeURIComponent(username)}` : "./profile.html";
  }

  function setChatStatus(message, tone) {
    const node = $("#chatStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-live", tone === "live");
    node.classList.toggle("is-error", tone === "error");
  }

  function setFormStatus(node, message, tone = "info") {
    if (!node) return;
    node.textContent = String(message || "");
    node.className = "form-status" + (tone ? ` is-${tone}` : "");
    node.hidden = !message;
  }

  function clearFormStatus(node) {
    if (!node) return;
    node.textContent = "";
    node.className = "form-status";
    node.hidden = true;
  }

  function announce(message) {
    const node = $("#chatAnnouncements");
    if (!node) return;
    node.textContent = "";
    window.requestAnimationFrame(() => {
      node.textContent = String(message || "");
    });
  }

  function syncDialogState() {
    const open = $$("dialog[open]").length > 0;
    document.body.classList.toggle("dialog-open", open);
  }

  function showDialog(dialog, opener, focusSelector) {
    if (!dialog) return;
    dialog._opener = opener || document.activeElement;
    if (typeof dialog.showModal === "function" && !dialog.open) {
      try {
        dialog.showModal();
      } catch (error) {
        dialog.setAttribute("open", "");
      }
    } else if (!dialog.open) {
      dialog.setAttribute("open", "");
    }
    syncDialogState();
    const target = focusSelector ? $$(focusSelector, dialog).find(isVisible) : null;
    if (target) {
      window.setTimeout(() => {
        try {
          target.focus({ preventScroll: true });
        } catch (error) {
          target.focus();
        }
      }, 50);
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    syncDialogState();
    if (dialog._opener && typeof dialog._opener.focus === "function") {
      try {
        dialog._opener.focus({ preventScroll: true });
      } catch (error) {
        dialog._opener.focus();
      }
    }
  }

  function initDialogChrome(dialog, closeSelector) {
    if (!dialog) return;
    const close = $(closeSelector);
    if (close) close.addEventListener("click", () => closeDialog(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener("close", syncDialogState);
  }

  function cleanAuthUrl() {
    const url = new URL(window.location.href);
    [
      "access_token", "refresh_token", "expires_in", "expires_at", "token_type",
      "type", "error", "error_description", "error_code", "code", "state",
      "provider_token", "provider_refresh_token"
    ].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    history.replaceState(null, "", url.pathname + url.search);
  }

  function normaliseSession(payload) {
    if (!payload || !payload.access_token) return null;
    const expires = Number(payload.expires_in) || 3600;
    return {
      access_token: String(payload.access_token),
      refresh_token: String(payload.refresh_token || ""),
      token_type: String(payload.token_type || "bearer"),
      expires_at: Date.now() + expires * 1000
    };
  }

  function handleAuthCallback() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
    const error = hash.get("error_description")
      || hash.get("error")
      || url.searchParams.get("error_description")
      || url.searchParams.get("error");

    if (error) {
      cleanAuthUrl();
      sessionRemove(OAUTH_STATE_KEY);
      storageRemove(COMMUNITY_REDIRECT_KEY);
      EC.showToast(
        error === "access_denied"
          ? "Sign-in was cancelled."
          : String(error).replace(/\+/g, " "),
        6500
      );
      return "error";
    }

    const access = hash.get("access_token");
    if (!access) {
      if (url.searchParams.get("code")) {
        cleanAuthUrl();
        EC.showToast("This sign-in tab needs to be reopened from The Garage.", 6500);
        return "error";
      }
      return "none";
    }

    const returnedState = hash.get("state") || url.searchParams.get("state") || "";
    const rawState = sessionGet(OAUTH_STATE_KEY);
    let storedState = null;
    try {
      storedState = rawState ? JSON.parse(rawState) : null;
    } catch (error) {
      storedState = null;
    }
    const age = storedState ? Date.now() - Number(storedState.ts || 0) : Infinity;
    const stateValid = Boolean(
      storedState
        && storedState.value
        && Number.isFinite(age)
        && age >= 0
        && age <= OAUTH_STATE_TTL
        && (!returnedState || storedState.value === returnedState)
    );

    if (!stateValid) {
      cleanAuthUrl();
      sessionRemove(OAUTH_STATE_KEY);
      storageRemove(COMMUNITY_REDIRECT_KEY);
      EC.showToast("Sign-in could not be verified. Open sign-in again.", 6500);
      return "error";
    }

    sessionRemove(OAUTH_STATE_KEY);
    const session = normaliseSession({
      access_token: access,
      refresh_token: hash.get("refresh_token"),
      expires_in: hash.get("expires_in"),
      token_type: hash.get("token_type")
    });
    if (!session) {
      cleanAuthUrl();
      EC.showToast("The sign-in response was incomplete. Try again.", 6000);
      return "error";
    }

    EC.saveSession(session);
    state.session = session;
    cleanAuthUrl();
    return "signed-in";
  }

  function beginOAuth(provider) {
    if (!provider || state.authBusy) return;
    if (!EC.ready) {
      EC.showToast("On-site sign-in is not configured. Use Telegram support for now.", 6000);
      return;
    }
    state.authBusy = true;
    const value = randomToken();
    sessionSet(OAUTH_STATE_KEY, JSON.stringify({ value, ts: Date.now() }));
    storageSet(COMMUNITY_REDIRECT_KEY, JSON.stringify({
      channel: state.channel,
      ts: Date.now()
    }));

    const redirect = new URL(".", window.location.href).href;
    const params = new URLSearchParams({
      provider,
      redirect_to: redirect,
      state: value
    });
    EC.showToast(`Redirecting to ${EC.providerLabel(provider)}…`, 4500);
    window.location.assign(`${EC.base}/auth/v1/authorize?${params.toString()}`);
  }

  function peekCommunityRedirect() {
    const raw = storageGet(COMMUNITY_REDIRECT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || Date.now() - Number(parsed.ts || 0) > OAUTH_STATE_TTL) {
        storageRemove(COMMUNITY_REDIRECT_KEY);
        return null;
      }
      return parsed;
    } catch (error) {
      storageRemove(COMMUNITY_REDIRECT_KEY);
      return null;
    }
  }

  async function initAuth() {
    const callback = handleAuthCallback();
    let session = null;
    try {
      session = await EC.getValidSession();
    } catch (error) {
      session = null;
    }

    if (session) {
      state.session = session;
      try {
        state.user = await EC.getUser(session);
        state.me = await EC.rpc("community_ensure_profile", {}, { session });
        const role = await EC.rpc("community_my_role", {}, { session });
        state.role = String(role || "").toLowerCase();
        state.providers = providerList(state.user);
        await EC.rpc("community_track_login", {
          p_provider: primaryProvider(state.user)
        }, { session });
        await EC.rpc("community_heartbeat", {}, { session });
      } catch (error) {
        if (error && (error.status === 401 || error.status === 403)) {
          await EC.signOut(session);
          state.session = null;
          state.user = null;
          state.me = null;
          state.role = "";
        } else {
          console.warn("EXTREME++: community profile sync failed.", error);
          EC.showToast("Signed in, but the profile could not sync. Posting may still work.", 6000);
        }
      }
    }

    updateAuthUI();
    startHeartbeat();

    const pending = peekCommunityRedirect();
    if (pending && state.session) {
      storageRemove(COMMUNITY_REDIRECT_KEY);
      const target = CHANNELS[pending.channel] ? pending.channel : state.channel;
      if (target !== state.channel) {
        switchChannel(target, { updateHash: true });
      } else if (state.channel === "bugs") {
        loadBugReports();
      }
    }

    if (state.channel === "bugs") {
      if (state.session) loadBugReports();
      else resetBugDesk();
    }

    if (callback === "signed-in" && state.session) {
      EC.showToast(`Signed in as ${activeSessionLabel()}.`, 4800);
    }
  }

  async function signOut() {
    const button = $("#communitySignOut");
    if (button) {
      button.disabled = true;
      button.textContent = "Signing out…";
    }
    try {
      await EC.signOut(state.session);
    } finally {
      window.clearInterval(state.timers.heartbeat);
      state.timers.heartbeat = 0;
      state.session = null;
      state.user = null;
      state.me = null;
      state.role = "";
      state.providers = [];
      state.roleByUsername = {};
      if (button) {
        button.disabled = false;
        button.textContent = "Sign out";
      }
      updateAuthUI();
      if (state.channel === "bugs") resetBugDesk();
      if (state.messages.length) renderMessages({ silent: true });
      closeDialog($("#communityAuthDialog"));
      EC.showToast("Signed out.", 3600);
    }
  }

  function updateAuthUI() {
    const signedIn = Boolean(state.session);
    const name = signedIn ? activeSessionLabel() : "Not signed in";
    const username = state.me && state.me.username ? state.me.username : "";
    const role = String(state.role || "").toLowerCase();
    const staff = role === "owner" || role === "admin";

    $$("[data-community-signed-out]").forEach((node) => {
      node.hidden = signedIn;
    });
    $$("[data-community-signed-in]").forEach((node) => {
      node.hidden = !signedIn;
    });

    $$("[data-community-account-label]").forEach((node) => {
      node.textContent = signedIn ? name : "Sign in";
    });
    $$("[data-community-account-hint]").forEach((node) => {
      node.textContent = signedIn ? (username ? `@${username}` : "Signed in") : "Community";
    });
    $$("[data-community-name]").forEach((node) => {
      node.textContent = signedIn ? name : "Not signed in";
    });
    $$("[data-community-email]").forEach((node) => {
      node.textContent = signedIn && state.user && state.user.email ? String(state.user.email) : "";
    });
    $$("[data-community-provider]").forEach((node) => {
      node.textContent = signedIn ? providerText(state.user) : "";
    });
    $$("[data-community-avatar]").forEach((node) => renderAccountAvatar(node));

    const account = $("#communityAccount");
    if (account) {
      account.classList.toggle("is-signed-in", signedIn);
      account.setAttribute(
        "aria-label",
        signedIn ? `Account: ${name}. Open community account.` : "Sign in to the community"
      );
    }

    $$("[data-community-profile], [data-rail-profile]").forEach((node) => {
      node.hidden = !signedIn || !username;
      if (username) node.href = profileHref(username);
    });
    $$("[data-community-admin], [data-rail-admin]").forEach((node) => {
      node.hidden = !staff;
    });

    updateComposerVisibility();

    if (state.channel === "bugs") {
      if (signedIn) {
        const gate = $("#bugDeskGate");
        if (gate) gate.hidden = true;
        const list = $("#bugDeskList");
        if (list) list.hidden = false;
      } else {
        resetBugDesk();
      }
    }

    if (state.messages.length) renderMessages({ silent: true });
  }

  function updateComposerVisibility() {
    const form = $("#chatForm");
    const gate = $("#chatAuthGate");
    if (!form || !gate) return;
    if (state.channel === "bugs") {
      form.hidden = true;
      gate.hidden = true;
      return;
    }
    if (state.session) {
      form.hidden = false;
      gate.hidden = true;
    } else {
      form.hidden = true;
      gate.hidden = false;
    }
  }

  function updateComposerLabels() {
    const input = $("#chatInput");
    if (input) input.placeholder = `Write to #${CHANNELS[state.channel] ? CHANNELS[state.channel].label : "General"}…`;
    const note = $("#chatSlowNote");
    if (note) {
      const slow = state.stats && Number(state.stats.chat_slow_seconds);
      const hourly = state.stats && Number(state.stats.chat_hourly_limit);
      if (slow > 0 && hourly > 0) {
        note.textContent = `Slow mode: ${slow}s between messages · ${hourly} per hour. Public messages. Be useful, be honest, be kind.`;
      } else {
        note.textContent = "Public messages. Be useful, be honest, be kind.";
      }
    }
  }

  function applyChannelUI(channel) {
    const meta = CHANNELS[channel] || CHANNELS.general;
    const isBugs = !meta.public;

    $$("[data-channel-link]").forEach((button) => {
      const active = button.getAttribute("data-channel-link") === channel;
      button.classList.toggle("is-active", active);
      if (button.getAttribute("role") === "tab") {
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      } else if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    const chatPanel = $("#chatPanel");
    const bugDesk = $("#bugDesk");
    if (chatPanel) chatPanel.hidden = isBugs;
    if (bugDesk) bugDesk.hidden = !isBugs;

    const hash = $("#channelHash");
    if (hash) {
      hash.textContent = meta.hash;
      hash.classList.toggle("is-private", isBugs);
    }
    setText("#channelKicker", meta.kicker);
    setText("#channelTitle", meta.label);
    setText("#channelTopic", meta.topic);

    const pinned = $("#channelPinned");
    if (pinned) pinned.hidden = channel !== "releases";

    const build = $("#channelPinned [data-pinned-build]");
    if (build) {
      build.textContent = `${config.kernel && config.kernel.fallbackBuild ? config.kernel.fallbackBuild : "Latest stable"} — Official Stable`;
    }

    document.title = `${meta.label} — EXTREME++ The Garage`;
    updateComposerVisibility();
    updateComposerLabels();
  }

  function switchChannel(channel, options = {}) {
    const next = CHANNELS[channel] ? channel : "general";
    const changed = state.channel !== next;
    state.channel = next;
    storageSet(CHANNEL_KEY, next);
    closeMembers();

    applyChannelUI(next);
    if (options.updateHash !== false) {
      const url = `${window.location.pathname}${window.location.search}#${next}`;
      try {
        history.replaceState(null, "", url);
      } catch (error) {
        // Hash history is non-essential.
      }
    }

    if (next === "bugs") {
      if (state.session) loadBugReports();
      else resetBugDesk();
    } else {
      if (changed) {
        state.messages = [];
        renderChatLoading();
      }
      loadMessages({
        silent: false,
        forceScroll: changed || Boolean(options.forceScroll)
      });
    }
  }

  function renderChatLoading() {
    const body = $("#chatBody");
    if (!body) return;
    const loading = create("div", "chat-loading");
    loading.setAttribute("aria-hidden", "true");
    ["skeleton-line skeleton-line--short", "skeleton-line", "skeleton-line skeleton-line--medium"].forEach((className) => {
      loading.appendChild(create("span", className));
    });
    body.replaceChildren(loading);
    body.setAttribute("aria-busy", "true");
  }

  async function loadStats() {
    if (!EC.ready) return;
    try {
      const stats = await EC.rpc("community_public_stats", {}, { auth: false });
      if (!stats || typeof stats !== "object") return;
      state.stats = stats;
      ["members", "online", "visits", "reviews", "chat", "logins", "unique_visitors"].forEach((key) => {
        setText(`[data-stat="${key}"]`, EC.formatNumber(stats[key]));
      });
      setText("[data-online-count]", EC.formatNumber(stats.online));
      setText("[data-member-count]", EC.formatNumber(stats.members));

      const channels = stats.channels && typeof stats.channels === "object" ? stats.channels : {};
      $$("[data-channel-count]").forEach((node) => {
        node.textContent = EC.formatNumber(channels[node.getAttribute("data-channel-count")] || 0);
      });
      updateComposerLabels();
    } catch (error) {
      // Counts are non-essential; keep the last known values.
    }
  }

  async function loadMembers() {
    if (!EC.ready) return;
    try {
      const members = await EC.rpc("community_public_members", { p_limit: 40 }, { auth: false });
      state.members = Array.isArray(members) ? members : [];
      state.roleByUsername = {};
      state.members.forEach((member) => {
        if (member && member.username) {
          state.roleByUsername[String(member.username).toLowerCase()] = String(member.role || "member").toLowerCase();
        }
      });
      if (state.me && state.me.username && state.role) {
        state.roleByUsername[String(state.me.username).toLowerCase()] = state.role;
      }
      renderMembers();
      if (state.messages.length) renderMessages({ silent: true });
    } catch (error) {
      const list = $("#membersList");
      if (list && !state.members.length) {
        list.replaceChildren(create("p", "members-empty", "Members are unavailable right now."));
      }
    }
  }

  function renderMembers() {
    const list = $("#membersList");
    if (!list) return;
    list.replaceChildren();
    if (!state.members.length) {
      list.appendChild(create("p", "members-empty", "No public profiles yet. Be the first to join."));
      return;
    }

    const fragment = document.createDocumentFragment();
    state.members.forEach((member) => {
      if (!member || !member.username) return;
      const row = document.createElement("a");
      row.className = "member-row" + (member.online ? " is-online" : "");
      row.href = profileHref(member.username);
      row.setAttribute("aria-label", `${member.display_name || member.username}, @${member.username}${member.online ? ", online" : ""}`);

      const avatar = create("span", "member-avatar");
      renderAvatar(avatar, member.avatar_url, member.display_name || member.username);
      row.appendChild(avatar);

      const copy = create("span", "member-copy");
      copy.appendChild(create("strong", "", member.display_name || member.username));
      copy.appendChild(create("small", "", `@${member.username}`));
      row.appendChild(copy);

      const role = String(member.role || "").toLowerCase();
      if (role === "owner" || role === "admin") {
        const badge = create("span", `member-badge member-badge--${role}`, role === "owner" ? "Owner" : "Admin");
        row.appendChild(badge);
      }
      fragment.appendChild(row);
    });
    list.appendChild(fragment);
  }

  function messageQuery(channel) {
    const params = new URLSearchParams({
      select: "id,user_id,author_name,author_avatar,author_username,provider,body,channel,created_at,forwarded_from_message_id,forwarded_from_name,forwarded_from_username,forwarded_from_channel,forwarded_at",
      channel: `eq.${channel}`,
      order: "created_at.desc",
      limit: "60"
    });
    return params.toString();
  }

  async function loadMessages(options = {}) {
    if (!EC.ready || state.channel === "bugs") return;
    const channel = state.channel;
    const silent = Boolean(options.silent);
    const body = $("#chatBody");
    const requestId = ++state.loadToken;
    state.loadingMessages = true;
    if (body) body.setAttribute("aria-busy", "true");
    if (!silent) setChatStatus("Syncing…", "");

    try {
      const rows = await EC.table("chat_messages", messageQuery(channel), { auth: false });
      if (!Array.isArray(rows) || state.channel !== channel || requestId !== state.loadToken) return;

      const previousIds = new Set(state.messages.map((message) => message.id));
      const previousCount = state.messages.length;
      const initialized = Boolean(state.initializedChannels[channel]);
      const ordered = rows.slice().reverse();
      const fresh = ordered.filter((message) => message && message.id && !previousIds.has(message.id));

      state.initializedChannels[channel] = true;
      state.messages = ordered;
      renderMessages({
        forceScroll: Boolean(options.forceScroll) || !initialized,
        silent: silent || (initialized && previousCount > 0)
      });

      if (initialized && fresh.length && document.visibilityState !== "hidden") {
        const latest = fresh[fresh.length - 1];
        const preview = truncate(latest.body, 110);
        const author = latest.author_name || "Rider";
        announce(fresh.length === 1
          ? `New message from ${author}: ${preview}`
          : `${fresh.length} new messages. Latest from ${author}: ${preview}`);
        state.lastAnnouncedId = latest.id || "";
      }

      setChatStatus(silent ? "Live" : "Live", "live");
    } catch (error) {
      if (!silent) {
        setChatStatus("Reconnecting…", "error");
        if (!state.messages.length) renderChatError();
      }
    } finally {
      if (requestId === state.loadToken) {
        state.loadingMessages = false;
        if (body) body.setAttribute("aria-busy", "false");
      }
    }
  }

  function renderMessages(options = {}) {
    const body = $("#chatBody");
    if (!body) return;
    const forceScroll = Boolean(options.forceScroll);
    const silent = Boolean(options.silent);
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 150;
    const previousTop = body.scrollTop;

    body.replaceChildren();
    if (!state.messages.length) {
      renderChatEmpty(body);
      return;
    }

    const fragment = document.createDocumentFragment();
    let previous = null;
    let previousDay = "";

    state.messages.forEach((message) => {
      if (!message || !message.id) return;
      const key = dayKey(message.created_at);
      if (key && key !== previousDay) {
        fragment.appendChild(create("div", "garage-date", dayLabel(message.created_at)));
        previousDay = key;
        previous = null;
      }

      const date = new Date(message.created_at);
      const previousDate = previous ? new Date(previous.created_at) : null;
      const compact = Boolean(
        previous
        && previous.author_username
        && message.author_username
        && String(previous.author_username).toLowerCase() === String(message.author_username).toLowerCase()
        && previousDate
        && !Number.isNaN(previousDate.getTime())
        && !Number.isNaN(date.getTime())
        && date.getTime() - previousDate.getTime() < 5 * 60 * 1000
      );

      fragment.appendChild(createMessage(message, compact, silent));
      previous = message;
      previousDay = key || previousDay;
    });

    body.appendChild(fragment);

    if (forceScroll || nearBottom) {
      body.scrollTop = body.scrollHeight;
    } else {
      body.scrollTop = previousTop;
    }
  }

  function createMessage(message, compact, silent) {
    const own = Boolean(state.session && state.user && message.user_id === state.user.id);
    const article = create("article", "garage-message" + (compact ? " is-compact" : "") + (own ? " is-own" : "") + (silent ? " is-silent" : ""));
    article.setAttribute("data-message-id", message.id);

    const avatar = message.author_username
      ? document.createElement("a")
      : document.createElement("span");
    avatar.className = "garage-avatar" + (compact ? " garage-avatar--ghost" : "");
    if (message.author_username) {
      avatar.href = profileHref(message.author_username);
      avatar.setAttribute("aria-label", `Open ${message.author_name || message.author_username}'s profile`);
    }
    renderAvatar(avatar, message.author_avatar, message.author_name || message.author_username);
    article.appendChild(avatar);

    const wrap = create("div", "garage-bubble-wrap");
    const head = create("div", "garage-message-head");
    const author = message.author_username
      ? document.createElement("a")
      : create("span", "garage-author", message.author_name || "Rider");
    author.className = "garage-author";
    if (message.author_username) {
      author.href = profileHref(message.author_username);
      author.textContent = message.author_name || message.author_username;
    }
    head.appendChild(author);

    const role = roleFor(message.author_username);
    if (role === "owner" || role === "admin") {
      head.appendChild(create("span", `garage-role garage-role--${role}`, role === "owner" ? "Owner" : "Admin"));
    }
    if (own) head.appendChild(create("span", "garage-own-tag", "you"));
    wrap.appendChild(head);

    const bubble = create("div", "garage-bubble");
    if (message.forwarded_from_channel) {
      const forward = create("div", "garage-forwarded");
      forward.appendChild(create("small", "", `Forwarded from #${CHANNELS[message.forwarded_from_channel] ? CHANNELS[message.forwarded_from_channel].label : message.forwarded_from_channel}`));
      forward.appendChild(create("strong", "", message.forwarded_from_name || message.forwarded_from_username || "Rider"));
      bubble.appendChild(forward);
    }

    bubble.appendChild(create("div", "garage-message-body", message.body));
    const foot = create("div", "garage-bubble-foot");
    const time = create("time", "", formatTime(message.created_at));
    time.dateTime = String(message.created_at || "");
    foot.appendChild(time);
    if (message.forwarded_at) foot.appendChild(create("span", "", "forwarded"));
    bubble.appendChild(foot);
    wrap.appendChild(bubble);
    article.appendChild(wrap);

    const actions = create("div", "garage-message-actions");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "garage-action-btn";
    trigger.setAttribute("data-message-menu", message.id);
    trigger.setAttribute("aria-label", "Message actions");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>';
    actions.appendChild(trigger);

    const menu = create("div", "garage-menu");
    menu.setAttribute("role", "menu");
    menu.appendChild(menuButton("forward", "Forward", MENU_ICONS.forward));
    menu.appendChild(menuButton("copy", "Copy text", MENU_ICONS.copy));
    if (!own) menu.appendChild(menuButton("report", "Report", MENU_ICONS.report));
    if (own) menu.appendChild(menuButton("delete", "Delete", MENU_ICONS.delete, true));
    actions.appendChild(menu);
    article.appendChild(actions);

    return article;
  }

  function menuButton(action, label, icon, danger) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-message-action", action);
    if (danger) button.classList.add("is-danger");
    button.innerHTML = icon;
    button.appendChild(document.createTextNode(label));
    return button;
  }

  function renderChatEmpty(body) {
    const empty = create("div", "garage-empty");
    empty.appendChild(create("span", "garage-empty-mark", "#"));
    const channel = CHANNELS[state.channel] || CHANNELS.general;
    empty.appendChild(create("strong", "", `No messages in ${channel.label} yet.`));
    empty.appendChild(create("p", "", "The garage is quiet. Start the conversation or open a public profile to see who is around."));

    if (state.session) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button--primary";
      button.setAttribute("data-focus-composer", "");
      button.textContent = "Write the first message";
      empty.appendChild(button);
    } else {
      const actions = create("div", "auth-gate-actions");
      const google = create("button", "auth-chip auth-chip--google", "Google");
      google.type = "button";
      google.setAttribute("data-oauth-provider", "google");
      const github = create("button", "auth-chip auth-chip--github", "GitHub");
      github.type = "button";
      github.setAttribute("data-oauth-provider", "github");
      actions.appendChild(google);
      actions.appendChild(github);
      empty.appendChild(actions);
    }
    body.replaceChildren(empty);
  }

  function renderChatError() {
    const body = $("#chatBody");
    if (!body) return;
    const empty = create("div", "garage-empty");
    empty.appendChild(create("span", "garage-empty-mark", "!"));
    empty.appendChild(create("strong", "", "The garage could not connect."));
    empty.appendChild(create("p", "", "Check your connection and try again. Public channels stay readable when the backend returns."));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--ghost";
    button.setAttribute("data-retry-chat", "");
    button.textContent = "Try again";
    empty.appendChild(button);
    body.replaceChildren(empty);
  }

  function closeMessageMenus(exceptId) {
    $$(".garage-message.has-open-menu").forEach((message) => {
      if (exceptId && message.getAttribute("data-message-id") === exceptId) return;
      message.classList.remove("has-open-menu");
      const trigger = $("[data-message-menu]", message);
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
    if (!exceptId) state.activeMenuId = "";
  }

  function toggleMessageMenu(id) {
    const message = $(`[data-message-id="${CSS.escape(id)}"]`);
    if (!message) return;
    const wasOpen = message.classList.contains("has-open-menu");
    closeMessageMenus(id);
    message.classList.toggle("has-open-menu", !wasOpen);
    const trigger = $("[data-message-menu]", message);
    if (trigger) trigger.setAttribute("aria-expanded", String(!wasOpen));
    state.activeMenuId = wasOpen ? "" : id;
  }

  function messageById(id) {
    return state.messages.find((message) => message.id === id) || null;
  }

  function handleMessageAction(action, id) {
    const message = messageById(id);
    if (!message) return;
    closeMessageMenus();
    if (action === "forward") openForwardDialog(message);
    else if (action === "copy") copyMessage(message);
    else if (action === "report") openReportDialog(message);
    else if (action === "delete") deleteMessage(message);
  }

  async function copyMessage(message) {
    const text = String(message.body || "");
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      EC.showToast("Message copied.", 3000);
    } catch (error) {
      EC.showToast("Could not copy that message.", 4200);
    }
  }

  async function deleteMessage(message) {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (!window.confirm("Delete this message for everyone?")) return;
    try {
      await EC.table("chat_messages", `id=eq.${encodeURIComponent(message.id)}`, {
        method: "DELETE",
        auth: true,
        headers: { Prefer: "return=minimal" }
      });
      state.messages = state.messages.filter((item) => item.id !== message.id);
      renderMessages({ silent: true });
      loadStats();
      EC.showToast("Message deleted.", 3200);
    } catch (error) {
      EC.showToast(error && error.status === 403
        ? "You can only delete your own messages."
        : "That message could not be deleted.", 5000);
    }
  }

  function openForwardDialog(message) {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    const targets = PUBLIC_CHANNELS.filter((channel) => channel !== message.channel);
    if (!targets.length) {
      EC.showToast("There is no other public channel to forward this to.", 4800);
      return;
    }
    state.forwardMessage = message;
    state.forwardTarget = targets[0];

    const preview = $("#forwardPreview");
    if (preview) {
      preview.replaceChildren();
      preview.appendChild(create("small", "", `#${CHANNELS[message.channel] ? CHANNELS[message.channel].label : message.channel} · ${message.author_name || "Rider"}`));
      preview.appendChild(document.createTextNode(truncate(message.body, 320)));
    }

    const channels = $("#forwardChannels");
    if (channels) {
      channels.replaceChildren();
      targets.forEach((channel) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "forward-channel" + (channel === state.forwardTarget ? " is-selected" : "");
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(channel === state.forwardTarget));
        button.setAttribute("data-forward-channel", channel);
        const mark = create("span", "forward-channel-mark", "#");
        const copy = create("span", "forward-channel-copy");
        copy.appendChild(create("strong", "", CHANNELS[channel].label));
        copy.appendChild(create("small", "", CHANNELS[channel].topic));
        button.appendChild(mark);
        button.appendChild(copy);
        channels.appendChild(button);
      });
    }

    clearFormStatus($("#forwardStatus"));
    showDialog($("#forwardDialog"), document.activeElement, "[data-forward-channel]");
  }

  async function submitForward(event) {
    event.preventDefault();
    if (!state.forwardMessage || !state.forwardTarget) return;
    const button = $("#forwardSubmit");
    const status = $("#forwardStatus");
    clearFormStatus(status);
    EC.setBusy(button, true, "Forwarding…");
    try {
      await EC.rpc("community_forward_message", {
        p_message_id: state.forwardMessage.id,
        p_channel: state.forwardTarget
      }, { session: state.session });
      const target = state.forwardTarget;
      closeDialog($("#forwardDialog"));
      EC.showToast(`Forwarded to #${CHANNELS[target].label}.`, 4200);
      switchChannel(target, { updateHash: true, forceScroll: true });
      loadStats();
    } catch (error) {
      setFormStatus(status, error && error.message ? error.message : "That message could not be forwarded.", "error");
    } finally {
      EC.setBusy(button, false);
    }
  }

  function openReportDialog(message) {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (state.user && message.user_id === state.user.id) {
      EC.showToast("You cannot report your own message.", 4000);
      return;
    }
    state.reportMessage = message;
    const type = $("#reportTargetType");
    const id = $("#reportTargetId");
    if (type) type.value = "chat";
    if (id) id.value = message.id;

    const preview = $("#reportPreview");
    if (preview) {
      preview.hidden = false;
      preview.replaceChildren();
      preview.appendChild(create("small", "", `#${CHANNELS[message.channel] ? CHANNELS[message.channel].label : message.channel} · ${message.author_name || "Rider"}`));
      preview.appendChild(document.createTextNode(truncate(message.body, 280)));
    }

    const reason = $("#reportReason");
    if (reason) reason.value = "";
    setText("#reportCharCount", "0");
    clearFormStatus($("#reportStatus"));
    showDialog($("#reportDialog"), document.activeElement, "#reportReason");
  }

  async function submitReport(event) {
    event.preventDefault();
    const reason = $("#reportReason");
    const status = $("#reportStatus");
    const button = $("#reportSubmit");
    const type = $("#reportTargetType");
    const id = $("#reportTargetId");
    const text = reason ? reason.value.trim() : "";
    clearFormStatus(status);
    if (text.length < 5) {
      setFormStatus(status, "Give a short reason of at least 5 characters.", "error");
      if (reason) reason.focus();
      return;
    }
    if (!type || !id || !type.value || !id.value) {
      setFormStatus(status, "That report target is missing. Reopen the message menu.", "error");
      return;
    }

    EC.setBusy(button, true, "Sending…");
    try {
      await EC.rpc("community_report_content", {
        p_target_type: type.value,
        p_target_id: id.value,
        p_reason: text
      }, { session: state.session });
      closeDialog($("#reportDialog"));
      if (reason) reason.value = "";
      setText("#reportCharCount", "0");
      EC.showToast("Report sent privately to the moderation team.", 4800);
    } catch (error) {
      setFormStatus(status, error && error.message ? error.message : "The report could not be sent.", "error");
    } finally {
      EC.setBusy(button, false);
    }
  }

  function openBugDialog() {
    if (!state.session) {
      openAuthDialog();
      EC.showToast("Sign in to open your private bug desk.", 4800);
      return;
    }
    const build = $("#bugBuild");
    if (build && !build.value) {
      build.value = config.kernel && config.kernel.fallbackBuild ? config.kernel.fallbackBuild : "Latest stable";
    }
    clearFormStatus($("#bugStatus"));
    showDialog($("#bugDialog"), document.activeElement, "#bugTitle");
  }

  async function submitBug(event) {
    event.preventDefault();
    const form = $("#bugForm");
    const status = $("#bugStatus");
    const button = $("#bugSubmit");
    if (!form) return;
    if (!state.session) {
      closeDialog($("#bugDialog"));
      openAuthDialog();
      return;
    }

    const title = $("#bugTitle") ? $("#bugTitle").value.trim() : "";
    const device = $("#bugDevice") ? $("#bugDevice").value.trim() : "";
    const rom = $("#bugRom") ? $("#bugRom").value.trim() : "";
    const root = $("#bugRoot") ? $("#bugRoot").value.trim() : "";
    const build = $("#bugBuild") ? $("#bugBuild").value.trim() : "";
    const description = $("#bugDescription") ? $("#bugDescription").value.trim() : "";
    const logs = $("#bugLogs") ? $("#bugLogs").value.trim() : "";
    const modded = $("#bugModded") ? $("#bugModded").checked : false;

    clearFormStatus(status);
    if (title.length < 8) {
      setFormStatus(status, "Give the bug a title of at least 8 characters.", "error");
      if ($("#bugTitle")) $("#bugTitle").focus();
      return;
    }
    if (description.length < 30) {
      setFormStatus(status, "Describe the bug in at least 30 characters.", "error");
      if ($("#bugDescription")) $("#bugDescription").focus();
      return;
    }
    if (!modded) {
      setFormStatus(status, "Confirm that you are running a modded HyperOS, ColorOS port or AOSP-based custom ROM.", "error");
      if ($("#bugModded")) $("#bugModded").focus();
      return;
    }

    EC.setBusy(button, true, "Sending…");
    try {
      await EC.table("bug_reports", "", {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: {
          title,
          device,
          rom,
          root_flavor: root,
          build,
          description,
          logs: logs || null
        }
      });
      form.reset();
      const buildField = $("#bugBuild");
      if (buildField) {
        buildField.value = config.kernel && config.kernel.fallbackBuild ? config.kernel.fallbackBuild : "Latest stable";
      }
      setText("#bugCharCount", "0");
      closeDialog($("#bugDialog"));
      EC.showToast("Private bug report sent to the maintainer.", 5600);
      loadStats();
      if (state.channel === "bugs") loadBugReports();
      else switchChannel("bugs", { updateHash: true });
    } catch (error) {
      let message = error && error.message ? error.message : "The report could not be sent.";
      if (error && error.status === 401) message = "Your session expired. Sign in again.";
      if (error && error.status === 403) message = "Your account is restricted from posting.";
      setFormStatus(status, message, "error");
    } finally {
      EC.setBusy(button, false);
    }
  }

  function resetBugDesk() {
    const gate = $("#bugDeskGate");
    const list = $("#bugDeskList");
    if (gate) gate.hidden = false;
    if (list) {
      list.hidden = true;
      list.replaceChildren();
    }
    state.bugs = [];
  }

  async function loadBugReports() {
    if (!state.session) {
      resetBugDesk();
      return;
    }
    const list = $("#bugDeskList");
    const gate = $("#bugDeskGate");
    if (gate) gate.hidden = true;
    if (!list) return;
    list.hidden = false;
    list.setAttribute("aria-busy", "true");
    state.bugsLoading = true;

    const params = new URLSearchParams({
      select: "id,title,device,rom,root_flavor,build,description,logs,status,created_at,updated_at",
      user_id: `eq.${state.user.id}`,
      order: "created_at.desc",
      limit: "50"
    });

    try {
      const rows = await EC.table("bug_reports", params.toString(), { session: state.session });
      state.bugs = Array.isArray(rows) ? rows : [];
      renderBugReports();
    } catch (error) {
      list.replaceChildren();
      const empty = create("div", "garage-empty");
      empty.appendChild(create("span", "garage-empty-mark", "!"));
      empty.appendChild(create("strong", "", "Your private reports could not load."));
      empty.appendChild(create("p", "", "Check your connection and try again."));
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "button button--ghost";
      retry.setAttribute("data-retry-bugs", "");
      retry.textContent = "Try again";
      empty.appendChild(retry);
      list.appendChild(empty);
    } finally {
      state.bugsLoading = false;
      list.setAttribute("aria-busy", "false");
    }
  }

  function renderBugReports() {
    const list = $("#bugDeskList");
    if (!list) return;
    list.replaceChildren();
    if (!state.bugs.length) {
      const empty = create("div", "garage-empty");
      empty.appendChild(create("span", "garage-empty-mark", "▣"));
      empty.appendChild(create("strong", "", "Your private desk is empty."));
      empty.appendChild(create("p", "", "Send a report with your ROM, build, root flavor and logs. Only you and the maintainer can read it."));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button--primary";
      button.setAttribute("data-open-bug", "");
      button.textContent = "Submit private report";
      empty.appendChild(button);
      list.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.bugs.forEach((bug) => {
      const card = create("article", "bug-ticket");
      const head = create("div", "bug-ticket-head");
      const title = create("div", "bug-ticket-title");
      title.appendChild(create("h3", "", bug.title || "Untitled report"));
      const meta = create("div", "bug-ticket-meta");
      [bug.device, bug.rom, bug.root_flavor, bug.build].filter(Boolean).forEach((value) => {
        meta.appendChild(create("span", "", value));
      });
      meta.appendChild(create("span", "", EC.formatDate(bug.created_at)));
      title.appendChild(meta);
      head.appendChild(title);
      const status = String(bug.status || "open").toLowerCase();
      head.appendChild(create("span", `bug-status bug-status--${status}`, status));
      card.appendChild(head);

      const details = document.createElement("details");
      details.className = "bug-ticket-details";
      const summary = document.createElement("summary");
      summary.textContent = "Open report";
      details.appendChild(summary);
      const body = create("div", "bug-ticket-body");
      body.appendChild(create("p", "", bug.description || "No description."));
      if (bug.logs) {
        body.appendChild(create("pre", "bug-ticket-logs", bug.logs));
      }
      details.appendChild(body);
      card.appendChild(details);
      fragment.appendChild(card);
    });
    list.appendChild(fragment);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.sending) return;
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (Date.now() < state.cooldownUntil) return;
    const input = $("#chatInput");
    const button = $("#chatSend");
    const body = input ? input.value.trim() : "";
    if (!body) {
      if (input) input.focus();
      return;
    }
    if (body.length > 500) {
      EC.showToast("Keep messages under 500 characters.", 4200);
      return;
    }

    state.sending = true;
    let sent = false;
    EC.setBusy(button, true, "Sending…");
    try {
      const rows = await EC.table("chat_messages", "", {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: { body, channel: state.channel }
      });
      if (input) {
        input.value = "";
        input.style.height = "auto";
      }
      setText("#chatCharCount", "0");
      if (Array.isArray(rows) && rows[0]) {
        state.messages.push(rows[0]);
        renderMessages({ forceScroll: true });
      } else {
        await loadMessages({ silent: true, forceScroll: true });
      }
      sent = true;
      announce("Message sent.");
      loadStats();
      if (input) input.focus({ preventScroll: true });
    } catch (error) {
      let message = error && error.message ? error.message : "The message could not be sent.";
      if (error && error.status === 401) message = "Your session expired. Sign in again.";
      if (error && error.status === 403) message = "Your account is restricted from posting.";
      if (error && error.status === 429) {
        const seconds = Math.max(1, Number(state.stats && state.stats.chat_slow_seconds) || 5);
        startCooldown(seconds);
        message = `Slow mode. Wait ${seconds}s before the next message.`;
      }
      EC.showToast(message, 5200);
    } finally {
      state.sending = false;
      EC.setBusy(button, false);
      if (sent) {
        const seconds = Math.max(0, Number(state.stats && state.stats.chat_slow_seconds) || 0);
        if (seconds > 0) startCooldown(seconds);
      }
      updateSendAvailability();
    }
  }

  function startCooldown(seconds) {
    state.cooldownUntil = Date.now() + seconds * 1000;
    window.clearInterval(state.cooldownTimer);
    updateSendAvailability();
    state.cooldownTimer = window.setInterval(() => {
      if (Date.now() >= state.cooldownUntil) {
        window.clearInterval(state.cooldownTimer);
        state.cooldownTimer = 0;
        state.cooldownUntil = 0;
        updateSendAvailability();
        return;
      }
      updateSendAvailability();
    }, 350);
  }

  function updateSendAvailability() {
    const button = $("#chatSend");
    if (!button) return;
    const remaining = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
    if (remaining > 0) {
      button.disabled = true;
      button.querySelector("span").textContent = `Wait ${remaining}s`;
    } else if (!state.sending) {
      button.disabled = false;
      button.querySelector("span").textContent = "Send";
    }
  }

  function resizeComposer() {
    const input = $("#chatInput");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }

  function initComposer() {
    const form = $("#chatForm");
    const input = $("#chatInput");
    if (!form || !input) return;

    form.addEventListener("submit", sendMessage);
    input.addEventListener("input", () => {
      setText("#chatCharCount", String(input.value.length));
      resizeComposer();
      updateSendAvailability();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!state.sending && Date.now() >= state.cooldownUntil) form.requestSubmit();
      }
    });
    resizeComposer();
  }

  function openMembers() {
    const panel = $("#membersPanel");
    const scrim = $("#membersScrim");
    if (!panel) return;
    panel.classList.add("is-open");
    if (scrim) scrim.hidden = false;
    $$("[data-members-toggle], #communityMembersToggle").forEach((button) => {
      button.setAttribute("aria-expanded", "true");
    });
    const close = $("[data-members-close]");
    if (close) {
      try {
        close.focus({ preventScroll: true });
      } catch (error) {
        close.focus();
      }
    }
  }

  function closeMembers() {
    const panel = $("#membersPanel");
    const scrim = $("#membersScrim");
    if (!panel) return;
    panel.classList.remove("is-open");
    if (scrim) scrim.hidden = true;
    $$("[data-members-toggle], #communityMembersToggle").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function openAuthDialog() {
    const dialog = $("#communityAuthDialog");
    if (!dialog) return;
    updateAuthUI();
    showDialog(
      dialog,
      document.activeElement,
      state.session ? "[data-community-profile]" : "[data-oauth-provider]"
    );
  }

  function initDialogs() {
    initDialogChrome($("#communityAuthDialog"), "#communityAuthClose");
    initDialogChrome($("#bugDialog"), "#bugDialogClose");
    initDialogChrome($("#forwardDialog"), "#forwardDialogClose");
    initDialogChrome($("#reportDialog"), "#reportDialogClose");

    $$("[data-community-auth], #communityAccount").forEach((button) => {
      button.addEventListener("click", openAuthDialog);
    });

    const signOutButton = $("#communitySignOut");
    if (signOutButton) signOutButton.addEventListener("click", signOut);

    const bugForm = $("#bugForm");
    if (bugForm) bugForm.addEventListener("submit", submitBug);
    const forwardForm = $("#forwardForm");
    if (forwardForm) forwardForm.addEventListener("submit", submitForward);
    const reportForm = $("#reportForm");
    if (reportForm) reportForm.addEventListener("submit", submitReport);

    const description = $("#bugDescription");
    if (description) {
      description.addEventListener("input", () => setText("#bugCharCount", String(description.value.length)));
    }
    const reason = $("#reportReason");
    if (reason) {
      reason.addEventListener("input", () => setText("#reportCharCount", String(reason.value.length)));
    }
  }

  function initMembers() {
    $$("[data-members-toggle], #communityMembersToggle").forEach((button) => {
      button.addEventListener("click", openMembers);
    });
    $$("[data-members-close]").forEach((button) => {
      button.addEventListener("click", closeMembers);
    });
    const scrim = $("#membersScrim");
    if (scrim) scrim.addEventListener("click", closeMembers);
  }

  function initDelegatedEvents() {
    document.addEventListener("click", (event) => {
      const oauth = event.target.closest("[data-oauth-provider]");
      if (oauth) {
        event.preventDefault();
        beginOAuth(oauth.getAttribute("data-oauth-provider"));
        return;
      }

      const focusComposer = event.target.closest("[data-focus-composer]");
      if (focusComposer) {
        const input = $("#chatInput");
        if (input) input.focus({ preventScroll: true });
        return;
      }

      const bugOpen = event.target.closest("[data-open-bug]");
      if (bugOpen) {
        event.preventDefault();
        openBugDialog();
        return;
      }

      const retryChat = event.target.closest("[data-retry-chat]");
      if (retryChat) {
        loadMessages({ forceScroll: true });
        return;
      }

      const retryBugs = event.target.closest("[data-retry-bugs]");
      if (retryBugs) {
        loadBugReports();
        return;
      }

      const forwardChoice = event.target.closest("[data-forward-channel]");
      if (forwardChoice) {
        state.forwardTarget = forwardChoice.getAttribute("data-forward-channel");
        $$("[data-forward-channel]").forEach((button) => {
          const selected = button === forwardChoice;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-checked", String(selected));
        });
        return;
      }

      const messageMenu = event.target.closest("[data-message-menu]");
      if (messageMenu) {
        event.preventDefault();
        toggleMessageMenu(messageMenu.getAttribute("data-message-menu"));
        return;
      }

      const messageAction = event.target.closest("[data-message-action]");
      if (messageAction) {
        const article = messageAction.closest("[data-message-id]");
        if (article) {
          handleMessageAction(
            messageAction.getAttribute("data-message-action"),
            article.getAttribute("data-message-id")
          );
        }
        return;
      }

      if (!event.target.closest(".garage-message-actions")) {
        closeMessageMenus();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMessageMenus();
        closeMembers();
        $$("dialog[open]").forEach((dialog) => closeDialog(dialog));
      }
    });

    window.addEventListener("hashchange", () => {
      const channel = window.location.hash.replace(/^#/, "");
      if (CHANNELS[channel] && channel !== state.channel) {
        switchChannel(channel, { updateHash: false });
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      loadStats();
      loadMembers();
      if (state.channel === "bugs") {
        if (state.session) loadBugReports();
      } else {
        loadMessages({ silent: true });
      }
    });

    window.addEventListener("online", () => {
      if (state.channel === "bugs") {
        if (state.session) loadBugReports();
      } else {
        loadMessages({ silent: true });
      }
    });
  }

  function initChannelLinks() {
    $$("[data-channel-link]").forEach((button) => {
      button.addEventListener("click", () => {
        const channel = button.getAttribute("data-channel-link");
        if (CHANNELS[channel]) switchChannel(channel, { updateHash: true });
      });
    });

    const tabs = $$('[role="tab"][data-channel-link]');
    tabs.forEach((tab, index) => {
      tab.addEventListener("keydown", (event) => {
        let nextIndex = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          nextIndex = (index + 1) % tabs.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = tabs.length - 1;
        }
        if (nextIndex < 0) return;
        event.preventDefault();
        const next = tabs[nextIndex];
        next.focus({ preventScroll: true });
        next.click();
      });
    });
  }

  function startHeartbeat() {
    window.clearInterval(state.timers.heartbeat);
    state.timers.heartbeat = 0;
    if (!state.session) return;
    state.timers.heartbeat = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const session = await EC.getValidSession();
      if (!session || !state.session) return;
      state.session = session;
      try {
        await EC.rpc("community_heartbeat", {}, { session });
      } catch (error) {
        if (error && (error.status === 401 || error.status === 403)) {
          state.session = null;
          state.user = null;
          state.me = null;
          state.role = "";
          updateAuthUI();
        }
      }
    }, 60000);
  }

  function startPolling() {
    window.clearInterval(state.timers.chat);
    window.clearInterval(state.timers.stats);
    window.clearInterval(state.timers.members);

    state.timers.chat = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (state.channel !== "bugs") loadMessages({ silent: true });
    }, CHAT_POLL_MS);

    state.timers.stats = window.setInterval(() => {
      if (document.visibilityState !== "hidden") loadStats();
    }, STATS_POLL_MS);

    state.timers.members = window.setInterval(() => {
      if (document.visibilityState !== "hidden") loadMembers();
    }, MEMBERS_POLL_MS);
  }

  function init() {
    EC.initTheme();
    initChannelLinks();
    initComposer();
    initDialogs();
    initMembers();
    initDelegatedEvents();
    applyChannelUI(state.channel);
    updateAuthUI();
    startPolling();
    loadStats();
    loadMembers();
    EC.trackVisit("community.html");
    switchChannel(state.channel, { updateHash: false });
    initAuth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
