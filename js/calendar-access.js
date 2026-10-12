/**
 * Calendar Access Control — Owner (admin) approval queue + Manager requests.
 * Official availability is changed only through Supabase RPCs.
 */
(function () {
  var PAGE_SIZE = 5;
  var listPages = { pending: 1, history: 1, manager: 1 };
  var ownerCalView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var selectedIso = null;
  var requestsCache = [];
  var bound = false;
  var realtimeDone = false;

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

  function currentRole() {
    var u = currentUser();
    if (window.ElenestAuth && typeof window.ElenestAuth.normalizeRole === "function") {
      return window.ElenestAuth.normalizeRole(u && u.role);
    }
    return String((u && u.role) || "").trim().toLowerCase();
  }

  function isOwner() {
    return currentRole() === "admin";
  }

  function isManager() {
    return currentRole() === "manager";
  }

  function rpcErrorMessage(err) {
    var msg = (err && (err.message || err.details || err.hint)) || "";
    msg = String(msg);
    if (/Could not find the function/i.test(msg) || /schema cache/i.test(msg)) {
      return "Calendar Access Control is not set up yet. Run sql/calendar-access-control.sql in Supabase.";
    }
    return msg || "Request failed.";
  }

  function rowFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      date: String(row.requested_date || "").slice(0, 10),
      action: String(row.action || "").toLowerCase() === "unblock" ? "unblock" : "block",
      reason: row.reason || "",
      status: String(row.status || "pending").toLowerCase(),
      requestedBy: row.requested_by_name || row.requested_by_email || "Manager",
      requestedByEmail: row.requested_by_email || "",
      requestedAt: row.created_at || "",
      reviewedBy: row.reviewed_by_name || row.reviewed_by_email || "",
      reviewedAt: row.reviewed_at || ""
    };
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function actionLabel(action) {
    return action === "unblock" ? "Unblock" : "Block";
  }

  function statusClass(status) {
    if (status === "approved") return "booking-status booking-status--confirmed";
    if (status === "rejected") return "booking-status booking-status--cancelled";
    return "booking-status booking-status--pending";
  }

  function applyAccessStatusBadge(el, status, label) {
    var PF = window.ElenestPaymentFlow;
    var kind = status === "approved" ? "success" : status === "rejected" ? "cancelled" : "pending";
    if (PF && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(el, { kind: kind, label: label });
      return el;
    }
    el.className = statusClass(status);
    el.textContent = label;
    return el;
  }

  function statusLabel(status) {
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Rejected";
    return "Pending";
  }

  function hasSwal() {
    return typeof Swal !== "undefined" && typeof Swal.fire === "function";
  }

  function swalAlert(options) {
    options = options || {};
    var text = options.text || options.message || "";
    if (!hasSwal()) {
      window.alert(text);
      return Promise.resolve();
    }
    return Swal.fire({
      icon: options.icon || "info",
      title: options.title || "",
      text: text,
      confirmButtonText: options.confirmText || "OK",
      confirmButtonColor: options.confirmColor || "#c46b82"
    });
  }

  function swalConfirm(options) {
    options = options || {};
    var text = options.text || options.message || "Are you sure?";
    if (!hasSwal()) {
      return Promise.resolve(window.confirm(text));
    }
    return Swal.fire({
      icon: options.icon || "question",
      title: options.title || "Please confirm",
      text: text,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: options.confirmText || "OK",
      cancelButtonText: options.cancelText || "Cancel",
      confirmButtonColor: options.confirmColor || "#c46b82",
      cancelButtonColor: "#6b7280",
      reverseButtons: true
    }).then(function (result) {
      return !!(result && result.isConfirmed);
    });
  }

  function swalReason(options) {
    options = options || {};
    var label = options.text || "Please provide a reason.";
    if (!hasSwal()) {
      var value = window.prompt(label, "");
      return Promise.resolve(value === null ? null : String(value));
    }
    return Swal.fire({
      icon: "question",
      title: options.title || "Reason required",
      text: label,
      input: "textarea",
      inputPlaceholder: options.placeholder || "Why should this date be changed?",
      inputAttributes: { maxlength: "500" },
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: options.confirmText || "Submit request",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#c46b82",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
      preConfirm: function (value) {
        var text = String(value || "").trim();
        if (text.length < 3) {
          Swal.showValidationMessage("Please enter a reason (at least 3 characters).");
          return false;
        }
        return text;
      }
    }).then(function (result) {
      if (!result || !result.isConfirmed) return null;
      return String(result.value || "").trim();
    });
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

  function renderPagination(host, state, onPageChange) {
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

  function createPayTable(headers) {
    var table = document.createElement("table");
    table.className = "admin-pay-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headers.forEach(function (lab) {
      var th = document.createElement("th");
      th.textContent = lab;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    return { table: table, tbody: tbody };
  }

  function appendEmpty(host, text) {
    var empty = document.createElement("p");
    empty.className = "admin-payment-empty";
    empty.textContent = text;
    host.appendChild(empty);
  }

  function createIconButton(kind, label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-pay-icon-btn admin-pay-icon-btn--" + kind;
    btn.setAttribute("aria-label", label);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var pathSpecs =
      kind === "approve"
        ? ["M20 6 9 17l-5-5"]
        : ["M18 6 6 18", "M6 6l12 12"];
    pathSpecs.forEach(function (d) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    var tip = document.createElement("span");
    tip.className = "admin-pay-icon-tip";
    tip.textContent = label;
    btn.appendChild(svg);
    btn.appendChild(tip);
    return btn;
  }

  function refreshAvailability() {
    var av = window.ElenestAvailability;
    if (av && typeof av.refreshManagerBlocks === "function") {
      return av.refreshManagerBlocks();
    }
    return Promise.resolve();
  }

  function loadRequests() {
    var sb = getSb();
    if (!sb) return Promise.resolve([]);
    return sb
      .from("calendar_access_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        requestsCache = (res.data || []).map(rowFromDb).filter(Boolean);
        return requestsCache;
      })
      .catch(function (err) {
        try {
          console.warn("[Calendar Access]", rpcErrorMessage(err));
        } catch (e) {}
        requestsCache = [];
        return [];
      });
  }

  function listPending() {
    return requestsCache.filter(function (r) {
      return r.status === "pending";
    });
  }

  function listHistory() {
    return requestsCache.filter(function (r) {
      return r.status !== "pending";
    });
  }

  function pendingForDate(iso) {
    var key = String(iso || "").slice(0, 10);
    if (!key) return null;
    for (var i = 0; i < requestsCache.length; i++) {
      if (requestsCache[i].status === "pending" && requestsCache[i].date === key) {
        return requestsCache[i];
      }
    }
    return null;
  }

  function requestChange(iso, action, reason) {
    var sb = getSb();
    if (!sb) return Promise.reject(new Error("Supabase is not available."));
    return sb
      .rpc("request_calendar_date_change", {
        p_date: iso,
        p_action: action,
        p_reason: reason
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return rowFromDb(res.data) || res.data;
      });
  }

  function reviewRequest(id, approve) {
    var sb = getSb();
    if (!sb) return Promise.reject(new Error("Supabase is not available."));
    return sb
      .rpc("review_calendar_access_request", {
        p_request_id: id,
        p_approve: !!approve
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return rowFromDb(res.data) || res.data;
      });
  }

  function applyOwnerChange(iso, blocked, note) {
    var sb = getSb();
    if (!sb) return Promise.reject(new Error("Supabase is not available."));
    return sb
      .rpc("owner_set_calendar_block", {
        p_date: iso,
        p_blocked: !!blocked,
        p_note: note || (blocked ? "Blocked by owner" : "")
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
  }

  function emitUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-calendar-access-updated"));
    } catch (e) {}
  }

  function unavailableKind(iso) {
    var av = window.ElenestAvailability;
    if (av && typeof av.getUnavailableKind === "function") {
      return av.getUnavailableKind(iso);
    }
    return "";
  }

  function renderOwnerCalendar() {
    var host = document.getElementById("adminAccessCalendarHost");
    var label = document.getElementById("adminAccessCalMonthLabel");
    if (!host || !label) return;
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") return;
    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: ownerCalView,
      wizardState: { checkIn: null, checkOut: null },
      highlightRange: false,
      allowManagerToggle: true,
      allowUnavailableClick: true,
      resortWideView: true,
      selectedIso: selectedIso,
      onDayClick: function (iso) {
        selectedIso = iso;
        renderOwnerCalendar();
        syncOwnerDateControls();
      }
    });
    syncOwnerDateControls();
  }

  function syncOwnerDateControls() {
    var labelEl = document.getElementById("adminAccessSelectedDateLabel");
    var statusEl = document.getElementById("adminAccessSelectedDateStatus");
    var blockBtn = document.getElementById("adminAccessBlockBtn");
    var unblockBtn = document.getElementById("adminAccessUnblockBtn");
    if (labelEl) labelEl.textContent = selectedIso || "—";
    if (!selectedIso) {
      if (statusEl) statusEl.textContent = "—";
      if (blockBtn) blockBtn.disabled = true;
      if (unblockBtn) unblockBtn.disabled = true;
      return;
    }
    var kind = unavailableKind(selectedIso);
    var facilityStatus =
      window.ElenestAvailability && typeof window.ElenestAvailability.getDateFacilityStatus === "function"
        ? window.ElenestAvailability.getDateFacilityStatus(selectedIso)
        : null;
    var pending = pendingForDate(selectedIso);
    var isManagerBlocked = kind === "manager";
    var isPendingDate = kind === "pending" || !!(facilityStatus && facilityStatus.hasPending);
    var isBooked = kind === "booked" || kind === "limited" || kind === "hold" || kind === "google" || kind === "pending";
    var label = "Available";
    if (isPendingDate) {
      label =
        (facilityStatus && facilityStatus.label) ||
        (window.ElenestUnitAvailability &&
        typeof window.ElenestUnitAvailability.pendingCalendarLabel === "function"
          ? window.ElenestUnitAvailability.pendingCalendarLabel()
          : "Pending Admin Confirmation");
    } else if (isBooked) label = "Booked";
    else if (isManagerBlocked) label = "Block";
    else if (kind) label = "Unavailable";
    if (pending) {
      label += " · Pending " + actionLabel(pending.action).toLowerCase() + " request";
    }
    if (statusEl) statusEl.textContent = "Status: " + label;
    if (blockBtn) blockBtn.disabled = isBooked || isManagerBlocked;
    if (unblockBtn) unblockBtn.disabled = isBooked || !isManagerBlocked;
  }

  function setKpi(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderPendingTable() {
    var host = document.getElementById("adminCalendarRequestsList");
    var pager = document.getElementById("adminCalendarRequestsPagination");
    if (!host) return;
    host.textContent = "";
    var pending = listPending();
    setKpi("adminCalendarKpiPending", pending.length);
    var countEl = document.getElementById("adminCalendarRequestsCount");
    if (countEl) {
      countEl.hidden = !pending.length;
      countEl.textContent = pending.length ? pending.length + " pending" : "";
    }
    if (!pending.length) {
      appendEmpty(host, "No pending calendar requests.");
      renderPagination(pager, { total: 0, pageSize: PAGE_SIZE }, function () {});
      return;
    }
    var pageState = paginateItems(pending, listPages.pending, PAGE_SIZE);
    listPages.pending = pageState.page;
    var built = createPayTable(["Date", "Action", "Requested by", "Reason", "Requested", ""]);
    pageState.items.forEach(function (item) {
      var tr = document.createElement("tr");
      function td(text) {
        var cell = document.createElement("td");
        cell.textContent = text;
        return cell;
      }
      tr.appendChild(td(fmtDate(item.date)));
      var actionCell = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = statusClass("pending");
      badge.textContent = actionLabel(item.action);
      actionCell.appendChild(badge);
      tr.appendChild(actionCell);
      tr.appendChild(td(item.requestedBy));
      tr.appendChild(td(item.reason || "—"));
      tr.appendChild(td(fmtWhen(item.requestedAt)));
      var actions = document.createElement("td");
      actions.className = "admin-pay-table-actions";
      var approveBtn = createIconButton("approve", "Approve");
      var rejectBtn = createIconButton("reject", "Reject");
      approveBtn.addEventListener("click", function () {
        handleReview(item, true, approveBtn);
      });
      rejectBtn.addEventListener("click", function () {
        handleReview(item, false, rejectBtn);
      });
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      tr.appendChild(actions);
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPagination(pager, pageState, function (page) {
      listPages.pending = page;
      renderPendingTable();
    });
  }

  function renderHistoryTable() {
    var host = document.getElementById("adminCalendarHistoryList");
    var pager = document.getElementById("adminCalendarHistoryPagination");
    if (!host) return;
    host.textContent = "";
    var history = listHistory();
    setKpi("adminCalendarKpiHistory", history.length);
    var av = window.ElenestAvailability;
    var blockedCount =
      av && typeof av.listManagerBlocked === "function" ? av.listManagerBlocked().length : 0;
    setKpi("adminCalendarKpiBlocked", blockedCount);
    if (!history.length) {
      appendEmpty(host, "No approved or rejected requests yet.");
      renderPagination(pager, { total: 0, pageSize: PAGE_SIZE }, function () {});
      return;
    }
    var pageState = paginateItems(history, listPages.history, PAGE_SIZE);
    listPages.history = pageState.page;
    var built = createPayTable([
      "Date",
      "Action",
      "Requested by",
      "Reason",
      "Status",
      "Reviewed by",
      "Reviewed"
    ]);
    pageState.items.forEach(function (item) {
      var tr = document.createElement("tr");
      function td(text) {
        var cell = document.createElement("td");
        cell.textContent = text;
        return cell;
      }
      tr.appendChild(td(fmtDate(item.date)));
      tr.appendChild(td(actionLabel(item.action)));
      tr.appendChild(td(item.requestedBy));
      tr.appendChild(td(item.reason || "—"));
      var statusCell = document.createElement("td");
      var badge = document.createElement("span");
      applyAccessStatusBadge(badge, item.status, statusLabel(item.status));
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);
      tr.appendChild(td(item.reviewedBy || "—"));
      tr.appendChild(td(fmtWhen(item.reviewedAt)));
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPagination(pager, pageState, function (page) {
      listPages.history = page;
      renderHistoryTable();
    });
  }

  function renderManagerRequests() {
    var host = document.getElementById("managerCalendarRequestsList");
    var pager = document.getElementById("managerCalendarRequestsPagination");
    if (!host) return;
    host.textContent = "";
    if (!requestsCache.length) {
      appendEmpty(host, "No calendar requests yet. Block or Unblock a date to send a request to the Owner.");
      renderPagination(pager, { total: 0, pageSize: PAGE_SIZE }, function () {});
      return;
    }
    var pageState = paginateItems(requestsCache, listPages.manager, PAGE_SIZE);
    listPages.manager = pageState.page;
    var built = createPayTable(["Date", "Action", "Reason", "Status", "Reviewed by", "Reviewed"]);
    pageState.items.forEach(function (item) {
      var tr = document.createElement("tr");
      function td(text) {
        var cell = document.createElement("td");
        cell.textContent = text;
        return cell;
      }
      tr.appendChild(td(fmtDate(item.date)));
      tr.appendChild(td(actionLabel(item.action)));
      tr.appendChild(td(item.reason || "—"));
      var statusCell = document.createElement("td");
      var badge = document.createElement("span");
      applyAccessStatusBadge(badge, item.status, statusLabel(item.status));
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);
      tr.appendChild(td(item.status === "pending" ? "Waiting for Owner" : item.reviewedBy || "—"));
      tr.appendChild(td(item.status === "pending" ? "—" : fmtWhen(item.reviewedAt)));
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPagination(pager, pageState, function (page) {
      listPages.manager = page;
      renderManagerRequests();
    });
  }

  function handleReview(item, approve, btn) {
    var title = approve ? "Approve request?" : "Reject request?";
    var text = approve
      ? "This will " + actionLabel(item.action).toLowerCase() + " " + fmtDate(item.date) + " on the official calendar."
      : "The date will stay as it is. The Manager request will be marked rejected.";
    var BL = window.ElenestButtonLoading;
    swalConfirm({
      title: title,
      text: text,
      confirmText: approve ? "Approve" : "Reject",
      confirmColor: approve ? "#2f9e44" : "#c45c5c"
    }).then(function (ok) {
      if (!ok) return;
      if (BL && btn) BL.set(btn, true);
      return reviewRequest(item.id, approve)
        .then(function () {
          return refreshAvailability();
        })
        .then(function () {
          return loadRequests();
        })
        .then(function () {
          renderOwnerSection();
          emitUpdated();
          swalAlert({
            icon: "success",
            title: approve ? "Request approved" : "Request rejected",
            text: approve
              ? "Official calendar availability has been updated."
              : "The date was left unchanged."
          });
        })
        .catch(function (err) {
          swalAlert({ icon: "error", title: "Could not review request", text: rpcErrorMessage(err) });
        })
        .then(function () {
          if (BL && btn) BL.set(btn, false);
        });
    });
  }

  function runOwnerAction(blocked) {
    if (!isOwner()) {
      return swalAlert({
        icon: "error",
        title: "Not allowed",
        text: "Only the Owner can change official calendar availability."
      });
    }
    if (!selectedIso) {
      return swalAlert({
        icon: "info",
        title: "Select a date",
        text: "Choose a date on the calendar before blocking or unblocking it."
      });
    }
    var kind = unavailableKind(selectedIso);
    if (kind === "booked" || kind === "limited" || kind === "hold" || kind === "pending" || kind === "google") {
      return swalAlert({
        icon: "warning",
        title: "Date is booked",
        text: "This date is booked and cannot be blocked or unblocked."
      });
    }
    var label = blocked ? "Block" : "Unblock";
    return swalConfirm({
      title: label + " this date?",
      text: fmtDate(selectedIso) + " will be " + (blocked ? "closed" : "opened") + " on the official calendar immediately.",
      confirmText: label
    }).then(function (ok) {
      if (!ok) return;
      var btn = document.getElementById(blocked ? "adminAccessBlockBtn" : "adminAccessUnblockBtn");
      var work = function () {
        return applyOwnerChange(selectedIso, blocked)
          .then(function () {
            return refreshAvailability();
          })
          .then(function () {
            renderOwnerCalendar();
            renderHistoryTable();
            emitUpdated();
          });
      };
      return runBlockUnblockLoading(btn, work, blocked ? "Blocking…" : "Unblocking…").catch(function (err) {
        swalAlert({ icon: "error", title: "Could not update calendar", text: rpcErrorMessage(err) });
      });
    });
  }

  function promptManagerRequest(iso, action) {
    if (!isManager()) {
      return swalAlert({
        icon: "error",
        title: "Not allowed",
        text: "Only a Manager can request calendar changes."
      });
    }
    if (!iso) return Promise.resolve();
    var pending = pendingForDate(iso);
    if (pending) {
      return swalAlert({
        icon: "info",
        title: "Request already pending",
        text: "The Owner still needs to review the existing request for this date."
      });
    }
    var kind = unavailableKind(iso);
    if (kind === "booked" || kind === "limited" || kind === "hold" || kind === "pending" || kind === "google") {
      return swalAlert({
        icon: "warning",
        title: "Date is booked",
        text: "This date is booked and cannot be blocked or unblocked."
      });
    }
    var verb = actionLabel(action);
    return swalReason({
      title: "Request to " + verb.toLowerCase() + " date",
      text: "The Owner must approve this before " + fmtDate(iso) + " changes on the official calendar.",
      confirmText: "Send request",
      placeholder: "Reason for this " + verb.toLowerCase() + " request"
    }).then(function (reason) {
      if (!reason) return;
      var btn = document.getElementById(action === "unblock" ? "managerUnblockBtn" : "managerBlockBtn");
      var work = function () {
        return requestChange(iso, action, reason)
          .then(function () {
            return loadRequests();
          })
          .then(function () {
            renderManagerRequests();
            emitUpdated();
          });
      };
      var BL = window.ElenestButtonLoading;
      var done = BL && btn ? BL.run(btn, work, action === "unblock" ? "Unblocking…" : "Blocking…") : Promise.resolve().then(work);
      return Promise.resolve(done)
        .then(function () {
          emitUpdated();
          return swalAlert({
            icon: "success",
            title: "Request sent",
            text: "The Owner can now approve or reject this " + verb.toLowerCase() + " request."
          });
        })
        .catch(function (err) {
          emitUpdated();
          swalAlert({ icon: "error", title: "Could not send request", text: rpcErrorMessage(err) });
        });
    });
  }

  function renderOwnerSection() {
    renderOwnerCalendar();
    renderPendingTable();
    renderHistoryTable();
  }

  function refreshAndRender() {
    return loadRequests().then(function () {
      if (document.getElementById("section-calendar-access")) renderOwnerSection();
      if (document.getElementById("managerCalendarRequestsList")) renderManagerRequests();
      return requestsCache;
    });
  }

  function setupRealtime() {
    var sb = getSb();
    if (!sb || realtimeDone) return;
    realtimeDone = true;
    try {
      sb.channel("elenest-calendar-access")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "calendar_access_requests" },
          function () {
            refreshAndRender();
          }
        )
        .subscribe();
    } catch (e) {}
  }

  function runBlockUnblockLoading(btn, work, label) {
    var BL = window.ElenestButtonLoading;
    var done = BL && btn ? BL.run(btn, work, label) : Promise.resolve().then(work);
    return Promise.resolve(done).then(
      function (result) {
        syncOwnerDateControls();
        return result;
      },
      function (err) {
        syncOwnerDateControls();
        throw err;
      }
    );
  }

  function bindOwnerUi() {
    var prev = document.getElementById("adminAccessCalPrev");
    var next = document.getElementById("adminAccessCalNext");
    if (prev) {
      prev.addEventListener("click", function () {
        ownerCalView.m--;
        if (ownerCalView.m < 0) {
          ownerCalView.m = 11;
          ownerCalView.y--;
        }
        renderOwnerCalendar();
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        ownerCalView.m++;
        if (ownerCalView.m > 11) {
          ownerCalView.m = 0;
          ownerCalView.y++;
        }
        renderOwnerCalendar();
      });
    }
    var blockBtn = document.getElementById("adminAccessBlockBtn");
    var unblockBtn = document.getElementById("adminAccessUnblockBtn");
    var clearBtn = document.getElementById("adminAccessClearSelectedDate");
    if (blockBtn) {
      blockBtn.addEventListener("click", function () {
        runOwnerAction(true);
      });
    }
    if (unblockBtn) {
      unblockBtn.addEventListener("click", function () {
        runOwnerAction(false);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        selectedIso = null;
        renderOwnerCalendar();
      });
    }
    var refreshPending = document.getElementById("adminCalendarRequestsRefresh");
    var refreshHistory = document.getElementById("adminCalendarHistoryRefresh");
    if (refreshPending) {
      refreshPending.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = refreshAndRender;
        if (BL) BL.run(refreshPending, work);
        else work();
      });
    }
    if (refreshHistory) {
      refreshHistory.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = refreshAndRender;
        if (BL) BL.run(refreshHistory, work);
        else work();
      });
    }
    var refreshCal = document.getElementById("adminAccessCalendarRefresh");
    if (refreshCal) {
      refreshCal.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = function () {
          return refreshAvailability().then(function () {
            renderOwnerCalendar();
          });
        };
        if (BL) BL.run(refreshCal, work);
        else work();
      });
    }
  }

  function bindManagerUi() {
    var refresh = document.getElementById("managerCalendarRequestsRefresh");
    if (refresh) {
      refresh.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = refreshAndRender;
        if (BL) BL.run(refresh, work);
        else work();
      });
    }
  }

  function init() {
    if (bound) return;
    bound = true;
    bindOwnerUi();
    bindManagerUi();
    setupRealtime();
    window.addEventListener("elenest-manager-blocks-updated", function () {
      if (document.getElementById("adminAccessCalendarHost")) renderOwnerCalendar();
    });
    refreshAndRender();
  }

  window.ElenestCalendarAccess = {
    init: init,
    refresh: refreshAndRender,
    renderOwnerSection: renderOwnerSection,
    renderManagerRequests: renderManagerRequests,
    requestChange: requestChange,
    reviewRequest: reviewRequest,
    applyOwnerChange: applyOwnerChange,
    promptManagerRequest: promptManagerRequest,
    listPending: listPending,
    pendingForDate: pendingForDate,
    rpcErrorMessage: rpcErrorMessage
  };
})();
