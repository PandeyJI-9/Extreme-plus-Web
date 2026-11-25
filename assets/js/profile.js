/** PROJECT EXTREME++ — public profile page */
(() => {
  "use strict";

  const EC = window.ExtremeCommunity;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    session: null,
    user: null,
    me: null,
    profile: null,
    username: "",
    saving: false
  };

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

  function setStatus(message, tone = "info") {
    const status = $("#profileStatus");
    if (!status) return;
    status.textContent = String(message || "");
    status.hidden = !message;
    status.classList.toggle("is-error", tone === "error");
    status.classList.toggle("is-success", tone === "success");
    status.classList.toggle("is-info", tone === "info");
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    const text = button.querySelector("span");
    if (busy) {
      if (!button.dataset.idleLabel && text) button.dataset.idleLabel = text.textContent;
      if (text && label) text.textContent = label;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else {
      if (text && button.dataset.idleLabel) text.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  function showError(message) {
    const loading = $("#profileLoading");
    const error = $("#profileError");
    const card = $("#profileCard");
    if (loading) loading.hidden = true;
    if (card) card.hidden = true;
    if (error) error.hidden = false;
    const text = $("#profileErrorText");
    if (text) text.textContent = message || "Check the username or return to the community.";
  }

  function renderAvatar(profile) {
    const target = $("[data-profile-avatar]");
    if (!target) return;
    target.replaceChildren();
    const url = EC.normaliseAvatarUrl(profile.avatar_url || "", 128);
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.width = 128;
      image.height = 128;
      image.loading = "eager";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        target.textContent = EC.initials(profile.display_name || profile.username);
      }, { once: true });
      target.appendChild(image);
    } else {
      target.textContent = EC.initials(profile.display_name || profile.username);
    }
  }

  function renderFeed(container, items, type) {
    if (!container) return;
    container.replaceChildren();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      container.appendChild(create(
        "p",
        "profile-feed-empty",
        type === "review" ? "No published reviews yet." : "No public chat messages yet."
      ));
      return;
    }

    list.forEach((item) => {
      const article = create("article", "profile-feed-item");
      const body = type === "review" ? item.body : item.body;
      article.appendChild(create("p", "", String(body || "")));

      const meta = create("div", "profile-feed-meta");
      if (type === "review") {
        const rating = Number(item.rating);
        if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
          meta.appendChild(create("span", "profile-feed-stars", "★".repeat(rating) + "☆".repeat(5 - rating)));
        }
        if (item.rom) meta.appendChild(create("span", "", String(item.rom)));
        if (item.build) meta.appendChild(create("span", "", String(item.build)));
      }
      const time = document.createElement("time");
      time.dateTime = item.created_at || "";
      time.textContent = EC.formatDate(item.created_at);
      meta.appendChild(time);
      article.appendChild(meta);
      container.appendChild(article);
    });
  }

  function renderProfile(profile) {
    state.profile = profile;
    state.username = profile.username;
    const loading = $("#profileLoading");
    const error = $("#profileError");
    const card = $("#profileCard");
    if (loading) loading.hidden = true;
    if (error) error.hidden = true;
    if (card) card.hidden = false;

    document.title = `@${profile.username} — PROJECT EXTREME++`;
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute(
        "content",
        `${profile.display_name || profile.username} (@${profile.username}) on PROJECT EXTREME++. Public reviews and chat activity, no private account details.`
      );
    }

    renderAvatar(profile);
    setText("[data-profile-name]", profile.display_name || profile.username || "Rider");
    setText("[data-profile-username]", profile.username || "");
    setText("[data-profile-provider]", EC.providerLabel(profile.provider));
    setText("[data-profile-bio]", profile.bio || "No bio yet. This rider lets the build do the talking.");
    setText("[data-profile-joined]", `Joined ${EC.formatDate(profile.joined_at)}`);
    setText("[data-profile-joined-stat]", EC.formatDate(profile.joined_at, { month: "short", year: "numeric" }));
    setText("[data-profile-reviews]", EC.formatNumber(profile.reviews || 0));
    setText("[data-profile-chat]", EC.formatNumber(profile.chat_messages || 0));

    const online = $("[data-profile-online]");
    if (online) {
      online.classList.toggle("is-online", Boolean(profile.online));
      online.lastChild.textContent = profile.online ? " Online now" : " Offline";
      online.setAttribute("aria-label", profile.online ? "Online in the last 15 minutes" : "Not online in the last 15 minutes");
    }

    renderFeed($("#profileRecentReviews"), profile.recent_reviews, "review");
    renderFeed($("#profileRecentChat"), profile.recent_chat, "chat");

    const own = Boolean(
      state.me
      && state.me.username
      && String(state.me.username).toLowerCase() === String(profile.username).toLowerCase()
    );
    const edit = $("#editProfile");
    const signIn = $("#profileSignIn");
    if (edit) edit.hidden = !own;
    if (signIn) signIn.hidden = Boolean(state.session);
    if (own) populateEditor(state.me || profile);
  }

  function populateEditor(profile) {
    const display = $("#profileDisplayName");
    const username = $("#profileUsername");
    const bio = $("#profileBio");
    if (display) display.value = profile.display_name || profile.username || "";
    if (username) {
      username.value = profile.username || "";
      const canChange = profile.can_change_username !== false;
      username.disabled = !canChange;
      username.title = canChange ? "" : "Username can be changed once every 30 days.";
    }
    if (bio) bio.value = profile.bio || "";
    const count = $("#profileBioCount");
    if (count && bio) count.textContent = String(bio.value.length);
  }

  function openEditor(opener) {
    if (!state.me) {
      EC.showToast("Sign in to edit your profile.", 4200);
      return;
    }
    const dialog = $("#editProfileDialog");
    if (!dialog) return;
    populateEditor(state.me);
    setStatus("");
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    const display = $("#profileDisplayName");
    if (display) window.setTimeout(() => display.focus({ preventScroll: true }), 60);
  }

  function closeEditor() {
    const dialog = $("#editProfileDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  async function fetchProfile(username) {
    return EC.rpc("community_get_profile", { p_username: username }, { auth: false });
  }

  async function refreshFromServer(username) {
    const profile = await fetchProfile(username);
    if (profile) renderProfile(profile);
    return profile;
  }

  async function saveProfile() {
    if (state.saving || !state.me) return;
    const form = $("#profileForm");
    const display = $("#profileDisplayName");
    const usernameInput = $("#profileUsername");
    const bio = $("#profileBio");
    const save = $("#profileSave");
    if (!form || !display || !usernameInput || !bio) return;

    const displayName = display.value.trim();
    const username = usernameInput.value.trim();
    const bioValue = bio.value.trim();
    if (displayName.length < 1) {
      setStatus("Display name cannot be empty.", "error");
      display.focus();
      return;
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setStatus("Username must be 3–20 characters using letters, numbers or underscores.", "error");
      usernameInput.focus();
      return;
    }
    if (!form.reportValidity()) {
      setStatus("Check the highlighted fields and try again.", "error");
      return;
    }

    state.saving = true;
    setBusy(save, true, "Saving…");
    setStatus("");
    try {
      let next = state.me;
      const profileChanged = displayName !== (state.me.display_name || "")
        || bioValue !== (state.me.bio || "");
      const usernameChanged = username.toLowerCase() !== String(state.me.username || "").toLowerCase();

      if (profileChanged) {
        next = await EC.rpc("community_update_profile", {
          p_display_name: displayName,
          p_bio: bioValue
        }, { session: state.session });
      }
      if (usernameChanged) {
        next = await EC.rpc("community_change_username", {
          p_username: username
        }, { session: state.session });
      }

      state.me = next || await EC.rpc("community_get_my_profile", {}, { session: state.session });
      state.username = state.me.username;
      closeEditor();
      const url = new URL(window.location.href);
      url.searchParams.set("u", state.me.username);
      history.replaceState(null, "", `${url.pathname}${url.search}`);
      await refreshFromServer(state.me.username);
      EC.showToast("Profile updated. Your public card is live.", 5200);
    } catch (error) {
      if (error.status === 401) {
        EC.clearSession();
        state.session = null;
        state.user = null;
        state.me = null;
        setStatus("Your session expired. Sign in again to edit your profile.", "error");
      } else {
        setStatus(error.message || "The profile could not be saved.", "error");
      }
    } finally {
      state.saving = false;
      setBusy(save, false);
    }
  }

  function initReveals() {
    const items = $$(".reveal");
    if (!items.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible", "is-settled"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    items.forEach((item) => observer.observe(item));
  }

  function initDialog() {
    const dialog = $("#editProfileDialog");
    const close = $("#editProfileClose");
    const cancel = $("#profileCancel");
    const form = $("#profileForm");
    const bio = $("#profileBio");
    const count = $("#profileBioCount");
    if (!dialog) return;

    if (close) close.addEventListener("click", closeEditor);
    if (cancel) cancel.addEventListener("click", closeEditor);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeEditor();
    });
    if (bio && count) {
      const update = () => { count.textContent = String(bio.value.length); };
      bio.addEventListener("input", update);
      update();
    }
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveProfile();
      });
    }
    const edit = $("#editProfile");
    if (edit) edit.addEventListener("click", () => openEditor(edit));
  }

  async function boot() {
    EC.initTheme();
    initReveals();
    initDialog();
    await EC.trackVisit();

    if (!EC.ready) {
      showError("The community backend is not connected in this build.");
      return;
    }

    try {
      state.session = await EC.getValidSession();
      if (state.session) {
        try {
          state.user = await EC.getUser(state.session);
          state.me = await EC.rpc("community_get_my_profile", {}, { session: state.session });
          EC.rpc("community_heartbeat", {}, { session: state.session }).catch(() => {});
        } catch (error) {
          if (error.status === 401) {
            EC.clearSession();
            state.session = null;
            state.me = null;
          }
        }
      }
    } catch (error) {
      state.session = null;
    }

    const params = new URLSearchParams(window.location.search);
    let username = String(params.get("u") || "").trim();
    if (!username && state.me && state.me.username) username = state.me.username;
    if (!username) {
      showError(state.session
        ? "Your public profile is still being created. Return to the community and try again."
        : "Choose a profile from the community, or sign in to open your own.");
      return;
    }

    try {
      const profile = await fetchProfile(username);
      if (!profile) {
        showError(`No public profile exists for @${username}.`);
        return;
      }
      renderProfile(profile);
    } catch (error) {
      showError(error.message || "The public profile could not be loaded.");
    }
  }

  boot().catch((error) => {
    showError(error.message || "The public profile could not be loaded.");
  });
})();
