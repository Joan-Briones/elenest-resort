(function () {
  var activeEmail = "";
  var activeRole = "";
  var panelOpen = false;
  var selectedId = null;
  var mounted = false;

  function api() {
    return window.ElenestNotifications || null;
  }

  function listInbox() {
    var N = api();
    if (!N || !activeEmail) return [];
    if (typeof N.listForStaff === "function") return N.listForStaff(activeEmail);
    return N.listForUser ? N.listForUser(activeEmail) : [];
  }

  function unreadCount() {
    var N = api();
    if (!N || !activeEmail) return 0;
    if (typeof N.countUnreadStaff === "function") return N.countUnreadStaff(activeEmail);
    return N.countUnread ? N.countUnread(activeEmail) : 0;
  }

  function typeLabel(n) {
    var N = api();
    if (!N || !N.getTypeLabel) return (n && n.type) || "Notification";
    return N.getTypeLabel(n);
  }

  function bellSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7"/>' +
      '<path d="M13.73 21a2 2 0 01-3.46 0"/>' +
      "</svg>"
    );
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return "";
    }
  }

  function updateBadge(bell) {
    if (!bell) bell = document.querySelector(".staff-notif-bell");
    if (!bell) return;
    var count = unreadCount();
    var badge = bell.querySelector(".customer-notif-badge");
    if (!badge) return;
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? "99+" : String(count);
    } else {
      badge.hidden = true;
      badge.textContent = "";
    }
  }

  function getPanel() {
    return document.getElementById("staffNotifPanel");
  }

  function getDetailOverlay() {
    return document.getElementById("staffNotifDetailOverlay");
  }

  function closeDetail() {
    var overlay = getDetailOverlay();
    if (overlay) overlay.setAttribute("hidden", "");
    selectedId = null;
  }

  function openDetail(id) {
    var N = api();
    var overlay = getDetailOverlay();
    if (!N || !overlay || !activeEmail || !id) return;
    var n = N.getById(activeEmail, id);
    if (!n) return;
    selectedId = id;
    if (!n.read) {
      N.markAsRead(activeEmail, id);
      updateBadge();
      renderPanelList();
    }
    var typeEl = document.getElementById("staffNotifDetailType");
    var titleEl = document.getElementById("staffNotifDetailTitle");
    var timeEl = document.getElementById("staffNotifDetailTime");
    var msgEl = document.getElementById("staffNotifDetailMessage");
    var openBtn = document.getElementById("staffNotifDetailOpen");
    if (typeEl) typeEl.textContent = typeLabel(n);
    if (titleEl) titleEl.textContent = n.title || "Notification";
    if (timeEl) timeEl.textContent = fmtWhen(n.createdAt);
    if (msgEl) msgEl.textContent = n.message || "";
    if (openBtn) {
      if (n.link) {
        openBtn.hidden = false;
        openBtn.setAttribute("data-link", n.link);
      } else {
        openBtn.hidden = true;
        openBtn.removeAttribute("data-link");
      }
    }
    overlay.removeAttribute("hidden");
  }

  function renderPanelList() {
    var host = document.querySelector("#staffNotifPanel .customer-notif-panel__list");
    if (!host) return;
    host.textContent = "";
    var list = listInbox();
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "customer-notif-empty";
      empty.textContent = "No notifications yet.";
      host.appendChild(empty);
      return;
    }
    list.forEach(function (n) {
      if (!n) return;
      var item = document.createElement("button");
      item.type = "button";
      item.className = "customer-notif-item" + (n.read ? "" : " customer-notif-item--unread");
      var type = document.createElement("span");
      type.className = "customer-notif-item__type";
      type.textContent = typeLabel(n);
      var title = document.createElement("strong");
      title.className = "customer-notif-item__title";
      title.textContent = n.title || "Notification";
      var msg = document.createElement("span");
      msg.className = "customer-notif-item__msg";
      msg.textContent =
        (n.message || "").length > 90 ? (n.message || "").slice(0, 90) + "…" : n.message || "";
      var time = document.createElement("span");
      time.className = "customer-notif-item__time";
      time.textContent = fmtWhen(n.createdAt);
      item.appendChild(type);
      item.appendChild(title);
      item.appendChild(msg);
      item.appendChild(time);
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        openDetail(n.id);
      });
      host.appendChild(item);
    });
  }

  function openPanel(bell) {
    var panel = getPanel();
    if (!panel || !bell) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    bell.setAttribute("aria-expanded", "true");
    panelOpen = true;
    renderPanelList();
  }

  function closePanel() {
    var panel = getPanel();
    var bell = document.querySelector(".staff-notif-bell");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
    if (bell) bell.setAttribute("aria-expanded", "false");
    panelOpen = false;
  }

  function ensurePanel() {
    if (document.getElementById("staffNotifPanel")) return;
    var panel = document.createElement("div");
    panel.id = "staffNotifPanel";
    panel.className = "customer-notif-panel staff-notif-panel";
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notifications");
    panel.innerHTML =
      '<div class="customer-notif-panel__head">' +
      '<h3 class="customer-notif-panel__title">Notifications</h3>' +
      '<div class="customer-notif-panel__actions">' +
      '<button type="button" class="customer-notif-panel__mark-all">Mark all read</button>' +
      '<button type="button" class="customer-notif-panel__clear-all">Clear all</button>' +
      "</div></div>" +
      '<div class="customer-notif-panel__list" role="list"></div>';
    document.body.appendChild(panel);

    var markAll = panel.querySelector(".customer-notif-panel__mark-all");
    if (markAll) {
      markAll.addEventListener("click", function (e) {
        e.stopPropagation();
        var N = api();
        if (N && activeEmail) {
          N.markAllAsRead(activeEmail);
          renderPanelList();
          updateBadge();
        }
      });
    }
    var clearAll = panel.querySelector(".customer-notif-panel__clear-all");
    if (clearAll) {
      clearAll.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Clear all notifications?")) return;
        var N = api();
        if (N && activeEmail) {
          listInbox().forEach(function (n) {
            if (n && n.id) N.clearForUser(activeEmail, n.id);
          });
          renderPanelList();
          updateBadge();
        }
      });
    }
  }

  function ensureDetailOverlay() {
    if (document.getElementById("staffNotifDetailOverlay")) return;
    var overlay = document.createElement("div");
    overlay.id = "staffNotifDetailOverlay";
    overlay.className = "admin-settings-overlay customer-notif-detail-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="admin-settings-modal customer-notif-detail-modal" role="dialog" aria-modal="true" aria-labelledby="staffNotifDetailTitle">' +
      '<span id="staffNotifDetailType" class="customer-notif-detail__type"></span>' +
      '<h3 id="staffNotifDetailTitle" class="customer-notif-detail__title"></h3>' +
      '<p id="staffNotifDetailTime" class="customer-notif-detail__time"></p>' +
      '<p id="staffNotifDetailMessage" class="customer-notif-detail__message"></p>' +
      '<div class="admin-settings-modal__actions customer-notif-detail__actions">' +
      '<button type="button" class="btn btn--outline" id="staffNotifDetailUnread">Mark as unread</button>' +
      '<button type="button" class="btn btn--outline" id="staffNotifDetailOpen" hidden>Open</button>' +
      '<button type="button" class="btn btn--outline" id="staffNotifDetailClear">Clear</button>' +
      '<button type="button" class="btn" id="staffNotifDetailClose">Close</button>' +
      "</div></div>";
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeDetail();
    });
    var closeBtn = document.getElementById("staffNotifDetailClose");
    if (closeBtn) closeBtn.addEventListener("click", closeDetail);
    var unreadBtn = document.getElementById("staffNotifDetailUnread");
    if (unreadBtn) {
      unreadBtn.addEventListener("click", function () {
        var N = api();
        if (N && activeEmail && selectedId && typeof N.markAsUnread === "function") {
          N.markAsUnread(activeEmail, selectedId);
          updateBadge();
          renderPanelList();
        }
      });
    }
    var openBtn = document.getElementById("staffNotifDetailOpen");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        var link = openBtn.getAttribute("data-link") || "";
        if (!link) return;
        closeDetail();
        closePanel();
        if (/^https?:\/\//i.test(link)) {
          window.location.href = link;
          return;
        }
        var hash = link.indexOf("#");
        var path = hash >= 0 ? link.slice(0, hash) : link;
        var frag = hash >= 0 ? link.slice(hash) : "";
        var current = (window.location.pathname.split("/").pop() || "").toLowerCase();
        var target = path.split("/").pop().toLowerCase();
        if (!path || current === target) {
          if (frag) window.location.hash = frag;
          return;
        }
        window.location.href = link;
      });
    }
    var clearBtn = document.getElementById("staffNotifDetailClear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var N = api();
        if (N && activeEmail && selectedId) {
          N.clearForUser(activeEmail, selectedId);
          closeDetail();
          renderPanelList();
          updateBadge();
        }
      });
    }
  }

  function createBell(user) {
    activeEmail = user && user.email ? String(user.email).trim().toLowerCase() : "";
    var Auth = window.ElenestAuth;
    activeRole =
      Auth && Auth.normalizeRole
        ? Auth.normalizeRole(user && user.role)
        : String((user && user.role) || "").toLowerCase();
    ensurePanel();
    ensureDetailOverlay();
    var N = api();
    if (N && activeEmail && typeof N.bindStaffInbox === "function") {
      N.bindStaffInbox(activeEmail, activeRole);
    } else if (N && activeEmail && typeof N.processAutomaticForStaff === "function") {
      N.processAutomaticForStaff(activeEmail, activeRole);
    }

    var wrap = document.createElement("div");
    wrap.className = "customer-notif-wrap staff-notif-wrap";
    var bell = document.createElement("button");
    bell.type = "button";
    bell.className = "customer-notif-bell staff-notif-bell";
    bell.setAttribute("aria-label", "Notifications");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-haspopup", "true");
    bell.innerHTML = bellSvg();
    var badge = document.createElement("span");
    badge.className = "customer-notif-badge";
    badge.hidden = true;
    bell.appendChild(badge);
    updateBadge(bell);
    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panelOpen) closePanel();
      else openPanel(bell);
    });
    wrap.appendChild(bell);
    return wrap;
  }

  function mount(user) {
    var host = document.getElementById("staffHeaderRoleItem");
    if (!host || !user || !user.email) return null;
    var existing = host.querySelector(".staff-notif-wrap");
    if (existing) {
      activeEmail = String(user.email).trim().toLowerCase();
      refresh(user.email);
      return existing;
    }
    var wrap = createBell(user);
    host.insertBefore(wrap, host.firstChild);
    host.removeAttribute("hidden");
    mounted = true;
    return wrap;
  }

  function refresh(email) {
    activeEmail = String(email || activeEmail || "").trim().toLowerCase();
    updateBadge();
    if (panelOpen) renderPanelList();
  }

  function boot(user) {
    var Auth = window.ElenestAuth;
    var u = user || (Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null);
    if (!u || !u.email) return;
    var role = Auth && Auth.normalizeRole ? Auth.normalizeRole(u.role) : String(u.role || "");
    if (role !== "admin" && role !== "manager" && role !== "receptionist") return;
    if (!document.getElementById("staffHeaderRoleItem")) return;
    mount(u);
  }

  document.addEventListener("click", function (e) {
    if (!panelOpen) return;
    var panel = getPanel();
    var bell = document.querySelector(".staff-notif-bell");
    if (!panel || !bell) return;
    if (
      panel.contains(e.target) ||
      bell.contains(e.target) ||
      (e.target.closest && e.target.closest(".staff-notif-wrap"))
    ) {
      return;
    }
    closePanel();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var detail = getDetailOverlay();
    if (detail && !detail.hidden) {
      closeDetail();
      return;
    }
    if (panelOpen) closePanel();
  });

  window.addEventListener("storage", function (e) {
    if (e && e.key === "elenest_notifications") refresh(activeEmail);
  });

  window.addEventListener("elenest-notifications-changed", function () {
    updateBadge();
    if (panelOpen) renderPanelList();
  });

  window.addEventListener("elenest-auth-change", function (e) {
    var user = e && e.detail && e.detail.user;
    if (user) boot(user);
  });

  function start() {
    var Auth = window.ElenestAuth;
    if (Auth && Auth.ready && typeof Auth.ready.then === "function") {
      Auth.ready.then(function (user) {
        boot(user);
      });
      return;
    }
    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.ElenestStaffNotifications = {
    createBell: createBell,
    mount: mount,
    refresh: refresh,
    closePanel: closePanel
  };
})();
