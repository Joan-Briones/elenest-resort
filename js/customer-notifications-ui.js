(function () {
  var activeEmail = "";
  var panelOpen = false;
  var selectedId = null;

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
    if (!bell) bell = document.querySelector(".customer-notif-bell");
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
    var width = docked
      ? Math.max(200, Math.round(sidebarRect.width - 16))
      : Math.min(360, vw - margin * 2);
    width = Math.min(width, vw - margin * 2);
    panel.style.width = width + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    var spaceBelow = vh - rect.bottom - gap - margin;
    var spaceAbove = rect.top - gap - margin;
    var openBelow = spaceBelow >= 190 || spaceBelow >= spaceAbove;
    var room = openBelow ? spaceBelow : spaceAbove;
    if (room < 160 && Math.max(spaceBelow, spaceAbove) > room) {
      openBelow = spaceBelow >= spaceAbove;
      room = openBelow ? spaceBelow : spaceAbove;
    }
    var available = Math.min(420, Math.max(140, room));
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

    var left = docked ? sidebarRect.left + 8 : rect.left;
    if (!docked && left + width > vw - margin) left = rect.right - width;
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
    var N = api();
    if (!N || !bell || !activeEmail) return;
    var count = N.countUnread(activeEmail);
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
    return document.getElementById("customerNotifPanel");
  }

  function getDetailOverlay() {
    return document.getElementById("customerNotifDetailOverlay");
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
      var bell = document.querySelector(".customer-notif-bell");
      if (bell) updateBadge(bell);
      renderPanelList();
    }
    var typeEl = document.getElementById("customerNotifDetailType");
    var titleEl = document.getElementById("customerNotifDetailTitle");
    var timeEl = document.getElementById("customerNotifDetailTime");
    var msgEl = document.getElementById("customerNotifDetailMessage");
    if (typeEl) typeEl.textContent = N.getTypeLabel(n.type);
    if (titleEl) titleEl.textContent = n.title || "Notification";
    if (timeEl) timeEl.textContent = fmtWhen(n.createdAt);
    if (msgEl) msgEl.textContent = n.message || "";
    overlay.removeAttribute("hidden");
  }

  function renderPanelList() {
    var host = document.querySelector("#customerNotifPanel .customer-notif-panel__list");
    var N = api();
    if (!host || !N || !activeEmail) return;
    host.textContent = "";
    var list = N.listForUser(activeEmail) || [];
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
      type.textContent = N.getTypeLabel(n.type);
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
    var bell = document.querySelector(".customer-notif-bell");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
    if (bell) bell.setAttribute("aria-expanded", "false");
    panelOpen = false;
  }

  function ensurePanel() {
    if (document.getElementById("customerNotifPanel")) return;
    var panel = document.createElement("div");
    panel.id = "customerNotifPanel";
    panel.className = "customer-notif-panel";
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
        var list = N.listForUser(activeEmail) || [];
        if (!list.length) {
          infoNotif("No notifications", "There are no notifications to mark as read.");
          return;
        }
        if (!list.some(function (n) { return n && !n.read; })) {
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
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
        });
      });
    }
    var clearAll = panel.querySelector(".customer-notif-panel__clear-all");
    if (clearAll) {
      clearAll.addEventListener("click", function (e) {
        e.stopPropagation();
        var N = api();
        if (!N || !activeEmail) return;
        var list = N.listForUser(activeEmail) || [];
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
          N.clearAllForUser(activeEmail);
          renderPanelList();
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
        });
      });
    }
  }

  function ensureDetailOverlay() {
    if (document.getElementById("customerNotifDetailOverlay")) return;
    var overlay = document.createElement("div");
    overlay.id = "customerNotifDetailOverlay";
    overlay.className = "admin-settings-overlay customer-notif-detail-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="admin-settings-modal customer-notif-detail-modal" role="dialog" aria-modal="true" aria-labelledby="customerNotifDetailTitle">' +
      '<span id="customerNotifDetailType" class="customer-notif-detail__type"></span>' +
      '<h3 id="customerNotifDetailTitle" class="customer-notif-detail__title"></h3>' +
      '<p id="customerNotifDetailTime" class="customer-notif-detail__time"></p>' +
      '<p id="customerNotifDetailMessage" class="customer-notif-detail__message"></p>' +
      '<div class="admin-settings-modal__actions customer-notif-detail__actions">' +
      '<button type="button" class="btn btn--outline" id="customerNotifDetailUnread">Mark as unread</button>' +
      '<button type="button" class="btn btn--outline" id="customerNotifDetailClear">Clear</button>' +
      '<button type="button" class="btn" id="customerNotifDetailClose">Close</button>' +
      "</div></div>";
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeDetail();
    });
    var closeBtn = document.getElementById("customerNotifDetailClose");
    if (closeBtn) closeBtn.addEventListener("click", closeDetail);
    var unreadBtn = document.getElementById("customerNotifDetailUnread");
    if (unreadBtn) {
      unreadBtn.addEventListener("click", function () {
        var N = api();
        if (N && activeEmail && selectedId && typeof N.markAsUnread === "function") {
          N.markAsUnread(activeEmail, selectedId);
          renderPanelList();
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
        }
      });
    }
    var clearBtn = document.getElementById("customerNotifDetailClear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var N = api();
        if (N && activeEmail && selectedId) {
          N.clearForUser(activeEmail, selectedId);
          closeDetail();
          renderPanelList();
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
        }
      });
    }
  }

  function createBell(user) {
    activeEmail = user && user.email ? String(user.email).trim().toLowerCase() : "";
    ensurePanel();
    ensureDetailOverlay();
    var N = api();
    if (N && activeEmail) N.processAutomaticForUser(activeEmail);

    var wrap = document.createElement("div");
    wrap.className = "customer-notif-wrap";
    var bell = document.createElement("button");
    bell.type = "button";
    bell.className = "customer-notif-bell";
    bell.setAttribute("aria-label", "Notifications");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-haspopup", "dialog");
    bell.setAttribute("aria-controls", "customerNotifPanel");
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

  function refresh(email) {
    activeEmail = String(email || activeEmail || "").trim().toLowerCase();
    var bell = document.querySelector(".customer-notif-bell");
    if (bell) updateBadge(bell);
    if (panelOpen) renderPanelList();
  }

  window.addEventListener("resize", function () {
    if (panelOpen) placePanel(document.querySelector(".customer-notif-bell"));
  });

  document.addEventListener(
    "scroll",
    function (e) {
      if (!panelOpen) return;
      var panel = getPanel();
      if (panel && e.target && e.target.nodeType === 1 && panel.contains(e.target)) return;
      placePanel(document.querySelector(".customer-notif-bell"));
    },
    true
  );

  document.addEventListener("click", function (e) {
    if (!panelOpen) return;
    var panel = getPanel();
    var bell = document.querySelector(".customer-notif-bell");
    if (!panel || !bell) return;
    if (e.target.closest && e.target.closest(".swal2-container")) return;
    if (panel.contains(e.target) || bell.contains(e.target) || (e.target.closest && e.target.closest(".customer-notif-wrap"))) return;
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
    refresh(activeEmail);
  });

  window.ElenestCustomerNotifications = {
    createBell: createBell,
    refresh: refresh,
    closePanel: closePanel
  };
})();
