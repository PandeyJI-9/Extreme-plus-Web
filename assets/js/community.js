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
  const PINNED_POLL_MS = 30000;
  const NOTIFICATIONS_POLL_MS = 30000;
  const RELEASE_SYNC_MS = 10 * 60 * 1000;
  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
  const ATTACHMENT_BUCKET = "community-attachments";
  const INLINE_IMAGE_TYPES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"
  ]);
  const MESSAGE_FIELDS = [
    "id", "user_id", "author_name", "author_avatar", "author_username", "provider",
    "body", "channel", "created_at",
    "attachment_path", "attachment_name", "attachment_type", "attachment_size", "attachment_kind",
    "forwarded_from_message_id", "forwarded_from_name", "forwarded_from_username",
    "forwarded_from_channel", "forwarded_at",
    "reply_to_message_id", "reply_to_author_name", "reply_to_author_username", "reply_to_excerpt",
    "pinned_at", "is_release_announcement", "release_tag", "release_name", "release_url"
  ].join(",");

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
    reply: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 4 6 6-2 2 3 3-1 1-3-3-2 2-6-6 5-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8 16-3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
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
    menuTrigger: null,
    jumpUnread: 0,
    userAway: false,
    renderedIds: new Set(),
    membersOpener: null,
    forwardMessage: null,
    forwardTarget: "",
    reportMessage: null,
    authBusy: false,
    pinned: null,
    pinnedChannel: "",
    notifications: [],
    notificationsUnread: 0,
    notificationsLoaded: false,
    notifiedIds: new Set(),
    replyTo: null,
    pendingAttachment: null,
    attachmentPreviewUrl: "",
    latestGithubRelease: null,
    releaseBusy: false,
    lastReleaseSync: 0,
    timers: { chat: 0, stats: 0, members: 0, heartbeat: 0, pinned: 0, notifications: 0, release: 0 },
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

  function formatFileSize(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function sanitizeAttachmentName(value) {
    let name = String(value || "Attachment");
    try {
      name = name.normalize("NFKC");
    } catch (error) {
      // Older browsers can skip normalization.
    }
    return name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "Attachment";
  }

  function attachmentKindFor(type) {
    const value = String(type || "").toLowerCase();
    if (INLINE_IMAGE_TYPES.has(value)) return "image";
    if (value.startsWith("video/")) return "video";
    return "file";
  }

  function fileExtension(name, type) {
    const safe = sanitizeAttachmentName(name);
    const match = safe.match(/\.([A-Za-z0-9]{1,10})$/);
    if (match) return match[1].toLowerCase();
    const subtype = String(type || "").split("/")[1];
    const cleaned = subtype ? subtype.split("+")[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 10) : "";
    return cleaned.toLowerCase() || "bin";
  }

  function guessedMimeType(file) {
    const explicit = String(file && file.type ? file.type : "").trim().toLowerCase();
    if (explicit) return explicit;
    const extension = fileExtension(file && file.name ? file.name : "", "");
    const types = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
      webp: "image/webp", avif: "image/avif",
      mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/x-m4v",
      mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
      pdf: "application/pdf", zip: "application/zip", txt: "text/plain", log: "text/plain"
    };
    return types[extension] || "application/octet-stream";
  }

  function attachmentPublicUrl(path) {
    return EC.storagePublicUrl(ATTACHMENT_BUCKET, path);
  }

  function attachmentDownloadUrl(url, name) {
    if (!url) return "";
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}download=${encodeURIComponent(name)}`;
  }

  function createFileAttachment(url, name, type, size) {
    const link = document.createElement("a");
    link.className = "garage-attachment garage-attachment--file";
    link.href = attachmentDownloadUrl(url, name);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("download", name);

    const icon = create("span", "garage-file-icon", fileExtension(name, type).toUpperCase());
    icon.setAttribute("aria-hidden", "true");
    link.appendChild(icon);

    const copy = create("span", "garage-file-copy");
    copy.appendChild(create("strong", "", name));
    copy.appendChild(create("small", "", `${formatFileSize(size)} · ${type || "file"}`));
    link.appendChild(copy);
    link.appendChild(create("span", "garage-file-open", "Open"));
    return link;
  }

  function createAttachmentNode(message) {
    const path = message && message.attachment_path ? String(message.attachment_path) : "";
    if (!path) return null;
    const url = attachmentPublicUrl(path);
    if (!url) return null;

    const name = sanitizeAttachmentName(message.attachment_name || "Attachment");
    const type = String(message.attachment_type || "application/octet-stream");
    const size = Number(message.attachment_size) || 0;
    const kind = message.attachment_kind || attachmentKindFor(type);

    if (kind === "image") {
      const figure = create("figure", "garage-attachment garage-attachment--image");
      const link = document.createElement("a");
      link.className = "garage-attachment-media";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `Open ${name}`);
      const image = document.createElement("img");
      image.src = url;
      image.alt = name;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        figure.replaceWith(createFileAttachment(url, name, type, size));
      });
      link.appendChild(image);
      figure.appendChild(link);

      const caption = create("figcaption", "garage-attachment-caption");
      caption.appendChild(create("strong", "", name));
      caption.appendChild(create("small", "", `${formatFileSize(size)} · ${type}`));
      figure.appendChild(caption);
      return figure;
    }

    if (kind === "video") {
      const wrap = create("div", "garage-attachment garage-attachment--video");
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      const source = document.createElement("source");
      source.src = url;
      source.type = type;
      video.appendChild(source);
      video.appendChild(document.createTextNode("Your browser cannot play this video."));
      wrap.appendChild(video);

      const caption = create("div", "garage-attachment-caption");
      const copy = create("span", "garage-file-copy");
      copy.appendChild(create("strong", "", name));
      copy.appendChild(create("small", "", `${formatFileSize(size)} · ${type}`));
      caption.appendChild(copy);
      const open = create("a", "garage-attachment-open", "Open video");
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      caption.appendChild(open);
      wrap.appendChild(caption);
      return wrap;
    }

    return createFileAttachment(url, name, type, size);
  }

  function renderComposerAttachment() {
    const box = $("#composerAttachment");
    const thumb = $("#composerAttachmentThumb");
    const nameNode = $("#composerAttachmentName");
    const metaNode = $("#composerAttachmentMeta");
    if (!box) return;

    const file = state.pendingAttachment;
    box.hidden = !file;
    if (!file) {
      if (thumb) thumb.replaceChildren();
      return;
    }

    const type = guessedMimeType(file);
    const kind = attachmentKindFor(type);
    if (thumb) {
      thumb.replaceChildren();
      if (kind === "image" && state.attachmentPreviewUrl) {
        const image = document.createElement("img");
        image.src = state.attachmentPreviewUrl;
        image.alt = "";
        thumb.appendChild(image);
      } else {
        thumb.appendChild(create(
          "span",
          "composer-attachment-badge",
          kind === "video" ? "VIDEO" : fileExtension(file.name, type).toUpperCase()
        ));
      }
    }
    if (nameNode) nameNode.textContent = sanitizeAttachmentName(file.name);
    if (metaNode) metaNode.textContent = `${formatFileSize(file.size)} · ${type}`;
  }

  function clearPendingAttachment() {
    if (state.attachmentPreviewUrl) {
      try {
        URL.revokeObjectURL(state.attachmentPreviewUrl);
      } catch (error) {
        // Ignore revoked URLs.
      }
    }
    state.attachmentPreviewUrl = "";
    state.pendingAttachment = null;
    const input = $("#composerFileInput");
    if (input) input.value = "";
    renderComposerAttachment();
  }

  function setPendingAttachment(file) {
    if (!file || state.sending) return;
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (file.size <= 0) {
      EC.showToast("That file is empty.", 4200);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      EC.showToast("Attachments must be 2 MB or smaller.", 5200);
      return;
    }

    clearPendingAttachment();
    state.pendingAttachment = file;
    const type = guessedMimeType(file);
    if (attachmentKindFor(type) === "image") {
      try {
        state.attachmentPreviewUrl = URL.createObjectURL(file);
      } catch (error) {
        state.attachmentPreviewUrl = "";
      }
    }
    renderComposerAttachment();
    announce("Attachment ready to send.");
  }

  function openAttachmentPicker(accept) {
    if (state.sending) return;
    if (!state.session) {
      openAuthDialog();
      return;
    }
    const input = $("#composerFileInput");
    if (!input) return;
    input.accept = accept || "*/*";
    input.value = "";
    input.click();
  }

  function handleAttachmentSelection(event) {
    const input = event.currentTarget;
    const file = input && input.files && input.files[0];
    if (file) setPendingAttachment(file);
    if (input) input.value = "";
  }

  async function uploadPendingAttachment(file) {
    const session = await EC.getValidSession();
    if (!session || !state.user || !state.user.id) {
      const error = new Error("Sign in required.");
      error.status = 401;
      throw error;
    }

    const name = sanitizeAttachmentName(file.name);
    const type = guessedMimeType(file);
    const path = `${state.user.id}/${randomUuid()}.${fileExtension(name, type)}`;
    await EC.storageUpload(ATTACHMENT_BUCKET, path, file, session, type);
    return { path, name, type, size: file.size };
  }

  async function deleteAttachmentIfUnused(path) {
    if (!path) return;
    try {
      const query = new URLSearchParams({
        select: "id",
        attachment_path: `eq.${path}`,
        limit: "1"
      }).toString();
      const remaining = await EC.table("chat_messages", query, { auth: false });
      if (Array.isArray(remaining) && remaining.length) return;
      const session = await EC.getValidSession();
      if (session) await EC.storageDelete(ATTACHMENT_BUCKET, path, session);
    } catch (error) {
      // Cleanup is best-effort; the message itself is already gone.
    }
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

  function isStaff() {
    const role = String(state.role || "").toLowerCase();
    return role === "owner" || role === "admin";
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

    if (state.session) {
      loadNotifications({ silent: true });
      syncLatestRelease();
    }

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
      state.notifications = [];
      state.notificationsUnread = 0;
      state.notificationsLoaded = false;
      state.notifiedIds = new Set();
      state.replyTo = null;
      clearPendingAttachment();
      if (button) {
        button.disabled = false;
        button.textContent = "Sign out";
      }
      updateReplyBar();
      updateNotificationUI();
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
    updateReleaseButton();
    updateNotificationUI();

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

  function composerPlaceholder() {
    if (state.replyTo) {
      return `Reply to ${state.replyTo.author_name || state.replyTo.author_username || "Rider"}…`;
    }
    return `Write to #${CHANNELS[state.channel] ? CHANNELS[state.channel].label : "General"}…`;
  }

  function updateComposerLabels() {
    const input = $("#chatInput");
    if (input) input.placeholder = composerPlaceholder();
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

    renderPinnedBanner(channel);
    updateReleaseButton();

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
    closeMessageMenus();
    clearReplyTarget();
    clearPendingAttachment();

    if (changed) {
      state.pinned = null;
      state.pinnedChannel = "";
    }

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
        state.jumpUnread = 0;
        state.userAway = false;
        state.renderedIds = new Set();
        renderChatLoading();
      }
      loadMessages({
        silent: false,
        forceScroll: changed || Boolean(options.forceScroll)
      });
      loadPinnedMessage(next);
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
    updateJumpLatest();
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
      const previousRoles = JSON.stringify(state.roleByUsername);
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
      if (state.messages.length && JSON.stringify(state.roleByUsername) !== previousRoles) {
        renderMessages({ silent: true });
      }
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
      select: MESSAGE_FIELDS,
      channel: `eq.${channel}`,
      order: "created_at.desc",
      limit: "60"
    });
    return params.toString();
  }

  function sameMessageList(current, next) {
    if (current.length !== next.length) return false;
    try {
      return JSON.stringify(current) === JSON.stringify(next);
    } catch (error) {
      return false;
    }
  }

  async function loadMessages(options = {}) {
    if (!EC.ready || state.channel === "bugs") return;
    const channel = state.channel;
    const silent = Boolean(options.silent);
    const body = $("#chatBody");
    const wasNearBottom = body
      ? (body.scrollHeight - body.scrollTop - body.clientHeight) < 150
      : true;
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
      const freshIds = new Set(fresh.map((message) => message.id));
      const changed = !sameMessageList(state.messages, ordered);

      state.initializedChannels[channel] = true;
      state.messages = ordered;

      if (initialized && fresh.length && !wasNearBottom && !options.forceScroll) {
        state.jumpUnread += fresh.length;
      }

      if (changed || !initialized || options.forceScroll) {
        renderMessages({
          forceScroll: Boolean(options.forceScroll) || !initialized,
          silent: silent || (initialized && previousCount > 0),
          freshIds: initialized ? freshIds : new Set()
        });
      } else {
        updateJumpLatest();
      }

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

  function updateReleaseButton() {
    const button = $("#releaseAnnounceBtn");
    if (!button) return;
    button.hidden = !(state.channel === "releases" && isStaff());
  }

  function renderPinnedBanner(channel) {
    const node = $("#channelPinned");
    if (!node) return;
    const meta = CHANNELS[channel] || CHANNELS.general;
    if (!meta.public) {
      node.hidden = true;
      return;
    }

    const label = $("#pinnedLabel");
    const title = $("#pinnedTitle");
    const text = $("#pinnedText");
    const link = $("#pinnedLink");
    if (!label || !title || !text || !link) return;

    const pinned = state.pinned && state.pinnedChannel === channel ? state.pinned : null;
    if (pinned) {
      node.hidden = false;
      label.textContent = `PINNED · #${meta.label.toUpperCase()}`;
      title.textContent = `${pinned.author_name || "Rider"}${pinned.author_username ? ` @${pinned.author_username}` : ""}`;
      text.textContent = truncate(pinned.body || pinned.attachment_name || "Attachment", 180);
      link.textContent = "Jump";
      link.href = `#${channel}`;
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.setAttribute("data-pin-jump", pinned.id);
      return;
    }

    if (channel !== "releases") {
      node.hidden = true;
      return;
    }

    node.hidden = false;
    label.textContent = "PINNED · LATEST STABLE";
    title.textContent = `${config.kernel && config.kernel.fallbackBuild ? config.kernel.fallbackBuild : "Latest stable"} — Official Stable`;
    text.textContent = "Only stable, matching ROM/root builds are listed. Prereleases stay out of the garage.";
    link.textContent = "Download";
    link.href = `${(config.links && config.links.kernelReleases) || "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases"}/latest`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.removeAttribute("data-pin-jump");
  }

  async function loadPinnedMessage(channel, options = {}) {
    if (!EC.ready || channel === "bugs") {
      if (state.channel === channel) {
        state.pinned = null;
        state.pinnedChannel = channel;
        renderPinnedBanner(channel);
      }
      return;
    }

    try {
      const row = await EC.rpc("community_channel_pinned", { p_channel: channel }, { auth: false });
      if (state.channel !== channel) return;
      state.pinned = row && typeof row === "object" ? row : null;
      state.pinnedChannel = channel;
      renderPinnedBanner(channel);
    } catch (error) {
      if (!options.silent) {
        console.warn("EXTREME++: pinned message could not load.", error);
      }
    }
  }

  function isPinnedMessage(message) {
    return Boolean(message && (message.pinned_at || (state.pinned && state.pinned.id === message.id)));
  }

  function scrollToMessage(id) {
    if (!id) return;
    closeMessageMenus();
    cancelChatAutoScroll();
    const article = document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
    if (!article) {
      EC.showToast("That message is older than the loaded history.", 4200);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    article.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    article.classList.add("is-highlighted");
    window.setTimeout(() => article.classList.remove("is-highlighted"), 1900);
  }

  function chatDistanceFromBottom(body) {
    return Math.max(0, body.scrollHeight - body.scrollTop - body.clientHeight);
  }

  function cancelChatAutoScroll() {
    chatScrollStickToken += 1;
  }

  function updateJumpPosition() {
    const panel = $("#chatPanel");
    const body = $("#chatBody");
    const button = $("#chatJumpLatest");
    if (!panel || !body || !button) return;
    const panelRect = panel.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const below = Math.max(0, panelRect.bottom - bodyRect.bottom);
    button.style.setProperty("--jump-bottom", `${Math.round(below + 12)}px`);
  }

  function snapChatToBottom(body) {
    if (!body || !body.isConnected) return;
    state.userAway = false;
    const previousBehavior = body.style.scrollBehavior;
    body.style.scrollBehavior = "auto";
    body.scrollTop = body.scrollHeight;
    body.style.scrollBehavior = previousBehavior;
    updateJumpLatest();
  }

  function updateJumpLatest() {
    const body = $("#chatBody");
    const button = $("#chatJumpLatest");
    const count = $("#chatJumpCount");
    if (!body || !button || !count) return;

    const hasMessages = Boolean(
      state.messages.length
      && !body.querySelector(".garage-empty")
      && !body.querySelector(".chat-loading")
    );
    const unread = Math.max(0, Number(state.jumpUnread) || 0);
    const distance = chatDistanceFromBottom(body);
    const awayFromLatest = state.userAway && distance > 180;

    button.hidden = !hasMessages || (!awayFromLatest && unread === 0);
    count.hidden = unread <= 0;
    count.textContent = unread > 99 ? "99+" : String(unread);
    button.setAttribute(
      "aria-label",
      unread > 0
        ? `${unread} new message${unread === 1 ? "" : "s"}. Jump to latest.`
        : "Jump to latest message"
    );
  }

  function scrollToLatest() {
    const body = $("#chatBody");
    if (!body) return;
    closeMessageMenus();
    cancelChatAutoScroll();
    state.jumpUnread = 0;
    state.userAway = false;
    updateJumpLatest();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    body.scrollTo({
      top: body.scrollHeight,
      behavior: reduce ? "auto" : "smooth"
    });
  }

  function initJumpLatest() {
    const button = $("#chatJumpLatest");
    const body = $("#chatBody");
    if (button) {
      button.addEventListener("click", scrollToLatest);
    }
    if (body) {
      body.addEventListener("scroll", () => {
        const distance = chatDistanceFromBottom(body);
        state.userAway = distance > 180;
        if (state.jumpUnread && distance < 40) {
          state.jumpUnread = 0;
        }
        updateJumpLatest();
        if (state.activeMenuId) closeMessageMenus();
      }, { passive: true });
      if (typeof ResizeObserver === "function") {
        let previousHeight = body.clientHeight;
        const observer = new ResizeObserver(() => {
          const nextHeight = body.clientHeight;
          const resized = nextHeight !== previousHeight;
          previousHeight = nextHeight;
          updateJumpPosition();
          if (resized && !state.userAway) snapChatToBottom(body);
        });
        observer.observe(body);
      }
      updateJumpPosition();
    }
  }

  function initMessageGestures() {
    const body = $("#chatBody");
    if (!body) return;

    const SWIPE_THRESHOLD = 56;
    const SWIPE_MAX = 86;
    let gesture = null;
    let suppressContextUntil = 0;

    const clearLongPress = () => {
      if (gesture && gesture.longPressTimer) {
        window.clearTimeout(gesture.longPressTimer);
        gesture.longPressTimer = 0;
      }
    };

    const resetSwipe = (g, animate) => {
      if (!g || !g.article || !g.article.isConnected) return;
      const article = g.article;
      const wrap = g.wrap;
      article.classList.remove("is-swiping", "is-swipe-ready");
      if (!animate) {
        wrap.style.transform = "";
        article.style.removeProperty("--swipe-progress");
        return;
      }
      article.classList.add("is-swipe-reset");
      window.requestAnimationFrame(() => {
        if (article.isConnected) wrap.style.transform = "translateX(0px)";
      });
      window.setTimeout(() => {
        if (!article.isConnected) return;
        article.classList.remove("is-swipe-reset");
        wrap.style.transform = "";
        article.style.removeProperty("--swipe-progress");
      }, 230);
    };

    const finishGesture = (cancelled) => {
      if (!gesture) return;
      const g = gesture;
      if (g.longPressTimer) {
        window.clearTimeout(g.longPressTimer);
        g.longPressTimer = 0;
      }
      gesture = null;
      if (!g.active) return;
      resetSwipe(g, true);
      if (!cancelled && g.travel >= SWIPE_THRESHOLD) {
        const message = messageById(g.id);
        if (message) {
          try {
            if (navigator.vibrate) navigator.vibrate(12);
          } catch (error) {
            // Haptics are optional.
          }
          setReplyTarget(message);
        }
      }
    };

    const isInteractiveTarget = (target) => Boolean(
      target.closest("a, button, input, textarea, select, video, audio, .garage-attachment, .garage-reply-quote")
    );

    body.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.isPrimary === false) return;
      if (event.button !== undefined && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      const article = event.target.closest(".garage-message");
      if (!article || article.classList.contains("has-open-menu")) return;
      const wrap = article.querySelector(".garage-bubble-wrap");
      if (!wrap) return;

      if (gesture) finishGesture(true);
      clearLongPress();

      const g = {
        article,
        wrap,
        id: article.getAttribute("data-message-id"),
        own: article.classList.contains("is-own"),
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        active: false,
        travel: 0,
        moved: false,
        longPressTimer: 0
      };
      gesture = g;

      g.longPressTimer = window.setTimeout(() => {
        if (!gesture || gesture !== g || gesture.active || gesture.moved) return;
        g.longPressTimer = 0;
        suppressContextUntil = Date.now() + 900;
        try {
          if (navigator.vibrate) navigator.vibrate(10);
        } catch (error) {
          // Haptics are optional.
        }
        openMessageMenuAt(g.id, g.startX, g.startY);
      }, 480);
    }, { passive: true });

    body.addEventListener("pointermove", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const g = gesture;
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      if (!g.active) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        g.moved = true;
        clearLongPress();
        if (Math.abs(dy) >= Math.abs(dx)) return;

        const direction = g.own ? -1 : 1;
        if ((dx * direction) < 8) return;

        g.active = true;
        g.article.classList.add("is-swiping");
        try {
          g.article.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is an enhancement.
        }
      }

      if (event.cancelable) event.preventDefault();
      const direction = g.own ? -1 : 1;
      const raw = (event.clientX - g.startX) * direction;
      const travel = Math.min(Math.max(0, raw), SWIPE_MAX);
      g.travel = travel;
      g.wrap.style.transform = `translateX(${Math.round(direction * travel)}px)`;
      g.article.style.setProperty("--swipe-progress", Math.min(1, travel / SWIPE_THRESHOLD).toFixed(3));
      g.article.classList.toggle("is-swipe-ready", travel >= SWIPE_THRESHOLD);
    }, { passive: false });

    body.addEventListener("pointerup", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.active && event.cancelable) event.preventDefault();
      finishGesture(false);
    }, { passive: false });

    body.addEventListener("pointercancel", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      finishGesture(true);
    }, { passive: true });

    body.addEventListener("contextmenu", (event) => {
      const article = event.target.closest(".garage-message");
      if (!article) return;
      event.preventDefault();
      if (event.pointerType !== "mouse" && Date.now() < suppressContextUntil) return;
      openMessageMenuAt(article.getAttribute("data-message-id"), event.clientX, event.clientY);
    });

    body.addEventListener("dblclick", (event) => {
      if (!window.matchMedia("(hover: hover)").matches) return;
      if (isInteractiveTarget(event.target)) return;
      const article = event.target.closest(".garage-message");
      if (!article) return;
      const message = messageById(article.getAttribute("data-message-id"));
      if (!message) return;
      event.preventDefault();
      setReplyTarget(message);
    });

    body.addEventListener("keydown", (event) => {
      const article = event.target.closest(".garage-message");
      if (!article || event.target !== article) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const message = messageById(article.getAttribute("data-message-id"));
      if (!message) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMessageMenu(message.id);
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setReplyTarget(message);
        return;
      }

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        copyMessage(message);
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        openForwardDialog(message);
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && message.user_id && state.user && message.user_id === state.user.id) {
        event.preventDefault();
        deleteMessage(message);
      }
    });

    window.addEventListener("resize", () => {
      if (state.activeMenuId) closeMessageMenus();
    }, { passive: true });
  }

  function updateReplyBar() {
    const bar = $("#composerReply");
    if (!bar) return;
    const message = state.replyTo;
    bar.hidden = !message;
    if (!message) {
      bar.removeAttribute("title");
      bar.removeAttribute("aria-label");
      return;
    }
    const author = message.author_name || message.author_username || "Rider";
    const excerpt = truncate(message.body || message.attachment_name || "Attachment", 140);
    const authorNode = $("#composerReplyAuthor");
    const text = $("#composerReplyText");
    if (authorNode) authorNode.textContent = author;
    if (text) text.textContent = excerpt;
    bar.title = `Click to jump to ${author}'s message`;
    bar.setAttribute("aria-label", `Replying to ${author}: ${excerpt}. Click to jump to the original message.`);
  }

  function setReplyTarget(message) {
    if (!message) return;
    state.replyTo = message;
    updateReplyBar();
    updateComposerLabels();
    announce(`Replying to ${message.author_name || message.author_username || "Rider"}.`);
    const input = $("#chatInput");
    if (input) input.focus({ preventScroll: true });
  }

  function clearReplyTarget() {
    if (!state.replyTo) {
      updateReplyBar();
      return;
    }
    state.replyTo = null;
    updateReplyBar();
    updateComposerLabels();
  }

  let chatScrollStickToken = 0;

  function scrollChatToBottom(body) {
    if (!body) return;
    const token = ++chatScrollStickToken;
    let active = true;
    const cancel = () => {
      if (token !== chatScrollStickToken) return;
      active = false;
    };
    const observeUserScroll = () => {
      if (!active || token !== chatScrollStickToken) return;
      if (chatDistanceFromBottom(body) > 80) {
        active = false;
        body.removeEventListener("scroll", observeUserScroll);
      }
    };
    const apply = () => {
      if (!active || token !== chatScrollStickToken || !body.isConnected) return;
      snapChatToBottom(body);
    };
    const cancelEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    cancelEvents.forEach((name) => body.addEventListener(name, cancel, { passive: true, once: true }));
    body.addEventListener("scroll", observeUserScroll, { passive: true });

    apply();
    window.requestAnimationFrame(() => {
      apply();
      window.requestAnimationFrame(apply);
    });
    window.setTimeout(apply, 90);
    window.setTimeout(apply, 260);
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
      document.fonts.ready.then(apply).catch(() => {});
    }
    body.querySelectorAll("img, video").forEach((media) => {
      const settle = () => {
        if (active) apply();
      };
      if (media.tagName === "VIDEO") {
        media.addEventListener("loadedmetadata", settle, { once: true });
      }
      if (!media.complete) {
        media.addEventListener("load", settle, { once: true });
      }
    });
    window.setTimeout(() => {
      if (token === chatScrollStickToken) active = false;
      cancelEvents.forEach((name) => body.removeEventListener(name, cancel));
      body.removeEventListener("scroll", observeUserScroll);
    }, 5000);
  }

  function renderMessages(options = {}) {
    const body = $("#chatBody");
    if (!body) return;
    const forceScroll = Boolean(options.forceScroll);
    const freshIds = options.freshIds instanceof Set ? options.freshIds : new Set();
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 150;
    const previousTop = body.scrollTop;

    body.replaceChildren();
    state.renderedIds = new Set();

    if (!state.messages.length) {
      state.jumpUnread = 0;
      renderChatEmpty(body);
      updateJumpLatest();
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

      fragment.appendChild(createMessage(message, compact, {
        fresh: freshIds.has(message.id)
      }));
      previous = message;
      previousDay = key || previousDay;
    });

    body.appendChild(fragment);
    state.renderedIds = new Set(state.messages.map((message) => message.id));

    if (forceScroll || nearBottom) {
      state.jumpUnread = 0;
      state.userAway = false;
      scrollChatToBottom(body);
    } else {
      body.scrollTop = previousTop;
      updateJumpLatest();
    }
  }

  function createMessage(message, compact, options = {}) {
    const own = Boolean(state.session && state.user && message.user_id === state.user.id);
    const fresh = Boolean(options.fresh);
    const article = create("article", "garage-message" + (compact ? " is-compact" : "") + (own ? " is-own" : "") + (fresh ? " is-new" : ""));
    article.setAttribute("data-message-id", message.id);
    article.setAttribute("role", "article");
    article.setAttribute("tabindex", "0");
    article.setAttribute("aria-label", `${message.author_name || message.author_username || "Rider"} at ${formatTime(message.created_at)}: ${truncate(message.body || message.attachment_name || "Attachment", 180)}`);
    article.setAttribute("aria-haspopup", "menu");
    article.setAttribute("aria-keyshortcuts", "Enter");

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
    if (message.reply_to_message_id) {
      const quote = create("button", "garage-reply-quote");
      quote.type = "button";
      quote.setAttribute("data-reply-jump", message.reply_to_message_id);
      quote.setAttribute("aria-label", `Jump to the message from ${message.reply_to_author_name || "Rider"}`);
      quote.appendChild(create("small", "", `Replying to ${message.reply_to_author_name || message.reply_to_author_username || "Rider"}`));
      quote.appendChild(create("span", "", message.reply_to_excerpt || "Original message"));
      bubble.appendChild(quote);
    }

    if (message.forwarded_from_channel) {
      const forward = create("div", "garage-forwarded");
      forward.appendChild(create("small", "", `Forwarded from #${CHANNELS[message.forwarded_from_channel] ? CHANNELS[message.forwarded_from_channel].label : message.forwarded_from_channel}`));
      forward.appendChild(create("strong", "", message.forwarded_from_name || message.forwarded_from_username || "Rider"));
      bubble.appendChild(forward);
    }

    if (String(message.body || "").trim()) {
      bubble.appendChild(create("div", "garage-message-body", message.body));
    }
    const attachment = createAttachmentNode(message);
    if (attachment) bubble.appendChild(attachment);
    const foot = create("div", "garage-bubble-foot");
    const time = create("time", "", formatTime(message.created_at));
    time.dateTime = String(message.created_at || "");
    foot.appendChild(time);
    if (message.forwarded_at) foot.appendChild(create("span", "", "forwarded"));
    if (isPinnedMessage(message)) foot.appendChild(create("span", "garage-pinned-tag", "pinned"));
    if (message.is_release_announcement) foot.appendChild(create("span", "garage-release-tag", "stable"));
    bubble.appendChild(foot);
    wrap.appendChild(bubble);

    const actions = create("div", "garage-message-actions");
    actions.appendChild(quickAction("reply", "Reply", MENU_ICONS.reply));
    actions.appendChild(quickAction("copy", "Copy text", MENU_ICONS.copy));
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "garage-action-btn";
    trigger.setAttribute("data-message-menu", message.id);
    trigger.setAttribute("aria-label", "More message actions");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>';
    actions.appendChild(trigger);
    wrap.appendChild(actions);
    article.appendChild(wrap);

    return article;
  }

  function quickAction(action, label, icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "garage-action-btn garage-quick-action";
    button.setAttribute("data-message-action", action);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = icon;
    return button;
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
    updateJumpLatest();
  }

  function closeMessageMenus(exceptId) {
    const portal = $("#messageMenuPortal");
    if (portal && (!exceptId || portal.getAttribute("data-message-id") !== exceptId)) {
      portal.remove();
    }
    $$(".garage-message.has-open-menu").forEach((message) => {
      if (exceptId && message.getAttribute("data-message-id") === exceptId) return;
      message.classList.remove("has-open-menu");
      const trigger = $("[data-message-menu]", message);
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
    if (!exceptId) {
      state.activeMenuId = "";
      state.menuTrigger = null;
    }
  }

  function buildMessageMenu(message) {
    const own = Boolean(state.session && state.user && message.user_id === state.user.id);
    const menu = create("div", "garage-menu");
    menu.id = "messageMenuPortal";
    menu.setAttribute("data-message-id", message.id);
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Message actions");

    menu.appendChild(menuButton("reply", "Reply", MENU_ICONS.reply));
    if (isStaff()) {
      menu.appendChild(menuButton("pin", isPinnedMessage(message) ? "Unpin" : "Pin", MENU_ICONS.pin));
    }
    menu.appendChild(menuButton("forward", "Forward", MENU_ICONS.forward));
    menu.appendChild(menuButton("copy", "Copy text", MENU_ICONS.copy));
    menu.appendChild(create("span", "garage-menu-separator"));
    if (!own) menu.appendChild(menuButton("report", "Report", MENU_ICONS.report));
    if (own) menu.appendChild(menuButton("delete", "Delete", MENU_ICONS.delete, true));

    menu.addEventListener("keydown", (event) => {
      const items = $$("button:not([disabled])", menu);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
        items[next].focus({ preventScroll: true });
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1].focus({ preventScroll: true });
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const trigger = state.menuTrigger;
        closeMessageMenus();
        if (trigger && trigger.isConnected) {
          try {
            trigger.focus({ preventScroll: true });
          } catch (error) {
            trigger.focus();
          }
        }
      }
    });

    return menu;
  }

  function placeMessageMenu(menu, position) {
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    const anchor = position && position.anchor;
    let left = position && Number.isFinite(position.x) ? position.x : 0;
    let top = position && Number.isFinite(position.y) ? position.y : 0;

    if (anchor) {
      left = anchor.right - rect.width;
      top = anchor.bottom + 6;
      if (top + rect.height > window.innerHeight - pad) {
        top = anchor.top - rect.height - 6;
      }
    } else if (top + rect.height > window.innerHeight - pad) {
      top -= rect.height;
    }

    left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - rect.width - pad));
    top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - rect.height - pad));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function openMessageMenu(message, position) {
    const article = document.querySelector(`[data-message-id="${CSS.escape(String(message.id))}"]`);
    const trigger = article ? $("[data-message-menu]", article) : null;
    closeMessageMenus();

    const menu = buildMessageMenu(message);
    menu.style.left = "0px";
    menu.style.top = "0px";
    document.body.appendChild(menu);
    placeMessageMenu(menu, position);

    if (article) article.classList.add("has-open-menu");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      state.menuTrigger = trigger;
    } else {
      state.menuTrigger = null;
    }
    state.activeMenuId = message.id;
    updateJumpLatest();

    window.requestAnimationFrame(() => {
      if (!menu.isConnected) return;
      menu.classList.add("is-open");
      const first = $("button:not([disabled])", menu);
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (error) {
          first.focus();
        }
      }
    });
  }

  function toggleMessageMenu(id) {
    const message = messageById(id);
    if (!message) return;
    if (state.activeMenuId === id && $("#messageMenuPortal")) {
      closeMessageMenus();
      return;
    }
    const article = document.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
    const trigger = article ? $("[data-message-menu]", article) : null;
    openMessageMenu(message, trigger
      ? { anchor: trigger.getBoundingClientRect() }
      : { x: 12, y: 72 });
  }

  function openMessageMenuAt(id, x, y) {
    const message = messageById(id);
    if (!message) return;
    openMessageMenu(message, { x, y });
  }

  function messageById(id) {
    return state.messages.find((message) => message.id === id) || null;
  }

  function handleMessageAction(action, id) {
    const message = messageById(id);
    if (!message) return;
    closeMessageMenus();
    if (action === "reply") setReplyTarget(message);
    else if (action === "pin") pinMessage(message);
    else if (action === "forward") openForwardDialog(message);
    else if (action === "copy") copyMessage(message);
    else if (action === "report") openReportDialog(message);
    else if (action === "delete") deleteMessage(message);
  }

  async function pinMessage(message) {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (!isStaff()) {
      EC.showToast("Only staff can pin messages.", 4200);
      return;
    }

    const pinned = isPinnedMessage(message);
    try {
      const result = await EC.rpc("community_pin_message", {
        p_message_id: message.id,
        p_pinned: !pinned
      }, { session: state.session });

      if (result && result.pinned) {
        message.pinned_at = result.pinned_at || new Date().toISOString();
        state.messages.forEach((item) => {
          if (item.id !== message.id) item.pinned_at = null;
        });
      } else {
        message.pinned_at = null;
      }

      await loadPinnedMessage(state.channel, { silent: true });
      renderMessages({ silent: true });
      announce(pinned ? "Message unpinned." : "Message pinned.");
      EC.showToast(pinned ? "Message unpinned." : "Message pinned for this channel.", 3200);
    } catch (error) {
      EC.showToast(error && error.status === 403
        ? "Only staff can pin messages."
        : "That message could not be pinned.", 4800);
    }
  }

  async function copyMessage(message) {
    const baseUrl = message.attachment_path ? attachmentPublicUrl(message.attachment_path) : "";
    const attachmentUrl = baseUrl && message.attachment_kind === "file"
      ? attachmentDownloadUrl(baseUrl, sanitizeAttachmentName(message.attachment_name || "Attachment"))
      : baseUrl;
    const text = [String(message.body || "").trim(), attachmentUrl].filter(Boolean).join("\n");
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
      if (message.attachment_path
        && state.user
        && (isStaff() || String(message.attachment_path).startsWith(`${state.user.id}/`))) {
        deleteAttachmentIfUnused(message.attachment_path);
      }
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
      preview.appendChild(document.createTextNode(truncate(message.body || message.attachment_name || "Attachment", 320)));
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
    const file = state.pendingAttachment;
    if (!body && !file) {
      if (input) input.focus();
      return;
    }
    if (body.length > 500) {
      EC.showToast("Keep messages under 500 characters.", 4200);
      return;
    }

    state.sending = true;
    let sent = false;
    let uploaded = null;
    const replyTarget = state.replyTo;
    EC.setBusy(button, true, file ? "Uploading…" : "Sending…");
    try {
      if (file) {
        uploaded = await uploadPendingAttachment(file);
        EC.setBusy(button, true, "Sending…");
      }

      const payload = { body, channel: state.channel };
      if (uploaded) {
        payload.attachment_path = uploaded.path;
        payload.attachment_name = uploaded.name;
        payload.attachment_type = uploaded.type;
        payload.attachment_size = uploaded.size;
      }
      if (replyTarget) payload.reply_to_message_id = replyTarget.id;

      const rows = await EC.table("chat_messages", "", {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: payload
      });
      if (input) {
        input.value = "";
        input.style.height = "auto";
      }
      setText("#chatCharCount", "0");
      clearReplyTarget();
      clearPendingAttachment();
      if (Array.isArray(rows) && rows[0]) {
        state.messages.push(rows[0]);
        renderMessages({ forceScroll: true, freshIds: new Set([rows[0].id]) });
      } else {
        await loadMessages({ silent: true, forceScroll: true });
      }
      sent = true;
      announce("Message sent.");
      loadStats();
      if (input) input.focus({ preventScroll: true });
    } catch (error) {
      if (uploaded && uploaded.path) deleteAttachmentIfUnused(uploaded.path);
      let message = error && error.message ? error.message : "The message could not be sent.";
      if (error && error.status === 401) message = "Your session expired. Sign in again.";
      if (error && error.status === 403) message = "Your account is restricted from posting.";
      if (error && error.status === 413) message = "Attachments must be 2 MB or smaller.";
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
      button.setAttribute("aria-label", `Wait ${remaining} seconds before sending`);
      button.title = `Slow mode: wait ${remaining}s`;
    } else if (!state.sending) {
      button.disabled = false;
      button.querySelector("span").textContent = "Send";
      button.setAttribute("aria-label", "Send message");
      button.title = "Send message (Enter)";
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
    const replyCancel = $("#composerReplyCancel");
    if (replyCancel) {
      replyCancel.addEventListener("click", () => {
        clearReplyTarget();
        input.focus({ preventScroll: true });
      });
    }
    const replyBar = $("#composerReply");
    if (replyBar) {
      replyBar.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        if (state.replyTo) scrollToMessage(state.replyTo.id);
      });
    }

    const photoButton = $("#composerPhoto");
    if (photoButton) {
      photoButton.addEventListener("click", () => openAttachmentPicker("image/*,video/*"));
    }
    const fileButton = $("#composerFile");
    if (fileButton) {
      fileButton.addEventListener("click", () => openAttachmentPicker("*/*"));
    }
    const fileInput = $("#composerFileInput");
    if (fileInput) fileInput.addEventListener("change", handleAttachmentSelection);
    const removeAttachment = $("#composerAttachmentRemove");
    if (removeAttachment) {
      removeAttachment.addEventListener("click", () => {
        if (state.sending) return;
        clearPendingAttachment();
        input.focus({ preventScroll: true });
      });
    }

    input.addEventListener("paste", (event) => {
      const files = event.clipboardData && event.clipboardData.files;
      if (!files || !files.length) return;
      event.preventDefault();
      if (files.length > 1) EC.showToast("Send one attachment per message.", 4200);
      setPendingAttachment(files[0]);
    });

    const hasFileDrag = (event) => Boolean(
      event.dataTransfer
      && Array.from(event.dataTransfer.types || []).includes("Files")
    );
    let dragDepth = 0;
    form.addEventListener("dragenter", (event) => {
      if (!state.session || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepth += 1;
      form.classList.add("is-dragover");
    });
    form.addEventListener("dragover", (event) => {
      if (!state.session || !hasFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    form.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) form.classList.remove("is-dragover");
    });
    form.addEventListener("drop", (event) => {
      if (!state.session || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepth = 0;
      form.classList.remove("is-dragover");
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      if (files.length > 1) EC.showToast("Send one attachment per message.", 4200);
      setPendingAttachment(files[0]);
    });

    updateReplyBar();
    renderComposerAttachment();
    resizeComposer();
  }

  /* =========================================================
     Notifications, browser alerts and release broadcasts
     ========================================================= */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || window.location.protocol !== "https:") return;
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("EXTREME++: service worker could not register.", error);
    });
  }

  function notificationUrl(notification) {
    const fallback = new URL("./community.html", window.location.href).href;
    const raw = notification && notification.link ? String(notification.link) : "";
    if (!raw) return fallback;
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin ? url.href : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function showBrowserNotification(notification) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = notification && notification.title ? String(notification.title) : "EXTREME++";
    const options = {
      body: notification && notification.body ? String(notification.body) : "",
      icon: new URL("./assets/img/icon-192.png", window.location.href).href,
      badge: new URL("./assets/img/icon-192.png", window.location.href).href,
      tag: `extreme-${notification && notification.id ? notification.id : Date.now()}`,
      data: { url: notificationUrl(notification) },
      renotify: false
    };

    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => registration.showNotification(title, options))
          .catch(() => {
            try {
              new Notification(title, options);
            } catch (error) {
              // Browser notification support is optional.
            }
          });
      } else {
        new Notification(title, options);
      }
    } catch (error) {
      // Notifications are an enhancement; never break the page.
    }
  }

  function updateNotificationPermissionUI() {
    const button = $("#notificationEnable");
    const note = $("#notificationPermissionNote");
    if (!button || !note) return;

    if (!("Notification" in window)) {
      button.hidden = true;
      note.textContent = "This browser does not support system notifications. In-app notifications still work.";
      return;
    }

    button.hidden = false;
    const permission = Notification.permission;
    if (permission === "granted") {
      button.textContent = "Browser alerts on";
      button.disabled = true;
      note.textContent = "Browser alerts are on for this device. Replies and stable releases can appear outside the tab.";
    } else if (permission === "denied") {
      button.textContent = "Alerts blocked";
      button.disabled = true;
      note.textContent = "Browser alerts are blocked in browser settings. In-app notifications still work.";
    } else {
      button.textContent = "Enable browser alerts";
      button.disabled = false;
      note.textContent = "Browser alerts are off. Enable them to get replies and stable-release alerts outside the tab.";
    }
  }

  async function enableBrowserAlerts() {
    if (!("Notification" in window)) {
      EC.showToast("This browser does not support system notifications.", 4600);
      return;
    }
    if (Notification.permission === "denied") {
      EC.showToast("Browser alerts are blocked in your browser settings.", 5200);
      updateNotificationPermissionUI();
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      updateNotificationPermissionUI();
      if (permission === "granted") {
        registerServiceWorker();
        EC.showToast("Browser alerts enabled for this device.", 4600);
        showBrowserNotification({
          id: `welcome-${Date.now()}`,
          title: "Browser alerts enabled",
          body: "You will be notified about replies and new stable releases.",
          link: "./community.html"
        });
      } else {
        EC.showToast("Browser alerts were not enabled.", 4200);
      }
    } catch (error) {
      EC.showToast("Browser alerts could not be enabled.", 4600);
    }
  }

  function updateNotificationUI() {
    const button = $("#communityNotificationsBtn");
    const count = $("#communityNotificationCount");
    const unread = state.session ? Math.max(0, Number(state.notificationsUnread) || 0) : 0;

    if (count) {
      count.hidden = unread <= 0;
      count.textContent = unread > 99 ? "99+" : String(unread);
    }
    if (button) {
      button.classList.toggle("has-unread", unread > 0);
      button.setAttribute("aria-label", unread > 0 ? `Notifications, ${unread} unread` : "Notifications");
    }

    const unreadLabel = $("#notificationUnreadLabel");
    if (unreadLabel) unreadLabel.textContent = unread > 0 ? `${unread} unread` : "No unread notifications";
    const markButton = $("#notificationMarkRead");
    if (markButton) markButton.disabled = unread <= 0;
    updateNotificationPermissionUI();
  }

  function renderNotifications() {
    const list = $("#notificationList");
    if (!list) return;
    list.replaceChildren();

    if (!state.session) {
      list.appendChild(create("p", "notification-empty", "Sign in to see replies and release alerts."));
      return;
    }
    if (!state.notifications.length) {
      list.appendChild(create("p", "notification-empty", "No notifications yet. Replies and new stable releases will appear here."));
      return;
    }

    const fragment = document.createDocumentFragment();
    state.notifications.forEach((notification) => {
      if (!notification || !notification.id) return;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "notification-item" + (notification.read_at ? "" : " is-unread");
      item.setAttribute("data-notification-id", notification.id);
      item.setAttribute("data-notification-channel", notification.channel || "");
      item.setAttribute("data-notification-message", notification.message_id || "");
      item.setAttribute("data-notification-link", notification.link || "");

      const icon = create(
        "span",
        `notification-icon notification-icon--${notification.type || "system"}`,
        notification.type === "release" ? "★" : notification.type === "reply" ? "↩" : "•"
      );
      icon.setAttribute("aria-hidden", "true");
      item.appendChild(icon);

      const copy = create("span", "notification-copy");
      copy.appendChild(create("strong", "", notification.title || "Notification"));
      if (notification.body) copy.appendChild(create("span", "", notification.body));
      const kind = notification.type === "release" ? "Release" : notification.type === "reply" ? "Reply" : "Update";
      copy.appendChild(create("small", "", `${kind} · ${EC.relativeTime(notification.created_at)}`));
      item.appendChild(copy);

      fragment.appendChild(item);
    });
    list.appendChild(fragment);
  }

  async function loadNotifications(options = {}) {
    if (!EC.ready || !state.session) {
      state.notifications = [];
      state.notificationsUnread = 0;
      state.notificationsLoaded = false;
      state.notifiedIds = new Set();
      updateNotificationUI();
      renderNotifications();
      return;
    }

    try {
      const session = await EC.getValidSession();
      if (!session) {
        state.session = null;
        state.notifications = [];
        state.notificationsUnread = 0;
        state.notificationsLoaded = false;
        state.notifiedIds = new Set();
        updateNotificationUI();
        renderNotifications();
        return;
      }
      state.session = session;

      const data = await EC.rpc("community_get_notifications", { p_limit: 30 }, { session });
      const items = data && Array.isArray(data.items) ? data.items : [];
      const unread = data && Number.isFinite(Number(data.unread))
        ? Number(data.unread)
        : items.filter((item) => !item.read_at).length;

      const firstLoad = !state.notificationsLoaded;
      const fresh = [];
      items.forEach((notification) => {
        if (!notification || !notification.id) return;
        if (state.notifiedIds.has(notification.id)) return;
        state.notifiedIds.add(notification.id);
        if (!firstLoad && !notification.read_at) fresh.push(notification);
      });

      state.notifications = items;
      state.notificationsUnread = unread;
      state.notificationsLoaded = true;
      updateNotificationUI();
      renderNotifications();

      if (fresh.length) {
        fresh.slice(0, 3).forEach(showBrowserNotification);
        const latest = fresh[0];
        if (document.visibilityState !== "hidden") {
          EC.showToast(latest.title || "New notification", 5200);
          announce(latest.title || "New notification");
        }
      }
    } catch (error) {
      if (!options.silent) {
        console.warn("EXTREME++: notifications could not load.", error);
      }
      if (error && error.status === 401) {
        state.session = null;
        state.notifications = [];
        state.notificationsUnread = 0;
        state.notificationsLoaded = false;
        state.notifiedIds = new Set();
        updateNotificationUI();
        renderNotifications();
        updateAuthUI();
      }
    }
  }

  async function markNotificationsRead(ids) {
    if (!state.session) return 0;
    const all = !ids || !ids.length;
    try {
      const payload = all ? {} : { p_ids: ids };
      const count = await EC.rpc("community_mark_notifications_read", payload, { session: state.session });
      const now = new Date().toISOString();
      const selected = new Set(ids || []);
      state.notifications = state.notifications.map((notification) => {
        if (!all && !selected.has(notification.id)) return notification;
        return notification.read_at ? notification : { ...notification, read_at: now };
      });
      state.notificationsUnread = all
        ? 0
        : Math.max(0, state.notificationsUnread - (Number(count) || 0));
      updateNotificationUI();
      renderNotifications();
      return Number(count) || 0;
    } catch (error) {
      return 0;
    }
  }

  async function openNotifications() {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    const dialog = $("#notificationDialog");
    if (!dialog) return;
    await loadNotifications({ silent: true });
    renderNotifications();
    updateNotificationPermissionUI();
    showDialog(dialog, document.activeElement, "[data-notification-id], #notificationDialogClose");
    if (state.notificationsUnread > 0) {
      await markNotificationsRead();
    }
  }

  async function openNotificationItem(button) {
    if (!button) return;
    const id = button.getAttribute("data-notification-id");
    const channel = button.getAttribute("data-notification-channel");
    const messageId = button.getAttribute("data-notification-message");
    const link = button.getAttribute("data-notification-link");
    if (id) await markNotificationsRead([id]);
    closeDialog($("#notificationDialog"));

    if (CHANNELS[channel]) {
      switchChannel(channel, { updateHash: true });
      if (messageId) {
        window.setTimeout(() => scrollToMessage(messageId), 480);
      }
      return;
    }
    if (link) {
      window.location.assign(notificationUrl({ link }));
    }
  }

  /* =========================================================
     GitHub stable release sync
     ========================================================= */

  async function fetchLatestGithubRelease() {
    const owner = (config.kernel && config.kernel.owner) || "PandeyJI-9";
    const repo = (config.kernel && config.kernel.repo) || "Extreme-PLUS-kernel-munch";
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=5`,
      {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store"
      }
    );
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
    const releases = await response.json();
    if (!Array.isArray(releases)) return null;
    return releases.find((release) => release && release.tag_name && !release.draft && !release.prerelease) || null;
  }

  async function syncLatestRelease(options = {}) {
    if (!state.session || !isStaff()) return;
    const now = Date.now();
    if (!options.force && now - state.lastReleaseSync < RELEASE_SYNC_MS) return;
    state.lastReleaseSync = now;

    try {
      const release = await fetchLatestGithubRelease();
      if (!release) return;
      state.latestGithubRelease = release;

      const result = await EC.rpc("community_announce_release", {
        p_tag: release.tag_name,
        p_name: release.name || release.tag_name,
        p_url: release.html_url || `${(config.links && config.links.kernelReleases) || "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases"}/tag/${encodeURIComponent(release.tag_name)}`,
        p_body: release.body || "",
        p_published_at: release.published_at || release.created_at || null
      }, { session: state.session });

      if (result && result.created) {
        EC.showToast(`Release announced to ${Number(result.notifications) || 0} members.`, 6000);
        if (state.channel === "releases") {
          await loadMessages({ silent: true, forceScroll: true });
          await loadPinnedMessage("releases", { silent: true });
        }
        loadNotifications({ silent: true });
        loadStats();
      }
    } catch (error) {
      // GitHub or API failures are non-fatal. The Postgres watcher retries.
      console.warn("EXTREME++: release sync skipped.", error);
    }
  }

  function prefillReleaseForm() {
    const release = state.latestGithubRelease;
    if (!release) return;
    const title = $("#releaseTitle");
    const tag = $("#releaseTag");
    const url = $("#releaseUrl");
    const notes = $("#releaseNotes");
    if (title && !title.value) title.value = release.name || release.tag_name || "";
    if (tag && !tag.value) tag.value = release.tag_name || "";
    if (url && !url.value) url.value = release.html_url || "";
    if (notes && !notes.value) notes.value = release.body || "";
  }

  async function openReleaseDialog() {
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (!isStaff()) {
      EC.showToast("Only staff can announce releases.", 4200);
      return;
    }
    const dialog = $("#releaseDialog");
    if (!dialog) return;
    clearFormStatus($("#releaseStatus"));
    prefillReleaseForm();
    showDialog(dialog, document.activeElement, "#releaseTitle");

    if (!state.latestGithubRelease) {
      try {
        const release = await fetchLatestGithubRelease();
        if (release) {
          state.latestGithubRelease = release;
          prefillReleaseForm();
        }
      } catch (error) {
        // The form still works manually.
      }
    }
  }

  async function submitRelease(event) {
    event.preventDefault();
    if (state.releaseBusy) return;
    if (!state.session) {
      openAuthDialog();
      return;
    }
    if (!isStaff()) {
      EC.showToast("Only staff can announce releases.", 4200);
      return;
    }

    const title = ($("#releaseTitle") && $("#releaseTitle").value || "").trim();
    const tag = ($("#releaseTag") && $("#releaseTag").value || "").trim();
    const url = ($("#releaseUrl") && $("#releaseUrl").value || "").trim();
    const notes = ($("#releaseNotes") && $("#releaseNotes").value || "").trim();
    const status = $("#releaseStatus");
    const submit = $("#releaseSubmit");

    if (!title || !tag || !url) {
      setFormStatus(status, "Add a title, tag and release URL.", "error");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setFormStatus(status, "The release URL must start with http:// or https://.", "error");
      return;
    }

    state.releaseBusy = true;
    EC.setBusy(submit, true, "Announcing…");
    try {
      const result = await EC.rpc("community_announce_release", {
        p_tag: tag,
        p_name: title,
        p_url: url,
        p_body: notes,
        p_published_at: null
      }, { session: state.session });

      if (result && result.created) {
        closeDialog($("#releaseDialog"));
        EC.showToast(`Release announced to ${Number(result.notifications) || 0} members.`, 5600);
        if (state.channel === "releases") {
          await loadMessages({ silent: true, forceScroll: true });
          await loadPinnedMessage("releases", { silent: true });
        }
        loadNotifications({ silent: true });
        loadStats();
      } else if (result && result.reason === "already_announced") {
        setFormStatus(status, "That release tag was already announced.", "info");
      } else {
        setFormStatus(status, "The release could not be announced.", "error");
      }
    } catch (error) {
      setFormStatus(status, error && error.status === 403
        ? "Only staff can announce releases."
        : "The release could not be announced.", "error");
    } finally {
      state.releaseBusy = false;
      EC.setBusy(submit, false);
    }
  }

  function membersOverlay() {
    return window.matchMedia("(max-width: 1240px)").matches;
  }

  function openMembers() {
    const panel = $("#membersPanel");
    const scrim = $("#membersScrim");
    if (!panel) return;
    closeMessageMenus();
    const overlay = membersOverlay();
    if (!panel.classList.contains("is-open")) {
      state.membersOpener = document.activeElement;
    }
    panel.classList.add("is-open");
    if (overlay) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
    }
    if (scrim) scrim.hidden = !overlay;
    $$("[data-members-toggle], #communityMembersToggle").forEach((button) => {
      button.setAttribute("aria-expanded", "true");
    });
    const close = $("[data-members-close]");
    if (close) {
      window.requestAnimationFrame(() => {
        try {
          close.focus({ preventScroll: true });
        } catch (error) {
          close.focus();
        }
      });
    }
  }

  function closeMembers(options = {}) {
    const panel = $("#membersPanel");
    const scrim = $("#membersScrim");
    if (!panel) return;
    const wasOpen = panel.classList.contains("is-open");
    const overlay = membersOverlay();
    panel.classList.remove("is-open");
    panel.removeAttribute("role");
    panel.removeAttribute("aria-modal");
    if (scrim) scrim.hidden = true;
    $$("[data-members-toggle], #communityMembersToggle").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });

    if (wasOpen && overlay && options.restoreFocus !== false) {
      const opener = state.membersOpener;
      if (opener && opener.isConnected && !opener.hidden) {
        window.setTimeout(() => {
          try {
            opener.focus({ preventScroll: true });
          } catch (error) {
            opener.focus();
          }
        }, 40);
      }
    }
    state.membersOpener = null;
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
    initDialogChrome($("#notificationDialog"), "#notificationDialogClose");
    initDialogChrome($("#releaseDialog"), "#releaseDialogClose");

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
    const releaseForm = $("#releaseForm");
    if (releaseForm) releaseForm.addEventListener("submit", submitRelease);

    const notificationsButton = $("#communityNotificationsBtn");
    if (notificationsButton) notificationsButton.addEventListener("click", openNotifications);
    const releaseButton = $("#releaseAnnounceBtn");
    if (releaseButton) releaseButton.addEventListener("click", openReleaseDialog);
    const enableButton = $("#notificationEnable");
    if (enableButton) enableButton.addEventListener("click", enableBrowserAlerts);
    const markReadButton = $("#notificationMarkRead");
    if (markReadButton) markReadButton.addEventListener("click", () => markNotificationsRead());

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
      button.addEventListener("click", () => closeMembers());
    });
    const scrim = $("#membersScrim");
    if (scrim) scrim.addEventListener("click", () => closeMembers());

    const overlayQuery = window.matchMedia("(max-width: 1240px)");
    if (overlayQuery.addEventListener) {
      overlayQuery.addEventListener("change", (event) => {
        if (!event.matches) closeMembers({ restoreFocus: false });
      });
    }

    document.addEventListener("keydown", (event) => {
      const panel = $("#membersPanel");
      if (!panel || event.key !== "Tab" || !overlayQuery.matches || !panel.classList.contains("is-open")) return;
      const focusable = $$("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])", panel)
        .filter((node) => node.getClientRects().length > 0 && !node.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });
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

      const notificationItem = event.target.closest("[data-notification-id]");
      if (notificationItem) {
        event.preventDefault();
        openNotificationItem(notificationItem);
        return;
      }

      const pinJump = event.target.closest("[data-pin-jump]");
      if (pinJump) {
        event.preventDefault();
        scrollToMessage(pinJump.getAttribute("data-pin-jump"));
        return;
      }

      const replyJump = event.target.closest("[data-reply-jump]");
      if (replyJump) {
        event.preventDefault();
        scrollToMessage(replyJump.getAttribute("data-reply-jump"));
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
        const hadDialog = $$("dialog[open]").length > 0;
        const hadMenu = Boolean(state.activeMenuId);
        const hadMembers = Boolean($("#membersPanel") && $("#membersPanel").classList.contains("is-open"));
        closeMessageMenus();
        closeMembers();
        $$("dialog[open]").forEach((dialog) => closeDialog(dialog));
        if (!hadDialog && !hadMenu && !hadMembers && state.replyTo) clearReplyTarget();
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
      loadNotifications({ silent: true });
      if (isStaff()) syncLatestRelease();
      if (state.channel === "bugs") {
        if (state.session) loadBugReports();
      } else {
        loadMessages({ silent: true });
        loadPinnedMessage(state.channel, { silent: true });
      }
    });

    window.addEventListener("online", () => {
      loadNotifications({ silent: true });
      if (state.channel === "bugs") {
        if (state.session) loadBugReports();
      } else {
        loadMessages({ silent: true });
        loadPinnedMessage(state.channel, { silent: true });
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
    window.clearInterval(state.timers.pinned);
    window.clearInterval(state.timers.notifications);
    window.clearInterval(state.timers.release);

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

    state.timers.pinned = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (state.channel !== "bugs") loadPinnedMessage(state.channel, { silent: true });
    }, PINNED_POLL_MS);

    state.timers.notifications = window.setInterval(() => {
      if (state.session) loadNotifications({ silent: true });
    }, NOTIFICATIONS_POLL_MS);

    state.timers.release = window.setInterval(() => {
      if (isStaff()) syncLatestRelease();
    }, RELEASE_SYNC_MS);
  }

  function init() {
    EC.initTheme();
    initChannelLinks();
    initComposer();
    initDialogs();
    initMembers();
    initJumpLatest();
    initMessageGestures();
    initDelegatedEvents();
    applyChannelUI(state.channel);
    updateAuthUI();
    updateNotificationPermissionUI();
    renderNotifications();
    registerServiceWorker();
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
