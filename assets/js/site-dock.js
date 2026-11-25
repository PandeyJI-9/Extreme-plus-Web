/**
 * PROJECT EXTREME++ — site chrome
 * Shared floating liquid dock, account-aware settings sheet and
 * specular pointer tracking. Loaded after the page's own controller.
 */
(() => {
  "use strict";

  const EC = window.ExtremeCommunity;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const THEME_LABEL = "[data-settings-theme-label]";

  function isVisible(node) {
    return Boolean(node && !node.hidden && node.getClientRects().length);
  }

  function syncDialogState() {
    document.body.classList.toggle("dialog-open", $$("dialog[open]").length > 0);
  }

  function showSettings() {
    const dialog = $("#settingsDialog");
    if (!dialog) return;
    const opener = document.activeElement;
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
    syncAuthLinks();
    syncThemeLabel();
    const close = $("#settingsClose");
    if (close) {
      window.setTimeout(() => {
        try {
          close.focus({ preventScroll: true });
        } catch (error) {
          close.focus();
        }
      }, 40);
    }
    dialog._opener = opener;
  }

  function closeSettings() {
    const dialog = $("#settingsDialog");
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

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function syncThemeLabel() {
    $$(THEME_LABEL).forEach((node) => {
      node.textContent = currentTheme() === "light" ? "Light glass" : "Dark glass";
    });
  }

  function toggleTheme() {
    const toggle = $("#themeToggle");
    if (toggle) {
      toggle.click();
    } else {
      const root = document.documentElement;
      const next = currentTheme() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      root.style.colorScheme = next;
      try {
        window.localStorage.setItem("extreme_plus_theme", next);
      } catch (error) {
        // Ignore disabled storage.
      }
      const meta = $("#themeColorMeta");
      if (meta) meta.setAttribute("content", next === "light" ? "#f3f5fa" : "#06070b");
    }
    syncThemeLabel();
  }

  async function syncAuthLinks() {
    const profileLink = $("[data-settings-profile]");
    const adminLink = $("[data-settings-admin]");
    if (!EC || !EC.ready) {
      if (profileLink) profileLink.hidden = true;
      if (adminLink) adminLink.hidden = true;
      return;
    }

    try {
      const session = await EC.getValidSession();
      if (!session) {
        if (profileLink) profileLink.hidden = true;
        if (adminLink) adminLink.hidden = true;
        return;
      }

      const profile = await EC.rpc("community_ensure_profile", {}, { session });
      const role = String(await EC.rpc("community_my_role", {}, { session }) || "").toLowerCase();
      const username = profile && profile.username ? String(profile.username) : "";

      if (profileLink) {
        profileLink.hidden = !username;
        if (username) profileLink.href = `./profile.html?u=${encodeURIComponent(username)}`;
      }
      if (adminLink) {
        adminLink.hidden = !(role === "owner" || role === "admin");
      }
    } catch (error) {
      if (profileLink) profileLink.hidden = true;
      if (adminLink) adminLink.hidden = true;
    }
  }

  function initDockActive() {
    const dock = $(".liquid-dock");
    if (!dock) return;
    document.body.classList.add("has-liquid-dock");
    const path = String(window.location.pathname || "");
    const onCommunity = /\/community\.html$/i.test(path);
    $$("[data-dock]", dock).forEach((item) => {
      const target = item.getAttribute("data-dock");
      const active = (onCommunity && target === "community") || (!onCommunity && target === "kernel");
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function initDockGlow() {
    const dock = $(".liquid-dock");
    if (!dock || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      dock.style.setProperty("--dock-x", `${x}px`);
      dock.style.setProperty("--dock-y", `${y}px`);
    };

    dock.addEventListener("pointermove", (event) => {
      const rect = dock.getBoundingClientRect();
      x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      if (!frame) frame = window.requestAnimationFrame(paint);
    }, { passive: true });

    dock.addEventListener("pointerleave", () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      dock.style.removeProperty("--dock-x");
      dock.style.removeProperty("--dock-y");
    }, { passive: true });
  }

  function initSettings() {
    $$("[data-open-settings]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        showSettings();
      });
    });

    const close = $("#settingsClose");
    if (close) close.addEventListener("click", closeSettings);

    const dialog = $("#settingsDialog");
    if (dialog) {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeSettings();
      });
      dialog.addEventListener("close", syncDialogState);
    }

    const dialogObserver = new MutationObserver(syncDialogState);
    $$("dialog").forEach((node) => {
      dialogObserver.observe(node, { attributes: true, attributeFilter: ["open"] });
    });

    $$("[data-settings-theme]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });

    syncThemeLabel();

    const observer = new MutationObserver(syncThemeLabel);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function init() {
    initDockActive();
    initDockGlow();
    initSettings();
    syncDialogState();
    if (EC && typeof EC.trackVisit !== "function") {
      // The page controller owns analytics; this is only a guard.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
