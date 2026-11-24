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
  const links = config.links || {};
  const API_ROOT = "https://api.github.com";
  const CACHE_PREFIX = "extreme_plus_site_v2:";
  const CACHE_MINUTES = Number(config.cacheMinutes) || 15;
  const REQUEST_TIMEOUT = Number(config.requestTimeoutMs) || 9000;
  const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)");

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
    reviews: []
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
        "Dual HyperOS + AOSP target support",
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
    const match = haystack.match(/build\s*#?\s*(\d+)/i);
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

    menu.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (link) {
        setMenu(false, true);
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
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
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

    const reviewBuild = $("#reviewBuild");
    if (reviewBuild && (reviewBuild.value === "Latest stable" || reviewBuild.value === "Build #133")) {
      reviewBuild.value = state.buildLabel;
    }
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
      if (!release || release.draft) return;
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
      return /no.?susfs/i.test(name) || (/(kernelsu|ksu)/i.test(name) && !/susfs|no.?root/i.test(name));
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
    meta.appendChild(create("span", "", state.rom === "AOSP" ? "AOSP" : "HyperOS"));
    meta.appendChild(create("span", "", ROOT_LABELS[state.root]));
    if (typeof asset.download_count === "number") {
      meta.appendChild(create("span", "", `${formatNumber(asset.download_count)} downloads`));
    }
    result.appendChild(meta);

    const actions = create("div", "match-actions");
    const download = create("a", "button button--primary", "Download ZIP");
    download.href = safeHttpUrl(asset.browser_download_url) || links.kernelReleases;
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
      ? state.assets.find((asset) => /(?:^|\W)ekm.*\.apk$|\.apk$/i.test(asset.name || ""))
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
      state.latestRelease = releases.find((release) => !release.draft && !release.prerelease)
        || releases.find((release) => !release.draft)
        || null;

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
          "No public release found.",
          "The repository is reachable, but there is no published release to download yet.",
          { eyebrow: "WAITING FOR A BUILD", retry: true }
        );
        setLivePill("error", "No release", "No published GitHub release was found");
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
        showToast(`${state.rom === "AOSP" ? "AOSP / custom ROM" : "HyperOS"} selected in the download matcher.`);
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
      const buildMatch = body.match(/build\s*#?\s*\d+/i);
      build = buildMatch ? buildMatch[0] : "";
    }

    const rom = markdownSection(body, ["rom", "rom / os", "operating system"]);
    const root = markdownSection(body, ["root flavor", "root variant", "root"]);
    const username = issue.user?.login || "";
    const avatar = safeHttpUrl(issue.user?.avatar_url || (username ? `https://github.com/${username}.png?size=96` : ""));

    return {
      name: truncate(displayName, 42),
      username,
      avatar,
      rating,
      review: text,
      rom: truncate(cleanInlineMarkdown(rom), 42),
      root: truncate(cleanInlineMarkdown(root), 42),
      build: truncate(cleanInlineMarkdown(build), 42),
      date: issue.created_at || "",
      url: safeHttpUrl(issue.html_url)
    };
  }

  function normaliseCuratedReview(review) {
    if (!review || typeof review !== "object" || !review.review) return null;
    const username = String(review.username || "").replace(/^@/, "");
    return {
      name: truncate(review.name || username || "Rider", 42),
      username,
      avatar: safeHttpUrl(review.avatar || (username ? `https://github.com/${username}.png?size=96` : "")),
      rating: Number.isInteger(Number(review.rating)) ? Math.min(5, Math.max(1, Number(review.rating))) : null,
      review: String(review.review),
      rom: truncate(review.rom || "", 42),
      root: truncate(review.root || "", 42),
      build: truncate(review.build || "", 42),
      date: review.date || "",
      url: safeHttpUrl(review.url)
    };
  }

  function makeAvatar(review) {
    if (review.avatar) {
      const image = create("img", "review-avatar");
      image.src = review.avatar;
      image.alt = "";
      image.width = 30;
      image.height = 30;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      return image;
    }

    const initials = review.name
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
      unrated.style.fontFamily = "var(--font-mono)";
      unrated.style.fontSize = "0.45rem";
      unrated.style.letterSpacing = "0.08em";
      stars.appendChild(unrated);
    }

    top.appendChild(stars);

    if (review.url) {
      const source = create("a", "review-source", "GitHub ");
      const arrow = create("span", "", "↗");
      arrow.setAttribute("aria-hidden", "true");
      source.appendChild(arrow);
      source.href = review.url;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.setAttribute("aria-label", "Open source review on GitHub");
      top.appendChild(source);
    }

    article.appendChild(top);
    article.appendChild(create("blockquote", "", truncate(review.review, 560)));

    const footer = create("footer", "review-card-footer");
    footer.appendChild(makeAvatar(review));

    const user = create("div", "review-user");
    user.appendChild(create("strong", "", review.name));
    const metaParts = [];
    if (review.username) metaParts.push(`@${review.username}`);
    if (review.rom) metaParts.push(review.rom);
    if (review.root) metaParts.push(review.root);
    const meta = create("span", "", metaParts.join(" · ") || "Verified community review");
    if (meta.textContent) meta.title = meta.textContent;
    user.appendChild(meta);
    footer.appendChild(user);

    if (review.build) footer.appendChild(create("span", "review-build", review.build));

    article.appendChild(footer);
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
    copy.appendChild(create("p", "", "Flash the latest build, live with it for a few days, then leave an honest review. It will show up right here after you post it on GitHub."));

    const action = create("button", "text-link text-link--button", "Leave the first review ");
    const arrow = create("span", "", "→");
    arrow.setAttribute("aria-hidden", "true");
    action.appendChild(arrow);
    action.type = "button";
    action.id = "writeReviewEmptyBtn";
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
    copy.appendChild(create("p", "", "GitHub did not answer this request. Your reviews are safe — open the issue feed directly, or try loading them again."));

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
      const key = review.url || `${review.name}|${review.review.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(review);
    });

    return merged.sort((a, b) => {
      const timeA = new Date(a.date || 0).getTime() || 0;
      const timeB = new Date(b.date || 0).getTime() || 0;
      return timeB - timeA;
    });
  }

  async function hydrateReviews(force = false) {
    if (state.reviewsLoading) return;
    if (!reviewConfig.owner || !reviewConfig.repo) {
      renderReviewError();
      return;
    }

    const curated = Array.isArray(window.EXTREME_REVIEWS)
      ? window.EXTREME_REVIEWS.map(normaliseCuratedReview).filter(Boolean)
      : [];

    state.reviewsLoading = true;
    const issuesUrl = apiUrl(
      `/repos/${reviewConfig.owner}/${reviewConfig.repo}/issues?state=all&sort=created&direction=desc&per_page=${Number(reviewConfig.issuesPerPage) || 50}`
    );
    const cacheKey = `${reviewConfig.owner}/${reviewConfig.repo}:reviews:${Number(reviewConfig.issuesPerPage) || 50}`;

    try {
      const response = await fetchCached(issuesUrl, cacheKey, force);
      const issues = Array.isArray(response.data) ? response.data : [];
      const remote = issues
        .map(issueToReview)
        .filter((review) => review && review.review && review.review.trim());
      const reviews = mergeReviews(curated, remote);
      state.reviews = reviews;
      renderReviews(reviews);
    } catch (error) {
      console.warn("EXTREME++: could not load the review wall.", error);
      if (curated.length) {
        state.reviews = curated;
        renderReviews(curated);
      } else {
        renderReviewError();
      }
    } finally {
      state.reviewsLoading = false;
    }
  }

  function initReviewDialog() {
    const dialog = $("#reviewDialog");
    const form = $("#reviewForm");
    const closeButton = $("#reviewDialogClose");
    const nameInput = $("#reviewName");
    const reviewInput = $("#reviewText");
    const ratingInput = $("#reviewRating");
    const starGroup = $("#starInput");
    const charCount = $("#reviewCharCount");
    const stars = starGroup ? $$(".rating-star", starGroup) : [];
    let opener = null;

    if (!dialog || !form) return;

    const setRating = (value) => {
      const rating = Math.min(5, Math.max(1, Number(value) || 5));
      if (ratingInput) ratingInput.value = String(rating);
      stars.forEach((star) => {
        const starValue = Number(star.dataset.value);
        star.classList.toggle("is-active", starValue <= rating);
        star.setAttribute("aria-pressed", String(starValue === rating));
      });
    };

    setRating(5);

    const syncFormWithSelection = () => {
      const romSelect = $("#reviewRom");
      const rootSelect = $("#reviewRoot");
      const buildInput = $("#reviewBuild");

      if (romSelect) romSelect.value = state.rom === "AOSP" ? "AOSP / Custom ROM" : "HyperOS";
      if (rootSelect) rootSelect.value = ROOT_LABELS[state.root] || "KowSU + SuSFS";
      if (buildInput && (!buildInput.value.trim() || buildInput.value === "Latest stable")) {
        buildInput.value = state.buildLabel;
      }
    };

    const openDialog = (trigger) => {
      opener = trigger || document.activeElement;
      syncFormWithSelection();
      setRating(Number(ratingInput?.value) || 5);
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      document.body.classList.add("dialog-open");
      window.setTimeout(() => nameInput?.focus({ preventScroll: true }), 60);
    };

    const closeDialog = () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      document.body.classList.remove("dialog-open");
      if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };

    const writeButton = $("#writeReviewBtn");
    if (writeButton) writeButton.addEventListener("click", () => openDialog(writeButton));

    const reviewGrid = $("#reviewGrid");
    if (reviewGrid) {
      reviewGrid.addEventListener("click", (event) => {
        if (!event.target.closest("#writeReviewEmptyBtn")) return;
        openDialog(event.target.closest("#writeReviewEmptyBtn"));
      });
    }

    if (closeButton) closeButton.addEventListener("click", closeDialog);

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });

    dialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
    });

    dialog.addEventListener("cancel", () => {
      document.body.classList.remove("dialog-open");
    });

    stars.forEach((star) => {
      star.addEventListener("click", () => setRating(star.dataset.value));
    });

    if (starGroup) {
      starGroup.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = Number(ratingInput?.value) || 5;
        let next = current;
        if (event.key === "ArrowLeft") next = Math.max(1, current - 1);
        if (event.key === "ArrowRight") next = Math.min(5, current + 1);
        if (event.key === "Home") next = 1;
        if (event.key === "End") next = 5;
        setRating(next);
        const star = stars.find((item) => Number(item.dataset.value) === next);
        if (star) star.focus();
      });
    }

    if (reviewInput) {
      const updateCount = () => {
        if (charCount) charCount.textContent = String(reviewInput.value.length);
      };
      reviewInput.addEventListener("input", updateCount);
      updateCount();
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const name = nameInput?.value.trim() || "Rider";
      const text = reviewInput?.value.trim() || "";
      const rating = Number(ratingInput?.value) || 5;
      const rom = $("#reviewRom")?.value || "HyperOS";
      const root = $("#reviewRoot")?.value || "KowSU + SuSFS";
      const build = $("#reviewBuild")?.value.trim() || state.buildLabel;

      if (!text || text.length < 20) {
        showToast("Please write at least 20 characters so the review is useful.");
        reviewInput?.focus();
        return;
      }

      if (!reviewConfig.owner || !reviewConfig.repo) {
        showToast("Review repository is not configured. Update assets/js/config.js.");
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

      const issueUrl = `https://github.com/${reviewConfig.owner}/${reviewConfig.repo}/issues/new`;
      const query = new URLSearchParams({
        title: `${prefix} ${name}`.trim(),
        body
      });

      window.open(`${issueUrl}?${query.toString()}`, "_blank", "noopener,noreferrer");
      closeDialog();
      showToast("Opening GitHub. Submit the issue — the wall refreshes within 15 minutes.", 5500);
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
    initReviewDialog();
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
