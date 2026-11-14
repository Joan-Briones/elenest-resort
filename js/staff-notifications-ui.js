(function () {
  var activeEmail = "";
  var activeRole = "";
  var panelOpen = false;
  var selectedId = null;
  var mounted = false;

  function api() {
    return window.ElenestNotifications || null;
  }

  function hasSwal() {
    return typeof Swal !== "undefined" && typeof Swal.fire === "function";
  }

  function confirmNotifAction(options) {
    options = options || {};
    var text = options.text || "Are you sure?";
    if (!hasSwal()) return Promise.resolve(window.confirm(text));
    return Swal.fire({
      icon: options.icon || "question",
      title: options.title || "Please confirm",
      text: text,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: options.confirmText || "OK",
      cancelButtonText: options.cancelText || "Cancel",
      confirmButtonColor: options.confirmColor || "#D982A5",
      cancelButtonColor: "#6b7280",
      reverseButtons: true
    }).then(function (result) {
      return !!(result && result.isConfirmed);
    });
  }

  function infoNotif(title, text) {
    if (!hasSwal()) {
      window.alert(text || title);
      return;
    }
    Swal.fire({
      icon: "info",
      title: title,
      text: text || "",
      confirmButtonText: "OK",
      confirmButtonColor: "#D982A5"
    });
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

  function fmtRelative(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 45) return "Just now";
    var min = Math.round(sec / 60);
    if (min < 60) return min + "m ago";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + "h ago";
    var day = Math.round(hr / 24);
    if (day < 7) return day + "d ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function placePanel(bell) {
    var panel = getPanel();
    if (!panel || panel.hidden) return;
    if (!bell) bell = document.querySelector(".staff-notif-bell");
    if (!bell) return;
    var gap = 8;
    var margin = 12;
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = window.innerHeight;
    var rect = bell.getBoundingClientRect();
    var sidebar = bell.closest ? bell.closest("header.staff-sidebar") : null;
    var sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
    var docked = !!(
      sidebarRect &&
      sidebarRect.width > 0 &&
      sidebarRect.width <= 420 &&
      sidebarRect.height >= vh * 0.72
    );
    var width = Math.min(300, vw - margin * 2);
    panel.style.width = width + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    var spaceBelow = vh - rect.bottom - gap - margin;
    var spaceAbove = rect.top - gap - margin;
    var openBelow = docked ? false : rect.top < vh * 0.55;
    if (!openBelow && spaceAbove < 150 && spaceBelow > spaceAbove) openBelow = true;
    if (openBelow && spaceBelow < 150 && spaceAbove > spaceBelow) openBelow = false;
    var room = openBelow ? spaceBelow : spaceAbove;
    var available = Math.min(300, Math.max(150, room));
    panel.style.maxHeight = available + "px";

    var list = panel.querySelector(".customer-notif-panel__list");
    var chrome = 0;
    var accent = panel.querySelector(".customer-notif-panel__accent");
    var head = panel.querySelector(".customer-notif-panel__head");
    var bar = panel.querySelector(".customer-notif-panel__toolbar");
    if (accent) chrome += accent.offsetHeight;
    if (head) chrome += head.offsetHeight;
    if (bar) chrome += bar.offsetHeight;
    if (list) list.style.maxHeight = Math.max(96, available - chrome) + "px";

    var panelH = panel.offsetHeight;
    var top = openBelow ? rect.bottom + gap : rect.top - gap - panelH;
    if (top < margin) top = margin;
    if (top + panelH > vh - margin) top = Math.max(margin, vh - margin - panelH);

    var left = docked ? sidebarRect.right + 10 : rect.left;
    if (left + width > vw - margin) left = docked ? sidebarRect.right - width : rect.right - width;
    if (left < margin) left = margin;
    if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);

    panel.style.top = Math.round(top) + "px";
    panel.style.left = Math.round(left) + "px";
    panel.classList.toggle("is-below", !!openBelow);
    panel.classList.toggle("is-above", !openBelow);
  }

  function updatePanelCount(list) {
    var panel = getPanel();
    if (!panel) return;
    var countEl = panel.querySelector(".customer-notif-panel__count");
    if (!countEl) return;
    var unread = 0;
    (list || []).forEach(function (n) {
      if (n && !n.read) unread += 1;
    });
    if (unread > 0) {
      countEl.hidden = false;
      countEl.textContent = (unread > 99 ? "99+" : String(unread)) + " new";
    } else {
      countEl.hidden = true;
      countEl.textContent = "";
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
    updatePanelCount(list);
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "customer-notif-empty";
      empty.textContent = "No notifications yet.";
      host.appendChild(empty);
      if (panelOpen) placePanel();
      return;
    }
    list.forEach(function (n) {
      if (!n) return;
      var item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "listitem");
      item.className =
        "customer-notif-item " + (n.read ? "customer-notif-item--read" : "customer-notif-item--unread");
      var fullWhen = fmtWhen(n.createdAt);
      if (fullWhen) item.title = fullWhen;

      var status = document.createElement("span");
      status.className = "customer-notif-item__status";
      status.setAttribute("aria-hidden", "true");

      var body = document.createElement("span");
      body.className = "customer-notif-item__body";

      var title = document.createElement("strong");
      title.className = "customer-notif-item__title";
      title.textContent = n.title || "Notification";

      var raw = n.message || "";
      var msg = document.createElement("span");
      msg.className = "customer-notif-item__msg";
      msg.textContent = raw.length > 140 ? raw.slice(0, 140) + "…" : raw;

      var foot = document.createElement("span");
      foot.className = "customer-notif-item__foot";
      var type = document.createElement("span");
      type.className = "customer-notif-item__type";
      type.textContent = typeLabel(n);
      type.title = type.textContent;
      var time = document.createElement("time");
      time.className = "customer-notif-item__time";
      time.dateTime = n.createdAt || "";
      time.textContent = fmtRelative(n.createdAt) || fullWhen;
      if (fullWhen) time.title = fullWhen;
      foot.appendChild(type);
      foot.appendChild(time);

      body.appendChild(title);
      if (raw) body.appendChild(msg);
      body.appendChild(foot);
      item.appendChild(status);
      item.appendChild(body);
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        openDetail(n.id);
      });
      host.appendChild(item);
    });
    if (panelOpen) placePanel();
  }

  function openPanel(bell) {
    var panel = getPanel();
    if (!panel || !bell) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    bell.setAttribute("aria-expanded", "true");
    panelOpen = true;
    renderPanelList();
    placePanel(bell);
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
      '<div class="customer-notif-panel__accent" aria-hidden="true"></div>' +
      '<div class="customer-notif-panel__head">' +
      '<div class="customer-notif-panel__heading">' +
      '<h3 class="customer-notif-panel__title">Notifications</h3>' +
      '<span class="customer-notif-panel__count" hidden></span>' +
      "</div>" +
      '<button type="button" class="customer-notif-panel__close" aria-label="Close notifications" title="Close">\u00d7</button>' +
      "</div>" +
      '<div class="customer-notif-panel__toolbar customer-notif-panel__actions">' +
      '<button type="button" class="customer-notif-panel__mark-all">Mark all read</button>' +
      '<button type="button" class="customer-notif-panel__clear-all">Clear all</button>' +
      "</div>" +
      '<div class="customer-notif-panel__list" role="list"></div>';
    document.body.appendChild(panel);

    var closeBtn = panel.querySelector(".customer-notif-panel__close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        closePanel();
      });
    }

    var markAll = panel.querySelector(".customer-notif-panel__mark-all");
    if (markAll) {
      markAll.addEventListener("click", function (e) {
        e.stopPropagation();
        var N = api();
        if (!N || !activeEmail) return;
        var list = listInbox();
        if (!list.length) {
          infoNotif("No notifications", "There are no notifications to mark as read.");
          return;
        }
        if (!unreadCount()) {
          infoNotif("Already read", "Every notification is already marked as read.");
          return;
        }
        confirmNotifAction({
          title: "Mark all as read?",
          text: "Every notification will be marked as read.",
          confirmText: "Mark all read"
        }).then(function (ok) {
          if (!ok) return;
          N.markAllAsRead(activeEmail);
          renderPanelList();
          updateBadge();
        });
      });
    }
    var clearAll = panel.querySelector(".customer-notif-panel__clear-all");
    if (clearAll) {
      clearAll.addEventListener("click", function (e) {
        e.stopPropagation();
        var N = api();
        if (!N || !activeEmail) return;
        var list = listInbox();
        if (!list.length) {
          infoNotif("No notifications", "There are no notifications to clear.");
          return;
        }
        confirmNotifAction({
          icon: "warning",
          title: "Clear all notifications?",
          text: "This removes every notification and cannot be undone.",
          confirmText: "Clear all",
          confirmColor: "#b91c1c"
        }).then(function (ok) {
          if (!ok) return;
          listInbox().forEach(function (n) {
            if (n && n.id) N.clearForUser(activeEmail, n.id);
          });
          renderPanelList();
          updateBadge();
        });
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
    bell.setAttribute("aria-haspopup", "dialog");
    bell.setAttribute("aria-controls", "staffNotifPanel");
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

  window.addEventListener("resize", function () {
    if (panelOpen) placePanel(document.querySelector(".staff-notif-bell"));
  });

  document.addEventListener(
    "scroll",
    function (e) {
      if (!panelOpen) return;
      var panel = getPanel();
      if (panel && e.target && e.target.nodeType === 1 && panel.contains(e.target)) return;
      placePanel(document.querySelector(".staff-notif-bell"));
    },
    true
  );

  document.addEventListener("click", function (e) {
    if (!panelOpen) return;
    var panel = getPanel();
    var bell = document.querySelector(".staff-notif-bell");
    if (!panel || !bell) return;
    if (e.target.closest && e.target.closest(".swal2-container")) return;
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
    if (document.querySelector(".swal2-container")) return;
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
