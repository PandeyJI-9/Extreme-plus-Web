/**
 * PROJECT EXTREME++ — site behaviour
 * Vanilla JS. No framework, no runtime dependencies.
 */
(() => {
  "use strict";

  const config = window.EXTREME_CONFIG || {};
  const kernel = config.kernel || {};
  const companion = config.companion || {};
  const reviewConfig = config.reviews || {};
  const communityConfig = config.community || {};
  const supabaseConfig = communityConfig.supabase || {};
  const links = config.links || {};
  const API_ROOT = "https://api.github.com";
  const CACHE_PREFIX = "extreme_plus_site_v2:";
  const CACHE_MINUTES = Number(config.cacheMinutes) || 15;
  const REQUEST_TIMEOUT = Number(config.requestTimeoutMs) || 9000;
  const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)");

  const THEME_KEY = "extreme_plus_theme";
  const AUTH_KEY = "extreme_plus_auth_v1";
  const OAUTH_STATE_KEY = "extreme_plus_oauth_state_v1";
  const OAUTH_STATE_TTL = 15 * 60 * 1000;
  const PENDING_ACTION_KEY = "extreme_plus_pending_action_v1";
  const DRAFT_PREFIX = "extreme_plus_draft_v1:";
  const VISITOR_KEY = "extreme_plus_visitor_id";
  const CHAT_POLL_FALLBACK = 8000;
  const STATS_POLL_MS = 60000;
  const HEARTBEAT_MS = 60000;
  const AVATAR_PLACEHOLDER = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8.2" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    releases: [],
    latestRelease: null,
    assets: [],
    rom: "HyperOS",
    root: "susfs",
    buildLabel: kernel.fallbackBuild || "Build #",
    githubLoading: false,
    githubLoaded: false,
    reviewsLoading: false,
    reviews: [],
    theme: "dark",
    communityMode: "github",
    supabaseReady: false,
    supabase: {
      url: "",
      anonKey: "",
      reviewsTable: "reviews",
      bugsTable: "bug_reports",
      chatTable: "chat_messages",
      chatPollMs: CHAT_POLL_FALLBACK,
      chatLimit: 50
    },
    auth: {
      session: null,
      user: null,
      profile: null,
      role: "",
      loading: false,
      pendingAction: "",
      refreshTimer: 0,
      heartbeatTimer: 0,
      opener: null
    },
    chat: {
      messages: [],
      loading: false,
      sending: false,
      initialized: false,
      visible: true,
      pollTimer: 0
    },
    reviewSubmitting: false,
    reviewRomTouched: false,
    reviewRootTouched: false,
    bugSubmitting: false,
    reportSubmitting: false,
    report: {
      targetType: "",
      targetId: "",
      targetLabel: ""
    },
    statsTimer: 0,
    closeMobileMenu: null,
    heroRedraw: null
  };

  const ROOT_LABELS = {
    susfs: "KowSU + SuSFS",
    ksu: "Clean KernelSU",
    noroot: "No Root"
  };

  const PROFILE_MODEL = {
    gaming: {
      frequency: "3.19",
      offset: 0,
      label: "GAMING",
      gold: "2.42",
      little: "Stock <small>range</small>",
      description: "Maximum clock headroom for locked-in gaming sessions. Built to hold the line when the scene gets heavy."
    },
    balanced: {
      frequency: "2.84",
      offset: 11,
      label: "BALANCED",
      gold: "2.25",
      little: "Stock <small>range</small>",
      description: "The daily driver sweet spot: quick response, lower heat and sensible power draw for everything in between."
    },
    battery: {
      frequency: "2.42",
      offset: 24,
      label: "BATTERY",
      gold: "1.96",
      little: "Stock <small>range</small>",
      description: "Lower frequency ceilings for long stints and heavy standby. Efficiency first, without ever locking a core down."
    }
  };

  const FALLBACK_CHANGELOG = [
    {
      buildLabel: "Build #133",
      date: "2026-11-15T10:53:59Z",
      name: "BMW Edition — Official Stable",
      url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases/tag/BMW-Edition-Build-133",
      highlights: [
        "Automated GitHub Releases with variant notes and the EKM APK attached",
        "EXTREME+ restored as the active boot governor after safety hardening",
        "ZSTD Level-3 workspace guard and governor panic-path cleanup",
        "README, EKM and BMW Edition integration refresh"
      ]
    },
    {
      buildLabel: "Build #132",
      date: "2026-11-12T14:50:50Z",
      name: "AOSP support arrives",
      url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/commits/main",
      highlights: [
        "EXTREME+ governor tuning for performance",
        "Extreme Kernel Manager kernel hooks",
        "Dual modded HyperOS + AOSP target support",
        "ZSTD workspace hardening and CI fixes"
      ]
    },
    {
      buildLabel: "Build #111",
      date: "2026-10-27T00:00:00Z",
      name: "BMW Edition foundation",
      url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/commits/main",
      highlights: [
        "Gold cores now drop cleanly to idle when the workload allows",
        "Prime-core deadlock removed from profile switching",
        "Hardware bypass charging completed at the PMIC level"
      ]
    },
    {
      buildLabel: "Build #82",
      date: "2026-10-07T00:00:00Z",
      name: "Charging, tri-variant and boot work",
      url: "https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/commits/main",
      highlights: [
        "Tri-variant performance architecture: Battery, Balanced, Gaming",
        "Universal PD/PPS fast-charge architecture and 67W handshake fixes",
        "Bootloader cmdline spoofing and AVB early-boot crash fix"
      ]
    }
  ];

  let toastTimer = 0;
  let reviewEmptyTemplate = null;

  /* =========================================================
     Small utilities
     ========================================================= */

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

  function setTextNode(target, value) {
    if (target) target.textContent = value;
  }

  function safeHttpUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function resizeAvatarUrl(value, size = 64) {
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

  function profileUrlFor(username) {
    const value = String(username || "").trim();
    return value ? `./profile.html?u=${encodeURIComponent(value)}` : "";
  }

  function getVisitorId() {
    let value = storageGet(VISITOR_KEY);
    if (!value || value.length < 16 || value.length > 64) {
      value = `v_${randomToken()}`;
      storageSet(VISITOR_KEY, value);
    }
    return value;
  }

  function randomToken() {
    const crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (crypto && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function formatDate(value, options) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", options || {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en", {
      notation: value >= 1000 ? "compact" : "standard",
      maximumFractionDigits: 1
    }).format(value);
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || bytes <= 0) return "Unknown size";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function getBuildLabel(release) {
    if (!release) return kernel.fallbackBuild || "Latest build";
    const haystack = `${release.name || ""} ${release.tag_name || ""}`;
    const match = haystack.match(/build[\s._-]*#?\s*(\d+)/i);
    if (match) return `Build #${match[1]}`;
    return release.tag_name || release.name || "Latest build";
  }

  function buildKey(value) {
    const match = String(value || "").match(/\d+/);
    return match ? match[0] : String(value || "").toLowerCase();
  }

  function truncate(value, maxLength = 520) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  }

  function cleanInlineMarkdown(value) {
    let text = String(value || "");
    text = text.replace(/!\[[^\]]*]\([^)]*\)/g, "");
    text = text.replace(/\[([^\]]+)]\([^)]*\)/g, "$1");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/[*_`~>#|]/g, "");
    text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "");
    return text.replace(/\s+/g, " ").trim();
  }

  function showToast(message, duration = 4000) {
    const toast = $("#toast");
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, duration);
  }

  function prefersReducedMotion() {
    return REDUCE_MOTION.matches;
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start"
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
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Storage can be disabled. The in-memory state still updates.
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
      window.sessionStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function sessionRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      // Ignore disabled session storage.
    }
  }

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    if (node.hidden) return false;
    return Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
  }

  function formatChatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return new Intl.DateTimeFormat("en-GB", sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    ).format(date);
  }

  function normaliseSupabaseBase(value) {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/rest\/v1$/i, "")
      .replace(/\/auth\/v1$/i, "");
  }

  function validateSupabaseBase(value) {
    try {
      const url = new URL(value);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return false;
      return Boolean(url.hostname);
    } catch (error) {
      return false;
    }
  }

  async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function initTheme() {
    const root = document.documentElement;
    const toggle = $("#themeToggle");
    const meta = $("#themeColorMeta");
    const system = window.matchMedia("(prefers-color-scheme: light)");

    const sync = (theme) => {
      const next = theme === "light" ? "light" : "dark";
      state.theme = next;
      root.setAttribute("data-theme", next);
      root.style.colorScheme = next;
      if (meta) meta.setAttribute("content", next === "light" ? "#f3f5fa" : "#06070b");
      if (toggle) {
        const light = next === "light";
        toggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
        toggle.setAttribute("aria-pressed", String(light));
        toggle.title = light ? "Switch to dark mode" : "Switch to light mode";
      }
      if (typeof state.heroRedraw === "function") {
        window.requestAnimationFrame(() => state.heroRedraw());
      }
    };

    sync(root.getAttribute("data-theme") === "light" ? "light" : "dark");

    if (toggle) {
      toggle.addEventListener("click", () => {
        const next = state.theme === "light" ? "dark" : "light";
        storageSet(THEME_KEY, next);
        sync(next);
      });
    }

    const onSystemChange = (event) => {
      if (storageGet(THEME_KEY)) return;
      sync(event.matches ? "light" : "dark");
    };

    if (typeof system.addEventListener === "function") {
      system.addEventListener("change", onSystemChange);
    } else if (typeof system.addListener === "function") {
      system.addListener(onSystemChange);
    }
  }

  /* =========================================================
     Header, menu and active navigation
     ========================================================= */

  function initHeader() {
    const header = $("#siteHeader");
    const progress = $("#scrollProgress");
    let ticking = false;

    const update = () => {
      ticking = false;
      const scrollTop = window.scrollY || window.pageYOffset;
      if (header) header.classList.toggle("is-scrolled", scrollTop > 18);
      if (progress) {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = scrollable > 0 ? Math.min(Math.max(scrollTop / scrollable, 0), 1) : 0;
        progress.style.transform = `scaleX(${ratio})`;
      }
    };

    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    update();
  }

  function initMobileMenu() {
    const toggle = $("#menuToggle");
    const menu = $("#mobileMenu");
    if (!toggle || !menu) return;

    const main = $("#main");
    const footer = $(".site-footer");
    const topline = $(".topline");
    let isOpen = false;

    const focusableInMenu = () => {
      if (!menu) return [toggle];
      return [toggle, ...$$("a[href], button:not([disabled])", menu)].filter((node) => {
        return node.offsetParent !== null;
      });
    };

    const setMenu = (open, restoreFocus = false) => {
      if (isOpen === open) return;
      isOpen = open;
      menu.classList.toggle("is-open", open);
      menu.toggleAttribute("inert", !open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.classList.toggle("menu-open", open);

      [main, footer, topline].forEach((node) => {
        if (!node) return;
        if (open) node.setAttribute("inert", "");
        else node.removeAttribute("inert");
      });

      if (open) {
        window.setTimeout(() => {
          const firstLink = menu.querySelector("a[href]");
          if (firstLink) firstLink.focus({ preventScroll: true });
        }, 80);
      } else if (restoreFocus) {
        toggle.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener("click", () => setMenu(!isOpen));
    state.closeMobileMenu = () => setMenu(false, false);

    menu.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (link) {
        setMenu(false, true);
        return;
      }
      if (event.target.closest("[data-auth-trigger]")) {
        setMenu(false, false);
        return;
      }
      if (event.target === menu) setMenu(false, true);
    });

    document.addEventListener("keydown", (event) => {
      if (!isOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false, true);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableInMenu();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !menu.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1100) setMenu(false);
    }, { passive: true });
  }

  function initActiveNavigation() {
    const navLinks = $$(".desktop-nav a");
    if (!navLinks.length || !("IntersectionObserver" in window)) return;

    const sections = [
      "top",
      "silicon",
      "compatibility",
      "downloads",
      "install",
      "changelog",
      "community",
      "reviews"
    ].map((id) => document.getElementById(id)).filter(Boolean);

    const visible = new Map();
    let frame = 0;

    const updateCurrent = () => {
      frame = 0;
      let current = "";
      let best = 0;
      visible.forEach((ratio, id) => {
        if (ratio > best) {
          best = ratio;
          current = id;
        }
      });

      navLinks.forEach((link) => {
        const isCurrent = current !== "top" && link.getAttribute("href") === `#${current}`;
        link.classList.toggle("is-current", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio || 0.01 : 0);
      });
      if (!frame) frame = window.requestAnimationFrame(updateCurrent);
    }, {
      rootMargin: "-34% 0px -54% 0px",
      threshold: [0, 0.01, 0.15, 0.3, 0.5]
    });

    sections.forEach((section) => observer.observe(section));
  }

  /* =========================================================
     Scroll reveals and pointer lighting
     ========================================================= */

  function initReveals() {
    const elements = $$(".reveal");
    if (!elements.length) return;

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      elements.forEach((element) => {
        element.classList.add("is-visible", "is-settled");
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        window.setTimeout(() => entry.target.classList.add("is-settled"), 1500);
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -7% 0px",
      threshold: 0.08
    });

    elements.forEach((element) => observer.observe(element));
  }

  function initCardSpotlight() {
    if (!FINE_POINTER.matches || prefersReducedMotion()) return;

    let pendingCard = null;
    let x = 0;
    let y = 0;
    let frame = 0;

    const paint = () => {
      frame = 0;
      if (!pendingCard) return;
      pendingCard.style.setProperty("--mx", `${x}px`);
      pendingCard.style.setProperty("--my", `${y}px`);
    };

    document.addEventListener("pointermove", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const card = event.target.closest(".card-spotlight");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      pendingCard = card;
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (!frame) frame = window.requestAnimationFrame(paint);
    }, { passive: true });
  }

  function initTilt() {
    const card = $(".telemetry");
    if (!card || !FINE_POINTER.matches || prefersReducedMotion()) return;

    let frame = 0;
    let targetX = 0;
    let targetY = 0;

    const apply = () => {
      frame = 0;
      card.style.transform = `perspective(1100px) rotateX(${targetY.toFixed(2)}deg) rotateY(${targetX.toFixed(2)}deg) translateY(-2px)`;
    };

    card.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      card.style.transition = "transform 140ms ease-out";
    });

    card.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      targetX = px * 5.5;
      targetY = py * -4.5;
      if (!frame) frame = window.requestAnimationFrame(apply);
    }, { passive: true });

    card.addEventListener("pointerleave", () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      card.style.transition = "transform 600ms cubic-bezier(0.16, 1, 0.3, 1)";
      card.style.transform = "";
    });
  }

  function initMagnetic() {
    const buttons = $$(".magnetic");
    if (!buttons.length || !FINE_POINTER.matches || prefersReducedMotion()) return;

    buttons.forEach((button) => {
      let frame = 0;
      let offsetX = 0;
      let offsetY = 0;

      const apply = () => {
        frame = 0;
        button.style.translate = `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px`;
      };

      const reset = () => {
        window.cancelAnimationFrame(frame);
        frame = 0;
        offsetX = 0;
        offsetY = 0;
        button.classList.remove("is-tracking");
        button.style.translate = "";
      };

      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        button.classList.add("is-tracking");
      });

      button.addEventListener("pointermove", (event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        const rect = button.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        offsetX = Math.max(-5, Math.min(5, ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 12));
        offsetY = Math.max(-4, Math.min(4, ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 10));
        if (!frame) frame = window.requestAnimationFrame(apply);
      }, { passive: true });

      button.addEventListener("pointerleave", reset);
      button.addEventListener("pointercancel", reset);
      button.addEventListener("blur", reset);
    });
  }

  /* =========================================================
     Hero profile explorer
     ========================================================= */

  function initProfileExplorer() {
    const buttons = $$(".profile-tab[data-profile]");
    const gauge = $("#gaugeArc");
    const gaugeSvg = $(".gauge");
    if (!buttons.length) return;

    const update = (key) => {
      const model = PROFILE_MODEL[key];
      if (!model) return;

      buttons.forEach((button) => {
        const active = button.dataset.profile === key;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });

      setTextNode($("#profileFrequency"), model.frequency);
      setTextNode($("#profileName"), model.label);
      setTextNode($("#profileGold"), "");
      const gold = $("#profileGold");
      if (gold) gold.innerHTML = `${model.gold} <small>GHz</small>`;
      const little = $("#profileLittle");
      if (little) little.innerHTML = model.little;
      setTextNode($("#profileDescription"), model.description);

      if (gauge) gauge.style.strokeDashoffset = String(model.offset);
      if (gaugeSvg) {
        gaugeSvg.setAttribute(
          "aria-label",
          `Prime core frequency: ${model.frequency} gigahertz in ${model.label.toLowerCase()} profile`
        );
      }
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => update(button.dataset.profile));
    });

    buttons[0].parentElement.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const currentIndex = buttons.findIndex((button) => button.classList.contains("is-active"));
      let nextIndex = currentIndex;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = buttons.length - 1;
      buttons[nextIndex].focus();
      update(buttons[nextIndex].dataset.profile);
    });
  }

  /* =========================================================
     Ambient canvas
     ========================================================= */

  function initHeroCanvas() {
    const canvas = $("#heroCanvas");
    const hero = canvas ? canvas.closest(".hero") : null;
    if (!canvas || !hero) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const colors = ["120, 160, 255", "60, 220, 255", "176, 108, 255", "255, 70, 110"];
    let width = 0;
    let height = 0;
    let nodes = [];
    let pointer = null;
    let rafId = 0;
    let running = false;
    let visible = true;
    let lastTime = 0;
    let resizeTimer = 0;

    const buildNodes = () => {
      const desired = Math.round(Math.min(56, Math.max(18, width / 30)));
      nodes = Array.from({ length: desired }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        radius: Math.random() * 1.4 + 0.7,
        color: colors[Math.floor(Math.random() * colors.length)]
      }));
    };

    const resize = () => {
      const rect = hero.getBoundingClientRect();
      width = Math.max(0, rect.width);
      height = Math.max(0, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.7);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
      if (prefersReducedMotion()) draw();
    };

    const draw = () => {
      if (!width || !height) return;
      context.clearRect(0, 0, width, height);

      const maxDistance = width < 700 ? 98 : 142;
      const activePointer = pointer && FINE_POINTER.matches ? pointer : null;

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
          const other = nodes[otherIndex];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distance = Math.hypot(dx, dy);
          if (distance > maxDistance) continue;
          const alpha = (1 - distance / maxDistance) * 0.14;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(other.x, other.y);
          context.strokeStyle = `rgba(100, 140, 255, ${alpha})`;
          context.lineWidth = 0.65;
          context.stroke();
        }

        if (activePointer) {
          const dx = node.x - activePointer.x;
          const dy = node.y - activePointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 155) {
            context.beginPath();
            context.moveTo(node.x, node.y);
            context.lineTo(activePointer.x, activePointer.y);
            context.strokeStyle = `rgba(120, 190, 255, ${(1 - distance / 155) * 0.22})`;
            context.lineWidth = 0.8;
            context.stroke();
          }
        }

        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${node.color}, 0.58)`;
        context.fill();
      }

      if (activePointer) {
        context.beginPath();
        context.arc(activePointer.x, activePointer.y, 1.8, 0, Math.PI * 2);
        context.fillStyle = "rgba(180, 215, 255, 0.6)";
        context.fill();
      }
    };

    const step = (time) => {
      if (!running) return;
      const delta = Math.min(time - lastTime || 16, 34);
      lastTime = time;

      nodes.forEach((node) => {
        node.x += node.vx * (delta / 16);
        node.y += node.vy * (delta / 16);
        if (node.x < -10) node.x = width + 10;
        if (node.x > width + 10) node.x = -10;
        if (node.y < -10) node.y = height + 10;
        if (node.y > height + 10) node.y = -10;
      });

      draw();
      rafId = window.requestAnimationFrame(step);
    };

    const start = () => {
      if (running || prefersReducedMotion()) {
        draw();
        return;
      }
      running = true;
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(step);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(rafId);
    };

    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    };

    hero.addEventListener("pointermove", (event) => {
      if (!FINE_POINTER.matches) return;
      const rect = hero.getBoundingClientRect();
      pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      if (prefersReducedMotion()) draw();
    }, { passive: true });

    hero.addEventListener("pointerleave", () => {
      pointer = null;
      if (prefersReducedMotion()) draw();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (visible) start();
    });

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleResize);
      observer.observe(hero);
    } else {
      window.addEventListener("resize", scheduleResize, { passive: true });
    }

    if ("IntersectionObserver" in window) {
      const sectionObserver = new IntersectionObserver((entries) => {
        visible = entries[0] ? entries[0].isIntersecting : true;
        if (visible && !document.hidden) start();
        else stop();
      }, { rootMargin: "120px 0px" });
      sectionObserver.observe(hero);
    }

    state.heroRedraw = draw;
    resize();
    if (!prefersReducedMotion()) start();
    else draw();
  }

  /* =========================================================
     Installation tabs and copy controls
     ========================================================= */

  function initInstallTabs() {
    const tabs = $$(".install-tab[data-install-tab]");
    if (!tabs.length) return;

    const activate = (tab, focus = false) => {
      const target = tab.dataset.installTab;
      tabs.forEach((button) => {
        const isActive = button === tab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.tabIndex = isActive ? 0 : -1;
      });

      $$(".install-pane").forEach((pane) => {
        const isTarget = pane.id === (target === "recovery" ? "installRecovery" : "installFlasher");
        pane.hidden = !isTarget;
        pane.classList.toggle("is-active", isTarget);
      });

      if (focus) tab.focus();
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (event) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        let next = index;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        activate(tabs[next], true);
      });
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // fall through to the textarea fallback
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    } catch (error) {
      return false;
    }
  }

  function initCopyButtons() {
    $$(".copy-button[data-copy-target]").forEach((button) => {
      const originalLabel = button.querySelector("span")?.textContent || "Copy";
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copyTarget);
        if (!target) return;
        const copied = await copyText(target.innerText || target.textContent || "");
        const label = button.querySelector("span");
        if (!label) return;
        button.classList.toggle("is-copied", copied);
        label.textContent = copied ? "Copied" : "Failed";
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          label.textContent = originalLabel;
        }, 2200);
        if (!copied) showToast("Clipboard access was blocked. Select the commands manually.");
      });
    });
  }

  /* =========================================================
     GitHub API: cached, resilient, no build step required
     ========================================================= */

  function apiUrl(path) {
    return `${API_ROOT}${path}`;
  }

  function cacheGet(key) {
    try {
      const raw = window.localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.timestamp !== "number" || !("data" in parsed)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
        timestamp: Date.now(),
        data
      }));
    } catch (error) {
      // Storage can be full or disabled. The live request still works.
    }
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json"
        }
      });

      if (!response.ok) {
        let message = `GitHub API returned ${response.status}`;
        if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
          message = "GitHub API rate limit reached";
        } else if (response.status === 404) {
          message = "GitHub repository not found";
        }
        throw new Error(message);
      }

      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchCached(url, key, force = false) {
    const cached = cacheGet(key);
    const fresh = cached && (Date.now() - cached.timestamp) < CACHE_MINUTES * 60 * 1000;

    if (fresh && !force) {
      return { data: cached.data, timestamp: cached.timestamp, source: "cache" };
    }

    try {
      const data = await fetchJson(url);
      cacheSet(key, data);
      return { data, timestamp: Date.now(), source: "network" };
    } catch (error) {
      if (cached) {
        return {
          data: cached.data,
          timestamp: cached.timestamp,
          source: "stale-cache",
          error
        };
      }
      throw error;
    }
  }

  function setLivePill(status, label, title) {
    const pill = $("#githubLivePill");
    if (!pill) return;
    const copy = pill.querySelector("span");
    pill.classList.toggle("is-live", status === "live");
    pill.classList.toggle("is-error", status === "error");
    if (status === "loading") {
      pill.classList.remove("is-live", "is-error");
    }
    if (copy) copy.textContent = label;
    pill.title = title || label;
  }

  function collectDownloads(release) {
    if (!release || !Array.isArray(release.assets)) return 0;
    return release.assets.reduce((total, asset) => {
      return total + (typeof asset.download_count === "number" ? asset.download_count : 0);
    }, 0);
  }

  function renderReleaseSummary(release) {
    if (!release) return;
    state.buildLabel = getBuildLabel(release);
    setText("[data-latest-build]", state.buildLabel);

    const name = release.name || release.tag_name || "Latest EXTREME++ release";
    setText("[data-latest-name]", name);

    const date = release.published_at || release.created_at;
    setText("[data-latest-date]", date ? `Released ${formatDate(date)}` : "Release date unavailable");

    const assetCount = Array.isArray(release.assets) ? release.assets.length : 0;
    setText("[data-release-assets-count]", `${assetCount} ${assetCount === 1 ? "asset" : "assets"}`);
    setText("[data-download-total]", formatNumber(collectDownloads(release)));

    ["#reviewBuild", "#bugBuild"].forEach((selector) => {
      const buildInput = $(selector);
      if (!buildInput) return;
      buildInput.placeholder = state.buildLabel;
      if (buildInput.value === "Latest stable") {
        buildInput.value = state.buildLabel;
      }
    });
  }

  function renderRepoStats(repository) {
    if (!repository) return;
    const stars = typeof repository.stargazers_count === "number" ? repository.stargazers_count : null;
    const forks = typeof repository.forks_count === "number" ? repository.forks_count : null;

    if (stars !== null) {
      $$("[data-stars]").forEach((node) => {
        node.textContent = formatNumber(stars);
        node.title = `${stars} GitHub stars`;
      });
    }

    if (forks !== null) {
      $$("[data-forks]").forEach((node) => {
        node.textContent = formatNumber(forks);
        node.title = `${forks} forks`;
      });
    }
  }

  function releaseHighlights(body, limit = 4) {
    if (!body) return [];

    const sections = [];
    let current = { title: "", lines: [] };
    const lines = String(body).split(/\r?\n/);

    lines.forEach((line) => {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (heading) {
        if (current.title || current.lines.some((item) => item.trim())) {
          sections.push(current);
        }
        current = { title: cleanInlineMarkdown(heading[1]), lines: [] };
        return;
      }
      current.lines.push(line);
    });

    if (current.title || current.lines.some((item) => item.trim())) sections.push(current);

    const score = (title) => {
      if (!title) return 0;
      if (/(feature|highlight|what.?s new|silicon|optimization|optimi|performance|change)/i.test(title)) return 3;
      if (/(fix|improvement|technical)/i.test(title)) return 2;
      return 1;
    };

    const ranked = [...sections].sort((a, b) => score(b.title) - score(a.title));
    const highlights = [];
    const skipPattern = /(\.zip|\.apk|\.img|\.dtb|download|flashing|flash the|install guide|telegram|maintainer|release status|build number|dual target|complete suite)/i;

    for (const section of ranked) {
      for (const line of section.lines) {
        const bullet = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)/);
        if (!bullet) continue;
        let text = cleanInlineMarkdown(bullet[1]);
        if (!text || text.length < 16 || text.length > 260) continue;
        if (skipPattern.test(text)) continue;
        if (highlights.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
        if (text.length > 220) text = `${text.slice(0, 219).trimEnd()}…`;
        highlights.push(text);
        if (highlights.length >= limit) return highlights;
      }
    }

    return highlights;
  }

  function mergeChangelog(releases) {
    const entries = new Map();

    FALLBACK_CHANGELOG.forEach((entry) => {
      entries.set(buildKey(entry.buildLabel), { ...entry });
    });

    releases.forEach((release) => {
      if (!release || release.draft || release.prerelease) return;
      const buildLabel = getBuildLabel(release);
      const date = release.published_at || release.created_at;
      const highlights = releaseHighlights(release.body, 4);
      entries.set(buildKey(buildLabel), {
        buildLabel,
        date,
        name: release.name || release.tag_name || buildLabel,
        url: release.html_url,
        highlights: highlights.length ? highlights : [
          "Full release details, assets and checksums are available on GitHub."
        ]
      });
    });

    return Array.from(entries.values())
      .filter((entry) => entry.date && !Number.isNaN(new Date(entry.date).getTime()))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 4);
  }

  function renderChangelog(releases) {
    const container = $("#changelogList");
    if (!container || !Array.isArray(releases)) return;

    const entries = mergeChangelog(releases);
    if (!entries.length) return;

    const fragment = document.createDocumentFragment();

    entries.forEach((entry, index) => {
      const article = create("article", "timeline-item");

      const dot = create("span", "timeline-dot");
      dot.setAttribute("aria-hidden", "true");
      article.appendChild(dot);

      const head = create("div", "timeline-head");
      const headGroup = document.createElement("div");
      const tag = create("span", "timeline-tag", index === 0 ? "LATEST STABLE" : "");
      const version = create("span", "timeline-version", entry.buildLabel);
      headGroup.append(tag, version);

      const time = document.createElement("time");
      time.dateTime = entry.date;
      time.textContent = formatDate(entry.date);

      head.append(headGroup, time);
      article.appendChild(head);
      article.appendChild(create("h3", "", entry.name));

      const list = document.createElement("ul");
      (entry.highlights || []).forEach((highlight) => {
        list.appendChild(create("li", "", highlight));
      });
      article.appendChild(list);

      const releaseUrl = safeHttpUrl(entry.url);
      if (releaseUrl) {
        const link = create("a", "", "Release notes ");
        const external = create("span", "", "↗");
        external.setAttribute("aria-hidden", "true");
        link.appendChild(external);
        link.href = releaseUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        article.appendChild(link);
      }

      fragment.appendChild(article);
    });

    container.replaceChildren(fragment);
  }

  function findReleaseAsset() {
    if (!Array.isArray(state.assets) || !state.assets.length) return null;

    const zips = state.assets.filter((asset) => /\.zip$/i.test(asset.name || ""));
    if (!zips.length) return null;

    const romToken = state.rom === "AOSP" ? "aosp" : "hyperos";
    const candidates = zips.filter((asset) => asset.name.toLowerCase().includes(romToken));
    // Never fall back to the other ROM family: flashing an AOSP package over
    // HyperOS (or the reverse) is not a safe substitution.
    if (!candidates.length) return null;

    const rootMatcher = (asset) => {
      const name = asset.name || "";
      if (state.root === "noroot") return /no.?root/i.test(name);
      if (state.root === "susfs") return /susfs/i.test(name) && !/no.?susfs/i.test(name);
      const manager = /(kernelsu|ksu|kow.?su|resuki)/i.test(name);
      const hasSuSFS = /susfs/i.test(name) && !/no.?susfs/i.test(name);
      return manager && !hasSuSFS && !/no.?root/i.test(name);
    };

    return candidates.find(rootMatcher) || null;
  }

  function animateDownloadPanel(panel) {
    if (!panel || prefersReducedMotion() || typeof panel.animate !== "function") return;
    panel.animate(
      [
        { opacity: 0.35, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" }
      ],
      { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
    );
  }

  function downloadError(title, message, options = {}) {
    const panel = $("#smartDownload");
    if (!panel) return;

    panel.setAttribute("aria-busy", "false");
    panel.classList.remove("is-ready");

    const error = create("div", "match-error");
    error.appendChild(create("span", "", options.eyebrow || "LIVE RELEASE FEED"));
    error.appendChild(create("h4", "", title));
    error.appendChild(create("p", "", message));

    const actions = create("div", "match-error-actions");
    const releasesLink = create("a", "text-link", "Open GitHub releases ");
    const arrow = create("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    releasesLink.appendChild(arrow);
    releasesLink.href = links.kernelReleases || `https://github.com/${kernel.owner}/${kernel.repo}/releases`;
    releasesLink.target = "_blank";
    releasesLink.rel = "noopener noreferrer";
    actions.appendChild(releasesLink);

    if (options.retry) {
      const retry = create("button", "text-link text-link--button", "Retry ");
      const retryArrow = create("span", "", "→");
      retryArrow.setAttribute("aria-hidden", "true");
      retry.appendChild(retryArrow);
      retry.type = "button";
      retry.addEventListener("click", () => hydrateGitHub(true));
      actions.appendChild(retry);
    }

    error.appendChild(actions);
    panel.replaceChildren(error);
    animateDownloadPanel(panel);
  }

  function renderMatchedAsset(asset) {
    const panel = $("#smartDownload");
    if (!panel) return;

    panel.setAttribute("aria-busy", "false");
    panel.classList.add("is-ready");

    if (!asset) {
      downloadError(
        "No exact match in this release.",
        "This build may not include that ROM and root combination yet. Try another ROM or root option above, open GitHub releases to inspect every attached file, or ask in the Telegram group.",
        { eyebrow: "NO PACKAGE MATCH" }
      );
      return;
    }

    const result = create("div", "match-result");
    const top = create("div", "match-result-top");
    top.appendChild(create("span", "match-file-icon", "ZIP"));

    const copy = create("div", "match-file-copy");
    copy.appendChild(create("span", "match-file-label", "MATCHED PACKAGE"));
    const fileName = create("strong", "match-file-name", asset.name || "EXTREME++ kernel ZIP");
    fileName.title = asset.name || "";
    copy.appendChild(fileName);
    top.appendChild(copy);
    top.appendChild(create("span", "match-ready", "READY"));
    result.appendChild(top);

    const meta = create("div", "match-meta");
    meta.appendChild(create("span", "", formatBytes(asset.size)));
    meta.appendChild(create("span", "", state.rom === "AOSP" ? "AOSP" : "Modded HyperOS"));
    meta.appendChild(create("span", "", ROOT_LABELS[state.root]));
    if (typeof asset.download_count === "number") {
      meta.appendChild(create("span", "", `${formatNumber(asset.download_count)} downloads`));
    }
    result.appendChild(meta);

    const actions = create("div", "match-actions");
    const download = create("a", "button button--primary", "Download ZIP");
    download.href = safeHttpUrl(asset.browser_download_url) || links.kernelReleases;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.setAttribute("aria-label", `Download ${asset.name || "kernel ZIP"}`);
    actions.appendChild(download);

    if (state.latestRelease) {
      const notes = create("a", "text-link", "Build notes ");
      const noteArrow = create("span", "", "↗");
      noteArrow.setAttribute("aria-hidden", "true");
      notes.appendChild(noteArrow);
      notes.href = safeHttpUrl(state.latestRelease.html_url) || links.kernelReleases;
      notes.target = "_blank";
      notes.rel = "noopener noreferrer";
      actions.appendChild(notes);
    }

    result.appendChild(actions);
    panel.replaceChildren(result);
    animateDownloadPanel(panel);
  }

  function updateDownloadPicker() {
    $$('.segmented-control[data-group="rom"] button').forEach((button) => {
      const active = button.dataset.value === state.rom;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    $$('.root-options[data-group="root"] button').forEach((button) => {
      const active = button.dataset.value === state.root;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateCompanionDownload() {
    const link = $("#ekmDownload");
    if (!link) return;
    const apk = Array.isArray(state.assets)
      ? state.assets.find((asset) => /ekm.*\.apk$/i.test(asset.name || ""))
      : null;

    if (apk) {
      const url = safeHttpUrl(apk.browser_download_url);
      if (url) {
        link.href = url;
        link.title = `${apk.name} (${formatBytes(apk.size)})`;
      }
    } else if (companion.fallbackDownload) {
      link.href = companion.fallbackDownload;
    }
  }

  async function hydrateGitHub(force = false) {
    if (state.githubLoading) return;
    if (!kernel.owner || !kernel.repo) {
      setLivePill("error", "Not configured", "Set kernel.owner and kernel.repo in config.js");
      downloadError("Repository not configured.", "Add your GitHub owner and repository to assets/js/config.js.", {
        eyebrow: "CONFIG MISSING"
      });
      return;
    }

    state.githubLoading = true;
    setLivePill("loading", "Connecting", "Connecting to the public GitHub API");

    const releasesUrl = apiUrl(`/repos/${kernel.owner}/${kernel.repo}/releases?per_page=${Number(kernel.releasesPerPage) || 5}`);
    const repoUrl = apiUrl(`/repos/${kernel.owner}/${kernel.repo}`);

    const [releasesResult, repoResult] = await Promise.allSettled([
      fetchCached(releasesUrl, `${kernel.owner}/${kernel.repo}:releases`, force),
      fetchCached(repoUrl, `${kernel.owner}/${kernel.repo}:repository`, force)
    ]);

    if (repoResult.status === "fulfilled") {
      renderRepoStats(repoResult.value.data);
    }

    if (releasesResult.status === "fulfilled") {
      const releases = Array.isArray(releasesResult.value.data) ? releasesResult.value.data : [];
      state.releases = releases;
      state.latestRelease = releases.find((release) => !release.draft && !release.prerelease) || null;

      if (state.latestRelease) {
        state.assets = Array.isArray(state.latestRelease.assets) ? state.latestRelease.assets : [];
        state.githubLoaded = true;
        renderReleaseSummary(state.latestRelease);
        renderMatchedAsset(findReleaseAsset());
        updateCompanionDownload();
        renderChangelog(releases);

        const fromCache = releasesResult.value.source !== "network";
        setLivePill(
          "live",
          fromCache ? "Cached" : "GitHub live",
          fromCache
            ? "Showing recently cached GitHub release data"
            : "Release data loaded from the public GitHub API"
        );
      } else {
        downloadError(
          "No public stable release found.",
          "The repository is reachable, but there is no stable published release to download yet.",
          { eyebrow: "WAITING FOR A STABLE BUILD", retry: true }
        );
        setLivePill("error", "No stable release", "No stable published GitHub release was found");
      }
    } else {
      state.githubLoaded = false;
      const reason = releasesResult.reason && releasesResult.reason.message
        ? releasesResult.reason.message
        : "The public GitHub API did not answer.";
      downloadError(
        "Live release data is unavailable.",
        `${reason}. Open GitHub releases for the latest files, or retry in a moment.`,
        { eyebrow: "GITHUB CONNECTION", retry: true }
      );
      setLivePill("error", "Offline", reason);
    }

    if (repoResult.status === "rejected") {
      console.warn("EXTREME++: repository stats could not be loaded.", repoResult.reason);
    }

    state.githubLoading = false;
  }

  function initDownloads() {
    updateDownloadPicker();

    $$('.segmented-control[data-group="rom"] button').forEach((button) => {
      button.addEventListener("click", () => {
        state.rom = button.dataset.value;
        updateDownloadPicker();
        if (state.githubLoaded) renderMatchedAsset(findReleaseAsset());
      });
    });

    $$('.root-options[data-group="root"] button').forEach((button) => {
      button.addEventListener("click", () => {
        state.root = button.dataset.value;
        updateDownloadPicker();
        if (state.githubLoaded) renderMatchedAsset(findReleaseAsset());
      });
    });

    $$("[data-pick-rom]").forEach((button) => {
      button.addEventListener("click", () => {
        const rom = button.dataset.pickRom;
        state.rom = rom === "AOSP" ? "AOSP" : "HyperOS";
        updateDownloadPicker();
        if (state.githubLoaded) renderMatchedAsset(findReleaseAsset());
        showToast(`${state.rom === "AOSP" ? "AOSP / custom ROM" : "Modded HyperOS"} selected in the download matcher.`);
        scrollToSection("downloads");
      });
    });
  }

  /* =========================================================
     Review wall and submission flow
     ========================================================= */

  function markdownSection(body, aliases) {
    if (!body) return "";
    const lines = String(body).split(/\r?\n/);
    const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
    let capturing = false;
    const output = [];

    for (const line of lines) {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (heading) {
        if (capturing) break;
        const title = heading[1].toLowerCase().replace(/[^\w\s/]/g, " ").replace(/\s+/g, " ").trim();
        if (normalizedAliases.some((alias) => title === alias || title.startsWith(alias))) {
          capturing = true;
        }
        continue;
      }

      if (capturing) output.push(line);
    }

    return output.join("\n").trim();
  }

  function parseRating(value) {
    const match = String(value || "").match(/([1-5])\s*(?:\/\s*5|out of 5)?/i);
    return match ? Number(match[1]) : null;
  }

  function issueToReview(issue) {
    if (!issue || issue.pull_request) return null;
    const prefix = reviewConfig.titlePrefix || "[Review]";
    const title = String(issue.title || "").trim();
    if (!title.toLowerCase().startsWith(prefix.toLowerCase())) return null;

    const body = issue.body || "";
    let displayName = title.slice(prefix.length).trim();
    displayName = displayName.replace(/\s*[-–—]\s*\d\s*\/\s*5\s*$/, "").trim();
    if (!displayName) displayName = issue.user?.login || "Rider";

    const rating = parseRating(markdownSection(body, ["rating", "your rating"]));
    let text = markdownSection(body, ["review", "your experience", "experience", "feedback"]);
    if (!text) {
      text = cleanInlineMarkdown(body.replace(/^#{1,6}\s+.+$/gm, "").replace(/###.*$/gm, ""));
    }

    let build = markdownSection(body, ["build tested", "build you tested", "build"]);
    if (!build) {
      const buildMatch = body.match(/build[\s._-]*#?\s*\d+/i);
      build = buildMatch ? buildMatch[0] : "";
    }

    const rom = markdownSection(body, ["rom", "rom / os", "operating system"]);
    const root = markdownSection(body, ["root flavor", "root variant", "root"]);
    const username = issue.user?.login || "";
    const avatar = safeHttpUrl(issue.user?.avatar_url || (username ? `https://github.com/${username}.png?size=96` : ""));

    return {
      id: "",
      user_id: "",
      name: truncate(displayName, 42),
      username,
      author_username: "",
      profileUrl: "",
      avatar: resizeAvatarUrl(avatar),
      rating,
      review: text,
      rom: truncate(cleanInlineMarkdown(rom), 42),
      root: truncate(cleanInlineMarkdown(root), 42),
      build: truncate(cleanInlineMarkdown(build), 42),
      date: issue.created_at || "",
      url: safeHttpUrl(issue.html_url),
      source: "github"
    };
  }

  function normaliseCuratedReview(review) {
    if (!review || typeof review !== "object" || !review.review) return null;
    const username = String(review.username || "").replace(/^@/, "");
    return {
      id: "",
      user_id: "",
      name: truncate(review.name || username || "Rider", 42),
      username,
      author_username: "",
      profileUrl: "",
      avatar: resizeAvatarUrl(review.avatar || (username ? `https://github.com/${username}.png?size=96` : "")),
      rating: Number.isInteger(Number(review.rating)) ? Math.min(5, Math.max(1, Number(review.rating))) : null,
      review: String(review.review),
      rom: truncate(review.rom || "", 42),
      root: truncate(review.root || "", 42),
      build: truncate(review.build || "", 42),
      date: review.date || "",
      url: safeHttpUrl(review.url),
      source: "github"
    };
  }

  function makeAvatar(review) {
    const avatarUrl = safeHttpUrl(resizeAvatarUrl(review.avatar || ""));
    if (avatarUrl) {
      const image = create("img", "review-avatar");
      image.src = avatarUrl;
      image.alt = "";
      image.width = 30;
      image.height = 30;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.replaceWith(create(
          "span",
          "review-avatar review-avatar--initials",
          initialsFor(review.name)
        ));
      }, { once: true });
      return image;
    }

    const initials = String(review.name || "Rider")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "EX";

    const fallback = create("span", "review-avatar review-avatar--initials", initials);
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }

  function createReviewCard(review) {
    const article = create("article", "review-card");

    const top = create("div", "review-card-top");
    const stars = create("div", "review-stars");
    stars.setAttribute("role", "img");
    if (review.rating) {
      stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
      for (let index = 1; index <= 5; index += 1) {
        const star = create("span", index <= review.rating ? "" : "is-empty", "★");
        star.setAttribute("aria-hidden", "true");
        stars.appendChild(star);
      }
    } else {
      stars.setAttribute("aria-label", "No rating provided");
      const unrated = create("span", "is-empty", "UNRATED");
      unrated.style.color = "var(--faint)";
      unrated.style.fontFamily = "var(--font-mono)";
      unrated.style.fontSize = "0.45rem";
      unrated.style.letterSpacing = "0.08em";
      stars.appendChild(unrated);
    }

    top.appendChild(stars);

    const sourceUrl = safeHttpUrl(review.url || "");
    if (sourceUrl) {
      const source = create("a", "review-source", "GitHub ");
      const arrow = create("span", "", "↗");
      arrow.setAttribute("aria-hidden", "true");
      source.appendChild(arrow);
      source.href = sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.setAttribute("aria-label", "Open source review on GitHub");
      top.appendChild(source);
    } else if (review.source === "community") {
      const source = create("span", "review-source", "Community");
      source.setAttribute("aria-label", "Published on this site");
      top.appendChild(source);
    }

    article.appendChild(top);
    const reviewText = review.url ? truncate(review.review, 560) : String(review.review || "");
    article.appendChild(create("blockquote", "", reviewText));

    const footer = create("footer", "review-card-footer");
    footer.appendChild(makeAvatar(review));

    const user = create("div", "review-user");
    if (review.profileUrl) {
      const author = create("a", "review-author-link", review.name);
      author.href = review.profileUrl;
      user.appendChild(author);
    } else {
      user.appendChild(create("strong", "", review.name));
    }
    const metaParts = [];
    const account = review.author_username || review.username;
    if (account) metaParts.push(`@${account}`);
    if (review.rom) metaParts.push(review.rom);
    if (review.root) metaParts.push(review.root);
    const meta = create("span", "", metaParts.join(" · ") || "Verified community review");
    if (meta.textContent) meta.title = meta.textContent;
    user.appendChild(meta);
    footer.appendChild(user);

    if (review.build) footer.appendChild(create("span", "review-build", review.build));

    article.appendChild(footer);

    if (
      review.source === "community"
      && review.id
      && (!state.auth.user || review.user_id !== state.auth.user.id)
    ) {
      const actions = create("div", "review-card-actions");
      actions.appendChild(createReportButton("review", review.id, `review by ${review.name}`));
      article.appendChild(actions);
    }

    return article;
  }

  function captureReviewEmptyState() {
    const initial = $("#reviewsEmpty");
    if (initial) reviewEmptyTemplate = initial.cloneNode(true);
  }

  function renderEmptyReviews() {
    const grid = $("#reviewGrid");
    if (!grid) return;

    if (reviewEmptyTemplate) {
      grid.replaceChildren(reviewEmptyTemplate.cloneNode(true));
      return;
    }

    const panel = create("div", "review-empty");
    const copy = create("div", "review-empty-copy");
    copy.appendChild(create("span", "", "THE WALL IS OPEN"));
    copy.appendChild(create("h3", "", "Your experience could be the first build report."));
    copy.appendChild(create("p", "", "Flash the latest build, live with it for a few days, then leave an honest review. Sign in with Google or GitHub to publish it."));

    const action = create("button", "text-link text-link--button", "Leave the first review ");
    const arrow = create("span", "", "→");
    arrow.setAttribute("aria-hidden", "true");
    action.appendChild(arrow);
    action.type = "button";
    action.id = "writeReviewEmptyBtn";
    action.setAttribute("data-open-review", "");
    copy.appendChild(action);
    panel.appendChild(copy);
    grid.replaceChildren(panel);
  }

  function renderReviewError() {
    const grid = $("#reviewGrid");
    if (!grid) return;
    setText("[data-review-count]", "—");

    const panel = create("div", "review-empty");
    const copy = create("div", "review-empty-copy");
    copy.appendChild(create("span", "", "LIVE FEED OFFLINE"));
    copy.appendChild(create("h3", "", "The review feed is taking a pit stop."));
    copy.appendChild(create(
      "p",
      "",
      state.communityMode === "supabase"
        ? "The review feed did not answer this request. On-site reviews and GitHub issues are still open, or you can retry the feed."
        : "GitHub did not answer this request. Your reviews are safe — open the issue feed directly, or try loading them again."
    ));

    const actions = create("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.alignItems = "center";
    actions.style.gap = "1rem";
    actions.style.marginTop = "1.1rem";

    const retry = create("button", "text-link text-link--button", "Retry feed ");
    const retryArrow = create("span", "", "→");
    retryArrow.setAttribute("aria-hidden", "true");
    retry.appendChild(retryArrow);
    retry.type = "button";
    retry.addEventListener("click", () => hydrateReviews(true));
    actions.appendChild(retry);

    const direct = create("a", "text-link", "Open GitHub issues ");
    const directArrow = create("span", "", "↗");
    directArrow.setAttribute("aria-hidden", "true");
    direct.appendChild(directArrow);
    direct.href = links.kernelIssues || `https://github.com/${kernel.owner}/${kernel.repo}/issues`;
    direct.target = "_blank";
    direct.rel = "noopener noreferrer";
    actions.appendChild(direct);

    copy.appendChild(actions);
    panel.appendChild(copy);
    grid.replaceChildren(panel);
  }

  function renderReviews(reviews) {
    const grid = $("#reviewGrid");
    if (!grid) return;

    setText("[data-review-count]", formatNumber(reviews.length));
    setText('[data-stat="reviews"]', formatNumber(reviews.length));

    if (!reviews.length) {
      renderEmptyReviews();
      return;
    }

    const fragment = document.createDocumentFragment();
    reviews.slice(0, 9).forEach((review) => fragment.appendChild(createReviewCard(review)));
    grid.replaceChildren(fragment);
  }

  function mergeReviews(curated, remote) {
    const merged = [];
    const seen = new Set();

    [...curated, ...remote].forEach((review) => {
      if (!review) return;
      const contentKey = `${review.name}|${String(review.review || "").slice(0, 80)}`;
      const key = review.url || contentKey;
      if (seen.has(key) || seen.has(contentKey)) return;
      seen.add(key);
      seen.add(contentKey);
      merged.push(review);
    });

    return merged.sort((a, b) => {
      const timeA = new Date(a.date || 0).getTime() || 0;
      const timeB = new Date(b.date || 0).getTime() || 0;
      return timeB - timeA;
    });
  }

  function normaliseSupabaseReview(row) {
    if (!row || typeof row !== "object") return null;
    const body = String(row.body || "").trim();
    if (!body) return null;
    const username = String(row.author_username || "").trim();
    return {
      id: String(row.id || ""),
      user_id: String(row.user_id || ""),
      name: truncate(String(row.author_name || username || "Rider"), 42),
      username: "",
      author_username: username,
      profileUrl: profileUrlFor(username),
      avatar: safeHttpUrl(resizeAvatarUrl(row.author_avatar || "")),
      rating: Number.isInteger(Number(row.rating)) ? Math.min(5, Math.max(1, Number(row.rating))) : null,
      review: body,
      rom: truncate(row.rom || "", 42),
      root: truncate(row.root_flavor || "", 42),
      build: truncate(row.build || "", 42),
      date: row.created_at || "",
      url: "",
      source: "community"
    };
  }

  async function fetchSupabaseReviews() {
    const query = new URLSearchParams({
      select: "id,user_id,created_at,author_name,author_avatar,author_username,provider,rating,body,rom,root_flavor,build",
      order: "created_at.desc",
      limit: "60"
    });
    const rows = await supabaseRequest(supabaseTable(state.supabase.reviewsTable, query.toString()));
    return (Array.isArray(rows) ? rows : [])
      .map(normaliseSupabaseReview)
      .filter(Boolean);
  }

  async function fetchGitHubIssueReviews(force = false) {
    if (!reviewConfig.owner || !reviewConfig.repo) return [];
    const issuesUrl = apiUrl(
      `/repos/${reviewConfig.owner}/${reviewConfig.repo}/issues?state=all&sort=created&direction=desc&per_page=${Number(reviewConfig.issuesPerPage) || 50}`
    );
    const cacheKey = `${reviewConfig.owner}/${reviewConfig.repo}:reviews:${Number(reviewConfig.issuesPerPage) || 50}`;
    const response = await fetchCached(issuesUrl, cacheKey, force);
    const issues = Array.isArray(response.data) ? response.data : [];
    return issues
      .map(issueToReview)
      .filter((review) => review && review.review && review.review.trim());
  }

  async function hydrateReviews(force = false) {
    if (state.reviewsLoading) return false;

    const curated = Array.isArray(window.EXTREME_REVIEWS)
      ? window.EXTREME_REVIEWS.map(normaliseCuratedReview).filter(Boolean)
      : [];
    const previousReviews = Array.isArray(state.reviews) ? state.reviews.slice() : [];

    state.reviewsLoading = true;
    try {
      if (state.communityMode === "supabase") {
        // Merge the on-site wall with the existing GitHub review issues so
        // nothing posted before the migration disappears.
        const [supabaseResult, githubResult] = await Promise.allSettled([
          fetchSupabaseReviews(),
          fetchGitHubIssueReviews(force)
        ]);

        if (supabaseResult.status === "rejected") {
          console.warn("EXTREME++: could not load Supabase reviews.", supabaseResult.reason);
        }
        if (githubResult.status === "rejected") {
          console.warn("EXTREME++: could not load GitHub review issues.", githubResult.reason);
        }

        const remote = [];
        if (supabaseResult.status === "fulfilled") remote.push(...supabaseResult.value);
        if (githubResult.status === "fulfilled") remote.push(...githubResult.value);

        if (!remote.length && !curated.length
          && (supabaseResult.status === "rejected" || githubResult.status === "rejected")) {
          if (previousReviews.length) {
            state.reviews = previousReviews;
            renderReviews(previousReviews);
          } else {
            renderReviewError();
          }
          return false;
        }

        const reviews = mergeReviews(curated, remote);
        state.reviews = reviews;
        renderReviews(reviews);
        return true;
      }

      let remote = [];
      try {
        remote = await fetchGitHubIssueReviews(force);
      } catch (error) {
        console.warn("EXTREME++: could not load the review wall.", error);
        if (!curated.length) {
          if (previousReviews.length) {
            state.reviews = previousReviews;
            renderReviews(previousReviews);
          } else {
            renderReviewError();
          }
          return false;
        }
      }
      const reviews = mergeReviews(curated, remote);
      state.reviews = reviews;
      renderReviews(reviews);
      return true;
    } finally {
      state.reviewsLoading = false;
    }
  }

  async function refreshReviewWall(button) {
    if (!button || state.reviewsLoading) return;
    const label = button.querySelector("[data-refresh-label]");
    const original = label ? label.textContent : "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (label) label.textContent = "Refreshing…";
    let ok = false;
    try {
      ok = await hydrateReviews(true);
    } catch (error) {
      console.warn("EXTREME++: review wall refresh failed.", error);
    } finally {
      if (label) label.textContent = original;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    showToast(ok ? "Review wall refreshed." : "The wall could not refresh. Try again in a moment.", ok ? 3200 : 5200);
  }

  /* =========================================================
     Community, Supabase auth and dialogs
     ========================================================= */

  function showFormStatus(target, message, tone = "info") {
    if (!target) return;
    target.textContent = message || "";
    target.className = "form-status" + (tone ? ` is-${tone}` : "");
    target.hidden = !message;
  }

  function clearFormStatus(target) {
    if (!target) return;
    target.textContent = "";
    target.className = "form-status";
    target.hidden = true;
  }

  function setButtonBusy(button, busy, label) {
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

  function syncDialogLock() {
    const open = $$("dialog[open]").length > 0;
    document.body.classList.toggle("dialog-open", open);
  }

  function firstDialogFocus(dialog, selector) {
    if (!dialog) return null;
    if (selector) {
      const preferred = $$(selector, dialog).find(isVisible);
      if (preferred) return preferred;
    }
    return $$("button, [href], input:not([type=\"hidden\"]), select, textarea", dialog)
      .find((node) => isVisible(node) && !node.disabled && node.tabIndex !== -1);
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
    syncDialogLock();
    dialog.scrollTop = 0;
    window.setTimeout(() => {
      const target = firstDialogFocus(dialog, focusSelector);
      if (target) target.focus({ preventScroll: true });
    }, 70);
  }

  function hideDialog(dialog) {
    if (!dialog) return;
    const opener = dialog._opener;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    syncDialogLock();
    if (opener && isVisible(opener) && typeof opener.focus === "function") {
      opener.focus({ preventScroll: true });
    }
  }

  function initDialogChrome(dialog, closeSelector) {
    if (!dialog) return;
    const closeButton = closeSelector ? $(closeSelector) : null;
    if (closeButton) closeButton.addEventListener("click", () => hideDialog(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) hideDialog(dialog);
    });
    dialog.addEventListener("close", () => {
      syncDialogLock();
      const opener = dialog._opener;
      if (opener && isVisible(opener) && typeof opener.focus === "function") {
        window.setTimeout(() => {
          if (!dialog.open) opener.focus({ preventScroll: true });
        }, 0);
      }
    });
    dialog.addEventListener("cancel", () => window.setTimeout(syncDialogLock, 0));
  }

  function normaliseSupabaseConfig() {
    const base = normaliseSupabaseBase(supabaseConfig.url);
    const key = String(supabaseConfig.anonKey || "").trim();
    const ready = validateSupabaseBase(base) && key.length > 10;
    const requested = String(communityConfig.mode || "auto").toLowerCase();
    let mode = "github";

    if (requested === "github") mode = "github";
    else if (ready) mode = "supabase";
    else if (requested === "supabase") {
      console.warn("EXTREME++: community.mode is \"supabase\" but the Supabase URL or anon key is missing. Falling back to GitHub.");
    }

    state.supabase = {
      url: base,
      anonKey: key,
      reviewsTable: String(supabaseConfig.reviewsTable || "reviews"),
      bugsTable: String(supabaseConfig.bugsTable || "bug_reports"),
      chatTable: String(supabaseConfig.chatTable || "chat_messages"),
      chatPollMs: Math.max(4000, Number(supabaseConfig.chatPollMs) || CHAT_POLL_FALLBACK),
      chatLimit: Math.min(100, Math.max(1, Number(supabaseConfig.chatLimit) || 50))
    };
    state.communityMode = mode;
    state.supabaseReady = mode === "supabase" && ready;
    document.documentElement.setAttribute("data-community", mode);
  }

  function supabaseHeaders(authenticated) {
    const headers = {
      apikey: state.supabase.anonKey,
      Accept: "application/json"
    };
    if (authenticated) {
      const token = state.auth.session && state.auth.session.access_token;
      if (!token) {
        const error = new Error("Sign in required.");
        error.status = 401;
        throw error;
      }
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function supabaseRequest(path, options = {}) {
    if (!state.supabaseReady) {
      const error = new Error("The community backend is not configured.");
      error.status = 503;
      throw error;
    }
    const headers = {
      ...supabaseHeaders(Boolean(options.auth)),
      ...(options.headers || {})
    };
    let body;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetchWithTimeout(`${state.supabase.url}${path}`, {
      method: options.method || "GET",
      headers,
      body,
      cache: "no-store"
    });
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

  function supabaseTable(name, query) {
    return `/rest/v1/${encodeURIComponent(name)}${query ? `?${query}` : ""}`;
  }

  function isRateLimitError(error) {
    if (!error) return false;
    const data = error.data && typeof error.data === "object" ? error.data : {};
    const code = data.code || data.error_code || "";
    return error.status === 429
      || code === "PT429"
      || /rate limit/i.test(String(error.message || ""));
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

  function loadStoredSession() {
    const raw = storageGet(AUTH_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.access_token) return null;
      return normaliseSession(parsed);
    } catch (error) {
      return null;
    }
  }

  function saveStoredSession(session) {
    if (!session) return;
    storageSet(AUTH_KEY, JSON.stringify(session));
  }

  function clearAuthSession() {
    window.clearTimeout(state.auth.refreshTimer);
    state.auth.refreshTimer = 0;
    stopCommunityHeartbeat();
    state.auth.session = null;
    state.auth.user = null;
    state.auth.profile = null;
    state.auth.role = "";
    storageRemove(AUTH_KEY);
    updateCommunityLinks();
    syncDialogLock();
  }

  function authProviderOf(user) {
    if (state.auth.profile && state.auth.profile.provider) return String(state.auth.profile.provider);
    if (!user) return "";
    if (user.app_metadata && user.app_metadata.provider) return String(user.app_metadata.provider);
    if (Array.isArray(user.identities) && user.identities[0] && user.identities[0].provider) {
      return String(user.identities[0].provider);
    }
    return "";
  }

  function authNameOf(user) {
    if (state.auth.profile && state.auth.profile.display_name) {
      return truncate(String(state.auth.profile.display_name).trim(), 42) || "Rider";
    }
    if (!user) return "";
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || meta.user_name || meta.preferred_username
      || (user.email ? String(user.email).split("@")[0] : "");
    return truncate(String(name || "Rider").trim(), 42) || "Rider";
  }

  function authAvatarOf(user) {
    if (state.auth.profile && state.auth.profile.avatar_url) {
      return safeHttpUrl(resizeAvatarUrl(state.auth.profile.avatar_url));
    }
    if (!user) return "";
    const meta = user.user_metadata || {};
    return safeHttpUrl(resizeAvatarUrl(meta.avatar_url || meta.picture || user.avatar_url || ""));
  }

  function providerLabel(provider) {
    if (provider === "google") return "Google";
    if (provider === "github") return "GitHub";
    return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "";
  }

  function initialsFor(name) {
    return String(name || "EX")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "EX";
  }

  function renderAuthAvatar(target, user) {
    if (!target) return;
    target.replaceChildren();
    if (!user) {
      target.innerHTML = AVATAR_PLACEHOLDER;
      return;
    }
    const avatar = authAvatarOf(user);
    if (avatar) {
      const image = document.createElement("img");
      image.src = avatar;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        target.textContent = initialsFor(authNameOf(user));
      }, { once: true });
      target.appendChild(image);
      return;
    }
    target.textContent = initialsFor(authNameOf(user));
  }

  function updateComposerLabels() {
    const signedIn = Boolean(state.auth.session);
    const reviewLabel = $("[data-review-submit-label]");
    const bugLabel = $("[data-bug-submit-label]");

    if (state.communityMode === "supabase") {
      if (reviewLabel) reviewLabel.textContent = signedIn ? "Publish review" : "Sign in to publish";
      if (bugLabel) bugLabel.textContent = signedIn ? "Send private report" : "Sign in to report";
    } else {
      if (reviewLabel) reviewLabel.textContent = "Continue on GitHub";
      if (bugLabel) bugLabel.textContent = "Continue on GitHub";
    }
  }

  function updateCommunityLinks() {
    const signedIn = Boolean(state.auth.session);
    const profile = state.auth.profile;
    const role = String(state.auth.role || "").toLowerCase();
    const profileLink = $("[data-auth-profile]");
    const adminLink = $("[data-auth-admin]");

    if (profileLink) {
      const username = profile && profile.username ? String(profile.username) : "";
      profileLink.hidden = !signedIn || !username;
      if (username) profileLink.href = profileUrlFor(username);
    }

    if (adminLink) {
      adminLink.hidden = !signedIn || !(role === "owner" || role === "admin");
    }
  }

  function updateAuthUI() {
    const signedIn = Boolean(state.auth.session);
    const user = state.auth.user;
    const name = signedIn ? authNameOf(user) : "Not signed in";
    const provider = signedIn ? authProviderOf(user) : "";

    $$("[data-auth-signed-out]").forEach((node) => {
      node.hidden = signedIn;
    });
    $$("[data-auth-signed-in]").forEach((node) => {
      node.hidden = !signedIn;
    });

    // Community auth is unavailable in GitHub fallback mode, so keep every
    // auth trigger hidden even when it is part of a signed-out panel.
    $$("[data-auth-trigger]").forEach((trigger) => {
      trigger.hidden = state.communityMode !== "supabase";
      trigger.classList.toggle("is-signed-in", signedIn);
      trigger.setAttribute(
        "aria-label",
        signedIn ? `Account: ${name}. Open community account.` : "Sign in to the community"
      );
    });

    $$("[data-auth-label]").forEach((node) => {
      const inMobileMenu = Boolean(node.closest(".mobile-auth"));
      node.textContent = signedIn ? name : (inMobileMenu ? "Sign in to the community" : "Sign in");
    });

    $$("[data-auth-name]").forEach((node) => {
      node.textContent = signedIn ? name : "Not signed in";
    });
    $$("[data-auth-hint]").forEach((node) => {
      if (signedIn) {
        const username = state.auth.profile && state.auth.profile.username
          ? `@${state.auth.profile.username}`
          : name;
        const role = state.auth.role && state.auth.role !== "member"
          ? ` · ${state.auth.role}`
          : "";
        node.textContent = `Signed in as ${username}${role}. Your public profile appears with your post.`;
      } else if (node.closest("#bugDialog")) {
        node.textContent = "Sign in with Google or GitHub to send a report.";
      } else {
        node.textContent = "Sign in with Google or GitHub to publish.";
      }
    });
    $$("[data-auth-email]").forEach((node) => {
      node.textContent = signedIn && user && user.email ? String(user.email) : "";
    });
    $$("[data-auth-provider-label]").forEach((node) => {
      node.textContent = providerLabel(provider);
    });
    $$("[data-auth-avatar]").forEach((node) => renderAuthAvatar(node, signedIn ? user : null));

    const nameField = $("[data-review-name-field]");
    const nameInput = $("#reviewName");
    if (nameInput) {
      const githubMode = state.communityMode !== "supabase";
      nameInput.required = githubMode;
      nameInput.disabled = !githubMode;
      if (nameField) nameField.hidden = !githubMode;
    }

    const unconfigured = $("[data-community-unconfigured]");
    if (unconfigured) unconfigured.hidden = state.supabaseReady;
    const providers = $(".auth-providers");
    if (providers) providers.hidden = !state.supabaseReady || signedIn;

    const authStatus = $("#authStatus");
    if (authStatus && state.communityMode !== "supabase" && !authStatus.textContent) {
      showFormStatus(authStatus, "On-site sign-in is not configured. Use GitHub or Telegram for now.", "info");
    }

    updateComposerLabels();
    updateCommunityLinks();

    // Report ownership and signed-in highlighting depend on the current user.
    if (state.chat.initialized) renderChatMessages(state.chat.messages, false);
    if (state.reviews.length) renderReviews(state.reviews);
  }

  function scheduleAuthRefresh() {
    window.clearTimeout(state.auth.refreshTimer);
    state.auth.refreshTimer = 0;
    if (!state.auth.session) return;
    const expires = Number(state.auth.session.expires_at) || 0;
    const delay = Math.max(30000, expires - Date.now() - 120000);
    state.auth.refreshTimer = window.setTimeout(() => {
      refreshAuthSession().catch((error) => {
        console.warn("EXTREME++: session refresh failed.", error);
        if (error.status === 400 || error.status === 401) {
          clearAuthSession();
          updateAuthUI();
          showToast("Your community session expired. Sign in again to continue.", 5600);
        }
      });
    }, delay);
  }

  async function fetchAuthUser() {
    const user = await supabaseRequest("/auth/v1/user", { auth: true });
    if (user && user.id) state.auth.user = user;
    return user;
  }

  async function refreshAuthSession() {
    const session = state.auth.session;
    if (!session || !session.refresh_token) {
      const error = new Error("No refresh token available.");
      error.status = 401;
      throw error;
    }
    const payload = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token }
    });
    const next = normaliseSession(payload);
    if (!next) {
      const error = new Error("The community backend returned an invalid session.");
      error.status = 401;
      throw error;
    }
    state.auth.session = next;
    if (payload.user) state.auth.user = payload.user;
    saveStoredSession(next);
    scheduleAuthRefresh();
    if (!state.auth.user) await fetchAuthUser();
    updateAuthUI();
    return next;
  }

  async function restoreAuthSession() {
    if (!state.auth.session) return;
    try {
      if (!state.auth.session.access_token || Date.now() >= state.auth.session.expires_at - 60000) {
        await refreshAuthSession();
      } else {
        await fetchAuthUser();
      }
      scheduleAuthRefresh();
    } catch (error) {
      if (error.status === 401 && state.auth.session && state.auth.session.refresh_token) {
        try {
          await refreshAuthSession();
          return;
        } catch (refreshError) {
          console.warn("EXTREME++: saved session could not be refreshed.", refreshError);
        }
      }
      clearAuthSession();
    }
    updateAuthUI();
  }

  async function syncCommunityIdentity() {
    if (!state.supabaseReady || !state.auth.session) {
      state.auth.profile = null;
      state.auth.role = "";
      updateAuthUI();
      return;
    }

    try {
      const profile = await supabaseRequest("/rest/v1/rpc/community_ensure_profile", {
        method: "POST",
        auth: true,
        body: {}
      });
      state.auth.profile = profile && typeof profile === "object" ? profile : null;

      const role = await supabaseRequest("/rest/v1/rpc/community_my_role", {
        method: "POST",
        auth: true,
        body: {}
      });
      state.auth.role = typeof role === "string" ? role : "";
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
        return;
      }
      console.warn("EXTREME++: community profile could not be loaded.", error);
    }

    updateAuthUI();

    if (state.auth.session) {
      await trackCommunityLogin();
      startCommunityHeartbeat();
      loadPublicStats();
    }
  }

  async function trackCommunityLogin() {
    if (!state.supabaseReady || !state.auth.session) return;
    try {
      await supabaseRequest("/rest/v1/rpc/community_track_login", {
        method: "POST",
        auth: true,
        body: { p_provider: authProviderOf(state.auth.user) }
      });
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
      }
    }
  }

  async function heartbeat() {
    if (!state.supabaseReady || !state.auth.session || document.hidden) return;
    try {
      await supabaseRequest("/rest/v1/rpc/community_heartbeat", {
        method: "POST",
        auth: true,
        body: {}
      });
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
      }
    }
  }

  function startCommunityHeartbeat() {
    stopCommunityHeartbeat();
    if (!state.auth.session) return;
    heartbeat();
    state.auth.heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_MS);
  }

  function stopCommunityHeartbeat() {
    window.clearInterval(state.auth.heartbeatTimer);
    state.auth.heartbeatTimer = 0;
  }

  async function trackSiteVisit() {
    if (!state.supabaseReady) return;
    try {
      await supabaseRequest("/rest/v1/rpc/community_track_visit", {
        method: "POST",
        body: {
          p_visitor_id: getVisitorId(),
          p_path: window.location.pathname || "/"
        }
      });
    } catch (error) {
      // Analytics must never block the page.
    }
  }

  function renderPublicStats(stats) {
    if (!stats || typeof stats !== "object") return;
    ["members", "online", "visits", "logins", "reviews", "chat"].forEach((key) => {
      setText(`[data-stat="${key}"]`, formatNumber(stats[key] || 0));
    });
  }

  async function loadPublicStats() {
    if (!state.supabaseReady) return;
    try {
      const stats = await supabaseRequest("/rest/v1/rpc/community_public_stats", {
        method: "POST",
        body: {}
      });
      renderPublicStats(stats);
    } catch (error) {
      // Keep the last known values; public analytics are non-essential.
    }
  }

  function startStatsPolling() {
    window.clearInterval(state.statsTimer);
    if (!state.supabaseReady) return;
    state.statsTimer = window.setInterval(() => {
      if (!document.hidden) loadPublicStats();
    }, STATS_POLL_MS);
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

  function readPendingAction() {
    const raw = sessionGet(PENDING_ACTION_KEY);
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.action || Date.now() - Number(parsed.ts || 0) > 15 * 60 * 1000) {
        sessionRemove(PENDING_ACTION_KEY);
        return "";
      }
      sessionRemove(PENDING_ACTION_KEY);
      return String(parsed.action);
    } catch (error) {
      sessionRemove(PENDING_ACTION_KEY);
      return "";
    }
  }

  function writePendingAction(action) {
    if (!action) {
      sessionRemove(PENDING_ACTION_KEY);
      return;
    }
    sessionSet(PENDING_ACTION_KEY, JSON.stringify({ action, ts: Date.now() }));
  }

  function handleAuthCallback() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
    const error = hash.get("error_description") || hash.get("error")
      || url.searchParams.get("error_description") || url.searchParams.get("error");
    if (error) {
      cleanAuthUrl();
      sessionRemove(OAUTH_STATE_KEY);
      clearPendingAction();
      const message = error === "access_denied"
        ? "Sign-in was cancelled."
        : String(error).replace(/\+/g, " ");
      showToast(message, 6500);
      return "error";
    }

    const access = hash.get("access_token");
    if (!access) {
      if (url.searchParams.get("code")) {
        cleanAuthUrl();
        showToast("This sign-in tab needs to be reopened from the community section.", 6500);
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
    const stateAge = storedState ? Date.now() - Number(storedState.ts) : Infinity;
    const stateValid = Boolean(
      storedState
      && storedState.value
      && Number.isFinite(stateAge)
      && stateAge >= 0
      && stateAge <= OAUTH_STATE_TTL
      && (!returnedState || storedState.value === returnedState)
    );
    if (!stateValid) {
      cleanAuthUrl();
      sessionRemove(OAUTH_STATE_KEY);
      clearPendingAction();
      showToast("Sign-in could not be verified. Please open sign-in again.", 6500);
      return "error";
    }
    sessionRemove(OAUTH_STATE_KEY);

    const session = normaliseSession({
      access_token: access,
      refresh_token: hash.get("refresh_token") || "",
      expires_in: hash.get("expires_in"),
      expires_at: hash.get("expires_at"),
      token_type: hash.get("token_type")
    });
    if (!session) {
      cleanAuthUrl();
      showToast("The sign-in response was incomplete. Please try again.", 6000);
      return "error";
    }

    state.auth.session = session;
    state.auth.pendingAction = readPendingAction();
    saveStoredSession(session);
    cleanAuthUrl();
    return "signed-in";
  }

  async function initAuth() {
    if (state.communityMode !== "supabase") {
      updateAuthUI();
      return;
    }

    const callback = handleAuthCallback();
    const stored = loadStoredSession();
    if (stored) state.auth.session = stored;

    if (state.auth.session) {
      await restoreAuthSession();
      await syncCommunityIdentity();
    }

    updateAuthUI();

    if (callback === "signed-in" && state.auth.session) {
      if (!state.auth.user) {
        try {
          await fetchAuthUser();
          scheduleAuthRefresh();
          await syncCommunityIdentity();
        } catch (error) {
          console.warn("EXTREME++: signed in, but the profile could not be loaded.", error);
        }
      }
      updateAuthUI();
      if (state.auth.user) {
        showToast(`Signed in as ${authNameOf(state.auth.user)}.`, 5000);
        window.setTimeout(completePendingAction, 260);
      }
    }
  }

  function beginOAuth(provider, action) {
    if (!state.supabaseReady) {
      showToast("On-site sign-in is not configured yet. Use GitHub issues or Telegram.", 6000);
      return;
    }
    if (!provider) return;
    if (action) {
      state.auth.pendingAction = action;
      writePendingAction(action);
    } else {
      sessionRemove(PENDING_ACTION_KEY);
    }

    const value = randomToken();
    sessionSet(OAUTH_STATE_KEY, JSON.stringify({ value, ts: Date.now() }));

    const redirect = new URL(".", window.location.href).href;
    const params = new URLSearchParams({
      provider,
      redirect_to: redirect,
      state: value
    });
    const authorizeUrl = `${state.supabase.url}/auth/v1/authorize?${params.toString()}`;
    persistDraftsNow();
    showFormStatus($("#authStatus"), `Redirecting to ${providerLabel(provider)}…`, "info");
    window.location.assign(authorizeUrl);
  }

  function focusChatInput() {
    const input = $("#chatInput");
    if (input && isVisible(input)) {
      input.focus({ preventScroll: true });
    }
  }

  function completePendingAction() {
    const action = state.auth.pendingAction;
    state.auth.pendingAction = "";
    sessionRemove(PENDING_ACTION_KEY);
    if (!action) return;

    if (action === "review") {
      const dialog = $("#reviewDialog");
      if (dialog && dialog.open) {
        const textarea = $("#reviewText");
        if (textarea) textarea.focus({ preventScroll: true });
      } else {
        openReviewDialog();
      }
      return;
    }

    if (action === "bug") {
      const dialog = $("#bugDialog");
      if (dialog && dialog.open) {
        const title = $("#bugTitle");
        if (title) title.focus({ preventScroll: true });
      } else {
        openBugDialog();
      }
      return;
    }

    if (action === "chat") {
      scrollToSection("community");
      window.setTimeout(focusChatInput, 420);
    }
  }

  function clearPendingAction() {
    state.auth.pendingAction = "";
    sessionRemove(PENDING_ACTION_KEY);
  }

  function openAuthDialog(options = {}) {
    const dialog = $("#authDialog");
    if (!dialog) return;
    if (state.communityMode !== "supabase") {
      showDialog(dialog, options.opener, "[data-community-unconfigured] a");
      return;
    }
    state.auth.opener = options.opener || document.activeElement;
    state.auth.pendingAction = options.action || "";
    updateAuthUI();
    clearFormStatus($("#authStatus"));
    const signedIn = Boolean(state.auth.session);
    showDialog(
      dialog,
      options.opener,
      signedIn ? "[data-auth-continue]" : "[data-auth-provider]"
    );
  }

  function initAuthDialog() {
    const dialog = $("#authDialog");
    if (!dialog) return;
    initDialogChrome(dialog, "#authDialogClose");

    $$("[data-auth-provider]", dialog).forEach((button) => {
      button.addEventListener("click", () => {
        beginOAuth(button.dataset.authProvider, state.auth.pendingAction);
      });
    });

    const continueButton = $("[data-auth-continue]", dialog);
    if (continueButton) {
      continueButton.addEventListener("click", () => {
        hideDialog(dialog);
        completePendingAction();
      });
    }

    const signOutButton = $("#authSignOut", dialog);
    if (signOutButton) {
      signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        try {
          await signOut();
        } finally {
          signOutButton.disabled = false;
        }
      });
    }
  }

  async function signOut() {
    const session = state.auth.session;
    try {
      if (session && session.access_token) {
        await supabaseRequest("/auth/v1/logout", { method: "POST", auth: true });
      }
    } catch (error) {
      console.warn("EXTREME++: remote sign-out failed; clearing locally.", error);
    }
    clearAuthSession();
    clearPendingAction();
    updateAuthUI();
    hideDialog($("#authDialog"));
    showToast("Signed out of the community.", 4200);
  }

  function setReviewRating(value) {
    const ratingInput = $("#reviewRating");
    const starGroup = $("#starInput");
    if (!ratingInput || !starGroup) return;
    const rating = Math.min(5, Math.max(1, Number(value) || 5));
    ratingInput.value = String(rating);
    $$(".rating-star", starGroup).forEach((star) => {
      const starValue = Number(star.dataset.value);
      star.classList.toggle("is-active", starValue <= rating);
      star.setAttribute("aria-pressed", String(starValue === rating));
    });
  }

  function syncReviewFormSelection() {
    const romSelect = $("#reviewRom");
    const rootSelect = $("#reviewRoot");
    if (romSelect && !state.reviewRomTouched) {
      romSelect.value = state.rom === "AOSP" ? "AOSP / Custom ROM" : "Modded HyperOS";
    }
    if (rootSelect && !state.reviewRootTouched) {
      rootSelect.value = ROOT_LABELS[state.root] || "KowSU + SuSFS";
    }
  }

  function openReviewDialog(trigger) {
    const dialog = $("#reviewDialog");
    if (!dialog) return;
    updateAuthUI();
    syncReviewFormSelection();
    setReviewRating(Number($("#reviewRating") && $("#reviewRating").value) || 5);
    clearFormStatus($("#reviewStatus"));
    const focus = state.communityMode === "supabase" && !state.auth.session
      ? "[data-auth-trigger]"
      : (state.communityMode === "supabase" ? "#reviewText" : "#reviewName");
    showDialog(dialog, trigger, focus);
  }

  function validateReviewForm() {
    const form = $("#reviewForm");
    const reviewInput = $("#reviewText");
    const status = $("#reviewStatus");
    if (!form || !reviewInput) return false;
    const text = reviewInput.value.trim();
    if (!text || text.length < 20) {
      showFormStatus(status, "Write at least 20 characters so the review is useful.", "error");
      reviewInput.focus();
      return false;
    }
    if (!form.reportValidity()) {
      showFormStatus(status, "Check the highlighted fields and try again.", "error");
      return false;
    }
    clearFormStatus(status);
    return true;
  }

  async function submitSupabaseReview(payload) {
    const status = $("#reviewStatus");
    const submit = $("#reviewSubmit");
    state.reviewSubmitting = true;
    setButtonBusy(submit, true, "Publishing…");
    clearFormStatus(status);
    try {
      const rows = await supabaseRequest(supabaseTable(state.supabase.reviewsTable), {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: payload
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        const review = normaliseSupabaseReview(row);
        if (review) {
          state.reviews = mergeReviews([review], state.reviews);
          renderReviews(state.reviews);
        }
      } else {
        hydrateReviews(true);
      }

      const textarea = $("#reviewText");
      if (textarea) textarea.value = "";
      setReviewRating(5);
      const count = $("#reviewCharCount");
      if (count) count.textContent = "0";
      clearDraft("review");
      hideDialog($("#reviewDialog"));
      loadPublicStats();
      showToast("Review published. Thank you for putting it on the record.", 5200);
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
        showFormStatus(status, "Your session expired. Sign in again to publish.", "error");
        openAuthDialog({ action: "review", opener: submit });
      } else if (error.status === 403) {
        showFormStatus(status, "This account does not have permission to publish a review.", "error");
      } else if (isRateLimitError(error)) {
        showFormStatus(status, error.message || "Review limit reached. Try again tomorrow.", "error");
      } else {
        showFormStatus(status, error.message || "The review could not be published. Try again.", "error");
      }
    } finally {
      state.reviewSubmitting = false;
      setButtonBusy(submit, false);
    }
  }

  function initReviewDialog() {
    const dialog = $("#reviewDialog");
    const form = $("#reviewForm");
    const ratingInput = $("#reviewRating");
    const starGroup = $("#starInput");
    const reviewInput = $("#reviewText");
    const charCount = $("#reviewCharCount");
    if (!dialog || !form) return;

    initDialogChrome(dialog, "#reviewDialogClose");
    setReviewRating(Number(ratingInput && ratingInput.value) || 5);

    if (starGroup) {
      $$(".rating-star", starGroup).forEach((star) => {
        star.addEventListener("click", () => setReviewRating(star.dataset.value));
      });
      starGroup.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = Number(ratingInput && ratingInput.value) || 5;
        let next = current;
        if (event.key === "ArrowLeft") next = Math.max(1, current - 1);
        if (event.key === "ArrowRight") next = Math.min(5, current + 1);
        if (event.key === "Home") next = 1;
        if (event.key === "End") next = 5;
        setReviewRating(next);
        const star = $$(".rating-star", starGroup).find((item) => Number(item.dataset.value) === next);
        if (star) star.focus();
      });
    }

    [
      ["#reviewRom", "reviewRomTouched"],
      ["#reviewRoot", "reviewRootTouched"]
    ].forEach(([selector, stateKey]) => {
      const select = $(selector);
      if (select) {
        select.addEventListener("change", () => {
          state[stateKey] = true;
        });
      }
    });

    if (reviewInput && charCount) {
      const update = () => { charCount.textContent = String(reviewInput.value.length); };
      reviewInput.addEventListener("input", update);
      update();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.reviewSubmitting) return;
      if (!validateReviewForm()) return;

      const text = reviewInput.value.trim();
      const rating = Number(ratingInput && ratingInput.value) || 5;
      const rom = ($("#reviewRom") && $("#reviewRom").value) || "Modded HyperOS";
      const root = ($("#reviewRoot") && $("#reviewRoot").value) || "KowSU + SuSFS";
      const buildValue = ($("#reviewBuild") && $("#reviewBuild").value.trim()) || "";
      const build = !buildValue || buildValue === "Latest stable" ? state.buildLabel : buildValue;

      if (state.communityMode === "supabase") {
        if (!state.auth.session) {
          showFormStatus($("#reviewStatus"), "Sign in with Google or GitHub to publish your review.", "info");
          openAuthDialog({ action: "review", opener: $("#reviewSubmit") });
          return;
        }
        await submitSupabaseReview({ rating, body: text, rom, root_flavor: root, build });
        return;
      }

      const name = (($("#reviewName") && $("#reviewName").value) || "Rider")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 32) || "Rider";
      if (!reviewConfig.owner || !reviewConfig.repo) {
        showFormStatus($("#reviewStatus"), "Review repository is not configured. Update assets/js/config.js.", "error");
        return;
      }

      const prefix = reviewConfig.titlePrefix || "[Review]";
      const safeReviewText = text
        .split(/\r?\n/)
        .map((line) => (/^#{1,6}\s/.test(line) ? `> ${line}` : line))
        .join("\n");
      const body = [
        "### Review",
        safeReviewText,
        "",
        "### Rating",
        `${rating} / 5`,
        "",
        "### ROM",
        rom,
        "",
        "### Root flavor",
        root,
        "",
        "### Build tested",
        build
      ].join("\n");

      openGitHubIssue({
        title: `${prefix} ${name}`.trim(),
        body,
        success: "GitHub opened. Submit the issue, then use Refresh wall."
      });
      hideDialog(dialog);
    });
  }

  function openGitHubIssue({ title, body, success }) {
    const issueUrl = `https://github.com/${reviewConfig.owner}/${reviewConfig.repo}/issues/new`;
    const safeTitle = String(title || "Kernel report").replace(/\s+/g, " ").trim().slice(0, 140);
    const fullBody = String(body || "");
    const makeUrl = (value) => {
      const query = new URLSearchParams({ title: safeTitle, body: value });
      return `${issueUrl}?${query.toString()}`;
    };

    let targetBody = fullBody;
    let url = makeUrl(targetBody);
    let shortened = false;

    // GitHub rejects very long prefilled issue URLs (and the login redirect
    // doubles the URL). Keep the open usable; copy the complete report first.
    if (url.length > 4000) {
      const notice = "\n\n---\n_GitHub's prefilled-issue URL limit shortened this report. The complete report was copied to your clipboard — paste it here before submitting._";
      let low = 0;
      let high = fullBody.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidateBody = `${fullBody.slice(0, mid).trimEnd()}${notice}`;
        if (makeUrl(candidateBody).length <= 4000) low = mid;
        else high = mid - 1;
      }
      targetBody = `${fullBody.slice(0, low).replace(/\s+\S*$/, "").trimEnd()}${notice}`;
      url = makeUrl(targetBody);
      shortened = true;
    }

    window.open(url, "_blank", "noopener,noreferrer");

    if (!shortened) {
      showToast(success || "Opening GitHub. Submit the issue to publish it.", 5600);
      return;
    }

    copyText(fullBody).then((copied) => {
      showToast(
        copied
          ? "This report is long. GitHub opens a shortened copy; the complete report is on your clipboard. Paste it into the issue before submitting."
          : "This report is long. GitHub opens a shortened copy. Paste the full report from the form before submitting.",
        10000
      );
    });
  }

  function openBugDialog(trigger) {
    const dialog = $("#bugDialog");
    if (!dialog) return;
    updateAuthUI();
    clearFormStatus($("#bugStatus"));
    const focus = state.communityMode === "supabase" && !state.auth.session
      ? "[data-auth-trigger]"
      : "#bugTitle";
    showDialog(dialog, trigger, focus);
  }

  function validateBugForm() {
    const form = $("#bugForm");
    const title = $("#bugTitle");
    const rom = $("#bugRom");
    const description = $("#bugDescription");
    const status = $("#bugStatus");
    if (!form || !description) return false;
    if (title && title.value.trim().length < 8) {
      showFormStatus(status, "Give the report a short title of at least 8 characters.", "error");
      title.focus();
      return false;
    }
    if (rom && !rom.value.trim()) {
      showFormStatus(status, "Name the modded ROM and version you are running.", "error");
      rom.focus();
      return false;
    }
    const text = description.value.trim();
    if (text.length < 30) {
      showFormStatus(status, "Describe the bug in at least 30 characters so it can be reproduced.", "error");
      description.focus();
      return false;
    }
    if (!form.reportValidity()) {
      showFormStatus(status, "Check the highlighted fields, including the modded-ROM confirmation.", "error");
      return false;
    }
    clearFormStatus(status);
    return true;
  }

  async function submitSupabaseBug(payload) {
    const status = $("#bugStatus");
    const submit = $("#bugSubmit");
    state.bugSubmitting = true;
    setButtonBusy(submit, true, "Sending…");
    clearFormStatus(status);
    try {
      await supabaseRequest(supabaseTable(state.supabase.bugsTable), {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=minimal" },
        body: payload
      });
      const form = $("#bugForm");
      if (form) form.reset();
      const build = $("#bugBuild");
      if (build) build.value = state.buildLabel;
      const charCount = $("#bugCharCount");
      if (charCount) charCount.textContent = "0";
      clearDraft("bug");
      hideDialog($("#bugDialog"));
      loadPublicStats();
      showToast("Private bug report sent. Only you and the maintainer can read it.", 6000);
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
        showFormStatus(status, "Your session expired. Sign in again to send the report.", "error");
        openAuthDialog({ action: "bug", opener: submit });
      } else if (error.status === 403) {
        showFormStatus(status, "This account does not have permission to send a report.", "error");
      } else if (isRateLimitError(error)) {
        showFormStatus(status, error.message || "Bug report limit reached. Try again tomorrow.", "error");
      } else {
        showFormStatus(status, error.message || "The report could not be sent. Try again.", "error");
      }
    } finally {
      state.bugSubmitting = false;
      setButtonBusy(submit, false);
    }
  }

  function initBugDialog() {
    const dialog = $("#bugDialog");
    const form = $("#bugForm");
    const description = $("#bugDescription");
    const logs = $("#bugLogs");
    const charCount = $("#bugCharCount");
    if (!dialog || !form) return;

    initDialogChrome(dialog, "#bugDialogClose");

    if (description && charCount) {
      const update = () => { charCount.textContent = String(description.value.length); };
      description.addEventListener("input", update);
      update();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.bugSubmitting) return;
      if (!validateBugForm()) return;

      const buildValue = ($("#bugBuild") && $("#bugBuild").value.trim()) || "";
      const payload = {
        title: ($("#bugTitle") && $("#bugTitle").value.trim()) || "Kernel issue",
        device: ($("#bugDevice") && $("#bugDevice").value) || "POCO F4 (munch)",
        rom: ($("#bugRom") && $("#bugRom").value.trim()) || "",
        root_flavor: ($("#bugRoot") && $("#bugRoot").value) || "KowSU + SuSFS",
        build: !buildValue || buildValue === "Latest stable" ? state.buildLabel : buildValue,
        description: description.value.trim(),
        logs: (logs && logs.value.trim()) || ""
      };

      if (state.communityMode === "supabase") {
        if (!state.auth.session) {
          showFormStatus($("#bugStatus"), "Sign in with Google or GitHub to send a private report.", "info");
          openAuthDialog({ action: "bug", opener: $("#bugSubmit") });
          return;
        }
        await submitSupabaseBug(payload);
        return;
      }

      const safeDescription = payload.description
        .split(/\r?\n/)
        .map((line) => (/^#{1,6}\s/.test(line) ? `> ${line}` : line))
        .join("\n");
      const fence = payload.logs.includes("```") ? "````" : "```";
      const body = [
        "### Device",
        payload.device,
        "",
        "### ROM",
        payload.rom,
        "",
        "### Root flavor",
        payload.root_flavor,
        "",
        "### Build",
        payload.build,
        "",
        "### What happened",
        safeDescription,
        "",
        "### Logs",
        payload.logs ? `${fence}text\n${payload.logs}\n${fence}` : "_No logs provided._",
        "",
        "### ROM check",
        "- [x] Modded HyperOS, ColorOS port or AOSP-based custom ROM (not stock HyperOS)"
      ].join("\n");

      const prefix = communityConfig.bugTitlePrefix || "[Bug]";
      openGitHubIssue({
        title: `${prefix} ${payload.title}`.trim(),
        body,
        success: "GitHub opened. Submit the issue so the report reaches the tracker."
      });
      hideDialog(dialog);
    });
  }

  function createReportButton(targetType, targetId, targetLabel, className = "report-link") {
    const button = create("button", className, "Report");
    button.type = "button";
    button.dataset.reportType = String(targetType || "");
    button.dataset.reportId = String(targetId || "");
    button.dataset.reportLabel = String(targetLabel || "this content");
    button.setAttribute("aria-label", `Report ${targetLabel || "this content"}`);
    return button;
  }

  function openReportDialog(targetType, targetId, targetLabel, opener) {
    if (!state.supabaseReady || state.communityMode !== "supabase") {
      showToast("Reporting is available when the on-site community is connected.", 4800);
      return;
    }
    if (!state.auth.session) {
      showToast("Sign in with Google or GitHub to report content.", 4800);
      openAuthDialog({ opener });
      return;
    }

    const dialog = $("#reportDialog");
    const form = $("#reportForm");
    const preview = $("#reportPreview");
    const reason = $("#reportReason");
    const status = $("#reportStatus");
    const charCount = $("#reportCharCount");
    if (!dialog || !form) return;

    state.report.targetType = String(targetType || "");
    state.report.targetId = String(targetId || "");
    state.report.targetLabel = String(targetLabel || "this content");
    const typeInput = $("#reportTargetType");
    const idInput = $("#reportTargetId");
    if (typeInput) typeInput.value = state.report.targetType;
    if (idInput) idInput.value = state.report.targetId;
    if (preview) {
      preview.hidden = false;
      preview.textContent = `Reporting: ${state.report.targetLabel}`;
    }
    if (reason) reason.value = "";
    if (charCount) charCount.textContent = "0";
    clearFormStatus(status);
    showDialog(dialog, opener, "#reportReason");
  }

  async function submitReport() {
    const form = $("#reportForm");
    const reasonInput = $("#reportReason");
    const status = $("#reportStatus");
    const submit = $("#reportSubmit");
    if (!form || !reasonInput || !state.report.targetId) return;
    const reason = reasonInput.value.trim();
    if (reason.length < 5) {
      showFormStatus(status, "Give a specific reason of at least 5 characters.", "error");
      reasonInput.focus();
      return;
    }
    if (reason.length > 500) {
      showFormStatus(status, "Keep the reason under 500 characters.", "error");
      return;
    }

    state.reportSubmitting = true;
    setButtonBusy(submit, true, "Sending…");
    clearFormStatus(status);
    try {
      await supabaseRequest("/rest/v1/rpc/community_report_content", {
        method: "POST",
        auth: true,
        body: {
          p_target_type: state.report.targetType,
          p_target_id: state.report.targetId,
          p_reason: reason
        }
      });
      hideDialog($("#reportDialog"));
      form.reset();
      state.report.targetType = "";
      state.report.targetId = "";
      state.report.targetLabel = "";
      showToast("Report received. The moderation team will review it privately.", 6000);
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
        showFormStatus(status, "Your session expired. Sign in again to report.", "error");
        openAuthDialog({ opener: submit });
      } else if (error.status === 403) {
        showFormStatus(status, "This account cannot submit reports right now.", "error");
      } else if (isRateLimitError(error)) {
        showFormStatus(status, error.message || "Report limit reached. Try again later.", "error");
      } else {
        showFormStatus(status, error.message || "The report could not be sent. Try again.", "error");
      }
    } finally {
      state.reportSubmitting = false;
      setButtonBusy(submit, false);
    }
  }

  function initReportDialog() {
    const dialog = $("#reportDialog");
    const form = $("#reportForm");
    const reason = $("#reportReason");
    const charCount = $("#reportCharCount");
    if (!dialog || !form) return;

    initDialogChrome(dialog, "#reportDialogClose");

    if (reason && charCount) {
      const update = () => { charCount.textContent = String(reason.value.length); };
      reason.addEventListener("input", update);
      update();
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.reportSubmitting) return;
      submitReport();
    });
  }

  function normaliseChatRow(row) {
    if (!row || typeof row !== "object") return null;
    const username = String(row.author_username || "").trim();
    return {
      id: row.id || "",
      user_id: row.user_id || "",
      created_at: row.created_at || "",
      author_name: truncate(String(row.author_name || username || "Rider"), 42),
      author_username: username,
      profileUrl: profileUrlFor(username),
      author_avatar: safeHttpUrl(resizeAvatarUrl(row.author_avatar || "")),
      provider: String(row.provider || ""),
      body: String(row.body || "")
    };
  }

  function setChatStatus(label, tone) {
    const status = $("#chatStatus");
    if (!status) return;
    const next = String(label);
    if (status.textContent !== next) status.textContent = next;
    status.classList.toggle("is-live", tone === "live");
    status.classList.toggle("is-error", tone === "error");
  }

  function updateChatCount() {
    const count = state.chat.messages.length;
    const limit = state.supabase.chatLimit;
    const suffix = count >= limit ? "+" : "";
    const display = `${formatNumber(count)}${suffix}`;
    setText("[data-chat-count]", display);
    setTextNode($("#chatCount"), `${display} ${count === 1 ? "message" : "messages"}`);
  }

  function createChatMessage(message) {
    const item = create("div", "chat-message");
    if (state.auth.user && message.user_id === state.auth.user.id) item.classList.add("is-own");

    const avatar = create("span", "chat-message-avatar");
    const avatarUrl = safeHttpUrl(resizeAvatarUrl(message.author_avatar || ""));
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        avatar.textContent = initialsFor(message.author_name);
      }, { once: true });
      avatar.appendChild(image);
    } else {
      avatar.textContent = initialsFor(message.author_name);
    }
    avatar.setAttribute("aria-hidden", "true");
    item.appendChild(avatar);

    const main = create("div", "chat-message-main");
    const head = create("div", "chat-message-head");
    if (message.profileUrl) {
      const author = create("a", "chat-author-link", message.author_name || "Rider");
      author.href = message.profileUrl;
      head.appendChild(author);
    } else {
      head.appendChild(create("strong", "", message.author_name || "Rider"));
    }
    const time = document.createElement("time");
    time.dateTime = message.created_at || "";
    time.textContent = formatChatTime(message.created_at);
    head.appendChild(time);
    if (message.id && (!state.auth.user || message.user_id !== state.auth.user.id)) {
      head.appendChild(createReportButton("chat", message.id, `message by ${message.author_name}`, "report-link chat-report"));
    }
    main.appendChild(head);
    main.appendChild(create("div", "chat-message-body", message.body));
    item.appendChild(main);
    return item;
  }

  function renderChatEmpty() {
    const body = $("#chatBody");
    if (!body) return;
    const empty = create("div", "chat-empty");
    empty.appendChild(create("strong", "", "No messages yet."));
    empty.appendChild(create("p", "", "Signed-in riders can start the conversation. Keep it useful, honest and kind."));
    body.replaceChildren(empty);
  }

  function renderChatError() {
    const body = $("#chatBody");
    if (!body) return;
    const empty = create("div", "chat-empty");
    empty.appendChild(create("strong", "", "The chat is taking a pit stop."));
    empty.appendChild(create("p", "", "The community backend did not answer. Telegram is still open for immediate help."));
    const link = create("a", "text-link", "Open Telegram ");
    const arrow = create("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    link.appendChild(arrow);
    link.href = links.telegram || "https://t.me/Extremeplus_Support";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    empty.appendChild(link);
    body.replaceChildren(empty);
  }

  function renderChatMessages(messages, forceScroll = false) {
    const body = $("#chatBody");
    if (!body) return;
    const previousScrollTop = body.scrollTop;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 130;
    body.replaceChildren();
    if (!messages.length) {
      renderChatEmpty();
      return;
    }
    const fragment = document.createDocumentFragment();
    messages.forEach((message) => fragment.appendChild(createChatMessage(message)));
    body.appendChild(fragment);
    updateChatCount();
    if (forceScroll || nearBottom) {
      body.scrollTop = body.scrollHeight;
    } else {
      body.scrollTop = previousScrollTop;
    }
  }

  function announceNewChatMessages(messages, previousIds) {
    if (!state.chat.visible) return;
    const fresh = messages.filter((message) => message.id && !previousIds.has(message.id));
    if (!fresh.length) return;
    const latest = fresh[fresh.length - 1];
    const preview = truncate(latest.body.replace(/\s+/g, " ").trim(), 120);
    const announcer = $("#chatAnnouncements");
    if (!announcer) return;
    announcer.textContent = fresh.length === 1
      ? `New chat message from ${latest.author_name}: ${preview}`
      : `${fresh.length} new chat messages. Latest from ${latest.author_name}: ${preview}`;
  }

  async function hydrateChat(silent = false) {
    if (state.communityMode !== "supabase" || !state.supabaseReady || state.chat.loading) return;
    state.chat.loading = true;
    const body = $("#chatBody");
    if (body) body.setAttribute("aria-busy", "true");
    if (!state.chat.initialized) setChatStatus("Connecting…", "loading");
    try {
      const query = new URLSearchParams({
        select: "id,user_id,created_at,author_name,author_avatar,author_username,provider,body",
        order: "created_at.desc",
        limit: String(state.supabase.chatLimit)
      });
      const rows = await supabaseRequest(supabaseTable(state.supabase.chatTable, query.toString()));
      const messages = (Array.isArray(rows) ? rows : [])
        .map(normaliseChatRow)
        .filter(Boolean)
        .reverse();
      const firstLoad = !state.chat.initialized;
      const previousIds = new Set(state.chat.messages.map((message) => message.id).filter(Boolean));
      state.chat.messages = messages;
      state.chat.initialized = true;
      renderChatMessages(messages, firstLoad);
      if (!firstLoad) announceNewChatMessages(messages, previousIds);
      setChatStatus("Live", "live");
      updateChatCount();
    } catch (error) {
      console.warn("EXTREME++: chat could not load.", error);
      if (silent && state.chat.messages.length) {
        setChatStatus("Reconnecting…", "error");
      } else {
        setChatStatus("Offline", "error");
        renderChatError();
        updateChatCount();
      }
    } finally {
      state.chat.loading = false;
      if (body) body.setAttribute("aria-busy", "false");
    }
  }

  function startChatPolling() {
    stopChatPolling();
    if (state.communityMode !== "supabase" || !state.supabaseReady) return;
    state.chat.pollTimer = window.setInterval(() => {
      if (document.hidden || !state.chat.visible) return;
      hydrateChat(true);
    }, state.supabase.chatPollMs);
  }

  function stopChatPolling() {
    window.clearInterval(state.chat.pollTimer);
    state.chat.pollTimer = 0;
  }

  async function sendChatMessage() {
    if (state.chat.sending) return;
    const input = $("#chatInput");
    const form = $("#chatForm");
    const send = $("#chatSend");
    if (!input || !form) return;
    if (!state.auth.session) {
      openAuthDialog({ action: "chat", opener: send });
      return;
    }
    const message = input.value.trim();
    if (!message) {
      showToast("Write a message before sending.", 3200);
      input.focus();
      return;
    }
    if (message.length > 500) {
      showToast("Keep chat messages under 500 characters.", 4200);
      return;
    }

    state.chat.sending = true;
    if (send) {
      send.disabled = true;
      send.setAttribute("aria-busy", "true");
    }
    try {
      const rows = await supabaseRequest(supabaseTable(state.supabase.chatTable), {
        method: "POST",
        auth: true,
        headers: { Prefer: "return=representation" },
        body: { body: message }
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      const saved = normaliseChatRow(row);
      if (saved) {
        state.chat.messages.push(saved);
        renderChatMessages(state.chat.messages, true);
        updateChatCount();
      } else {
        await hydrateChat(true);
      }
      input.value = "";
      const count = $("#chatCharCount");
      if (count) count.textContent = "0";
      clearDraft("chat");
      loadPublicStats();
      setChatStatus("Live", "live");
    } catch (error) {
      if (error.status === 401) {
        clearAuthSession();
        updateAuthUI();
        showToast("Your session expired. Sign in again to chat.", 5200);
        openAuthDialog({ action: "chat", opener: send });
      } else if (error.status === 403) {
        showToast("This account cannot post to the chat right now.", 5200);
      } else if (isRateLimitError(error)) {
        showToast(error.message || "Chat is rate-limited. Wait a moment and try again.", 5200);
      } else {
        showToast(error.message || "The message could not be sent. Try again.", 5200);
      }
    } finally {
      state.chat.sending = false;
      if (send) {
        send.disabled = false;
        send.removeAttribute("aria-busy");
      }
    }
  }

  function initChat() {
    if (state.communityMode !== "supabase") return;
    const form = $("#chatForm");
    const input = $("#chatInput");
    const charCount = $("#chatCharCount");
    const section = $("#communityChat");
    if (!form || !input) return;

    const updateCount = () => {
      if (charCount) charCount.textContent = String(input.value.length);
    };
    input.addEventListener("input", updateCount);
    updateCount();
    updateChatCount();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendChatMessage();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else sendChatMessage();
    });

    const setVisible = (visible) => {
      state.chat.visible = visible;
      if (visible && !state.chat.initialized) hydrateChat(true);
    };

    if (section && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        setVisible(Boolean(entries[0] && entries[0].isIntersecting));
      }, { rootMargin: "240px 0px" });
      observer.observe(section);
    } else {
      state.chat.visible = true;
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopChatPolling();
      } else {
        startChatPolling();
        if (state.chat.visible) hydrateChat(true);
      }
    });

    hydrateChat(true);
    startChatPolling();
  }

  function handleAuthTrigger(trigger) {
    if (state.communityMode !== "supabase") {
      showToast("On-site accounts are not configured. Use GitHub issues or Telegram.", 5600);
      return;
    }
    const action = trigger.dataset.authAction || "";
    const provider = trigger.dataset.authProviderButton || "";
    if (state.auth.session) {
      if (action === "chat") {
        scrollToSection("community");
        window.setTimeout(focusChatInput, 380);
      } else if (action === "review") {
        openReviewDialog(trigger);
      } else if (action === "bug") {
        openBugDialog(trigger);
      } else {
        openAuthDialog({ opener: trigger });
      }
      return;
    }
    if (provider) {
      state.auth.pendingAction = action;
      beginOAuth(provider, action);
      return;
    }
    openAuthDialog({ action, opener: trigger });
  }

  function initCommunityActions() {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const authTrigger = target.closest("[data-auth-trigger]");
      if (authTrigger) {
        event.preventDefault();
        if (typeof state.closeMobileMenu === "function") state.closeMobileMenu();
        handleAuthTrigger(authTrigger);
        return;
      }

      const reportTrigger = target.closest("[data-report-type][data-report-id]");
      if (reportTrigger) {
        event.preventDefault();
        openReportDialog(
          reportTrigger.dataset.reportType,
          reportTrigger.dataset.reportId,
          reportTrigger.dataset.reportLabel,
          reportTrigger
        );
        return;
      }

      const refreshTrigger = target.closest("[data-refresh-reviews]");
      if (refreshTrigger) {
        event.preventDefault();
        refreshReviewWall(refreshTrigger);
        return;
      }

      const reviewTrigger = target.closest("[data-open-review]");
      if (reviewTrigger) {
        event.preventDefault();
        if (typeof state.closeMobileMenu === "function") state.closeMobileMenu();
        openReviewDialog(reviewTrigger);
        return;
      }

      const bugTrigger = target.closest("[data-open-bug]");
      if (bugTrigger) {
        event.preventDefault();
        if (typeof state.closeMobileMenu === "function") state.closeMobileMenu();
        openBugDialog(bugTrigger);
      }
    });
  }

  /* =========================================================
     Community drafts (local only)
     ========================================================= */

  function draftKey(name) {
    return `${DRAFT_PREFIX}${name}`;
  }

  function readDraft(name) {
    const raw = storageGet(draftKey(name));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
      if (Date.now() - Number(parsed.ts || 0) > 7 * 24 * 60 * 60 * 1000) {
        storageRemove(draftKey(name));
        return null;
      }
      return parsed.data;
    } catch (error) {
      return null;
    }
  }

  function writeDraft(name, data) {
    storageSet(draftKey(name), JSON.stringify({ ts: Date.now(), data }));
  }

  function clearDraft(name) {
    storageRemove(draftKey(name));
    const selectors = { review: "#reviewForm", bug: "#bugForm", chat: "#chatForm" };
    const form = selectors[name] ? $(selectors[name]) : null;
    if (form) delete form.dataset.draftDirty;
  }

  function persistDraftsNow() {
    [
      ["review", "#reviewForm"],
      ["bug", "#bugForm"],
      ["chat", "#chatForm"]
    ].forEach(([name, selector]) => {
      const form = $(selector);
      if (form && form.dataset.draftDirty === "true") {
        writeDraft(name, serialiseForm(form));
      }
    });
  }

  function serialiseForm(form) {
    const data = {};
    Array.from(form.elements).forEach((field) => {
      if (!field.name || field.disabled) return;
      if (field.type === "checkbox") {
        data[field.name] = field.checked;
      } else if (field.type === "radio") {
        if (field.checked) data[field.name] = field.value;
      } else {
        data[field.name] = field.value;
      }
    });
    return data;
  }

  function applyFormDraft(form, data) {
    if (!form || !data) return;
    Object.entries(data).forEach(([name, value]) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (field.type === "checkbox") {
        field.checked = Boolean(value);
        return;
      }
      if (field.tagName === "SELECT") {
        const exists = Array.from(field.options).some((option) => option.value === value);
        if (!exists) return;
      }
      field.value = value;
    });
  }

  function initDrafts() {
    [
      { name: "review", form: $("#reviewForm") },
      { name: "bug", form: $("#bugForm") },
      { name: "chat", form: $("#chatForm") }
    ].forEach(({ name, form }) => {
      if (!form) return;
      const draft = readDraft(name);
      if (draft) {
        applyFormDraft(form, draft);
        form.dataset.draftDirty = "true";
      }
      if (name === "review" && draft) {
        state.reviewRomTouched = true;
        state.reviewRootTouched = true;
      }
      if (name === "review") setReviewRating(Number($("#reviewRating") && $("#reviewRating").value) || 5);
      if (name === "review" && $("#reviewText")) {
        const count = $("#reviewCharCount");
        if (count) count.textContent = String($("#reviewText").value.length);
      }
      if (name === "bug" && $("#bugDescription")) {
        const count = $("#bugCharCount");
        if (count) count.textContent = String($("#bugDescription").value.length);
      }
      if (name === "chat" && $("#chatInput")) {
        const count = $("#chatCharCount");
        if (count) count.textContent = String($("#chatInput").value.length);
      }

      let timer = 0;
      const scheduleSave = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => writeDraft(name, serialiseForm(form)), 320);
      };
      form.addEventListener("input", () => {
        form.dataset.draftDirty = "true";
        scheduleSave();
      });
      form.addEventListener("change", () => {
        form.dataset.draftDirty = "true";
        writeDraft(name, serialiseForm(form));
      });
    });
  }

  function initCommunitySupport() {
    normaliseSupabaseConfig();
    updateAuthUI();
    initCommunityActions();
    initAuthDialog();
    initReportDialog();
    initReviewDialog();
    initBugDialog();
    initChat();
    initDrafts();
    initAuth();
    trackSiteVisit();
    loadPublicStats();
    startStatsPolling();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      loadPublicStats();
      heartbeat();
    });
  }


  /* =========================================================
     Service worker
     ========================================================= */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || window.location.protocol !== "https:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("EXTREME++: service worker could not register.", error);
      });
    });
  }

  /* =========================================================
     Boot
     ========================================================= */

  function init() {
    const year = $("#currentYear");
    if (year) year.textContent = String(new Date().getFullYear());

    initTheme();
    captureReviewEmptyState();
    initHeader();
    initMobileMenu();
    initActiveNavigation();
    initReveals();
    initCardSpotlight();
    initTilt();
    initMagnetic();
    initProfileExplorer();
    initHeroCanvas();
    initInstallTabs();
    initCopyButtons();
    initDownloads();
    initCommunitySupport();
    registerServiceWorker();

    hydrateGitHub();
    hydrateReviews();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
