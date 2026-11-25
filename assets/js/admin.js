/** PROJECT EXTREME++ — owner/admin moderation console */
(() => {
  "use strict";

  const EC = window.ExtremeCommunity;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    session: null,
    user: null,
    me: null,
    role: "",
    activeTab: "overview",
    ownerDays: 30,
    heartbeatTimer: 0,
    loading: {}
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

  function qs(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    return query.toString();
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function setStatus(message, tone = "info") {
    const status = $("#settingsStatus");
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

  async function rpc(name, args = {}) {
    return EC.rpc(name, args, { session: state.session });
  }

  function table(name, query = "", options = {}) {
    return EC.table(name, query, { session: state.session, ...options });
  }

  function handleError(error, fallback) {
    if (error && error.status === 401) {
      EC.clearSession();
      state.session = null;
      state.user = null;
      state.me = null;
      showDenied("Session expired.", "Sign in again with an owner or admin account to continue.");
      return;
    }
    EC.showToast((error && error.message) || fallback || "The request failed.", 6200);
  }

  function showDenied(title, message) {
    const loading = $("#adminLoading");
    const denied = $("#adminDenied");
    const app = $("#adminApp");
    if (loading) loading.hidden = true;
    if (app) app.hidden = true;
    if (denied) denied.hidden = false;
    const titleNode = $("#adminDeniedTitle");
    const textNode = $("#adminDeniedText");
    if (titleNode) titleNode.textContent = title || "Staff access required.";
    if (textNode) textNode.textContent = message || "Sign in with an owner or admin account to open the moderation console.";
    const role = $("#adminRole");
    if (role) role.hidden = true;
    const user = $("#adminUser");
    if (user) user.textContent = state.me && state.me.username ? `@${state.me.username}` : "Signed out";
    const signOut = $("#adminSignOut");
    if (signOut) signOut.hidden = !state.session;
  }

  function setupRoleVisibility() {
    const owner = state.role === "owner";
    const ownerPanel = $("#ownerAnalytics");
    if (ownerPanel) ownerPanel.hidden = !owner;
    const teamTab = $('[data-admin-tab="team"]');
    const settingsTab = $('[data-admin-tab="settings"]');
    if (teamTab) teamTab.hidden = !owner;
    if (settingsTab) settingsTab.hidden = !owner;
    if (owner) return;
    if (state.activeTab === "team" || state.activeTab === "settings") switchTab("overview");
  }

  function showApp() {
    const loading = $("#adminLoading");
    const denied = $("#adminDenied");
    const app = $("#adminApp");
    if (loading) loading.hidden = true;
    if (denied) denied.hidden = true;
    if (app) app.hidden = false;

    const role = $("#adminRole");
    if (role) {
      role.hidden = false;
      role.textContent = state.role;
    }
    const user = $("#adminUser");
    if (user) user.textContent = state.me && state.me.username ? `@${state.me.username}` : (state.user && state.user.email ? state.user.email : "Staff");
    const identity = $("#adminIdentity");
    if (identity) identity.textContent = state.me && state.me.username ? `@${state.me.username}` : "staff";
    const signOut = $("#adminSignOut");
    if (signOut) signOut.hidden = false;

    setupRoleVisibility();
    $$(".reveal", app).forEach((node) => node.classList.add("is-visible", "is-settled"));
  }

  function updateStats(data) {
    if (!data || typeof data !== "object") return;
    [
      "open_reports", "active_bans", "open_bugs", "members", "online",
      "visits", "logins", "reviews", "chat"
    ].forEach((key) => {
      const value = Number(data[key]) || 0;
      $$(`[data-admin-stat="${key}"]`).forEach((node) => {
        node.textContent = EC.formatNumber(value);
      });
    });
    if (data.role && ["owner", "admin"].includes(String(data.role))) {
      state.role = String(data.role);
      setupRoleVisibility();
      const role = $("#adminRole");
      if (role) role.textContent = state.role;
    }
  }

  function renderEmpty(container, message) {
    if (!container) return;
    container.replaceChildren(create("p", "admin-muted", message));
  }

  function renderChart(days) {
    const chart = $("#dailyChart");
    if (!chart) return;
    chart.replaceChildren();
    const list = Array.isArray(days) ? days : [];
    if (!list.length) {
      chart.appendChild(create("p", "admin-muted", "No activity recorded in this window."));
      return;
    }

    const values = list.flatMap((day) => [
      Number(day.visits) || 0,
      Number(day.logins) || 0,
      Number(day.reviews) || 0,
      Number(day.chat) || 0
    ]);
    const max = Math.max(1, ...values);
    const compactLabels = list.length > 14;

    list.forEach((day) => {
      const date = String(day.date || "");
      const wrap = create("div", "admin-chart-day");
      wrap.title = `${EC.formatDate(date)} · visits ${Number(day.visits) || 0}, sign-ins ${Number(day.logins) || 0}, reviews ${Number(day.reviews) || 0}, chat ${Number(day.chat) || 0}`;

      const bars = create("div", "admin-chart-bars");
      [
        ["visits", "admin-chart-bar--visits"],
        ["logins", "admin-chart-bar--logins"],
        ["reviews", "admin-chart-bar--reviews"],
        ["chat", "admin-chart-bar--chat"]
      ].forEach(([key, className]) => {
        const value = Number(day[key]) || 0;
        const bar = create("span", `admin-chart-bar ${className}`);
        bar.style.height = `${Math.max(1, Math.round((value / max) * 100))}%`;
        bar.title = `${key}: ${value}`;
        bars.appendChild(bar);
      });
      wrap.appendChild(bars);
      wrap.appendChild(create(
        "small",
        "",
        compactLabels
          ? EC.formatDate(date, { day: "2-digit" })
          : EC.formatDate(date, { day: "2-digit", month: "short" })
      ));
      chart.appendChild(wrap);
    });
  }

  function renderRanked(container, items, labelFn) {
    if (!container) return;
    container.replaceChildren();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      container.appendChild(create("p", "admin-muted", "No data in this window."));
      return;
    }
    list.forEach((item) => {
      const row = create("div", "admin-row");
      const main = create("div", "admin-row-main");
      main.appendChild(create("strong", "", labelFn(item)));
      row.appendChild(main);
      row.appendChild(create("span", "admin-row-value", EC.formatNumber(item.count || 0)));
      container.appendChild(row);
    });
  }

  function renderRecentMembers(items) {
    const container = $("#recentMembers");
    if (!container) return;
    container.replaceChildren();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      container.appendChild(create("p", "admin-muted", "No members yet."));
      return;
    }
    list.forEach((member) => {
      const row = create("div", "admin-row");
      const main = create("div", "admin-row-main");
      main.appendChild(create("strong", "", member.display_name || member.username || "Rider"));
      main.appendChild(create(
        "small",
        "",
        `@${member.username || "rider"} · ${EC.providerLabel(member.provider)} · ${EC.formatDate(member.joined_at)}`
      ));
      row.appendChild(main);
      container.appendChild(row);
    });
  }

  function renderModeration(moderation) {
    const container = $("#ownerModeration");
    if (!container || !moderation) return;
    container.replaceChildren();
    [
      ["open_reports", "Open reports"],
      ["active_bans", "Active bans"],
      ["open_bugs", "Open bugs"],
      ["audit_events", "Audit events · 30d"]
    ].forEach(([key, label]) => {
      const cell = create("div");
      cell.appendChild(create("span", "", EC.formatNumber(moderation[key] || 0)));
      cell.appendChild(create("small", "", label));
      container.appendChild(cell);
    });
  }

  async function loadOwnerStats() {
    if (state.role !== "owner") return;
    try {
      const stats = await rpc("community_owner_stats", { p_days: state.ownerDays });
      renderChart(stats && stats.daily);
      renderRanked($("#providerList"), stats && stats.providers, (item) => EC.providerLabel(item.provider));
      renderRanked($("#topPaths"), stats && stats.top_paths, (item) => String(item.path || "/"));
      renderRecentMembers(stats && stats.recent_members);
      renderModeration(stats && stats.moderation);
    } catch (error) {
      handleError(error, "Owner analytics could not be loaded.");
    }
  }

  async function loadOverview() {
    if (state.loading.overview) return;
    state.loading.overview = true;
    try {
      const data = await rpc("community_admin_overview");
      updateStats(data);
      if (state.role === "owner") await loadOwnerStats();
    } catch (error) {
      handleError(error, "The community overview could not be loaded.");
    } finally {
      state.loading.overview = false;
    }
  }

  async function loadProfileMap(ids) {
    const unique = [...new Set((ids || []).filter(isUuid))];
    if (!unique.length) return new Map();
    try {
      const rows = await table("community_profiles", qs({
        select: "user_id,username,display_name,provider",
        user_id: `in.(${unique.join(",")})`,
        limit: "100"
      }));
      return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.user_id), row]));
    } catch (error) {
      return new Map();
    }
  }

  function profileLabel(map, userId, fallback) {
    const profile = map && map.get(String(userId || ""));
    if (profile && profile.username) return `@${profile.username}`;
    if (profile && profile.display_name) return profile.display_name;
    return fallback || "unknown";
  }

  async function resolveReport(reportId, status, button) {
    if (!isUuid(reportId)) return;
    setBusy(button, true, "Saving…");
    try {
      await table("community_reports", qs({ id: `eq.${reportId}` }), {
        method: "PATCH",
        body: { status },
        headers: { Prefer: "return=minimal" }
      });
      EC.showToast(status === "resolved" ? "Report resolved." : "Report dismissed.", 4200);
      await loadReports();
      await loadOverview();
    } catch (error) {
      handleError(error, "The report could not be updated.");
    } finally {
      setBusy(button, false);
    }
  }

  async function removeContent(type, id) {
    if (!["review", "chat"].includes(type) || !isUuid(id)) {
      throw new Error("Invalid content target.");
    }
    const tableName = type === "review" ? "reviews" : "chat_messages";
    await table(tableName, qs({ id: `eq.${id}` }), {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }

  async function deleteReportContent(report, button) {
    if (!report || !isUuid(report.target_id)) return;
    const typeLabel = report.target_type === "review" ? "review" : "chat message";
    if (!window.confirm(`Delete this ${typeLabel}? This cannot be undone.`)) return;
    setBusy(button, true, "Deleting…");
    try {
      await removeContent(report.target_type, report.target_id);
      await table("community_reports", qs({ id: `eq.${report.id}` }), {
        method: "PATCH",
        body: { status: "resolved" },
        headers: { Prefer: "return=minimal" }
      });
      EC.showToast(`The ${typeLabel} was deleted and the report resolved.`, 5200);
      await loadReports();
      await loadContent();
      await loadOverview();
    } catch (error) {
      handleError(error, `The ${typeLabel} could not be deleted.`);
    } finally {
      setBusy(button, false);
    }
  }

  function renderReports(rows) {
    const list = $("#reportsList");
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      renderEmpty(list, "No open reports. The queue is clear.");
      return;
    }

    rows.forEach((report) => {
      const item = create("article", "admin-item");
      const head = create("div", "admin-item-head");
      head.appendChild(create(
        "strong",
        "",
        `${report.target_type === "review" ? "Review" : "Chat message"} by ${report.target_author || "Rider"}`
      ));
      head.appendChild(create("span", "admin-badge admin-badge--open", "Open"));
      item.appendChild(head);

      const meta = create("div", "admin-item-meta");
      meta.appendChild(create("span", "", `Reported by ${report.reporter_name || "Rider"}`));
      meta.appendChild(create("time", "", EC.formatDateTime(report.created_at)));
      item.appendChild(meta);
      item.appendChild(create("p", "", `Reason: ${report.reason || "No reason provided."}`));
      if (report.target_excerpt) {
        item.appendChild(create("p", "", `“${report.target_excerpt}”`));
      }

      const actions = create("div", "admin-item-actions");
      const resolve = create("button", "button button--ghost", "Resolve");
      resolve.type = "button";
      resolve.addEventListener("click", () => resolveReport(report.id, "resolved", resolve));
      actions.appendChild(resolve);

      const dismiss = create("button", "button button--ghost", "Dismiss");
      dismiss.type = "button";
      dismiss.addEventListener("click", () => resolveReport(report.id, "dismissed", dismiss));
      actions.appendChild(dismiss);

      const remove = create("button", "button button--danger", "Delete content");
      remove.type = "button";
      remove.addEventListener("click", () => deleteReportContent(report, remove));
      actions.appendChild(remove);

      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  async function loadReports() {
    if (state.loading.reports) return;
    state.loading.reports = true;
    try {
      const rows = await table("community_reports", qs({
        select: "*",
        status: "eq.open",
        order: "created_at.desc",
        limit: "50"
      }));
      renderReports(Array.isArray(rows) ? rows : []);
    } catch (error) {
      handleError(error, "Reports could not be loaded.");
      renderEmpty($("#reportsList"), "Reports could not be loaded.");
    } finally {
      state.loading.reports = false;
    }
  }

  function contentItem({ title, meta, body, extra, onDelete }) {
    const item = create("article", "admin-item");
    const head = create("div", "admin-item-head");
    head.appendChild(create("strong", "", title));
    item.appendChild(head);
    const metaNode = create("div", "admin-item-meta");
    meta.forEach((part) => metaNode.appendChild(create("span", "", part)));
    item.appendChild(metaNode);
    if (body) item.appendChild(create("p", "", body));
    if (extra) item.appendChild(extra);

    const actions = create("div", "admin-item-actions");
    const remove = create("button", "button button--danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => onDelete(remove));
    actions.appendChild(remove);
    item.appendChild(actions);
    return item;
  }

  async function deletePublishedContent(type, id, button) {
    const label = type === "review" ? "review" : "chat message";
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setBusy(button, true, "Deleting…");
    try {
      await removeContent(type, id);
      EC.showToast(`The ${label} was deleted.`, 4600);
      await loadContent();
      await loadOverview();
    } catch (error) {
      handleError(error, `The ${label} could not be deleted.`);
    } finally {
      setBusy(button, false);
    }
  }

  async function loadContent() {
    if (state.loading.content) return;
    state.loading.content = true;
    const reviewsList = $("#contentReviews");
    const chatList = $("#contentChat");
    try {
      const [reviews, chat] = await Promise.all([
        table("reviews", qs({
          select: "id,user_id,created_at,author_name,author_username,rating,body,rom,root_flavor,build",
          order: "created_at.desc",
          limit: "25"
        })),
        table("chat_messages", qs({
          select: "id,user_id,created_at,author_name,author_username,body",
          order: "created_at.desc",
          limit: "25"
        }))
      ]);

      if (reviewsList) {
        reviewsList.replaceChildren();
        if (!reviews.length) renderEmpty(reviewsList, "No reviews published yet.");
        reviews.forEach((review) => {
          reviewsList.appendChild(contentItem({
            title: `${review.author_name || review.author_username || "Rider"} · ${review.rating || "—"}/5`,
            meta: [
              review.author_username ? `@${review.author_username}` : "no username",
              review.rom || "ROM unknown",
              review.build || "build unknown",
              EC.formatDateTime(review.created_at)
            ],
            body: String(review.body || ""),
            onDelete: (button) => deletePublishedContent("review", review.id, button)
          }));
        });
      }

      if (chatList) {
        chatList.replaceChildren();
        if (!chat.length) renderEmpty(chatList, "No chat messages yet.");
        chat.forEach((message) => {
          chatList.appendChild(contentItem({
            title: message.author_name || message.author_username || "Rider",
            meta: [
              message.author_username ? `@${message.author_username}` : "no username",
              EC.formatDateTime(message.created_at)
            ],
            body: String(message.body || ""),
            onDelete: (button) => deletePublishedContent("chat", message.id, button)
          }));
        });
      }
    } catch (error) {
      handleError(error, "Published content could not be loaded.");
      renderEmpty(reviewsList, "Content could not be loaded.");
      renderEmpty(chatList, "Content could not be loaded.");
    } finally {
      state.loading.content = false;
    }
  }

  function banStatus(ban) {
    if (!ban.active) return { label: "Lifted", className: "admin-badge--resolved", active: false };
    const expires = ban.expires_at ? new Date(ban.expires_at).getTime() : 0;
    if (expires && expires <= Date.now()) return { label: "Expired", className: "admin-badge--expired", active: false };
    return { label: "Active", className: "admin-badge--active", active: true };
  }

  async function loadBans() {
    if (state.loading.bans) return;
    state.loading.bans = true;
    try {
      const rows = await table("community_bans", qs({
        select: "*",
        order: "created_at.desc",
        limit: "100"
      }));
      const profiles = await loadProfileMap((rows || []).map((row) => row.user_id));
      const list = $("#bansList");
      if (!list) return;
      list.replaceChildren();
      if (!rows.length) {
        renderEmpty(list, "No bans have been issued.");
        return;
      }
      rows.forEach((ban) => {
        const status = banStatus(ban);
        const item = create("article", "admin-item");
        const head = create("div", "admin-item-head");
        head.appendChild(create("strong", "", profileLabel(profiles, ban.user_id, "Unknown member")));
        head.appendChild(create("span", `admin-badge ${status.className}`, status.label));
        item.appendChild(head);

        const meta = create("div", "admin-item-meta");
        meta.appendChild(create("span", "", `Reason: ${ban.reason || "No reason"}`));
        meta.appendChild(create("span", "", ban.expires_at ? `Expires ${EC.formatDateTime(ban.expires_at)}` : "Permanent"));
        meta.appendChild(create("span", "", `Issued ${EC.formatDateTime(ban.created_at)}`));
        item.appendChild(meta);

        if (ban.active) {
          const actions = create("div", "admin-item-actions");
          const unban = create("button", "button button--ghost", "Lift ban");
          unban.type = "button";
          unban.addEventListener("click", async () => {
            setBusy(unban, true, "Lifting…");
            try {
              await rpc("community_unban_user", { p_user_id: ban.user_id });
              EC.showToast("Posting ban lifted.", 4200);
              await loadBans();
              await loadOverview();
            } catch (error) {
              handleError(error, "The ban could not be lifted.");
            } finally {
              setBusy(unban, false);
            }
          });
          actions.appendChild(unban);
          item.appendChild(actions);
        }

        list.appendChild(item);
      });
    } catch (error) {
      handleError(error, "Bans could not be loaded.");
      renderEmpty($("#bansList"), "Bans could not be loaded.");
    } finally {
      state.loading.bans = false;
    }
  }

  async function submitBan() {
    const form = $("#banForm");
    const usernameInput = $("#banUsername");
    const reasonInput = $("#banReason");
    const expiry = $("#banExpiry");
    const submit = $("#banSubmit");
    if (!form || !usernameInput || !reasonInput) return;
    const username = usernameInput.value.trim().replace(/^@/, "");
    const reason = reasonInput.value.trim();
    if (!username) {
      EC.showToast("Enter the username to ban.", 4000);
      usernameInput.focus();
      return;
    }
    if (reason.length < 3) {
      EC.showToast("Give a reason of at least 3 characters.", 4200);
      reasonInput.focus();
      return;
    }

    setBusy(submit, true, "Applying…");
    try {
      const profile = await rpc("community_find_profile", { p_username: username });
      if (!profile || !profile.user_id) {
        throw new Error(`No public profile matches @${username}.`);
      }
      const seconds = Number(expiry && expiry.value) || 0;
      const expiresAt = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
      await rpc("community_ban_user", {
        p_user_id: profile.user_id,
        p_reason: reason,
        p_expires_at: expiresAt
      });
      form.reset();
      EC.showToast(`Posting ban applied to @${profile.username}.`, 5200);
      await loadBans();
      await loadOverview();
    } catch (error) {
      handleError(error, "The posting ban could not be applied.");
    } finally {
      setBusy(submit, false);
    }
  }

  function bugStatusSelect(bug, onChange) {
    const select = document.createElement("select");
    select.className = "admin-status-select";
    select.setAttribute("aria-label", `Status for ${bug.title || "bug report"}`);
    [
      ["open", "Open"],
      ["investigating", "Investigating"],
      ["resolved", "Resolved"],
      ["closed", "Closed"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === bug.status;
      select.appendChild(option);
    });
    select.addEventListener("change", () => onChange(select, select.value));
    return select;
  }

  async function loadBugs() {
    if (state.loading.bugs) return;
    state.loading.bugs = true;
    try {
      const rows = await table("bug_reports", qs({
        select: "*",
        order: "created_at.desc",
        limit: "50"
      }));
      const profiles = await loadProfileMap((rows || []).map((row) => row.user_id));
      const list = $("#bugsList");
      if (!list) return;
      list.replaceChildren();
      if (!rows.length) {
        renderEmpty(list, "No private bug reports yet.");
        return;
      }

      rows.forEach((bug) => {
        const item = create("article", "admin-item");
        const head = create("div", "admin-item-head");
        head.appendChild(create("strong", "", bug.title || "Bug report"));
        head.appendChild(create("span", "admin-badge", bug.status || "open"));
        item.appendChild(head);

        const meta = create("div", "admin-item-meta");
        const profile = profiles.get(String(bug.user_id || ""));
        if (profile && profile.username) meta.appendChild(create("span", "", `@${profile.username}`));
        meta.appendChild(create("span", "", bug.author_name || "Rider"));
        if (bug.author_email) meta.appendChild(create("span", "", bug.author_email));
        meta.appendChild(create("span", "", EC.providerLabel(bug.provider)));
        meta.appendChild(create("span", "", bug.device || "device unknown"));
        meta.appendChild(create("span", "", bug.rom || "ROM unknown"));
        meta.appendChild(create("span", "", bug.root_flavor || "root unknown"));
        meta.appendChild(create("span", "", bug.build || "build unknown"));
        meta.appendChild(create("time", "", EC.formatDateTime(bug.created_at)));
        item.appendChild(meta);

        item.appendChild(create("p", "", String(bug.description || "")));
        if (bug.logs) {
          item.appendChild(create("pre", "", String(bug.logs)));
        }

        const actions = create("div", "admin-item-actions");
        actions.appendChild(bugStatusSelect(bug, async (select, nextStatus) => {
          select.disabled = true;
          try {
            await table("bug_reports", qs({ id: `eq.${bug.id}` }), {
              method: "PATCH",
              body: { status: nextStatus },
              headers: { Prefer: "return=minimal" }
            });
            EC.showToast(`Bug report marked ${nextStatus}.`, 4200);
            await loadOverview();
          } catch (error) {
            select.value = bug.status;
            handleError(error, "The bug status could not be updated.");
          } finally {
            select.disabled = false;
          }
        }));

        if (profile && profile.username && state.user && bug.user_id !== state.user.id) {
          const banAuthor = create("button", "button button--danger", "Ban author");
          banAuthor.type = "button";
          banAuthor.addEventListener("click", () => prefillBan(profile.username));
          actions.appendChild(banAuthor);
        }
        item.appendChild(actions);
        list.appendChild(item);
      });
    } catch (error) {
      handleError(error, "Private bug reports could not be loaded.");
      renderEmpty($("#bugsList"), "Private bug reports could not be loaded.");
    } finally {
      state.loading.bugs = false;
    }
  }

  function prefillBan(username) {
    switchTab("bans");
    const input = $("#banUsername");
    const reason = $("#banReason");
    if (input) input.value = username || "";
    if (reason) reason.focus();
  }

  async function loadTeam() {
    if (state.role !== "owner") return;
    if (state.loading.team) return;
    state.loading.team = true;
    try {
      const rows = await table("community_admins", qs({
        select: "user_id,role,note,created_at,created_by",
        order: "created_at.asc",
        limit: "100"
      }));
      const profiles = await loadProfileMap((rows || []).map((row) => row.user_id));
      const list = $("#teamList");
      if (!list) return;
      list.replaceChildren();
      if (!rows.length) {
        renderEmpty(list, "No staff records found.");
        return;
      }
      rows.forEach((member) => {
        const profile = profiles.get(String(member.user_id || ""));
        const item = create("article", "admin-item");
        const head = create("div", "admin-item-head");
        head.appendChild(create("strong", "", profile ? (profile.display_name || profile.username) : "Staff account"));
        head.appendChild(create(
          "span",
          `admin-badge ${member.role === "owner" ? "admin-badge--owner" : ""}`,
          member.role
        ));
        item.appendChild(head);

        const meta = create("div", "admin-item-meta");
        if (profile && profile.username) meta.appendChild(create("span", "", `@${profile.username}`));
        if (member.note) meta.appendChild(create("span", "", member.note));
        meta.appendChild(create("span", "", `Added ${EC.formatDateTime(member.created_at)}`));
        item.appendChild(meta);

        if (member.role !== "owner" && state.user && member.user_id !== state.user.id) {
          const actions = create("div", "admin-item-actions");
          const remove = create("button", "button button--danger", "Remove admin");
          remove.type = "button";
          remove.addEventListener("click", async () => {
            if (!window.confirm(`Remove admin access from ${profile && profile.username ? `@${profile.username}` : "this account"}?`)) return;
            setBusy(remove, true, "Removing…");
            try {
              await table("community_admins", qs({ user_id: `eq.${member.user_id}` }), {
                method: "DELETE",
                headers: { Prefer: "return=minimal" }
              });
              EC.showToast("Admin access removed.", 4200);
              await loadTeam();
              await loadOverview();
            } catch (error) {
              handleError(error, "Admin access could not be removed.");
            } finally {
              setBusy(remove, false);
            }
          });
          actions.appendChild(remove);
          item.appendChild(actions);
        }

        list.appendChild(item);
      });
    } catch (error) {
      handleError(error, "The staff team could not be loaded.");
      renderEmpty($("#teamList"), "The staff team could not be loaded.");
    } finally {
      state.loading.team = false;
    }
  }

  async function submitTeam() {
    if (state.role !== "owner") {
      EC.showToast("Only the owner can add admins.", 4200);
      return;
    }
    const usernameInput = $("#teamUsername");
    const noteInput = $("#teamNote");
    const submit = $("#teamSubmit");
    if (!usernameInput) return;
    const username = usernameInput.value.trim().replace(/^@/, "");
    if (!username) {
      EC.showToast("Enter a username to promote.", 4200);
      usernameInput.focus();
      return;
    }
    setBusy(submit, true, "Granting…");
    try {
      const profile = await rpc("community_find_profile", { p_username: username });
      if (!profile || !profile.user_id) throw new Error(`No public profile matches @${username}.`);
      await table("community_admins", "", {
        method: "POST",
        body: {
          user_id: profile.user_id,
          role: "admin",
          note: (noteInput && noteInput.value.trim()) || ""
        },
        headers: { Prefer: "return=representation" }
      });
      $("#teamForm").reset();
      EC.showToast(`@${profile.username} is now an admin.`, 5200);
      await loadTeam();
      await loadOverview();
    } catch (error) {
      handleError(error, "Admin access could not be granted.");
    } finally {
      setBusy(submit, false);
    }
  }

  async function loadSettings() {
    if (state.role !== "owner") return;
    if (state.loading.settings) return;
    state.loading.settings = true;
    try {
      const rows = await table("community_settings", qs({
        select: "*",
        id: "eq.1"
      }));
      const settings = Array.isArray(rows) ? rows[0] : null;
      if (!settings) throw new Error("Community settings were not found.");
      const values = {
        "#settingChatSlow": settings.chat_slow_seconds,
        "#settingChatHourly": settings.chat_hourly_limit,
        "#settingReviews": settings.reviews_per_day,
        "#settingBugs": settings.bugs_per_day,
        "#settingReports": settings.reports_per_day
      };
      Object.entries(values).forEach(([selector, value]) => {
        const input = $(selector);
        if (input) input.value = String(value);
      });
      setStatus("");
    } catch (error) {
      handleError(error, "Settings could not be loaded.");
    } finally {
      state.loading.settings = false;
    }
  }

  async function submitSettings() {
    if (state.role !== "owner") return;
    const submit = $("#settingsSubmit");
    const values = {
      chat_slow_seconds: Number($("#settingChatSlow") && $("#settingChatSlow").value),
      chat_hourly_limit: Number($("#settingChatHourly") && $("#settingChatHourly").value),
      reviews_per_day: Number($("#settingReviews") && $("#settingReviews").value),
      bugs_per_day: Number($("#settingBugs") && $("#settingBugs").value),
      reports_per_day: Number($("#settingReports") && $("#settingReports").value)
    };
    if (!Number.isInteger(values.chat_slow_seconds) || values.chat_slow_seconds < 1 || values.chat_slow_seconds > 3600) {
      setStatus("Chat slow mode must be between 1 and 3600 seconds.", "error");
      return;
    }
    if (!Number.isInteger(values.chat_hourly_limit) || values.chat_hourly_limit < 1 || values.chat_hourly_limit > 1000) {
      setStatus("Hourly chat limit must be between 1 and 1000.", "error");
      return;
    }
    if (
      !Number.isInteger(values.reviews_per_day)
      || !Number.isInteger(values.bugs_per_day)
      || !Number.isInteger(values.reports_per_day)
      || values.reviews_per_day < 0 || values.reviews_per_day > 100
      || values.bugs_per_day < 0 || values.bugs_per_day > 100
      || values.reports_per_day < 0 || values.reports_per_day > 100
    ) {
      setStatus("Daily limits must be whole numbers between 0 and 100.", "error");
      return;
    }

    setBusy(submit, true, "Saving…");
    setStatus("");
    try {
      await table("community_settings", qs({ id: "eq.1" }), {
        method: "PATCH",
        body: values,
        headers: { Prefer: "return=minimal" }
      });
      EC.showToast("Community limits saved. Slow mode is live.", 5200);
      await loadSettings();
    } catch (error) {
      handleError(error, "Settings could not be saved.");
    } finally {
      setBusy(submit, false);
    }
  }

  function detailsSummary(details) {
    if (!details || typeof details !== "object") return "";
    const parts = [];
    if (details.reason) parts.push(`Reason: ${details.reason}`);
    if (details.title) parts.push(`Title: ${details.title}`);
    if (details.username) parts.push(`User: @${details.username}`);
    if (details.status) parts.push(`Status: ${details.status}`);
    if (details.role) parts.push(`Role: ${details.role}`);
    if (details.excerpt) parts.push(`“${details.excerpt}”`);
    if (details.expires_at) parts.push(`Expires: ${EC.formatDateTime(details.expires_at)}`);
    if (details.settings && typeof details.settings === "object") {
      parts.push(Object.entries(details.settings).map(([key, value]) => `${key}: ${value}`).join(", "));
    }
    return parts.join(" · ");
  }

  async function loadAudit() {
    if (state.loading.audit) return;
    state.loading.audit = true;
    try {
      const rows = await table("community_moderation_log", qs({
        select: "*",
        order: "created_at.desc",
        limit: "100"
      }));
      const profiles = await loadProfileMap((rows || []).flatMap((row) => [row.actor_id, row.target_user_id]));
      const list = $("#auditList");
      if (!list) return;
      list.replaceChildren();
      if (!rows.length) {
        renderEmpty(list, "No moderation actions recorded yet.");
        return;
      }
      rows.forEach((entry) => {
        const item = create("article", "admin-item");
        const head = create("div", "admin-item-head");
        head.appendChild(create("strong", "", String(entry.action || "action").replace(/_/g, " ")));
        head.appendChild(create("time", "admin-item-meta", EC.formatDateTime(entry.created_at)));
        item.appendChild(head);

        const meta = create("div", "admin-item-meta");
        meta.appendChild(create("span", "", `Actor ${profileLabel(profiles, entry.actor_id, "system")}`));
        if (entry.target_user_id) {
          meta.appendChild(create("span", "", `Target ${profileLabel(profiles, entry.target_user_id, "member")}`));
        } else if (entry.target_table) {
          meta.appendChild(create("span", "", `Target ${entry.target_table}`));
        }
        item.appendChild(meta);

        const summary = detailsSummary(entry.details);
        if (summary) item.appendChild(create("p", "", summary));
        list.appendChild(item);
      });
    } catch (error) {
      handleError(error, "The audit log could not be loaded.");
      renderEmpty($("#auditList"), "The audit log could not be loaded.");
    } finally {
      state.loading.audit = false;
    }
  }

  async function loadTab(tab) {
    if (tab === "overview") return loadOverview();
    if (tab === "reports") return loadReports();
    if (tab === "content") return loadContent();
    if (tab === "bans") return loadBans();
    if (tab === "bugs") return loadBugs();
    if (tab === "team") return loadTeam();
    if (tab === "settings") return loadSettings();
    if (tab === "audit") return loadAudit();
    return undefined;
  }

  function switchTab(tab) {
    const next = String(tab || "overview");
    if ((next === "team" || next === "settings") && state.role !== "owner") return;
    state.activeTab = next;
    $$("[data-admin-tab]").forEach((button) => {
      const active = button.dataset.adminTab === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$("[data-admin-panel]").forEach((panel) => {
      const active = panel.dataset.adminPanel === next;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    loadTab(next);
  }

  async function heartbeat() {
    if (!state.session || document.hidden) return;
    try {
      await rpc("community_heartbeat");
    } catch (error) {
      if (error.status === 401) handleError(error, "Session expired.");
    }
  }

  function startHeartbeat() {
    window.clearInterval(state.heartbeatTimer);
    heartbeat();
    state.heartbeatTimer = window.setInterval(heartbeat, 60000);
  }

  async function signOut() {
    await EC.signOut(state.session);
    window.location.assign("./");
  }

  function initEvents() {
    const signOutButton = $("#adminSignOut");
    if (signOutButton) signOutButton.addEventListener("click", signOut);

    $$("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.adminTab));
    });

    $$("[data-admin-refresh]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.adminRefresh;
        if (target === "overview") loadOverview();
        else loadTab(target);
      });
    });

    const overviewRefresh = $("#refreshOverview");
    if (overviewRefresh) overviewRefresh.addEventListener("click", loadOverview);

    const ownerDays = $("#ownerDays");
    if (ownerDays) {
      ownerDays.addEventListener("change", () => {
        state.ownerDays = Number(ownerDays.value) || 30;
        loadOwnerStats();
      });
    }

    const banForm = $("#banForm");
    if (banForm) {
      banForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitBan();
      });
    }

    const teamForm = $("#teamForm");
    if (teamForm) {
      teamForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitTeam();
      });
    }

    const settingsForm = $("#settingsForm");
    if (settingsForm) {
      settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitSettings();
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      heartbeat();
      if (state.session) loadOverview();
    });
  }

  async function boot() {
    EC.initTheme();
    initEvents();

    if (!EC.ready) {
      showDenied("Community backend not connected.", "Check assets/js/config.js and the Supabase project configuration.");
      return;
    }

    try {
      state.session = await EC.getValidSession();
      if (!state.session) {
        showDenied("Sign in required.", "Sign in with an owner or admin account, then return to this page.");
        return;
      }
      state.user = await EC.getUser(state.session);
      state.role = String(await rpc("community_my_role") || "").toLowerCase();
      if (state.role !== "owner" && state.role !== "admin") {
        showDenied("Staff access required.", "This account is signed in but does not have owner or admin permissions.");
        return;
      }
      state.me = await rpc("community_ensure_profile");
      showApp();
      await rpc("community_track_login", { p_provider: EC.providerLabel(state.me && state.me.provider) });
      await loadOverview();
      startHeartbeat();
    } catch (error) {
      if (error.status === 401) {
        EC.clearSession();
        showDenied("Sign in required.", "Your session expired. Sign in again with a staff account.");
      } else {
        showDenied("Moderation console unavailable.", error.message || "The access check could not be completed.");
      }
    }
  }

  boot().catch((error) => {
    showDenied("Moderation console unavailable.", error.message || "The access check could not be completed.");
  });
})();
