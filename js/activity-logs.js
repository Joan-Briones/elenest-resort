/**
 * Automatic Activity Logs — records Manager and Receptionist actions
 * without a manual log form. Admin reviews them on the Activity Logs page.
 */
(function () {
  var TABLE = "activity_logs";
  var PAGE_SIZE = 8;
  var FETCH_LIMIT = 500;
  var TZ = "Asia/Manila";
  var bound = false;
  var realtimeDone = false;
  var cache = [];
  var lastError = "";
  var listPage = 1;
  var searchTimer = null;
  var hookTimer = null;

  function getSb() {
    if (window.ElenestAuth && typeof window.ElenestAuth.getClient === "function") {
      var c = window.ElenestAuth.getClient();
      if (c) return c;
    }
    return window.ElenestSupabase || null;
  }

  function currentUser() {
    try {
      return window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
    } catch (e) {
      return null;
    }
  }

  function normalizeRole(role) {
    if (window.ElenestAuth && typeof window.ElenestAuth.normalizeRole === "function") {
      return window.ElenestAuth.normalizeRole(role);
    }
    var r = String(role || "").trim().toLowerCase();
    if (r === "administrator") return "admin";
    if (r === "reception") return "receptionist";
    return r;
  }

  function isLoggableRole(role) {
    var r = normalizeRole(role);
    return r === "manager" || r === "receptionist";
  }

  function isLoggableUser(user) {
    return !!(user && isLoggableRole(user.role));
  }

  function staffLabel(role) {
    var r = normalizeRole(role);
    if (r === "manager") return "Manager";
    if (r === "receptionist") return "Receptionist";
    return r ? r.charAt(0).toUpperCase() + r.slice(1) : "Staff";
  }

  function guestName(booking, email) {
    var b = booking || {};
    return String(b.fullName || b.full_name || b.guestName || email || "guest").trim() || "guest";
  }

  function itemTitle(item, fallback) {
    if (!item || typeof item !== "object") return fallback || "item";
    return String(item.name || item.title || item.question || fallback || "item").trim() || fallback || "item";
  }

  function wrapMethod(obj, name, factory) {
    if (!obj || typeof obj[name] !== "function") return false;
    var flag = "_elenestActivityHooked_" + name;
    if (obj[flag]) return true;
    obj[name] = factory(obj[name]);
    obj[flag] = true;
    return true;
  }

  function afterPromise(result, onOk) {
    if (result && typeof result.then === "function") {
      return result.then(function (val) {
        try {
          onOk(val);
        } catch (e) {}
        return val;
      });
    }
    try {
      onOk(result);
    } catch (e2) {}
    return result;
  }

  function emitUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-activity-logs-updated"));
    } catch (e) {}
  }

  function isMissingTable(err) {
    if (!err) return false;
    var code = String(err.code || "");
    var msg = String(err.message || err.details || "").toLowerCase();
    return (
      code === "42P01" ||
      code === "PGRST205" ||
      msg.indexOf("activity_logs") >= 0 && (msg.indexOf("does not exist") >= 0 || msg.indexOf("schema cache") >= 0)
    );
  }

  function logActivity(desc, userOverride) {
    try {
      if (!desc || !desc.activity) return Promise.resolve(false);
      var user = userOverride || currentUser();
      if (!isLoggableUser(user) || !user.id) return Promise.resolve(false);
      var sb = getSb();
      if (!sb) return Promise.resolve(false);

      var row = {
        user_id: user.id,
        user_name: String(user.name || user.email || "Staff").trim() || "Staff",
        user_email: String(user.email || "").trim().toLowerCase(),
        user_role: normalizeRole(user.role),
        activity: String(desc.activity).trim().slice(0, 500),
        action_key: String(desc.actionKey || "").trim().slice(0, 80),
        entity_type: String(desc.entityType || "").trim().slice(0, 40),
        entity_id: String(desc.entityId || "").trim().slice(0, 120),
        metadata: desc.metadata && typeof desc.metadata === "object" ? desc.metadata : {}
      };

      return sb
        .from(TABLE)
        .insert(row)
        .then(function (res) {
          if (res.error) {
            if (!isMissingTable(res.error)) {
              try {
                console.warn("[Elenest Activity Logs] insert failed:", res.error.message || res.error);
              } catch (e) {}
            }
            return false;
          }
          emitUpdated();
          return true;
        })
        .catch(function () {
          return false;
        });
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  function describeBookingPatch(booking, patch, accountEmail) {
    if (!patch || typeof patch !== "object") return null;
    var guest = guestName(booking, accountEmail);
    var id = booking && booking.id ? String(booking.id) : "";

    if (patch.checkedInAt || String(patch.workflow || "") === "checked_in") {
      return {
        activity: "Checked in guest " + guest,
        actionKey: "booking.check_in",
        entityType: "booking",
        entityId: id,
        metadata: { guest: guest }
      };
    }
    if (patch.checkedOutAt || String(patch.workflow || "") === "checked_out") {
      return {
        activity: "Checked out guest " + guest,
        actionKey: "booking.check_out",
        entityType: "booking",
        entityId: id,
        metadata: { guest: guest }
      };
    }
    if (patch.managerApprovedAt || patch.managerApprovedBy) {
      return {
        activity: "Approved reservation for " + guest,
        actionKey: "booking.approve",
        entityType: "booking",
        entityId: id,
        metadata: { guest: guest }
      };
    }
    var st = String(patch.status || "").toLowerCase();
    if (st === "cancelled" || st === "canceled" || String(patch.workflow || "") === "cancelled") {
      return {
        activity: "Cancelled reservation for " + guest,
        actionKey: "booking.cancel",
        entityType: "booking",
        entityId: id,
        metadata: { guest: guest }
      };
    }
    var editKeys = [
      "checkIn",
      "checkOut",
      "checkInTime",
      "checkOutTime",
      "roomType",
      "cottageQty",
      "eventHall",
      "managerNote",
      "fullName",
      "phone"
    ];
    var edited = false;
    for (var i = 0; i < editKeys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(patch, editKeys[i])) {
        edited = true;
        break;
      }
    }
    if (edited) {
      return {
        activity: "Updated reservation for " + guest,
        actionKey: "booking.update",
        entityType: "booking",
        entityId: id,
        metadata: { guest: guest }
      };
    }
    return null;
  }

  function hookBookings() {
    var B = window.ElenestBookings;
    if (!B) return false;
    wrapMethod(B, "updateFields", function (orig) {
      return function (accountEmail, id, patch) {
        var before = null;
        try {
          if (typeof B.findById === "function") {
            var entry = B.findById(id);
            before = entry && entry.booking ? entry.booking : null;
            if (!accountEmail && entry) accountEmail = entry.accountEmail;
          }
        } catch (e) {}
        var snapshot = before ? {
          id: before.id,
          fullName: before.fullName || before.full_name || "",
          status: before.status || ""
        } : { id: id, fullName: "", status: "" };
        return afterPromise(orig.apply(B, arguments), function (ok) {
          if (!ok) return;
          var desc = describeBookingPatch(snapshot, patch, accountEmail);
          if (desc) logActivity(desc);
        });
      };
    });
    wrapMethod(B, "add", function (orig) {
      return function (email, booking) {
        var created = orig.apply(B, arguments);
        if (booking && booking.walkIn) {
          var name = guestName(booking, email);
          var wait = B.waitForSave ? B.waitForSave(created) : Promise.resolve(created);
          Promise.resolve(wait)
            .then(function (saved) {
              logActivity({
                activity: "Created walk-in reservation for " + name,
                actionKey: "booking.walk_in",
                entityType: "booking",
                entityId: (saved && saved.id) || (created && created.id) || "",
                metadata: {
                  guest: name,
                  checkIn: booking.checkIn || "",
                  checkOut: booking.checkOut || ""
                }
              });
            })
            .catch(function () {});
        }
        return created;
      };
    });
    return true;
  }

  function hookContentStore() {
    var S = window.ElenestContentStore;
    if (!S) return false;
    wrapMethod(S, "saveAbout", function (orig) {
      return function () {
        return afterPromise(orig.apply(S, arguments), function () {
          logActivity({
            activity: "Updated About page content",
            actionKey: "content.about",
            entityType: "content"
          });
        });
      };
    });
    function wrapNamed(method, verb, kind, titleFn) {
      wrapMethod(S, method, function (orig) {
        return function () {
          var args = arguments;
          var first = args[0];
          var title = titleFn ? titleFn.apply(null, args) : kind;
          var entityId = first && typeof first === "object" && first.id ? String(first.id) : String(first || "");
          return afterPromise(orig.apply(S, args), function () {
            logActivity({
              activity: verb + " " + kind + (title ? ": " + title : ""),
              actionKey: "content." + kind.replace(/\s+/g, "_"),
              entityType: "content",
              entityId: entityId,
              metadata: { title: title }
            });
          });
        };
      });
    }
    wrapNamed("upsertFaq", "Saved", "FAQ", function (item) {
      return itemTitle(item, "FAQ");
    });
    wrapNamed("deleteFaq", "Deleted", "FAQ", function () {
      return "";
    });
    wrapNamed("upsertActivity", "Saved", "activity", function (item) {
      return itemTitle(item, "activity");
    });
    wrapNamed("deleteActivity", "Deleted", "activity", function () {
      return "";
    });
    wrapNamed("upsertEvent", "Saved", "event", function (item) {
      return itemTitle(item, "event");
    });
    wrapNamed("deleteEvent", "Deleted", "event", function () {
      return "";
    });
    wrapNamed("upsertFacility", "Saved", "facility", function (item) {
      return itemTitle(item, "facility");
    });
    wrapNamed("deleteFacility", "Deleted", "facility", function () {
      return "";
    });
    wrapNamed("upsertPolicy", "Saved", "policy", function (item) {
      return itemTitle(item, "policy");
    });
    wrapNamed("deletePolicy", "Deleted", "policy", function () {
      return "";
    });
    wrapNamed("upsertGalleryItem", "Saved", "gallery photo", function (item) {
      return itemTitle(item, "gallery photo");
    });
    wrapNamed("deleteGalleryItem", "Deleted", "gallery photo", function () {
      return "";
    });
    return true;
  }

  function hookNotifications() {
    var N = window.ElenestNotifications;
    if (!N) return false;
    wrapMethod(N, "saveManagerPromotion", function (orig) {
      return function (record) {
        var title = itemTitle(record, "promotion");
        return afterPromise(orig.apply(N, arguments), function () {
          logActivity({
            activity: "Saved promotion: " + title,
            actionKey: "marketing.promotion",
            entityType: "broadcast",
            entityId: record && record.id ? String(record.id) : "",
            metadata: { title: title }
          });
        });
      };
    });
    wrapMethod(N, "saveManagerEvent", function (orig) {
      return function (record) {
        var title = itemTitle(record, "event");
        return afterPromise(orig.apply(N, arguments), function () {
          logActivity({
            activity: "Saved event: " + title,
            actionKey: "marketing.event",
            entityType: "broadcast",
            entityId: record && record.id ? String(record.id) : "",
            metadata: { title: title }
          });
        });
      };
    });
    wrapMethod(N, "deleteManagerItem", function (orig) {
      return function (id) {
        return afterPromise(orig.apply(N, arguments), function () {
          logActivity({
            activity: "Deleted a promotion or event",
            actionKey: "marketing.delete",
            entityType: "broadcast",
            entityId: String(id || "")
          });
        });
      };
    });
    return true;
  }

  function fmtIsoDate(iso) {
    var s = String(iso || "").slice(0, 10);
    if (!s) return "a date";
    try {
      var d = new Date(s + "T00:00:00+08:00");
      return d.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: TZ
      });
    } catch (e) {
      return s;
    }
  }

  function hookCalendarAccess() {
    var C = window.ElenestCalendarAccess;
    if (!C) return false;
    wrapMethod(C, "requestChange", function (orig) {
      return function (iso, action, reason) {
        var act = String(action || "change").toLowerCase();
        var label = act === "unblock" ? "unblock" : "block";
        return afterPromise(orig.apply(C, arguments), function () {
          logActivity({
            activity: "Requested to " + label + " calendar date " + fmtIsoDate(iso),
            actionKey: "calendar.request",
            entityType: "calendar",
            entityId: String(iso || "").slice(0, 10),
            metadata: { action: label, reason: String(reason || "").slice(0, 200) }
          });
        });
      };
    });
    return true;
  }

  function hookContactMessages() {
    var M = window.ElenestContactMessages;
    if (!M) return false;
    wrapMethod(M, "saveReply", function (orig) {
      return function (id, replyText) {
        var who = "a customer";
        try {
          var list = typeof M.listAll === "function" ? M.listAll() : [];
          for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === String(id)) {
              who = list[i].name || list[i].email || who;
              break;
            }
          }
        } catch (e) {}
        return afterPromise(orig.apply(M, arguments), function () {
          if (!String(replyText || "").trim()) return;
          logActivity({
            activity: "Replied to customer message from " + who,
            actionKey: "message.reply",
            entityType: "contact_message",
            entityId: String(id || ""),
            metadata: { customer: who }
          });
        });
      };
    });
    return true;
  }

  function hookAuth() {
    var Auth = window.ElenestAuth;
    if (!Auth) return false;
    wrapMethod(Auth, "login", function (orig) {
      return function () {
        return Promise.resolve(orig.apply(Auth, arguments)).then(function (result) {
          if (!result || !result.ok) return result;
          var user = currentUser();
          var role = result.role || (user && user.role);
          if (!isLoggableRole(role)) return result;
          if (user && !user.role) user = Object.assign({}, user, { role: role });
          if (!user || !user.id) return result;
          return logActivity(
            {
              activity: "Signed in",
              actionKey: "auth.sign_in",
              entityType: "session"
            },
            user
          )
            .then(function () {
              return result;
            })
            .catch(function () {
              return result;
            });
        });
      };
    });
    wrapMethod(Auth, "logout", function (orig) {
      return function () {
        var user = currentUser();
        if (!isLoggableUser(user)) return orig.apply(Auth, arguments);
        return logActivity(
          {
            activity: "Signed out",
            actionKey: "auth.sign_out",
            entityType: "session"
          },
          user
        )
          .catch(function () {})
          .then(function () {
            return orig.apply(Auth, arguments);
          });
      };
    });
    return true;
  }

  function hookAll() {
    hookBookings();
    hookContentStore();
    hookNotifications();
    hookCalendarAccess();
    hookContactMessages();
    hookAuth();
  }

  function readFilters() {
    var searchEl = document.getElementById("adminActivitySearch");
    var roleEl = document.getElementById("adminActivityRoleFilter");
    var typeEl = document.getElementById("adminActivityTypeFilter");
    var fromEl = document.getElementById("adminActivityDateFrom");
    var toEl = document.getElementById("adminActivityDateTo");
    return {
      search: searchEl ? String(searchEl.value || "").trim().toLowerCase() : "",
      role: roleEl ? String(roleEl.value || "").trim().toLowerCase() : "",
      type: typeEl ? String(typeEl.value || "").trim().toLowerCase() : "",
      from: fromEl ? String(fromEl.value || "").trim() : "",
      to: toEl ? String(toEl.value || "").trim() : ""
    };
  }

  function paginateItems(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Number(pageSize) || PAGE_SIZE);
    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / size) || 1);
    var current = Math.max(1, Math.min(Number(page) || 1, totalPages));
    var start = (current - 1) * size;
    return {
      items: list.slice(start, start + size),
      page: current,
      pageSize: size,
      total: total,
      totalPages: totalPages,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total)
    };
  }

  function renderPaginationControls(host, state, onPageChange) {
    if (!host) return;
    host.textContent = "";
    if (!state || state.total <= state.pageSize) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.className = "admin-pagination";

    var info = document.createElement("span");
    info.className = "admin-pagination__info";
    info.textContent = "Showing " + state.from + "–" + state.to + " of " + state.total;

    var nav = document.createElement("div");
    nav.className = "admin-pagination__nav";

    function makeBtn(label, disabled, page) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline btn--small";
      btn.textContent = label;
      btn.disabled = !!disabled;
      if (!disabled) {
        btn.addEventListener("click", function () {
          onPageChange(page);
        });
      }
      return btn;
    }

    nav.appendChild(makeBtn("Prev", state.page <= 1, state.page - 1));
    var pageLabel = document.createElement("span");
    pageLabel.className = "admin-pagination__page";
    pageLabel.textContent = "Page " + state.page + " / " + state.totalPages;
    nav.appendChild(pageLabel);
    nav.appendChild(makeBtn("Next", state.page >= state.totalPages, state.page + 1));
    host.appendChild(info);
    host.appendChild(nav);
  }

  function splitDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { date: "—", time: "—" };
    return {
      date: d.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: TZ
      }),
      time: d.toLocaleTimeString("en-PH", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: TZ
      })
    };
  }

  function manilaYmd(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
    } catch (e) {
      return String(iso || "").slice(0, 10);
    }
  }

  function todayYmd() {
    return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  }

  function rowMatches(row, filters) {
    if (!row) return false;
    if (filters.role && normalizeRole(row.user_role) !== filters.role) return false;
    if (filters.type) {
      var key = String(row.action_key || "");
      if (key.indexOf(filters.type + ".") !== 0 && key !== filters.type) return false;
    }
    if (filters.from || filters.to) {
      var ymd = manilaYmd(row.created_at);
      if (filters.from && ymd < filters.from) return false;
      if (filters.to && ymd > filters.to) return false;
    }
    if (filters.search) {
      var hay = [
        row.user_name,
        row.user_email,
        row.user_role,
        staffLabel(row.user_role),
        row.activity,
        row.action_key
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(filters.search) === -1) return false;
    }
    return true;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function loadLogs() {
    var sb = getSb();
    if (!sb) {
      lastError = "Supabase is not connected.";
      cache = [];
      return Promise.resolve([]);
    }
    return sb
      .from(TABLE)
      .select("id, user_id, user_name, user_email, user_role, activity, action_key, entity_type, entity_id, created_at")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT)
      .then(function (res) {
        if (res.error) {
          lastError = isMissingTable(res.error)
            ? "Activity logs are not set up yet. Run sql/activity-logs.sql in the Supabase SQL Editor."
            : res.error.message || "Could not load activity logs.";
          cache = [];
          return cache;
        }
        lastError = "";
        cache = Array.isArray(res.data) ? res.data : [];
        return cache;
      })
      .catch(function (err) {
        lastError = (err && err.message) || "Could not load activity logs.";
        cache = [];
        return cache;
      });
  }

  function filteredLogs() {
    var filters = readFilters();
    return cache.filter(function (row) {
      return rowMatches(row, filters);
    });
  }

  function renderAdminSection() {
    var host = document.getElementById("adminActivityLogsList");
    if (!host) return;
    var filters = readFilters();
    var items = filteredLogs();
    var today = todayYmd();
    var todayCount = cache.filter(function (row) {
      return manilaYmd(row.created_at) === today;
    }).length;
    var managerCount = cache.filter(function (row) {
      return normalizeRole(row.user_role) === "manager";
    }).length;
    var receptionCount = cache.filter(function (row) {
      return normalizeRole(row.user_role) === "receptionist";
    }).length;

    setText("adminActivityKpiToday", String(todayCount));
    setText("adminActivityKpiManager", String(managerCount));
    setText("adminActivityKpiReception", String(receptionCount));

    var empty = document.getElementById("adminActivityLogsEmpty");
    var pager = document.getElementById("adminActivityLogsPagination");
    host.textContent = "";

    if (lastError) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = lastError;
      }
      renderPaginationControls(pager, null);
      return;
    }

    if (!items.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = cache.length
          ? "No activity logs match the current search or filters."
          : "No activity logs yet. Manager and Receptionist actions appear here automatically.";
      }
      renderPaginationControls(pager, null);
      return;
    }
    if (empty) empty.hidden = true;

    var pageState = paginateItems(items, listPage, PAGE_SIZE);
    listPage = pageState.page;

    var table = document.createElement("table");
    table.className = "admin-pay-table activity-logs-table";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["User", "Role", "Activity", "Date", "Time"].forEach(function (label) {
      var th = document.createElement("th");
      th.textContent = label;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    pageState.items.forEach(function (row) {
      var tr = document.createElement("tr");
      var when = splitDateTime(row.created_at);
      var userCell = document.createElement("td");
      userCell.className = "admin-pay-cell-wrap";
      var main = document.createElement("div");
      main.className = "admin-pay-cell-main";
      main.textContent = row.user_name || "Staff";
      userCell.appendChild(main);
      if (row.user_email) {
        var sub = document.createElement("div");
        sub.className = "admin-pay-cell-sub";
        sub.textContent = row.user_email;
        userCell.appendChild(sub);
      }
      tr.appendChild(userCell);

      var roleTd = document.createElement("td");
      var pill = document.createElement("span");
      var role = normalizeRole(row.user_role);
      pill.className =
        "activity-logs-role" +
        (role === "manager"
          ? " activity-logs-role--manager"
          : role === "receptionist"
            ? " activity-logs-role--reception"
            : "");
      pill.textContent = staffLabel(role);
      roleTd.appendChild(pill);
      tr.appendChild(roleTd);

      var actTd = document.createElement("td");
      actTd.className = "activity-logs-activity";
      actTd.textContent = row.activity || "—";
      tr.appendChild(actTd);

      var dateTd = document.createElement("td");
      dateTd.textContent = when.date;
      tr.appendChild(dateTd);

      var timeTd = document.createElement("td");
      timeTd.textContent = when.time;
      tr.appendChild(timeTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);

    renderPaginationControls(pager, pageState, function (page) {
      listPage = page;
      renderAdminSection();
    });
  }

  function refreshAdminSection() {
    return loadLogs().then(function () {
      renderAdminSection();
    });
  }

  function bindAdminUi() {
    if (bound) return;
    if (!document.getElementById("section-activity-logs")) return;
    bound = true;

    var searchEl = document.getElementById("adminActivitySearch");
    var roleEl = document.getElementById("adminActivityRoleFilter");
    var typeEl = document.getElementById("adminActivityTypeFilter");
    var fromEl = document.getElementById("adminActivityDateFrom");
    var toEl = document.getElementById("adminActivityDateTo");
    var resetBtn = document.getElementById("adminActivityResetFilters");
    var refreshBtn = document.getElementById("adminActivityRefresh");

    function onFilterChange() {
      listPage = 1;
      renderAdminSection();
    }

    if (searchEl) {
      searchEl.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(onFilterChange, 220);
      });
    }
    if (roleEl) roleEl.addEventListener("change", onFilterChange);
    if (typeEl) typeEl.addEventListener("change", onFilterChange);
    if (fromEl) fromEl.addEventListener("change", onFilterChange);
    if (toEl) toEl.addEventListener("change", onFilterChange);
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (searchEl) searchEl.value = "";
        if (roleEl) roleEl.value = "";
        if (typeEl) typeEl.value = "";
        if (fromEl) fromEl.value = "";
        if (toEl) toEl.value = "";
        onFilterChange();
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshBtn, refreshAdminSection);
        else refreshAdminSection();
      });
    }

    window.addEventListener("elenest-activity-logs-updated", function () {
      if (document.getElementById("section-activity-logs") && !document.getElementById("section-activity-logs").hidden) {
        refreshAdminSection();
      }
    });
  }

  function setupRealtime() {
    if (realtimeDone) return;
    var sb = getSb();
    if (!sb || typeof sb.channel !== "function") return;
    realtimeDone = true;
    try {
      sb.channel("elenest-activity-logs")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: TABLE },
          function () {
            emitUpdated();
          }
        )
        .subscribe();
    } catch (e) {
      realtimeDone = false;
    }
  }

  function init() {
    hookAll();
    bindAdminUi();
    setupRealtime();
    if (!hookTimer) {
      var tries = 0;
      hookTimer = setInterval(function () {
        tries += 1;
        hookAll();
        if (tries >= 24) {
          clearInterval(hookTimer);
          hookTimer = null;
        }
      }, 250);
    }
  }

  window.ElenestActivityLogs = {
    log: logActivity,
    refreshAdminSection: refreshAdminSection,
    renderAdminSection: renderAdminSection,
    init: init
  };

  init();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
