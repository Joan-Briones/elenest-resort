(function () {
  var activeEmail = "";
  var panelOpen = false;
  var selectedId = null;

  function api() {
    return window.ElenestNotifications || null;
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
    var host = document.querySelector(".customer-notif-panel__list");
    var N = api();
    if (!host || !N || !activeEmail) return;
    host.textContent = "";
    var list = N.listForUser(activeEmail);
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
      type.textContent = N.getTypeLabel(n.type);
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
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
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
          N.clearAllForUser(activeEmail);
          renderPanelList();
          var bell = document.querySelector(".customer-notif-bell");
          if (bell) updateBadge(bell);
        }
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

  function refresh(email) {
    activeEmail = String(email || activeEmail || "").trim().toLowerCase();
    var bell = document.querySelector(".customer-notif-bell");
    if (bell) updateBadge(bell);
    if (panelOpen) renderPanelList();
  }

  document.addEventListener("click", function (e) {
    if (!panelOpen) return;
    var panel = getPanel();
    var bell = document.querySelector(".customer-notif-bell");
    if (!panel || !bell) return;
    if (panel.contains(e.target) || bell.contains(e.target) || (e.target.closest && e.target.closest(".customer-notif-wrap"))) return;
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
    refresh(activeEmail);
  });

  window.ElenestCustomerNotifications = {
    createBell: createBell,
    refresh: refresh,
    closePanel: closePanel
  };
})();
