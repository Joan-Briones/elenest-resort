(function () {
  function contentStore() {
    return window.ElenestContentStore || null;
  }

  function getRoomCatalog() {
    var S = contentStore();
    return S ? S.getFacilitiesAll() : [];
  }

  function saveRoomCatalog(list) {
    var S = contentStore();
    if (S) S.saveFacilities(list);
  }

  function getPolicies() {
    var S = contentStore();
    return S ? S.getPolicies() : [];
  }

  function savePolicies(list) {
    var S = contentStore();
    if (S) S.savePolicies(list);
  }

  function escapeHtml(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  var MESSAGES_PAGE_SIZE = 8;
  var messagesPage = 1;
  var MANAGE_PAGE_SIZE = 8;
  var managePage = 1;

  function paginateItems(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Number(pageSize) || MESSAGES_PAGE_SIZE);
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

  function normalizeStatus(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.normalizeBookingStatus === "function") {
      return PF.normalizeBookingStatus(st);
    }
    var s = String(st || "Pending").trim().toLowerCase();
    if (s === "confirmed" || s === "approved") return "Confirmed";
    if (s === "checked in" || s === "checked_in") return "Checked In";
    if (s === "checked out" || s === "checked_out" || s === "completed") return "Checked Out";
    if (s === "cancelled" || s === "canceled") return "Cancelled";
    return "Pending";
  }

  function isPendingPaymentVerification(b) {
    if (!b) return false;
    return String(b.status || "").trim().toLowerCase() === "pending payment verification";
  }

  function hasManagerClearance(b) {
    return !!(b && b.managerApprovedAt);
  }

  function statusClass(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getStatusPresentation === "function") {
      return PF.getStatusPresentation(st).badgeClass;
    }
    var s = normalizeStatus(st);
    if (s === "Confirmed" || s === "Checked In" || s === "Checked Out") return "booking-status--confirmed";
    if (s === "Cancelled" || s === "Rejected" || s === "No Show") return "booking-status--cancelled";
    return "booking-status--pending";
  }

  function applyManagerStatusBadge(el, booking, label) {
    var PF = window.ElenestPaymentFlow;
    var text = label != null ? label : normalizeStatus(booking && booking.status);
    if (PF && typeof PF.getStatusPresentation === "function" && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(el, PF.getStatusPresentation(booking, { label: text }));
      return el;
    }
    el.className = "booking-status " + statusClass(booking && booking.status);
    el.textContent = text;
    return el;
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (err) {
      return iso;
    }
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return isNaN(d.getTime())
        ? "—"
        : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (err) {
      return "—";
    }
  }

  function toNumberOrNull(v) {
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function fmtPHP(amount) {
    var n = toNumberOrNull(amount);
    if (n === null) return "₱0";
    return "₱" + Math.round(n).toLocaleString();
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function listBookings() {
    var B = window.ElenestBookings;
    if (B && typeof B.listLive === "function") return B.listLive();
    if (B && typeof B.listAll === "function") return B.listAll();
    return [];
  }

  function listBookingsAll() {
    var B = window.ElenestBookings;
    if (B && typeof B.listAll === "function") return B.listAll();
    return listBookings();
  }

  function patchBooking(accountEmail, id, patch) {
    var B = window.ElenestBookings;
    if (B && typeof B.updateFields === "function") return B.updateFields(accountEmail, id, patch);
    return false;
  }

  function labelRoomType(v) {
    if (v === "big") return "Big room";
    if (v === "small") return "Small room";
    if (v === "couple") return "Couple room";
    if (v === "none") return "No room";
    return v ? String(v) : "—";
  }

  function labelEventHall(v) {
    var x = String(v || "none").toLowerCase();
    if (x === "none" || x === "no") return "No hall";
    if (x === "poolside") return "Event hall beside the pool";
    if (x === "upper") return "Upper hall";
    if (x === "new_function") return "New function hall";
    if (x === "ac") return "Air-conditioned event hall";
    return v ? String(v) : "—";
  }

  // Recommendation themes (aligned with Admin recommendations)
  var CATEGORY_PATTERNS = {
    room: /(room|rooms|suite|bed|bathroom|bath|shower|linen|pillow|towel|housekeeping|\bac\b|aircon|air con|cleanliness|musty)/i,
    pools: /(pool|pools|swimming|jacuzzi|lounger|lap pool)/i,
    events: /(event|hall|function|wedding|banquet|conference|venue|program|company lunch)/i,
    cottage: /(cottage|cabana|bungalow|hut|villa)/i,
    services: /(staff|service|reception|front desk|check-?in|check-?out|attendant|waiter|room service|concierge)/i
  };

  function detectFeedbackCategories(comment) {
    var c = String(comment || "");
    var found = [];
    Object.keys(CATEGORY_PATTERNS).forEach(function (key) {
      if (CATEGORY_PATTERNS[key].test(c)) found.push(key);
    });
    if (!found.length) found.push("overall");
    return found;
  }

  var IMPROVEMENT_BY_AREA = {
    room: {
      title: "Guest rooms",
      text:
        "Use a clear room checklist before every check-in. Confirm clean air, stable cooling, complete linens, and low noise so each room meets one quality standard."
    },
    pools: {
      title: "Pool area",
      text:
        "Inspect pool furniture and floor safety every day. Keep towel supply ready during peak hours, and record water quality and safety signs in a daily log."
    },
    events: {
      title: "Event spaces",
      text:
        "Check cooling, lighting, sound, and power before each event. Give staff a simple service timeline for meal flow, room reset, and host support."
    },
    cottage: {
      title: "Cottages",
      text:
        "Inspect each cottage before arrival for maintenance, privacy, and complete amenities. Ensure the actual setup matches the details shown in your booking materials."
    },
    services: {
      title: "Service standards",
      text:
        "Set clear response-time targets for front desk and in-stay requests. Use one handover format between shifts so commitments remain accurate and consistent."
    },
    overall: {
      title: "End-to-end stay",
      text:
        "Review the full guest journey from arrival to departure. Assign one owner for each issue type and track completion until the problem is resolved."
    }
  };

  function feedbackGuestName(f) {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.displayName === "function") return api.displayName(f);
    var name = String((f && f.name) || "").trim();
    if (!name || name.toLowerCase() === "guest") return "Guest";
    return name;
  }

  function readFeedback() {
    if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listLive === "function") {
      return window.ElenestGuestFeedback.listLive();
    }
    if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listAll === "function") {
      return window.ElenestGuestFeedback.listAll();
    }
    try {
      var raw = localStorage.getItem("elenest_feedback");
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /** Live Supabase reviews for KPIs (excludes past-fb-* historical / sample JSON). */
  function readLiveReviewRecordsForKpis() {
    var GF = window.ElenestGuestFeedback;
    var list = readFeedback();
    return (list || []).filter(function (f) {
      if (!f) return false;
      if (GF && typeof GF.isHistoricalFeedback === "function" && GF.isHistoricalFeedback(f)) {
        return false;
      }
      var id = String(f.id || "");
      return id.indexOf("past-fb-") !== 0;
    });
  }

  /** Same review set as the public homepage KPIs (live + historical). */
  function readAllReviewRecordsForHomeKpis() {
    var GF = window.ElenestGuestFeedback;
    if (GF && typeof GF.listAll === "function") return GF.listAll() || [];
    return readFeedback();
  }

  function getSupabaseForReviews() {
    try {
      if (
        window.ElenestSupabaseHelpers &&
        typeof window.ElenestSupabaseHelpers.getClient === "function"
      ) {
        return window.ElenestSupabaseHelpers.getClient();
      }
    } catch (e) {}
    return window.ElenestSupabase || null;
  }

  var fullReviewsCache = null;
  var fullReviewsLoadPromise = null;

  function invalidateFullReviewsCache() {
    fullReviewsCache = null;
    fullReviewsLoadPromise = null;
  }

  function mergeReviewListsById(primary, secondary) {
    var byId = {};
    (primary || []).concat(secondary || []).forEach(function (item) {
      if (!item) return;
      var id = String(item.id || "");
      if (!id || byId[id]) return;
      byId[id] = item;
    });
    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function fetchAllGuestFeedbackFromSupabase() {
    var sb = getSupabaseForReviews();
    if (!sb || typeof sb.from !== "function") return Promise.resolve([]);

    function fetchPage(from, pageSize, acc, columns) {
      return sb
        .from("guest_feedback")
        .select(columns)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          var all = acc.concat(rows);
          if (rows.length === pageSize) {
            return fetchPage(from + pageSize, pageSize, all, columns);
          }
          return all;
        });
    }

    return fetchPage(0, 1000, [], "id, stars, sentiment, created_at")
      .catch(function () {
        return fetchPage(0, 1000, [], "id, stars, created_at");
      })
      .then(function (rows) {
        return (rows || []).map(function (row) {
          return {
            id: row.id,
            stars: row.stars != null ? row.stars : 0,
            sentiment: row.sentiment || "",
            createdAt: row.created_at || "",
            name: "",
            comment: "",
            photo: "",
            bookingId: ""
          };
        });
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Manager] guest_feedback Supabase load failed:", err);
        } catch (e) {}
        return [];
      });
  }

  function mapHistoricalFeedbackRows(rows) {
    return (rows || [])
      .map(function (row) {
        if (!row) return null;
        var id = row.id || "";
        if (!id) return null;
        return {
          id: id,
          stars: row.stars != null ? row.stars : 0,
          sentiment: row.sentiment || "",
          createdAt: row.created_at || row.createdAt || "",
          name: row.guest_name || row.name || "",
          comment: row.comment || "",
          photo: row.photo_url || row.photo || "",
          bookingId: row.booking_id || row.bookingId || ""
        };
      })
      .filter(Boolean);
  }

  function loadFullReviewRecordsForHomeKpis(force) {
    if (!force && fullReviewsCache && fullReviewsCache.length > 200) {
      return Promise.resolve(fullReviewsCache);
    }
    if (!force && fullReviewsLoadPromise) return fullReviewsLoadPromise;

    var GF = window.ElenestGuestFeedback;
    var HD = window.ElenestHistoricalData;

    var histApi =
      GF && typeof GF.ensureHistoricalLoaded === "function"
        ? GF.ensureHistoricalLoaded()
        : Promise.resolve([]);

    var histFiles =
      HD && typeof HD.loadFeedback === "function"
        ? HD.loadFeedback()
            .then(function (result) {
              return mapHistoricalFeedbackRows((result && result.rows) || []);
            })
            .catch(function () {
              return [];
            })
        : Promise.resolve([]);

    fullReviewsLoadPromise = Promise.all([
      histApi,
      histFiles,
      fetchAllGuestFeedbackFromSupabase()
    ])
      .then(function (parts) {
        var local = readAllReviewRecordsForHomeKpis();
        var fromFiles = parts[1] || [];
        var fromDb = parts[2] || [];
        var merged = mergeReviewListsById(
          mergeReviewListsById(fromDb, local),
          fromFiles
        );
        fullReviewsCache = merged;
        fullReviewsLoadPromise = null;
        return merged;
      })
      .catch(function () {
        fullReviewsLoadPromise = null;
        var fallback = readAllReviewRecordsForHomeKpis();
        fullReviewsCache = fallback;
        return fallback;
      });

    return fullReviewsLoadPromise;
  }

  function isRecommendableReview(f) {
    var raw = String((f && (f.sentiment || f.sentimentLabel)) || "")
      .trim()
      .toLowerCase();
    if (/^(pos|positive)\b/.test(raw) || raw === "pos") return true;
    return Number(f && f.stars) >= 4;
  }

  function computeHomeStyleReviewKpis(list) {
    var rows = list || [];
    var total = rows.length;
    var withStars = rows.filter(function (f) {
      return Number(f.stars) > 0;
    });
    var average = 0;
    if (withStars.length) {
      var sum = withStars.reduce(function (a, c) {
        return a + Number(c.stars || 0);
      }, 0);
      average = sum / withStars.length;
    }
    var recommend = total
      ? Math.round((rows.filter(isRecommendableReview).length / total) * 100)
      : 0;
    return { average: average, recommend: recommend, total: total };
  }

  function buildAdminStyleRecommendationsFromFeedback(feedbackList) {
    var lows = (feedbackList || []).filter(function (f) {
      var s = Number(f && f.stars);
      return !isNaN(s) && s > 0 && s <= 2;
    });
    if (!lows.length) return [];

    var areaHit = { room: false, pools: false, events: false, cottage: false, services: false, overall: false };
    lows.forEach(function (f) {
      detectFeedbackCategories(f.comment).forEach(function (c) {
        if (Object.prototype.hasOwnProperty.call(areaHit, c)) areaHit[c] = true;
      });
    });

    var order = ["room", "pools", "events", "cottage", "services", "overall"];
    var out = [];
    order.forEach(function (cat) {
      if (!areaHit[cat]) return;
      var tpl = IMPROVEMENT_BY_AREA[cat];
      if (!tpl) return;
      out.push({ title: tpl.title, text: tpl.text });
    });
    return out;
  }

  function bookingMatchesQuery(item, q) {
    if (!q) return true;
    var b = item.booking || {};
    var hay = [
      b.id,
      b.fullName,
      b.phone,
      b.email,
      item.accountEmail,
      b.request
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function sortBySubmittedDesc(a, c) {
    var as = (a.booking && a.booking.submittedAt) || "";
    var bs = (c.booking && c.booking.submittedAt) || "";
    if (as !== bs) return bs < as ? -1 : bs > as ? 1 : 0;
    return 0;
  }

  function buildApprovalCard(item, managerUser, onChange) {
    var b = item.booking || {};
    var st = normalizeStatus(b.status);
    var approvedAt = b.managerApprovedAt || "";
    var approvedBy = b.managerApprovedBy || "";
    // Backward-compatible: some older records stored managerApprovedAt without updating status.
    if (approvedAt && st === "Pending") st = "Confirmed";

    var card = document.createElement("article");
    card.className = "booking-card reception-checkin-card";

    var body = document.createElement("div");
    body.className = "reception-checkin-card__body";

    var main = document.createElement("div");
    main.className = "reception-checkin-card__main";

    var top = document.createElement("div");
    top.className = "booking-card__top";
    var badge = document.createElement("span");
    if (st === "Cancelled") {
      applyManagerStatusBadge(badge, { status: "Cancelled" }, "Cancelled");
    } else if (st === "Confirmed") {
      applyManagerStatusBadge(badge, { status: "Confirmed" }, "Approved");
    } else {
      applyManagerStatusBadge(badge, { status: "Pending" }, "Pending");
    }
    top.appendChild(badge);
    main.appendChild(top);

    var nameRow = document.createElement("div");
    nameRow.className = "reception-checkin-card__name-row";
    var nameEl = document.createElement("h4");
    nameEl.className = "booking-card__name";
    nameEl.textContent = b.fullName || "Guest";
    nameRow.appendChild(nameEl);
    main.appendChild(nameRow);

    var details = document.createElement("div");
    details.className = "reception-checkin-card__details";
    details.hidden = true;
    details.id = "manager-approval-d-" + String(b.id || Math.random().toString(36).slice(2));

    function addRow(label, val) {
      var row = document.createElement("div");
      row.className = "booking-card__row";
      var lab = document.createElement("span");
      lab.className = "booking-card__label";
      lab.textContent = label;
      var v = document.createElement("span");
      v.className = "booking-card__value";
      v.textContent = val === undefined || val === null || val === "" ? "—" : String(val);
      row.appendChild(lab);
      row.appendChild(v);
      details.appendChild(row);
    }

    addRow("Stay begins", fmtDateLong(b.checkIn));
    addRow("Check-out", fmtDateLong(b.checkOut));
    addRow("Room type", labelRoomType(b.roomType));
    addRow("Phone", b.phone);
    addRow("Email", b.email || item.accountEmail);
    addRow("Record key", item.accountEmail);
    addRow("Submitted", fmtWhen(b.submittedAt));
    if (approvedAt) addRow("Approved at", fmtWhen(approvedAt));
    if (approvedBy) addRow("Approved by", approvedBy);
    main.appendChild(details);

    var sub = document.createElement("p");
    sub.className = "booking-card__sub";
    sub.textContent = "ID: " + (b.id || "—") + " • Submitted " + fmtWhen(b.submittedAt);
    main.appendChild(sub);

    var aside = document.createElement("div");
    aside.className = "reception-checkin-card__aside";

    var viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn--outline reception-checkin-card__view-btn";
    viewBtn.textContent = "View";
    viewBtn.setAttribute("aria-expanded", "false");
    viewBtn.setAttribute("aria-controls", details.id);
    viewBtn.addEventListener("click", function () {
      var open = details.hidden;
      details.hidden = !open;
      viewBtn.setAttribute("aria-expanded", open ? "true" : "false");
      viewBtn.textContent = open ? "Hide" : "View";
    });

    var controls = document.createElement("div");
    controls.className = "reception-checkin-card__aside-controls";
    controls.appendChild(viewBtn);

    if (isPendingPaymentVerification(b)) {
      var ownerNote = document.createElement("p");
      ownerNote.className = "booking-card__sub";
      ownerNote.textContent = "Awaiting owner payment verification. Only the Owner can approve QR payments.";
      controls.appendChild(ownerNote);
    } else if (st === "Pending") {
      var approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "btn btn--success";
      approveBtn.textContent = "Approved";
      approveBtn.addEventListener("click", function () {
        var approver = managerUser && managerUser.email ? normalizeEmail(managerUser.email) : "manager";
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(approveBtn, true);
        Promise.resolve(
          patchBooking(item.accountEmail, b.id, {
            status: "Approved",
            managerApprovedAt: new Date().toISOString(),
            managerApprovedBy: approver
          })
        ).then(function () {
          onChange();
        }).catch(function () {
          if (BL) BL.set(approveBtn, false);
        });
      });

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn--danger";
      cancelBtn.textContent = "Cancelled";
      cancelBtn.addEventListener("click", function () {
        var ok = window.confirm("Cancel this reservation?");
        if (!ok) return;
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(cancelBtn, true);
        Promise.resolve(
          patchBooking(item.accountEmail, b.id, {
            status: "Cancelled",
            managerApprovedAt: new Date().toISOString(),
            managerApprovedBy: (managerUser && managerUser.email) ? normalizeEmail(managerUser.email) : "manager"
          })
        ).then(function () {
          onChange();
        }).catch(function () {
          if (BL) BL.set(cancelBtn, false);
        });
      });

      controls.appendChild(approveBtn);
      controls.appendChild(cancelBtn);
    }

    aside.appendChild(controls);
    body.appendChild(main);
    body.appendChild(aside);
    card.appendChild(body);
    return card;
  }

  function addManageCell(row, text, cls) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    var value = text === undefined || text === null || text === "" ? "—" : String(text);
    td.textContent = value;
    td.title = value;
    row.appendChild(td);
    return td;
  }

  function buildManageRow(item, onEditDone) {
    var b = item.booking || {};
    var row = document.createElement("tr");
    row.className = "manager-msg-row";

    var nameTd = document.createElement("td");
    nameTd.className = "manager-msg-col-name";
    var nameEl = document.createElement("strong");
    nameEl.className = "manager-msg-customer__name";
    nameEl.textContent = b.fullName || "Guest";
    nameTd.appendChild(nameEl);
    row.appendChild(nameTd);

    var statusTd = document.createElement("td");
    statusTd.className = "manager-reserve-col-status";
    var badge = document.createElement("span");
    applyManagerStatusBadge(badge, b, normalizeStatus(b.status));
    statusTd.appendChild(badge);
    row.appendChild(statusTd);

    addManageCell(row, b.id || "—", "manager-reserve-col-id");
    addManageCell(
      row,
      fmtDateLong(b.checkIn) + " → " + fmtDateLong(b.checkOut),
      "manager-reserve-col-stay"
    );
    addManageCell(row, item.accountEmail, "manager-reserve-col-key");
    addManageCell(row, labelRoomType(b.roomType), "manager-reserve-col-room");
    addManageCell(row, String(b.cottageQty != null && b.cottageQty !== "" ? b.cottageQty : "0"), "manager-reserve-col-qty");
    addManageCell(row, labelEventHall(b.eventHall), "manager-reserve-col-hall");

    var actTd = document.createElement("td");
    actTd.className = "manager-msg-col-actions manager-msg-actions";
    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "cm-icon-btn cm-icon-btn--edit";
    editBtn.setAttribute("aria-label", "Edit reservation");
    editBtn.setAttribute("title", "Edit reservation");
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
      '<span class="cm-icon-tip">Edit</span>';
    editBtn.addEventListener("click", function () {
      openEditDialog(item, onEditDone);
    });
    actTd.appendChild(editBtn);
    row.appendChild(actTd);
    return row;
  }

  function openEditDialog(item, onDone) {
    var overlay = document.getElementById("managerEditOverlay");
    var title = document.getElementById("managerEditTitle");
    var form = document.getElementById("managerEditForm");
    var fullNameEl = document.getElementById("managerEditFullName");
    var phoneEl = document.getElementById("managerEditPhone");
    var emailEl = document.getElementById("managerEditEmail");
    var stayTypeEl = document.getElementById("managerEditStayType");
    var statusEl = document.getElementById("managerEditStatus");
    var checkInEl = document.getElementById("managerEditCheckIn");
    var checkOutEl = document.getElementById("managerEditCheckOut");
    var checkInTimeEl = document.getElementById("managerEditCheckInTime");
    var checkOutTimeEl = document.getElementById("managerEditCheckOutTime");
    var adultsEl = document.getElementById("managerEditAdults");
    var childrenEl = document.getElementById("managerEditChildren");
    var childrenUnder6El = document.getElementById("managerEditChildrenUnder6");
    var roomEl = document.getElementById("managerEditRoomType");
    var cottageQtyEl = document.getElementById("managerEditCottageQty");
    var hallEl = document.getElementById("managerEditEventHall");
    var requestEl = document.getElementById("managerEditRequest");
    var noteEl = document.getElementById("managerEditNote");
    var cancelBtn = document.getElementById("managerEditCancelBtn");
    var closeBtn = document.getElementById("managerEditCloseBtn");
    var msg = document.getElementById("managerEditMsg");
    if (
      !overlay ||
      !form ||
      !fullNameEl ||
      !phoneEl ||
      !emailEl ||
      !checkInEl ||
      !checkOutEl ||
      !roomEl ||
      !noteEl ||
      !cottageQtyEl ||
      !hallEl
    ) {
      return;
    }

    var b = item.booking || {};
    var name = b.fullName || "Guest";

    function setMsg(ok, text) {
      if (!msg) return;
      msg.hidden = false;
      msg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      msg.textContent = text;
    }

    function resetMsg() {
      if (!msg) return;
      msg.hidden = true;
      msg.textContent = "";
      msg.className = "auth-msg";
    }

    function close() {
      overlay.setAttribute("hidden", "");
      resetMsg();
    }

    function normalizeStayType(v) {
      var x = String(v || "").trim().toLowerCase();
      if (x === "day_tour" || x === "daytour" || x === "day") return "day_tour";
      return "overnight";
    }

    function normalizeEditStatus(v) {
      var s = normalizeStatus(v);
      if (s === "Cancelled" || s === "Canceled") return "Cancelled";
      if (s === "Confirmed") return "Confirmed";
      if (s === "Approved") return "Approved";
      if (s === "Pending") return "Pending";
      // Fallbacks for payment/workflow labels
      if (/confirm/i.test(String(v || ""))) return "Confirmed";
      if (/approv/i.test(String(v || ""))) return "Approved";
      if (/cancel/i.test(String(v || ""))) return "Cancelled";
      return "Pending";
    }

    function timeInputValue(v) {
      var t = String(v || "").trim();
      if (!t) return "";
      // Accept "HH:MM" or "HH:MM:SS" or "H:MM AM"
      var m24 = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m24) {
        var hh = String(Math.min(23, Math.max(0, parseInt(m24[1], 10)))).padStart(2, "0");
        var mm = String(Math.min(59, Math.max(0, parseInt(m24[2], 10)))).padStart(2, "0");
        return hh + ":" + mm;
      }
      return "";
    }

    if (title) title.textContent = "Edit reservation — " + name;
    fullNameEl.value = b.fullName || "";
    phoneEl.value = b.phone || "";
    emailEl.value = b.email || item.accountEmail || "";
    if (stayTypeEl) stayTypeEl.value = normalizeStayType(b.stayType || b.poolUse);
    if (statusEl) statusEl.value = normalizeEditStatus(b.status);
    checkInEl.value = b.checkIn || "";
    checkOutEl.value = b.checkOut || "";
    if (checkInTimeEl) checkInTimeEl.value = timeInputValue(b.checkInTime);
    if (checkOutTimeEl) checkOutTimeEl.value = timeInputValue(b.checkOutTime);
    if (adultsEl) adultsEl.value = String(b.adults != null && b.adults !== "" ? b.adults : "1");
    if (childrenEl) childrenEl.value = String(b.children != null && b.children !== "" ? b.children : "0");
    if (childrenUnder6El) {
      childrenUnder6El.value = String(
        b.childrenUnder6 != null && b.childrenUnder6 !== "" ? b.childrenUnder6 : "0"
      );
    }
    roomEl.value = b.roomType || "none";
    cottageQtyEl.value = String(b.cottageQty != null && b.cottageQty !== "" ? b.cottageQty : "0");
    hallEl.value = b.eventHall ? String(b.eventHall) : "none";
    if (requestEl) requestEl.value = b.request || b.specialRequest || "";
    noteEl.value = b.managerNote || "";
    resetMsg();
    overlay.removeAttribute("hidden");
    fullNameEl.focus();

    function onCancel() {
      close();
    }

    function onOverlayClick(e) {
      if (e.target === overlay) close();
    }

    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    function onSubmit(e) {
      e.preventDefault();
      var newName = String(fullNameEl.value || "").trim();
      var newPhone = String(phoneEl.value || "").trim();
      var newEmail = String(emailEl.value || "").trim().toLowerCase();
      var newStayType = stayTypeEl ? normalizeStayType(stayTypeEl.value) : "overnight";
      var newStatus = statusEl ? normalizeEditStatus(statusEl.value) : normalizeEditStatus(b.status);
      var newCheckIn = String(checkInEl.value || "").trim();
      var newCheckOut = String(checkOutEl.value || "").trim();
      var newCheckInTime = checkInTimeEl ? String(checkInTimeEl.value || "").trim() : "";
      var newCheckOutTime = checkOutTimeEl ? String(checkOutTimeEl.value || "").trim() : "";
      var newAdults = adultsEl ? String(adultsEl.value || "1").trim() : "1";
      var newChildren = childrenEl ? String(childrenEl.value || "0").trim() : "0";
      var newChildrenUnder6 = childrenUnder6El ? String(childrenUnder6El.value || "0").trim() : "0";
      var newRoom = String(roomEl.value || "").trim().toLowerCase();
      var newNote = String(noteEl.value || "").trim();
      var newRequest = requestEl ? String(requestEl.value || "").trim() : "";
      var newCottageQty = String(cottageQtyEl.value || "0").trim();
      var newHall = String(hallEl.value || "none").trim();

      if (!newName || !newPhone || !newEmail || !newCheckIn || !newCheckOut || !newRoom) {
        setMsg(false, "Please fill in required guest and stay fields.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        setMsg(false, "Enter a valid email address.");
        return;
      }
      if (newCheckOut < newCheckIn) {
        setMsg(false, "Check-out must be on or after check-in.");
        return;
      }
      if (newStayType === "overnight" && newCheckOut <= newCheckIn) {
        setMsg(false, "Overnight stays need a check-out after check-in.");
        return;
      }
      if (parseInt(newAdults, 10) < 1) {
        setMsg(false, "At least 1 adult is required.");
        return;
      }

      var patch = {
        fullName: newName,
        phone: newPhone,
        email: newEmail,
        stayType: newStayType,
        poolUse: newStayType === "day_tour" ? "day_tour" : b.poolUse === "day_tour" ? "none" : b.poolUse || "none",
        status: newStatus,
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        checkInTime: newCheckInTime,
        checkOutTime: newCheckOutTime,
        adults: newAdults,
        children: newChildren,
        childrenUnder6: newChildrenUnder6,
        roomType: newRoom,
        cottageQty: newCottageQty,
        eventHall: newHall,
        request: newRequest,
        managerNote: newNote
      };

      var submitBtn = form.querySelector('button[type="submit"]');
      var BL = window.ElenestButtonLoading;
      if (BL) BL.set(submitBtn, true);
      Promise.resolve(patchBooking(item.accountEmail, b.id, patch))
        .then(function () {
          if (BL) BL.set(submitBtn, false);
          setMsg(true, "Saved.");
          setTimeout(function () {
            close();
            if (typeof onDone === "function") onDone();
          }, 150);
        })
        .catch(function () {
          if (BL) BL.set(submitBtn, false);
          setMsg(false, "Could not save. Please try again.");
        });
    }

    // One-shot bindings for this open.
    form.addEventListener("submit", onSubmit, { once: true });
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel, { once: true });
    if (closeBtn) closeBtn.addEventListener("click", onCancel, { once: true });
    overlay.addEventListener("click", onOverlayClick, { once: true });
    document.addEventListener("keydown", onKeydown, { once: true });
  }

  function getSectionIdFromHash(h) {
    var id = String(h || "");
    if (id.charAt(0) === "#") id = id.slice(1);
    var known = ["section-dashboard", "section-messages", "section-content", "section-manage", "section-calendar", "section-analytics", "section-recommendations"];
    if (known.indexOf(id) !== -1) return id;
    return "section-dashboard";
  }

  var currentSectionId = null;

  var managerCalView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var dashCalView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var selectedIsoDate = null;

  var eventNavSections = {
    "section-messages": true,
    "section-content": true,
    "section-manage": true,
    "section-calendar": true,
    "section-recommendations": true
  };

  function setActiveNav(targetSectionId) {
    var targetHref = "#" + String(targetSectionId || "");
    var navLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
    navLinks.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href === targetHref) a.classList.add("active");
      else a.classList.remove("active");
    });
    var eventToggle = document.getElementById("managerNavEventToggle");
    if (eventToggle) {
      if (eventNavSections[targetSectionId]) eventToggle.classList.add("active");
      else eventToggle.classList.remove("active");
    }
  }

  function showSection(sectionId) {
    sectionId = getSectionIdFromHash(sectionId);
    if (currentSectionId === sectionId) {
      setActiveNav(sectionId);
      return;
    }
    currentSectionId = sectionId;

    ["section-dashboard", "section-messages", "section-content", "section-manage", "section-calendar", "section-analytics", "section-recommendations"].forEach(function (sid) {
      var el = document.getElementById(sid);
      if (!el) return;
      setHidden(el, sid !== sectionId);
    });
    setActiveNav(sectionId);

    if (sectionId === "section-dashboard") {
      renderDashboard();
      pullLiveBookings();
    }
    else if (sectionId === "section-messages") {
      renderMessages();
      var msgApi = window.ElenestContactMessages;
      if (msgApi && typeof msgApi.refresh === "function") {
        msgApi.refresh().then(renderMessages).catch(function () {
          renderMessages();
        });
      }
    }
    else if (sectionId === "section-content") {
      if (window.ElenestContentManagement && window.ElenestContentManagement.renderSection) {
        window.ElenestContentManagement.renderSection();
      }
    }
    else if (sectionId === "section-manage") renderManage();
    else if (sectionId === "section-calendar") {
      renderCalendarSection();
      if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.refresh) {
        window.ElenestCalendarAccess.refresh();
      }
    }
    else if (sectionId === "section-analytics") {
      renderAnalytics();
      renderReports();
      pullLiveBookings();
    }
    else if (sectionId === "section-recommendations") renderRecommendations();
  }

  window.ElenestManagerContent = {
    renderMarketing: renderMarketingSection
  };

  function setMarketingMsg(elId, ok, text) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function renderMarketingList(kind, hostId, editFn) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.textContent = "";
    var N = window.ElenestNotifications;
    if (!N) return;
    var list = kind === "event" ? N.listManagerEvents() : N.listManagerPromotions();
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "admin-payment-empty";
      empty.textContent = "None yet. Add one using the form above.";
      host.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "admin-notif-campaign-item";
      var title = document.createElement("strong");
      title.textContent = item.title || "Untitled";
      card.appendChild(title);
      var msg = document.createElement("p");
      msg.className = "admin-notif-campaign-item__msg";
      msg.textContent = item.message || "";
      card.appendChild(msg);
      var actions = document.createElement("div");
      actions.className = "admin-payment-method-item__actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn--outline btn--small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        editFn(item);
      });
      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--outline btn--small";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        if (!confirm("Delete this item? This cannot be undone.")) return;
        var BL = window.ElenestButtonLoading;
        var work = function () {
          return Promise.resolve(N.deleteManagerItem(item.id)).then(function () {
            renderMarketingSection();
          });
        };
        if (BL) BL.run(delBtn, work);
        else work();
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function renderMarketingSection() {
    renderMarketingList("promotion", "managerPromotionsList", function (item) {
      var editId = document.getElementById("managerPromotionEditId");
      var title = document.getElementById("managerPromotionTitle");
      var message = document.getElementById("managerPromotionMessage");
      var cancel = document.getElementById("managerPromotionCancelBtn");
      var submit = document.getElementById("managerPromotionSubmitBtn");
      if (editId) editId.value = item.id || "";
      if (title) title.value = item.title || "";
      if (message) message.value = item.message || "";
      if (cancel) cancel.hidden = false;
      if (submit) submit.textContent = "Save Changes";
    });
    renderMarketingList("event", "managerEventsList", function (item) {
      var editId = document.getElementById("managerEventEditId");
      var title = document.getElementById("managerEventTitle");
      var message = document.getElementById("managerEventMessage");
      var date = document.getElementById("managerEventDate");
      var cancel = document.getElementById("managerEventCancelBtn");
      var submit = document.getElementById("managerEventSubmitBtn");
      if (editId) editId.value = item.id || "";
      if (title) title.value = item.title || "";
      if (message) message.value = item.message || "";
      if (date) date.value = item.eventDate || "";
      if (cancel) cancel.hidden = false;
      if (submit) submit.textContent = "Save Changes";
    });
  }

  function initMarketingHandlers() {
    var promoForm = document.getElementById("managerPromotionForm");
    var eventForm = document.getElementById("managerEventForm");
    var promoCancel = document.getElementById("managerPromotionCancelBtn");
    var eventCancel = document.getElementById("managerEventCancelBtn");

    if (promoCancel) {
      promoCancel.addEventListener("click", function () {
        if (promoForm) promoForm.reset();
        var editId = document.getElementById("managerPromotionEditId");
        if (editId) editId.value = "";
        promoCancel.hidden = true;
        var submit = document.getElementById("managerPromotionSubmitBtn");
        if (submit) submit.textContent = "Add Offer";
      });
    }
    if (eventCancel) {
      eventCancel.addEventListener("click", function () {
        if (eventForm) eventForm.reset();
        var editId = document.getElementById("managerEventEditId");
        if (editId) editId.value = "";
        eventCancel.hidden = true;
        var submit = document.getElementById("managerEventSubmitBtn");
        if (submit) submit.textContent = "Add Notice";
      });
    }

    if (promoForm) {
      promoForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var N = window.ElenestNotifications;
        if (!N) return;
        var editId = document.getElementById("managerPromotionEditId");
        var title = document.getElementById("managerPromotionTitle");
        var message = document.getElementById("managerPromotionMessage");
        var payload = {
          id: editId && editId.value ? editId.value.trim() : "",
          title: title ? title.value.trim() : "",
          message: message ? message.value.trim() : "",
          link: "activities.html"
        };
        if (!payload.title || !payload.message) {
          setMarketingMsg("managerPromotionMsg", false, "Please fill in the offer title and details.");
          return;
        }
        N.saveManagerPromotion(payload);
        setMarketingMsg("managerPromotionMsg", true, "Offer saved. Guests were notified automatically.");
        if (promoForm) promoForm.reset();
        if (editId) editId.value = "";
        if (promoCancel) promoCancel.hidden = true;
        renderMarketingSection();
      });
    }

    if (eventForm) {
      eventForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var N = window.ElenestNotifications;
        if (!N) return;
        var editId = document.getElementById("managerEventEditId");
        var title = document.getElementById("managerEventTitle");
        var message = document.getElementById("managerEventMessage");
        var eventDate = document.getElementById("managerEventDate");
        var payload = {
          id: editId && editId.value ? editId.value.trim() : "",
          title: title ? title.value.trim() : "",
          message: message ? message.value.trim() : "",
          eventDate: eventDate ? eventDate.value : "",
          link: "activities.html"
        };
        if (!payload.title || !payload.message) {
          setMarketingMsg("managerEventMsg", false, "Please fill in the event title and details.");
          return;
        }
        N.saveManagerEvent(payload);
        setMarketingMsg("managerEventMsg", true, "Event notice saved. Guests were notified automatically.");
        if (eventForm) eventForm.reset();
        if (editId) editId.value = "";
        if (eventCancel) eventCancel.hidden = true;
        renderMarketingSection();
      });
    }
  }

  function renderRecommendations() {
    var host = document.getElementById("managerRecommendationsList");
    if (!host) return;
    host.textContent = "";
    var items = [
      {
        title: "Guest rooms",
        text:
          "Use a pre-arrival checklist for each room: cooling, linens, toiletries, and odor control. Sign off by shift before guest check-in."
      },
      {
        title: "Pool operations",
        text:
          "Run pool safety checks every morning and before peak hours. Log water quality, towels, and slip-risk areas in one daily tracker."
      },
      {
        title: "Event hall readiness",
        text:
          "Confirm hall setup 24 hours before each event, including sound, lighting, seating, and cooling, to avoid same-day delays."
      },
      {
        title: "Cottages",
        text:
          "Inspect each cottage before arrival for maintenance, privacy, and complete amenities so the setup matches what guests booked."
      },
      {
        title: "Front desk response",
        text:
          "Set target response times for check-in and guest requests, then monitor completion per shift to keep service consistent."
      },
      {
        title: "Issue follow-up",
        text:
          "Assign one owner per reported issue and require closure notes within 24 hours so recurring concerns are resolved quickly."
      },
      {
        title: "Housekeeping handover",
        text:
          "Use one shift log for unfinished rooms, missing amenities, and guest requests so the next team can finish prep before check-in."
      },
      {
        title: "Dining and catering",
        text:
          "Confirm menu counts, dietary notes, and service times the day before each event. Stage plates, drinks, and backups before guests arrive."
      }
    ];
    items = items.slice(0, 8);
    host.className = "manager-rec-grid";
    host.innerHTML = items.map(function (it) {
      return (
        '<article class="manager-rec-card">' +
        '<h4 class="manager-rec-card__title">' +
        escapeHtml(it.title) +
        "</h4>" +
        '<p class="manager-rec-card__text">' +
        escapeHtml(it.text) +
        "</p>" +
        "</article>"
      );
    }).join("");

  }

  function counts() {
    var all = listBookings();
    var pending = 0, approved = 0, cancelled = 0;
    all.forEach(function (it) {
      var b = it.booking || {};
      var st = normalizeStatus(b.status);
      if (st === "Cancelled") cancelled++;
      else if (hasManagerClearance(b) || st === "Confirmed") approved++;
      else if (st === "Pending") pending++;
    });
    return { pending: pending, approved: approved, cancelled: cancelled, total: all.length };
  }

  function renderDashboard() {
    var c = counts();
    var pendingEl = document.getElementById("managerKpiPending");
    var approvedEl = document.getElementById("managerKpiApproved");
    var cancelledEl = document.getElementById("managerKpiCancelled");
    if (pendingEl) pendingEl.textContent = String(c.pending);
    if (approvedEl) approvedEl.textContent = String(c.approved);
    if (cancelledEl) cancelledEl.textContent = String(c.cancelled);

    renderDashboardCalendar();
    renderFeedbackPeople();

    // Dashboard KPIs + charts
    var all = listBookings();
    var totalNet = 0;
    all.forEach(function (it) {
      var b = it.booking || {};
      if (normalizeStatus(b.status) !== "Confirmed") return;
      totalNet += bookingIncome(b);
    });
    var netEl = document.getElementById("managerDashNetIncome");
    if (netEl) netEl.textContent = fmtPHP(totalNet);
    var tb = document.getElementById("managerDashTotalBookings");
    if (tb) tb.textContent = String(all.length);
    drawStatusChart(all, "managerDashStatusChart", "managerDashStatusLegend", {
      subId: "managerDashStatusSub"
    });
    var dashMonths = buildTrendMonths(all);
    drawTrendChart(all, "managerDashTrendChart", dashMonths, {
      tipId: "managerDashTrendTip",
      subId: "managerDashTrendSub"
    });
    fillInsightList("managerDashStatusInsightsList", buildStatusInsights(c));
    fillInsightList("managerDashTrendInsightsList", buildTrendInsights(dashMonths));
  }

  function renderDashboardCalendar() {
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") return;
    var host = document.getElementById("managerDashCalendarHost");
    var label = document.getElementById("managerDashCalMonthLabel");
    if (!host || !label) return;
    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: dashCalView,
      wizardState: { checkIn: null, checkOut: null },
      highlightRange: false,
      resortWideView: true
    });
  }

    function renderFeedbackPeople() {
    var host = document.getElementById("managerFeedbackList");
    if (!host) return;
    host.textContent = "";
    function getFeedbackList() {
      if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listLive === "function") {
        return window.ElenestGuestFeedback.listLive();
      }
      if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listAll === "function") {
        return window.ElenestGuestFeedback.listAll();
      }
      try {
        var raw = localStorage.getItem("elenest_feedback");
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    var feedback = getFeedbackList();
    if (!feedback.length) {
      // Seed with some realistic examples (and link to a real customer name if available).
      var allBookings = listBookings();
      var firstName = allBookings.length && allBookings[0].booking && allBookings[0].booking.fullName
        ? String(allBookings[0].booking.fullName)
        : "Joan Briones";
      feedback = [
        { id: "fb1", name: firstName, stars: 5, comment: "Very peaceful place. Staff are kind and rooms are spotless.", createdAt: new Date().toISOString() },
        { id: "fb2", name: "Mark Dela Cruz", stars: 4, comment: "Relaxing environment and attentive staff. Food was great too.", createdAt: new Date().toISOString() },
        { id: "fb3", name: "Angela Santos", stars: 5, comment: "Excellent service and smooth check-in. Perfect for celebrations.", createdAt: new Date().toISOString() }
      ];
    }

    feedback.slice(0, 3).forEach(function (f) {
      var card = document.createElement("article");
      card.className = "manager-feedback-card";

      var img = document.createElement("img");
      img.className = "manager-feedback-card__img";
      img.src = f.photo || "../Images/blog-s1.png";
      var guestName = feedbackGuestName(f);
      img.alt = guestName;
      card.appendChild(img);

      var body = document.createElement("div");
      body.className = "manager-feedback-card__body";

      var top = document.createElement("div");
      top.className = "manager-feedback-card__top";

      var nameEl = document.createElement("h4");
      nameEl.className = "manager-feedback-card__name";
      nameEl.textContent = feedbackGuestName(f);
      top.appendChild(nameEl);

      var stars = document.createElement("p");
      stars.className = "stars manager-feedback-card__stars";
      var s = Math.max(0, Math.min(5, Number(f.stars) || 0));
      stars.textContent = "★★★★★".slice(0, s) + "☆☆☆☆☆".slice(0, 5 - s);
      top.appendChild(stars);

      var when = document.createElement("span");
      when.className = "manager-feedback-card__when";
      when.textContent = fmtWhen(f.createdAt);
      top.appendChild(when);

      body.appendChild(top);

      var comment = document.createElement("p");
      comment.className = "manager-feedback-card__comment";
      comment.textContent = '"' + String(f.comment || "") + '"';
      body.appendChild(comment);

      card.appendChild(body);
      host.appendChild(card);
    });
  }

  function getMessages() {
    var api = window.ElenestContactMessages;
    if (api && typeof api.listAll === "function") {
      return api.listAll();
    }
    return [];
  }

  function saveMessages(list) {
    try {
      localStorage.setItem("elenest_customer_messages", JSON.stringify(list || []));
    } catch (e) {}
  }

  function getContactReplyApiUrl() {
    if (window.location.protocol === "file:") {
      return "http://localhost/Elenest_Resort/api/send-contact-reply.php";
    }
    var path = window.location.pathname || "";
    if (path.indexOf("/html/") !== -1) {
      return "../api/send-contact-reply.php";
    }
    return "api/send-contact-reply.php";
  }

  function setMessagesStatus(ok, text) {
    var el = document.getElementById("managerMessagesStatus");
    if (!el) return;
    el.hidden = !text;
    if (!text) return;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function appendSvgPath(svg, d) {
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }

  function createMessageActionButton(kind, label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "manager-msg-icon-btn manager-msg-icon-btn--" + kind;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (kind === "send") {
      appendSvgPath(svg, "M22 2 11 13");
      appendSvgPath(svg, "M22 2 15 22 11 13 2 9 22 2");
    } else {
      appendSvgPath(svg, "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21");
      appendSvgPath(svg, "M22 21H7");
      appendSvgPath(svg, "m5 11 9 9");
    }
    btn.appendChild(svg);

    var tip = document.createElement("span");
    tip.className = "manager-msg-icon-tip";
    tip.textContent = label;
    btn.appendChild(tip);
    return btn;
  }

  function sendContactReplyEmail(m, replyText) {
    var to = String((m && m.email) || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return Promise.reject(new Error("Customer email is missing or invalid."));
    }
    var reply = String(replyText || "").trim();
    if (!reply) {
      return Promise.reject(new Error("Reply message is required."));
    }
    return fetch(getContactReplyApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to,
        name: (m && m.name) ? String(m.name).trim() : "Guest",
        reply: reply,
        original_message: (m && m.message) ? String(m.message).trim() : "",
        message_id: m && m.id ? String(m.id) : ""
      })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || !data.ok) {
          throw new Error((data && data.message) || "Could not send email.");
        }
        return data;
      }, function () {
        throw new Error("Invalid response from email server.");
      });
    });
  }

  function renderMessages() {
    var host = document.getElementById("managerMessagesList");
    var empty = document.getElementById("managerMessagesEmpty");
    var pager = document.getElementById("managerMessagesPagination");
    if (!host || !empty) return;
    host.textContent = "";
    var api = window.ElenestContactMessages;
    var loadErr = api && typeof api.getLastError === "function" ? api.getLastError() : null;
    var all = getMessages();
    if (!all.length) {
      setHidden(empty, false);
      empty.textContent = loadErr
        ? ("Could not load customer_messages: " + loadErr)
        : "No customer messages yet.";
      if (loadErr) setMessagesStatus(false, loadErr);
      else setMessagesStatus(true, "Connected to table: customer_messages");
      if (pager) {
        pager.hidden = true;
        pager.textContent = "";
      }
      messagesPage = 1;
      return;
    }
    setHidden(empty, true);
    setMessagesStatus(true, "Showing " + all.length + " message(s) from customer_messages");
    var pageState = paginateItems(all, messagesPage, MESSAGES_PAGE_SIZE);
    messagesPage = pageState.page;
    renderPaginationControls(pager, pageState, function (page) {
      messagesPage = page;
      renderMessages();
      try {
        host.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    });
    var wrap = document.createElement("div");
    wrap.className = "manager-msg-table-wrap";
    var table = document.createElement("table");
    table.className = "manager-msg-table";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [
      { label: "Customer Name", cls: "manager-msg-col-name" },
      { label: "Message", cls: "manager-msg-col-message" },
      { label: "Date/Time", cls: "manager-msg-col-when" },
      { label: "Reply", cls: "manager-msg-col-reply" },
      { label: "Actions", cls: "manager-msg-col-actions" }
    ].forEach(function (col) {
      var th = document.createElement("th");
      th.scope = "col";
      th.className = col.cls;
      th.textContent = col.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    pageState.items.forEach(function (m) {
      var existingReply = m && m.reply ? String(m.reply) : "";
      var customerName = (m && m.name) ? String(m.name) : "Customer";
      var customerEmail = (m && m.email) ? String(m.email) : "";
      var bodyText = (m && m.message) ? String(m.message) : "";
      var whenText = fmtWhen(m && m.createdAt);

      var row = document.createElement("tr");
      row.className = "manager-msg-row" + (existingReply ? " manager-msg-row--replied" : "");

      var nameCell = document.createElement("td");
      nameCell.className = "manager-msg-col-name";
      var nameEl = document.createElement("strong");
      nameEl.className = "manager-msg-customer__name";
      nameEl.textContent = customerName;
      nameEl.title = customerEmail || customerName;
      nameCell.appendChild(nameEl);
      if (existingReply) {
        var pill = document.createElement("span");
        pill.className = "manager-msg-pill";
        pill.textContent = "Replied";
        pill.title = "Manager reply" + (m.repliedAt ? " • " + fmtWhen(m.repliedAt) : "") + ": " + existingReply;
        nameCell.appendChild(document.createTextNode(" "));
        nameCell.appendChild(pill);
      }

      var msgCell = document.createElement("td");
      msgCell.className = "manager-msg-col-message";
      var msgEl = document.createElement("span");
      msgEl.className = "manager-msg-body";
      msgEl.textContent = bodyText;
      if (bodyText) msgEl.title = bodyText;
      msgCell.appendChild(msgEl);

      var whenCell = document.createElement("td");
      whenCell.className = "manager-msg-when";
      whenCell.textContent = whenText;
      whenCell.title = whenText;

      var replyCell = document.createElement("td");
      replyCell.className = "manager-msg-col-reply";
      var replyInput = document.createElement("input");
      replyInput.type = "text";
      replyInput.className = "manager-msg-reply-input";
      replyInput.placeholder = existingReply ? "Update reply…" : "Write a reply…";
      replyInput.value = existingReply;
      replyInput.title = customerEmail
        ? "Sends from Elenest Resort SMTP to " + customerEmail
        : "This message has no email — ask the guest to resubmit via Contact Us with an email address.";
      replyCell.appendChild(replyInput);

      var actCell = document.createElement("td");
      actCell.className = "manager-msg-actions";
      var actions = document.createElement("div");
      actions.className = "manager-msg-actions__btns";
      var sendBtn = createMessageActionButton("send", "Send Reply");
      sendBtn.disabled = !customerEmail;
      var clearBtn = createMessageActionButton("clear", "Clear");
      actions.appendChild(sendBtn);
      actions.appendChild(clearBtn);
      actCell.appendChild(actions);

      row.appendChild(nameCell);
      row.appendChild(msgCell);
      row.appendChild(whenCell);
      row.appendChild(replyCell);
      row.appendChild(actCell);

      function persistReply(reply) {
        var id = m && m.id ? String(m.id) : "";
        var api = window.ElenestContactMessages;
        if (api && typeof api.saveReply === "function") {
          return api.saveReply(id, reply);
        }
        var stored = getMessages();
        var idx = -1;
        for (var i = 0; i < stored.length; i++) {
          if (String(stored[i].id || "") === id) { idx = i; break; }
        }
        if (idx === -1) return Promise.reject(new Error("Message not found"));
        stored[idx].reply = reply;
        stored[idx].repliedAt = reply ? new Date().toISOString() : null;
        stored[idx].status = reply ? "replied" : (stored[idx].status || "new");
        saveMessages(stored);
        return Promise.resolve(true);
      }

      sendBtn.addEventListener("click", function () {
        var reply = String(replyInput.value || "").trim();
        if (!reply) {
          replyInput.focus();
          setMessagesStatus(false, "Write a reply before sending.");
          return;
        }
        if (!customerEmail) return;
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(sendBtn, true);
        else sendBtn.disabled = true;
        setMessagesStatus(true, "Sending email to " + customerEmail + "…");
        sendContactReplyEmail(m, reply)
          .then(function (data) {
            return persistReply(reply).then(function () {
              return data;
            });
          })
          .then(function (data) {
            setMessagesStatus(true, (data && data.message) || ("Reply emailed to " + customerEmail + "."));
            renderMessages();
          })
          .catch(function (err) {
            if (BL) BL.set(sendBtn, false);
            else sendBtn.disabled = false;
            setMessagesStatus(false, (err && err.message) || "Could not send email.");
          });
      });

      replyInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          sendBtn.click();
        }
      });

      clearBtn.addEventListener("click", function () {
        replyInput.value = "";
        replyInput.focus();
      });

      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function renderApprovals() {
    var Auth = window.ElenestAuth;
    var managerUser = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;

    var host = document.getElementById("managerApprovalsList");
    var empty = document.getElementById("managerApprovalsEmpty");
    var filterEl = document.getElementById("managerApprovalsFilter");
    if (!host) return;
    host.textContent = "";

    var filter = filterEl ? String(filterEl.value || "pending").toLowerCase() : "pending";
    if (["pending", "approved", "cancelled", "all"].indexOf(filter) === -1) filter = "pending";

    var all = listBookings().slice().sort(sortBySubmittedDesc);
    var filtered = all.filter(function (it) {
      var b = it.booking || {};
      var st = normalizeStatus(b.status);
      if (filter === "all") return true;
      if (filter === "pending") return st === "Pending" && !hasManagerClearance(b);
      if (filter === "approved") return hasManagerClearance(b) || st === "Confirmed";
      if (filter === "cancelled") return st === "Cancelled";
      return true;
    });

    if (!all.length) {
      setHidden(empty, false);
      if (empty) empty.textContent = "No reservations available.";
      return;
    }
    if (!filtered.length) {
      setHidden(empty, false);
      if (empty) empty.textContent = "No reservations match the selected filter.";
      return;
    }
    setHidden(empty, true);

    function onChange() {
      renderDashboard();
      renderApprovals();
      renderManage();
      renderAnalytics();
      renderReports();
    }

    filtered.forEach(function (it) {
      host.appendChild(buildApprovalCard(it, managerUser, onChange));
    });
  }

  function renderManage() {
    var host = document.getElementById("managerManageList");
    var empty = document.getElementById("managerManageEmpty");
    var pager = document.getElementById("managerManagePagination");
    var searchEl = document.getElementById("managerManageSearch");
    if (!host) return;
    host.textContent = "";

    var q = searchEl ? String(searchEl.value || "").trim().toLowerCase() : "";

    var all = listBookings().slice().sort(sortBySubmittedDesc);
    var filtered = all.filter(function (it) { return bookingMatchesQuery(it, q); });

    function hidePager() {
      if (!pager) return;
      pager.hidden = true;
      pager.textContent = "";
    }

    if (!all.length) {
      setHidden(empty, false);
      if (empty) empty.textContent = "No reservations found.";
      hidePager();
      managePage = 1;
      return;
    }
    if (!filtered.length) {
      setHidden(empty, false);
      if (empty) empty.textContent = "No reservations match your search.";
      hidePager();
      managePage = 1;
      return;
    }
    setHidden(empty, true);

    var pageState = paginateItems(filtered, managePage, MANAGE_PAGE_SIZE);
    managePage = pageState.page;
    renderPaginationControls(pager, pageState, function (page) {
      managePage = page;
      renderManage();
      try {
        host.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    });

    var wrap = document.createElement("div");
    wrap.className = "manager-msg-table-wrap";
    var table = document.createElement("table");
    table.className = "manager-msg-table manager-reserve-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [
      { label: "Guest", cls: "manager-msg-col-name" },
      { label: "Status", cls: "manager-reserve-col-status" },
      { label: "ID", cls: "manager-reserve-col-id" },
      { label: "Stay", cls: "manager-reserve-col-stay" },
      { label: "Record key", cls: "manager-reserve-col-key" },
      { label: "Room", cls: "manager-reserve-col-room" },
      { label: "Cottages", cls: "manager-reserve-col-qty" },
      { label: "Event hall", cls: "manager-reserve-col-hall" },
      { label: "Actions", cls: "manager-msg-col-actions" }
    ].forEach(function (col) {
      var th = document.createElement("th");
      th.scope = "col";
      th.className = col.cls;
      th.textContent = col.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    var onEditDone = function () {
      renderManage();
      renderApprovals();
      renderAnalytics();
      renderReports();
    };
    pageState.items.forEach(function (it) {
      tbody.appendChild(buildManageRow(it, onEditDone));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function renderManagerCalendar() {
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") return;
    var host = document.getElementById("managerCalendarHost");
    var label = document.getElementById("managerCalMonthLabel");
    if (!host || !label) return;
    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: managerCalView,
      wizardState: { checkIn: null, checkOut: null },
      highlightRange: false,
      allowManagerToggle: true,
      allowUnavailableClick: true,
      resortWideView: true,
      selectedIso: selectedIsoDate,
      onDayClick: function (iso) {
        selectedIsoDate = iso;
        renderManagerCalendar();
        renderAppointmentsForSelectedDate();
      }
    });
  }

  function isoToUtcDate(iso) {
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10) - 1;
    var d = parseInt(iso.slice(8, 10), 10);
    return new Date(Date.UTC(y, m, d));
  }

  function isIsoInStay(iso, checkIn, checkOut) {
    if (!iso || !checkIn || !checkOut) return false;
    try {
      var cur = isoToUtcDate(checkIn);
      var end = isoToUtcDate(checkOut);
      var target = isoToUtcDate(iso);
      return target >= cur && target < end;
    } catch (e) {
      return false;
    }
  }

  function buildAppointmentCard(item) {
    var b = item.booking || {};
    var st = normalizeStatus(b.status);

    var card = document.createElement("article");
    card.className = "manager-appt-card";

    var head = document.createElement("div");
    head.className = "manager-appt-card__head";

    var nameEl = document.createElement("h4");
    nameEl.className = "manager-appt-card__name";
    nameEl.textContent = b.fullName || "Guest";
    head.appendChild(nameEl);

    var badge = document.createElement("span");
    applyManagerStatusBadge(badge, b, st);
    head.appendChild(badge);
    card.appendChild(head);

    var meta = document.createElement("div");
    meta.className = "manager-appt-card__meta";

    function addCell(label, val) {
      var cell = document.createElement("div");
      cell.className = "manager-appt-card__cell";
      var lab = document.createElement("span");
      lab.className = "manager-appt-card__label";
      lab.textContent = label;
      var v = document.createElement("span");
      v.className = "manager-appt-card__value";
      v.textContent = val === undefined || val === null || val === "" ? "—" : String(val);
      cell.appendChild(lab);
      cell.appendChild(v);
      meta.appendChild(cell);
    }

    addCell("Stay begins", fmtDateLong(b.checkIn));
    addCell("Check-out", fmtDateLong(b.checkOut));
    addCell("Room type", labelRoomType(b.roomType));
    addCell("Email", b.email || item.accountEmail);
    addCell("Record key", item.accountEmail);

    card.appendChild(meta);

    var sub = document.createElement("p");
    sub.className = "manager-appt-card__sub";
    sub.textContent = "ID: " + (b.id || "—") + " • Submitted " + fmtWhen(b.submittedAt);
    card.appendChild(sub);

    return card;
  }

  function renderAppointmentsForSelectedDate() {
    var labelEl = document.getElementById("managerSelectedDateLabel");
    var host = document.getElementById("managerAppointmentsList");
    var empty = document.getElementById("managerAppointmentsEmpty");
    var statusEl = document.getElementById("managerSelectedDateStatus");
    var blockBtn = document.getElementById("managerBlockBtn");
    var unblockBtn = document.getElementById("managerUnblockBtn");
    if (!labelEl || !host || !empty) return;

    if (!selectedIsoDate) {
      labelEl.textContent = "—";
      if (statusEl) statusEl.textContent = "—";
      host.textContent = "";
      empty.textContent = "Select a date to view appointments.";
      setHidden(empty, false);
      if (blockBtn) blockBtn.disabled = true;
      if (unblockBtn) unblockBtn.disabled = true;
      return;
    }

    labelEl.textContent = selectedIsoDate;
    (function syncDateControls() {
      var av = window.ElenestAvailability;
      if (!av || typeof av.getUnavailableKind !== "function") {
        if (statusEl) statusEl.textContent = "Status: —";
        if (blockBtn) blockBtn.disabled = true;
        if (unblockBtn) unblockBtn.disabled = true;
        return;
      }
      var kind = av.getUnavailableKind(selectedIsoDate);
      var facility =
        typeof av.getDateFacilityStatus === "function" ? av.getDateFacilityStatus(selectedIsoDate) : null;
      var isManagerBlocked = kind === "manager";
      var isPendingDate = kind === "pending" || !!(facility && facility.hasPending);
      var isBooked = kind === "booked" || kind === "limited" || kind === "hold" || kind === "google" || kind === "pending";
      var label = "Available";
      if (isPendingDate) {
        label =
          (facility && facility.label) ||
          (window.ElenestUnitAvailability &&
          typeof window.ElenestUnitAvailability.pendingCalendarLabel === "function"
            ? window.ElenestUnitAvailability.pendingCalendarLabel()
            : "Pending Admin Confirmation");
      } else if (isBooked) label = "Booked";
      else if (isManagerBlocked) label = "Block";
      else if (kind) label = "Unavailable";
      var pending =
        window.ElenestCalendarAccess && typeof window.ElenestCalendarAccess.pendingForDate === "function"
          ? window.ElenestCalendarAccess.pendingForDate(selectedIsoDate)
          : null;
      if (pending) {
        label += " · Pending " + (pending.action === "unblock" ? "unblock" : "block") + " request";
      }
      if (statusEl) statusEl.textContent = "Status: " + label;
      if (blockBtn) blockBtn.disabled = isBooked || isManagerBlocked || !!pending;
      if (unblockBtn) unblockBtn.disabled = isBooked || !isManagerBlocked || !!pending;
    })();

    host.textContent = "";

    var items = listBookings()
      .filter(function (it) {
        var b = it.booking || {};
        if (!b.checkIn || !b.checkOut) return false;
        return isIsoInStay(selectedIsoDate, b.checkIn, b.checkOut);
      })
      .sort(function (a, c) {
        var ai = (a.booking && a.booking.checkIn) || "";
        var bi = (c.booking && c.booking.checkIn) || "";
        if (ai !== bi) return ai < bi ? -1 : 1;
        return sortBySubmittedDesc(a, c);
      });

    if (!items.length) {
      empty.textContent = "No appointments for this date.";
      setHidden(empty, false);
      return;
    }
    setHidden(empty, true);
    items.forEach(function (it) {
      host.appendChild(buildAppointmentCard(it));
    });
  }

  function renderCalendarSection() {
    if (window.ElenestAvailability && typeof window.ElenestAvailability.refreshManagerBlocks === "function") {
      window.ElenestAvailability.refreshManagerBlocks().finally(function () {
        renderManagerCalendar();
        renderAppointmentsForSelectedDate();
      });
      return;
    }
    renderManagerCalendar();
    renderAppointmentsForSelectedDate();
  }

  function isSameMonthByIsoDate(iso, y, m) {
    if (!iso) return false;
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return false;
      return d.getFullYear() === y && d.getMonth() === m;
    } catch (e) {
      return false;
    }
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoFromLocalDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseIsoDateLocal(iso) {
    var s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDateOfficial(iso) {
    var d = parseIsoDateLocal(iso);
    if (!d) return iso ? String(iso) : "—";
    return d.toLocaleDateString("en-PH", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function fmtDateTimeOfficial(d) {
    try {
      return d.toLocaleString("en-PH", {
        dateStyle: "long",
        timeStyle: "short"
      });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function bookingIncome(b) {
    var income = toNumberOrNull(b && (b.totalEstimate != null ? b.totalEstimate : b.total_estimate));
    if (income === null) income = toNumberOrNull(b && (b.amountDown != null ? b.amountDown : b.amount_down));
    return income === null ? 0 : income;
  }

  function displayStatusForChart(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingDisplayStatus === "function") {
      return PF.bookingDisplayStatus(b);
    }
    var st = normalizeStatus(b && b.status);
    if (st === "Checked Out") return "Completed";
    if (st === "Checked In") return "Confirmed";
    return st === "Confirmed" || st === "Cancelled" ? st : "Pending";
  }

  function facilityCategoryForBooking(b) {
    b = b || {};
    var sheet = String(b.sheetType || b.type || b.room_type || b.roomType || "")
      .trim()
      .toLowerCase();
    if (sheet === "reservation") return "Rooms";
    if (sheet === "entrance") return "Entrance";
    if (sheet === "hall rental" || sheet === "hall_rental") return "Event halls";
    if (sheet === "event") return "Events";

    var cottageCount =
      (Array.isArray(b.cottageCatalogNames) ? b.cottageCatalogNames.length : 0) ||
      (Array.isArray(b.cottageCatalogIds) ? b.cottageCatalogIds.length : 0) ||
      Number(b.cottageQty) ||
      0;
    var hallCount =
      (Array.isArray(b.hallCatalogNames) ? b.hallCatalogNames.length : 0) ||
      (Array.isArray(b.hallCatalogIds) ? b.hallCatalogIds.length : 0) ||
      (b.hallCatalogName ? 1 : 0) ||
      (b.eventHall && String(b.eventHall).toLowerCase() !== "none" ? 1 : 0);
    var roomCount =
      (Array.isArray(b.roomCatalogNames) ? b.roomCatalogNames.length : 0) ||
      (Array.isArray(b.roomCatalogIds) ? b.roomCatalogIds.length : 0) ||
      (b.roomCatalogName ? 1 : 0) ||
      (b.roomType && String(b.roomType).toLowerCase() !== "none" ? 1 : 0);
    var poolOnly = String(b.poolUse || "").toLowerCase() === "pool_only";

    if (cottageCount) return "Cottages";
    if (hallCount) return "Event halls";
    if (poolOnly) return "Entrance";
    if (roomCount) return "Rooms";
    if (/hall|event/.test(sheet)) return "Event halls";
    if (/entrance|pool/.test(sheet)) return "Entrance";
    if (/cottage|cabana/.test(sheet)) return "Cottages";
    if (/room|reservation/.test(sheet)) return "Rooms";
    return "Other";
  }

  function classifySentimentFromStars(stars) {
    var s = Number(stars || 0);
    if (s >= 4) return "pos";
    if (s === 3) return "neu";
    if (s > 0 && s <= 2) return "neg";
    return "neu";
  }

  function stayNights(b) {
    var a = parseIsoDateLocal(b && b.checkIn);
    var c = parseIsoDateLocal(b && b.checkOut);
    if (!a || !c) return 0;
    var n = Math.round((c.getTime() - a.getTime()) / 86400000);
    return n > 0 ? n : 0;
  }

  function bookingAnchorDate(b) {
    var iso = String((b && b.checkIn) || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    var submitted = String((b && b.submittedAt) || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(submitted)) return submitted;
    return "";
  }

  function isConfirmedIncome(b) {
    return normalizeStatus(b && b.status) === "Confirmed";
  }

  function isApprovedCount(b) {
    var st = normalizeStatus(b && b.status);
    return st === "Confirmed" || hasManagerClearance(b);
  }

  function rangeForPreset(preset) {
    var now = new Date();
    var today = isoFromLocalDate(now);
    if (preset === "last6") {
      return { from: isoFromLocalDate(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to: today };
    }
    if (preset === "ytd") {
      return { from: now.getFullYear() + "-01-01", to: today };
    }
    if (preset === "all") {
      return { from: "", to: "" };
    }
    if (preset === "custom") return null;
    return { from: isoFromLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }

  function syncReportRangeInputs(preset) {
    var bounds = rangeForPreset(preset);
    var fromEl = document.getElementById("managerReportFrom");
    var toEl = document.getElementById("managerReportTo");
    if (!fromEl || !toEl || !bounds) return;
    fromEl.value = bounds.from || "";
    toEl.value = bounds.to || "";
    fromEl.disabled = preset === "all";
    toEl.disabled = preset === "all";
  }

  function ensureReportRangeDefaults() {
    var presetEl = document.getElementById("managerReportPreset");
    var fromEl = document.getElementById("managerReportFrom");
    var toEl = document.getElementById("managerReportTo");
    if (!presetEl || !fromEl || !toEl) return;
    if (!presetEl.value) presetEl.value = "month";
    if (presetEl.value !== "custom" || !fromEl.value || !toEl.value) {
      if (presetEl.value !== "custom") syncReportRangeInputs(presetEl.value);
    }
    if (presetEl.value === "custom") {
      fromEl.disabled = false;
      toEl.disabled = false;
      if (!fromEl.value || !toEl.value) {
        var fallback = rangeForPreset("month");
        if (!fromEl.value) fromEl.value = fallback.from;
        if (!toEl.value) toEl.value = fallback.to;
      }
    }
  }

  function getReportRange() {
    ensureReportRangeDefaults();
    var presetEl = document.getElementById("managerReportPreset");
    var fromEl = document.getElementById("managerReportFrom");
    var toEl = document.getElementById("managerReportTo");
    var preset = (presetEl && presetEl.value) || "month";
    var from = fromEl ? String(fromEl.value || "").slice(0, 10) : "";
    var to = toEl ? String(toEl.value || "").slice(0, 10) : "";
    if (from && to && from > to) {
      var swap = from;
      from = to;
      to = swap;
      if (fromEl) fromEl.value = from;
      if (toEl) toEl.value = to;
    }
    var presetLabels = {
      month: "This month",
      last6: "Last 6 months",
      ytd: "Year to date",
      all: "All records",
      custom: "Custom range"
    };
    var label;
    if (preset === "all" || (!from && !to)) {
      label = "All recorded reservations as of " + fmtDateOfficial(isoFromLocalDate(new Date()));
    } else {
      label = fmtDateOfficial(from) + " through " + fmtDateOfficial(to);
    }
    return {
      preset: preset,
      presetLabel: presetLabels[preset] || "Selected period",
      from: from,
      to: to,
      label: label
    };
  }

  function bookingInRange(b, range) {
    if (!range || range.preset === "all" || (!range.from && !range.to)) return true;
    var d = bookingAnchorDate(b);
    if (!d) return false;
    if (range.from && d < range.from) return false;
    if (range.to && d > range.to) return false;
    return true;
  }

  function countsFromItems(items) {
    var pending = 0, approved = 0, cancelled = 0;
    (items || []).forEach(function (it) {
      var b = it.booking || {};
      var st = normalizeStatus(b.status);
      if (st === "Cancelled") cancelled++;
      else if (isApprovedCount(b)) approved++;
      else if (st === "Pending") pending++;
    });
    return {
      pending: pending,
      approved: approved,
      cancelled: cancelled,
      total: (items || []).length
    };
  }

  function statusBreakdown(items) {
    var map = {
      Pending: 0,
      Confirmed: 0,
      "Checked In": 0,
      "Checked Out": 0,
      Cancelled: 0
    };
    (items || []).forEach(function (it) {
      var st = normalizeStatus((it.booking || {}).status);
      if (map[st] == null) map[st] = 0;
      map[st] += 1;
    });
    return map;
  }

  function tallyByLabel(items, labelFn) {
    var map = {};
    (items || []).forEach(function (it) {
      var b = it.booking || {};
      var label = labelFn(b);
      if (!map[label]) {
        map[label] = { label: label, bookings: 0, approved: 0, cancelled: 0, income: 0, nights: 0 };
      }
      var row = map[label];
      row.bookings += 1;
      row.nights += stayNights(b);
      var st = normalizeStatus(b.status);
      if (st === "Cancelled") row.cancelled += 1;
      if (isApprovedCount(b)) row.approved += 1;
      if (isConfirmedIncome(b)) row.income += bookingIncome(b);
    });
    return Object.keys(map)
      .map(function (k) { return map[k]; })
      .sort(function (a, c) { return c.bookings - a.bookings; });
  }

  function buildTrendMonthsForRange(items, range) {
    var end = parseIsoDateLocal(range && range.to) || new Date();
    var sixBack = new Date(end.getFullYear(), end.getMonth() - 5, 1);
    var start = sixBack;
    if (range && range.from) {
      var fromDate = parseIsoDateLocal(range.from);
      if (fromDate) {
        var fromMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
        if (fromMonth < sixBack) start = fromMonth;
      }
    }
    var months = [];
    var cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    var endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    var guard = 0;
    while (cursor <= endMonth && guard < 24) {
      var mk = cursor.getFullYear() + "-" + pad2(cursor.getMonth() + 1);
      months.push({
        key: mk,
        label: cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        fullLabel: cursor.toLocaleDateString("en-PH", { month: "long", year: "numeric" }),
        bookings: 0,
        approved: 0,
        cancelled: 0,
        income: 0
      });
      cursor.setMonth(cursor.getMonth() + 1);
      guard += 1;
    }
    if (!months.length) return buildTrendMonths(items);
    var idxByKey = {};
    months.forEach(function (row, i) { idxByKey[row.key] = i; });
    (items || []).forEach(function (it) {
      var b = it.booking || {};
      var mk = monthKeyFromIso(b.checkIn || b.submittedAt);
      if (!mk || idxByKey[mk] == null) return;
      var bucket = months[idxByKey[mk]];
      bucket.bookings += 1;
      var st = normalizeStatus(b.status);
      if (st === "Cancelled") bucket.cancelled += 1;
      if (isApprovedCount(b)) bucket.approved += 1;
      if (isConfirmedIncome(b)) bucket.income += bookingIncome(b);
    });
    return months;
  }

  function computeManagerReport() {
    var range = getReportRange();
    var all = listBookingsAll();
    var items = all.filter(function (it) {
      return bookingInRange(it.booking || {}, range);
    });
    var c = countsFromItems(items);
    var periodIncome = 0;
    var allTimeIncome = 0;
    var periodNights = 0;
    all.forEach(function (it) {
      var b = it.booking || {};
      if (isConfirmedIncome(b)) allTimeIncome += bookingIncome(b);
    });
    items.forEach(function (it) {
      var b = it.booking || {};
      periodNights += stayNights(b);
      if (isConfirmedIncome(b)) periodIncome += bookingIncome(b);
    });
    var rooms = tallyByLabel(items, function (b) {
      return labelRoomType(b.roomType || "none");
    });
    var halls = tallyByLabel(items, function (b) {
      return labelEventHall(b.eventHall);
    });
    var topRoom = rooms[0] || null;
    var months = buildTrendMonthsForRange(all, range);
    var statuses = statusBreakdown(items);
    var decided = c.approved + c.cancelled;
    return {
      generatedAt: new Date(),
      range: range,
      all: all,
      items: items,
      counts: c,
      statuses: statuses,
      periodIncome: periodIncome,
      allTimeIncome: allTimeIncome,
      periodNights: periodNights,
      rooms: rooms,
      halls: halls,
      topRoom: topRoom,
      months: months,
      approvalRate: decided ? Math.round((c.approved / decided) * 100) : 0,
      avgBookingValue: c.approved ? periodIncome / Math.max(1, items.filter(function (it) {
        return isConfirmedIncome(it.booking || {});
      }).length) : 0,
      statusInsights: buildStatusInsights(c),
      trendInsights: buildTrendInsights(months)
    };
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderAnalytics() {
    var report = computeManagerReport();
    var periodBookings = report.counts.total;
    setText("managerKpiMonthlyBookings", String(periodBookings));
    setText("managerKpiMonthlyApproved", String(report.counts.approved));
    setText("managerKpiMonthlyIncome", fmtPHP(report.periodIncome));
    setText("managerKpiTotalIncome", fmtPHP(report.allTimeIncome));
    var periodWord = report.range.preset === "month" ? "this month" : "in period";
    setText("managerKpiBookingsLabel", "Bookings " + periodWord);
    setText("managerKpiApprovedLabel", "Approved " + periodWord);
    setText(
      "managerKpiPeriodIncomeLabel",
      report.range.preset === "month" ? "Monthly income (approved)" : "Period income (approved)"
    );
    setText("managerKpiTotalIncomeLabel", "Total income (all-time approved)");
    setText(
      "managerReportLiveStampText",
      "Live · updated " + fmtDateTimeOfficial(report.generatedAt)
    );
    return report;
  }

  function renderReports() {
    var report = computeManagerReport();
    paintManagerReports(report);
    return report;
  }

  function paintManagerReports(report) {
    var el = document.getElementById("managerReportSummary");
    if (el) {
      var topRoomLabel = report.topRoom
        ? report.topRoom.label + " (" + report.topRoom.approved + " approved)"
        : "—";
      el.innerHTML =
        '<div class="manager-report-summary__meta">' +
        '<span class="manager-report-live__dot" aria-hidden="true"></span>' +
        "Updated " +
        escapeHtml(fmtDateTimeOfficial(report.generatedAt)) +
        " · Coverage: " +
        escapeHtml(report.range.label) +
        " · Live records" +
        "</div>" +
        '<div class="manager-report-summary__section">' +
        '<div class="manager-report-summary__section-title">Totals (selected period)</div>' +
        '<div class="manager-report-summary__grid manager-report-summary__grid--4">' +
        buildReportRow("Total bookings", report.counts.total) +
        buildReportRow("Pending approvals", report.counts.pending) +
        buildReportRow("Approved", report.counts.approved) +
        buildReportRow("Cancelled", report.counts.cancelled) +
        "</div></div>" +
        '<div class="manager-report-summary__section">' +
        '<div class="manager-report-summary__section-title">Revenue (approved)</div>' +
        '<div class="manager-report-summary__grid manager-report-summary__grid--2">' +
        buildReportRow("Selected period", fmtPHP(report.periodIncome)) +
        buildReportRow("All time", fmtPHP(report.allTimeIncome)) +
        "</div></div>" +
        '<div class="manager-report-summary__section">' +
        '<div class="manager-report-summary__section-title">Highlights</div>' +
        '<div class="manager-report-summary__grid manager-report-summary__grid--2">' +
        buildReportRow("Top room type", topRoomLabel) +
        buildReportRow("Stay nights in period", report.periodNights) +
        "</div></div>";
    }

    /* Mirror Admin Report & Analytics chart set (same visuals + live data). */
    drawManagerBookingTrendsWave(report.all);
    drawStatusChart(report.all, "managerReportStatusChart", "managerReportStatusLegend", {
      subId: "managerReportStatusSub"
    });
    drawFacilityUsageChart(report.all, "managerReportFacilityChart");
    drawRevenueChart(report.all, buildMonthBuckets(12, report.all), "managerReportRevenueChart", {
      tipId: "managerReportRevenueTip",
      subId: "managerReportRevenueSub"
    });
    renderManagerGuestReviews();
    var EV = window.ElenestModelEvaluation;
    if (EV && typeof EV.render === "function") {
      try {
        EV.render();
      } catch (eEval) {
        /* ignore */
      }
    }
    fillInsightList("managerReportTrendInsightsList", buildTrendInsights(buildMonthBuckets(12, report.all)));
    setText(
      "managerReportStatusChartTitle",
      "Booking status"
    );
    return report;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function buildReportRow(label, value) {
    return (
      '<div class="manager-report-summary__row">' +
      '<span class="manager-report-summary__label">' +
      escapeHtml(label) +
      "</span>" +
      '<span class="manager-report-summary__value">' +
      escapeHtml(value) +
      "</span>" +
      "</div>"
    );
  }

  function pullLiveBookings() {
    var B = window.ElenestBookings;
    function applyLiveView() {
      renderDashboard();
      if (currentSectionId === "section-analytics") {
        renderAnalytics();
        renderReports();
      }
    }
    var chain = Promise.resolve();
    if (B && typeof B.refresh === "function") {
      chain = Promise.resolve(B.refresh(true)).catch(function () {});
    }
    if (B && typeof B.syncLivePaymentStatuses === "function") {
      chain = chain.then(function () {
        return Promise.resolve(B.syncLivePaymentStatuses()).catch(function () {});
      });
    }
    return chain.then(applyLiveView).catch(applyLiveView);
  }

  function fillInsightList(listId, items) {
    var list = document.getElementById(listId);
    if (!list) return;
    list.textContent = "";
    (items || []).forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function pctShare(part, total) {
    if (!total) return "0%";
    return Math.round((Number(part) / Number(total)) * 100) + "%";
  }

  function padInsightItems(items, extras) {
    var out = (items || []).slice(0, 4);
    var i = 0;
    extras = extras || [];
    while (out.length < 4 && extras[i]) {
      if (out.indexOf(extras[i]) === -1) out.push(extras[i]);
      i += 1;
    }
    return out.slice(0, 4);
  }

  function buildStatusInsights(c) {
    c = c || {};
    var pending = Number(c.pending) || 0;
    var approved = Number(c.approved) || 0;
    var cancelled = Number(c.cancelled) || 0;
    var total = Number(c.total) || pending + approved + cancelled;
    if (!total) {
      return [
        "No reservations yet. New bookings will appear here automatically.",
        "Pending, approved, and cancelled counts update as soon as a reservation changes.",
        "Use this chart to see how much of the pipeline still needs action.",
        "Approved share is the main signal of confirmed occupancy."
      ];
    }

    var rows = [
      { label: "Approved", value: approved },
      { label: "Pending", value: pending },
      { label: "Cancelled", value: cancelled }
    ].sort(function (a, b) { return b.value - a.value; });
    var top = rows[0];
    var items = [
      top.label +
        " is the largest share (" +
        top.value +
        " of " +
        total +
        ", " +
        pctShare(top.value, total) +
        ")."
    ];

    if (pending) {
      items.push(
        pending +
          " reservation" +
          (pending === 1 ? "" : "s") +
          " still need review before they become official stays."
      );
    } else {
      items.push("No pending reservations are waiting for approval right now.");
    }

    items.push(
      "Cancellations account for " +
        pctShare(cancelled, total) +
        " of all reservations (" +
        cancelled +
        ")."
    );

    var decided = approved + cancelled;
    if (decided) {
      items.push(
        "Approval rate among decided bookings is " +
          pctShare(approved, decided) +
          " (" +
          approved +
          " approved vs " +
          cancelled +
          " cancelled)."
      );
    }

    return padInsightItems(items, [
      "Watch the pending share: a growing queue usually means guests are waiting on payment or confirmation.",
      "A high cancelled share is a cue to review holds, payment timing, and guest follow-up."
    ]);
  }

  function monthKeyFromIso(iso) {
    if (!iso || String(iso).length < 7) return null;
    return String(iso).slice(0, 7);
  }

  function buildTrendMonths(items) {
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var mk = d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
      months.push({
        key: mk,
        label: d.toLocaleDateString(undefined, { month: "short" }),
        bookings: 0,
        income: 0
      });
    }
    var idxByKey = {};
    months.forEach(function (b, i2) { idxByKey[b.key] = i2; });

    (items || []).forEach(function (it) {
      var b = it.booking || {};
      var mk = monthKeyFromIso(b.checkIn || b.submittedAt);
      if (!mk || idxByKey[mk] == null) return;
      var bucket = months[idxByKey[mk]];
      bucket.bookings += 1;
      if (normalizeStatus(b.status) === "Confirmed") {
        bucket.income += bookingIncome(b);
      }
    });
    return months;
  }

  function pickMonthExtrema(months, key) {
    var max = months[0];
    var min = months[0];
    months.forEach(function (m) {
      if (m[key] > max[key]) max = m;
      if (m[key] < min[key]) min = m;
    });
    return { max: max, min: min };
  }

  function buildTrendInsights(months) {
    months = months || [];
    if (!months.length) {
      return ["No six-month reservation history is available yet."];
    }
    var totalBookings = months.reduce(function (a, m) { return a + m.bookings; }, 0);
    var totalIncome = months.reduce(function (a, m) { return a + m.income; }, 0);
    if (!totalBookings && !totalIncome) {
      return padInsightItems(
        ["No reservation activity in this trend window yet. New stays will show here automatically."],
        [
          "Green bars are monthly reservation counts.",
          "The pink line is approved income for those same months.",
          "Compare the latest month with the peak to see if demand is cooling."
        ]
      );
    }

    var bookExt = pickMonthExtrema(months, "bookings");
    var incExt = pickMonthExtrema(months, "income");
    var latest = months[months.length - 1];
    var prev = months.length > 1 ? months[months.length - 2] : null;
    var items = [];

    items.push(
      "Reservation volume peaked in " +
        bookExt.max.label +
        " (" +
        bookExt.max.bookings +
        ") and was lowest in " +
        bookExt.min.label +
        " (" +
        bookExt.min.bookings +
        ")."
    );

    items.push(
      "Approved income was strongest in " +
        incExt.max.label +
        " (" +
        fmtPHP(incExt.max.income) +
        ") and weakest in " +
        incExt.min.label +
        " (" +
        fmtPHP(incExt.min.income) +
        ")."
    );

    if (prev) {
      if (latest.bookings > prev.bookings) {
        items.push(
          latest.label +
            " is up versus " +
            prev.label +
            " (" +
            latest.bookings +
            " vs " +
            prev.bookings +
            " reservations)."
        );
      } else if (latest.bookings < prev.bookings) {
        items.push(
          latest.label +
            " is softer than " +
            prev.label +
            " (" +
            latest.bookings +
            " vs " +
            prev.bookings +
            " reservations). Promotions can help rebuild volume."
        );
      } else {
        items.push(
          latest.label +
            " matched " +
            prev.label +
            " at " +
            latest.bookings +
            " reservations."
        );
      }
    }

    if (bookExt.max.label === incExt.max.label) {
      items.push(
        "Income follows bookings: the busiest month (" +
          bookExt.max.label +
          ") is also the strongest income month."
      );
    } else {
      items.push(
        "Income and volume diverge: most reservations were in " +
          bookExt.max.label +
          ", but approved income peaked in " +
          incExt.max.label +
          "."
      );
    }

    return padInsightItems(items, [
      "Green bars are reservation counts; the pink line is approved income.",
      "Use stronger months for staffing and softer months for promotions."
    ]);
  }

  function drawCanvasTextFallback(ctx, w, h, text) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
  }

  /* —— Manager pro charts (aligned with Admin Report visuals) —— */
  var MGR_CHART_BG = "#ffffff";
  var MGR_CHART_PLOT = "rgba(248, 246, 249, 0.72)";
  var MGR_CHART_GRID = "rgba(61, 51, 64, 0.07)";
  var MGR_CHART_AXIS = "rgba(61, 51, 64, 0.16)";
  var MGR_CHART_TEXT = "#2f2933";
  var MGR_CHART_MUTED = "#6b6570";
  var MGR_CHART_PINK = "#c46b82";
  var MGR_CHART_PINK_DEEP = "#a84f68";
  var MGR_CHART_GREEN = "#7fc142";
  var MGR_CHART_GREEN_DEEP = "#5f9e2e";
  var managerTrendMetaById = {};
  var managerRevenueMetaById = {};
  var managerChartsResizeBound = false;

  function prepareManagerChartContext(canvas, fallbackW, fallbackH, minH) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = canvas.clientWidth;
    var cssW = cw >= 64 ? Math.floor(cw) : fallbackW;
    var ratio = fallbackH / fallbackW;
    var cssH = Math.max(Math.round(cssW * ratio), minH != null ? minH : 120);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.style.maxHeight = "none";
    var wPx = Math.max(1, Math.round(cssW * dpr));
    var hPx = Math.max(1, Math.round(cssH * dpr));
    canvas.width = wPx;
    canvas.height = hPx;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { ctx: ctx, w: cssW, h: cssH };
  }

  function mgrChartMonthLabelStep(cssW, count) {
    var n = count || 12;
    if (cssW < 420 || n > 14) return 3;
    if (cssW < 640 || n > 10) return 2;
    return 1;
  }

  function formatMgrChartMonthLabel(label, cssW) {
    var text = String(label || "");
    if (cssW < 640) return text.replace(/\s+\d{2}$/, "");
    return text;
  }

  function fillMgrChartMonthsRow(rowEl, months, cssW, plotL, plotW) {
    if (!rowEl || !months || !months.length) return;
    var step = mgrChartMonthLabelStep(cssW, months.length);
    rowEl.style.gridTemplateColumns = "repeat(" + months.length + ", minmax(0, 1fr))";
    rowEl.style.paddingLeft = (plotL != null ? plotL : 0) + "px";
    rowEl.style.paddingRight =
      Math.max(0, cssW - ((plotL || 0) + (plotW != null ? plotW : cssW))) + "px";
    rowEl.innerHTML = months
      .map(function (m, idx) {
        var skip = idx % step !== 0 && idx !== months.length - 1;
        var text = formatMgrChartMonthLabel(m.label, cssW);
        return (
          '<span class="' +
          (skip ? "is-chart-label-skip" : "") +
          '">' +
          (skip ? "" : text) +
          "</span>"
        );
      })
      .join("");
  }

  function drawMgrPlotBg(ctx, x0, y0, chartW, chartH) {
    ctx.save();
    ctx.fillStyle = MGR_CHART_PLOT;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x0, y0, chartW, chartH, 10);
      ctx.fill();
    } else {
      ctx.fillRect(x0, y0, chartW, chartH);
    }
    ctx.restore();
  }

  function drawMgrGrid(ctx, x0, y0, chartW, chartH, lineCount) {
    lineCount = lineCount || 4;
    ctx.save();
    ctx.strokeStyle = MGR_CHART_GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    var g;
    for (g = 0; g <= lineCount; g++) {
      var y = y0 + (chartH * g) / lineCount;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + chartW, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawMgrBaseline(ctx, x0, y0, chartW, chartH) {
    ctx.save();
    ctx.strokeStyle = MGR_CHART_AXIS;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + chartH);
    ctx.lineTo(x0 + chartW, y0 + chartH);
    ctx.stroke();
    ctx.restore();
  }

  function formatMgrAxisPeso(n) {
    var v = Math.abs(Number(n) || 0);
    if (v >= 1000000) {
      var m = v / 1000000;
      return "₱" + (m >= 10 ? Math.round(m) : m.toFixed(m >= 1 ? 1 : 2).replace(/\.0$/, "")) + "M";
    }
    if (v >= 1000) {
      var k = v / 1000;
      return "₱" + (k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "")) + "K";
    }
    return "₱" + Math.round(v).toLocaleString();
  }

  function fillMgrRoundTopBar(ctx, x, y, bw, bh, radius) {
    if (bh < 2) {
      ctx.fillRect(x, y, bw, Math.max(bh, 0));
      return;
    }
    var r = Math.min(radius || 6, bw / 2, bh);
    ctx.beginPath();
    ctx.moveTo(x, y + bh);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh);
    ctx.closePath();
    ctx.fill();
  }

  function fillMgrRoundBar(ctx, x, y, bw, bh, radius) {
    var r = Math.min(radius || 3, bw / 2, bh / 2);
    if (r <= 0 || bh < 2) {
      ctx.fillRect(x, y, bw, bh);
      return;
    }
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, bw, bh);
    }
  }

  function bindManagerChartsResize() {
    if (managerChartsResizeBound) return;
    managerChartsResizeBound = true;
    var timer = null;
    window.addEventListener("resize", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        renderDashboard();
        if (currentSectionId === "section-analytics") {
          renderAnalytics();
          renderReports();
        }
      }, 180);
    });
  }

  function buildMonthBuckets(monthCount, items) {
    var now = new Date();
    var months = [];
    var i;
    for (i = monthCount - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var mk = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      months.push({
        key: mk,
        label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        bookings: 0,
        income: 0,
        approved: 0,
        cancelled: 0
      });
    }
    var byKey = {};
    months.forEach(function (m) {
      byKey[m.key] = m;
    });
    (items || []).forEach(function (it) {
      var b = it.booking || it || {};
      var mk2 = monthKeyFromIso(b.checkIn || b.check_in || b.submittedAt || b.submitted_at);
      if (!mk2 || !byKey[mk2]) return;
      byKey[mk2].bookings += 1;
      var st = normalizeStatus(b.status);
      if (st === "Cancelled") byKey[mk2].cancelled += 1;
      if (isConfirmedIncome(b)) {
        byKey[mk2].approved += 1;
        byKey[mk2].income += bookingIncome(b);
      }
    });
    return months;
  }

  function buildMgrSmoothPath(ctx, pts) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) return;
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y
      );
    }
  }

  function drawManagerBookingTrendsWave(items) {
    var canvas = document.getElementById("managerReportTrendChart");
    if (!canvas) return;
    var months = buildMonthBuckets(12, items);
    var prep = prepareManagerChartContext(canvas, 640, 200, 160);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 14;
    var padR = 14;
    var padT = 12;
    var padB = 10;
    var edgeInset = 10;
    var chartW = w - padL - padR;
    var chartH = h - padT - padB;
    var x0 = padL;
    var y0 = padT;
    var baselineY = y0 + chartH;
    var plotL = x0 + edgeInset;
    var plotW = Math.max(40, chartW - edgeInset * 2);
    var maxBookings = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, m.bookings);
      }, 0)
    );

    drawMgrPlotBg(ctx, x0, y0, chartW, chartH);
    drawMgrGrid(ctx, x0, y0, chartW, chartH, 4);
    drawMgrBaseline(ctx, x0, y0, chartW, chartH);

    var bookingPts = months.map(function (m, idx) {
      var x =
        months.length === 1 ? plotL + plotW / 2 : plotL + (idx / (months.length - 1)) * plotW;
      var y = y0 + chartH - (m.bookings / maxBookings) * (chartH - 16);
      y = Math.max(y0 + 8, Math.min(y, baselineY - 8));
      return { x: x, y: y, index: idx, label: m.label, bookings: m.bookings, income: m.income };
    });

    if (bookingPts.length >= 2) {
      ctx.beginPath();
      buildMgrSmoothPath(ctx, bookingPts);
      ctx.lineTo(bookingPts[bookingPts.length - 1].x, baselineY);
      ctx.lineTo(bookingPts[0].x, baselineY);
      ctx.closePath();
      ctx.fillStyle = "rgba(127, 193, 66, 0.12)";
      ctx.fill();
      ctx.beginPath();
      buildMgrSmoothPath(ctx, bookingPts);
      ctx.strokeStyle = MGR_CHART_GREEN;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }
    bookingPts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = MGR_CHART_GREEN;
      ctx.fill();
    });

    var monthsRow = document.getElementById("managerReportTrendMonths");
    if (monthsRow) {
      fillMgrChartMonthsRow(monthsRow, months, w, plotL, plotW);
    }

    /* Hover tooltips */
    if (canvas.getAttribute("data-mgr-wave-bound") !== "1") {
      canvas.setAttribute("data-mgr-wave-bound", "1");
      canvas._mgrWaveHit = bookingPts;
      canvas._mgrWaveLayout = { w: w, h: h };
      canvas.addEventListener("mousemove", function (evt) {
        var hit = canvas._mgrWaveHit || [];
        var layout = canvas._mgrWaveLayout || { w: w, h: h };
        var rect = canvas.getBoundingClientRect();
        var mx = ((evt.clientX - rect.left) / rect.width) * layout.w;
        var best = null;
        var bestDist = 36;
        hit.forEach(function (p) {
          var d = Math.abs(p.x - mx);
          if (d < bestDist) {
            bestDist = d;
            best = p;
          }
        });
        var tip = document.getElementById("managerReportTrendTip");
        if (!tip || !canvas.parentElement) return;
        if (!best) {
          tip.hidden = true;
          return;
        }
        tip.innerHTML =
          '<p class="admin-report-chart-tooltip__month">' +
          best.label +
          "</p>" +
          '<p class="admin-report-chart-tooltip__value">' +
          best.bookings +
          "</p>" +
          '<p class="admin-report-chart-tooltip__kind">Reservations</p>';
        tip.hidden = false;
        var wrap = canvas.parentElement.getBoundingClientRect();
        var left = evt.clientX - wrap.left;
        var tipW = tip.offsetWidth || 120;
        left = Math.max(tipW / 2 + 4, Math.min(wrap.width - tipW / 2 - 4, left));
        tip.style.left = left + "px";
        tip.style.top = Math.max(8, evt.clientY - wrap.top) + "px";
      });
      canvas.addEventListener("mouseleave", function () {
        var tip = document.getElementById("managerReportTrendTip");
        if (tip) tip.hidden = true;
      });
    } else {
      canvas._mgrWaveHit = bookingPts;
      canvas._mgrWaveLayout = { w: w, h: h };
    }
    bindManagerChartsResize();
  }

  function statusSlicesFromItems(items) {
    var counts = { Confirmed: 0, Pending: 0, Cancelled: 0, Completed: 0 };
    var confirmedIncome = 0;
    (items || []).forEach(function (it) {
      var b = it && it.booking ? it.booking : it || {};
      var label = displayStatusForChart(b);
      if (label === "Completed") counts.Completed += 1;
      else if (label === "Confirmed") {
        counts.Confirmed += 1;
        confirmedIncome += bookingIncome(b);
      } else if (label === "Cancelled") counts.Cancelled += 1;
      else counts.Pending += 1;
    });
    var slices = [
      { key: "Confirmed", label: "Confirmed", value: counts.Confirmed, color: "#7fc142", colorDeep: "#5f9e2e" },
      { key: "Pending", label: "Pending", value: counts.Pending, color: "#e0b03a", colorDeep: "#c4921a" },
      { key: "Cancelled", label: "Cancelled", value: counts.Cancelled, color: "#c46b82", colorDeep: "#a84f68" },
      { key: "Completed", label: "Completed", value: counts.Completed, color: "#6b7c93", colorDeep: "#4f5f73" }
    ].filter(function (s) {
      return s.value > 0;
    });
    return { slices: slices, confirmedIncome: confirmedIncome, total: counts.Confirmed + counts.Pending + counts.Cancelled + counts.Completed };
  }

  function drawStatusChart(itemsOrCounts, canvasId, legendId, options) {
    options = options || {};
    var canvas = document.getElementById(canvasId || "managerReportStatusChart");
    var legend = document.getElementById(legendId || "managerReportStatusLegend");
    if (!canvas) return;

    var items = Array.isArray(itemsOrCounts) ? itemsOrCounts : null;
    var pack;
    if (items) {
      pack = statusSlicesFromItems(items);
    } else {
      var c = itemsOrCounts || {};
      pack = {
        slices: [
          { key: "Confirmed", label: "Approved", value: Number(c.approved) || 0, color: "#7fc142", colorDeep: "#5f9e2e" },
          { key: "Pending", label: "Pending", value: Number(c.pending) || 0, color: "#e0b03a", colorDeep: "#c4921a" },
          { key: "Cancelled", label: "Cancelled", value: Number(c.cancelled) || 0, color: "#c46b82", colorDeep: "#a84f68" }
        ].filter(function (s) {
          return s.value > 0;
        }),
        confirmedIncome: 0,
        total: Number(c.total) || 0
      };
    }

    var slices = pack.slices.slice();
    if (!slices.length) {
      slices = [{ key: "Empty", label: "No bookings yet", value: 1, color: "#e8e4ea", colorDeep: "#d5d0d8", empty: true }];
    }
    var total = slices.reduce(function (a, s) {
      return a + s.value;
    }, 0);

    if (options.subId) {
      var sub = document.getElementById(options.subId);
      if (sub) {
        sub.textContent = slices[0].empty
          ? "No live booking records yet."
          : "Live share of booking statuses" +
            (pack.confirmedIncome > 0 ? " · Confirmed revenue " + fmtPHP(pack.confirmedIncome) : "") +
            ".";
      }
    }

    var prep = prepareManagerChartContext(canvas, 280, 220, 190);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var cx = w / 2;
    var cy = h / 2 + 2;
    var outerR = Math.min(w, h) * 0.4;
    var ringW = Math.max(22, outerR * 0.38);
    var midR = outerR - ringW / 2;
    var gap = slices.length > 1 && !slices[0].empty ? 0.055 : 0;
    var start = -Math.PI / 2;

    ctx.save();
    var halo = ctx.createRadialGradient(cx, cy, midR * 0.35, cx, cy, outerR + 10);
    halo.addColorStop(0, "rgba(127, 193, 66, 0.08)");
    halo.addColorStop(0.55, "rgba(196, 107, 130, 0.05)");
    halo.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 10, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, midR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61, 51, 64, 0.07)";
    ctx.lineWidth = ringW;
    ctx.stroke();
    ctx.restore();

    slices.forEach(function (s) {
      var sweep = (s.value / total) * Math.PI * 2;
      var a0 = start + gap / 2;
      var a1 = start + sweep - gap / 2;
      if (a1 <= a0) a1 = a0 + 0.02;
      var grad = ctx.createLinearGradient(
        cx + Math.cos(a0) * midR,
        cy + Math.sin(a0) * midR,
        cx + Math.cos(a1) * midR,
        cy + Math.sin(a1) * midR
      );
      grad.addColorStop(0, s.color);
      grad.addColorStop(1, s.colorDeep || s.color);
      if (!s.empty && sweep > 0.2) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, midR, a0, a1);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = ringW + 6;
        ctx.lineCap = slices.length === 1 ? "butt" : "round";
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, midR, a0, a1);
      ctx.strokeStyle = grad;
      ctx.lineWidth = ringW;
      ctx.lineCap = slices.length === 1 ? "butt" : "round";
      ctx.stroke();
      ctx.restore();
      start += sweep;
    });

    var innerR = midR - ringW / 2 - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61, 51, 64, 0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();

    var centerTotal = slices[0].empty ? "0" : total.toLocaleString();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = MGR_CHART_TEXT;
    ctx.font = "800 26px Poppins, 'Segoe UI', sans-serif";
    ctx.fillText(centerTotal, cx, cy - 8);
    ctx.font = "600 11px Poppins, 'Segoe UI', sans-serif";
    ctx.fillStyle = MGR_CHART_MUTED;
    ctx.fillText("bookings", cx, cy + 14);

    if (legend) {
      var prefix = legend.classList.contains("admin-report-donut-legend")
        ? "admin-report-donut-legend"
        : "manager-donut-legend";
      legend.innerHTML = "";
      slices.forEach(function (s) {
        if (s.empty) {
          legend.innerHTML =
            '<li class="' + prefix + '__empty">No booking records yet.</li>';
          return;
        }
        var pct = total ? Math.round((s.value / total) * 100) : 0;
        var li = document.createElement("li");
        li.innerHTML =
          '<span class="' +
          prefix +
          '__swatch" style="background:linear-gradient(145deg,' +
          s.color +
          "," +
          (s.colorDeep || s.color) +
          ')"></span><span class="' +
          prefix +
          '__meta"><span class="' +
          prefix +
          '__label">' +
          s.label +
          '</span><span class="' +
          prefix +
          '__count">' +
          s.value.toLocaleString() +
          ' bookings</span></span><span class="' +
          prefix +
          '__value">' +
          pct +
          "%</span>";
        legend.appendChild(li);
      });
    }
    bindManagerChartsResize();
  }

  function paintManagerTrendChart(canvasId) {
    var meta = managerTrendMetaById[canvasId];
    var canvas = document.getElementById(canvasId);
    if (!canvas || !meta || !meta.months) return;
    var months = meta.months;
    var hoverIndex = meta.hoverIndex;
    var prep = prepareManagerChartContext(canvas, 640, 260, 200);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 52;
    var padR = 52;
    var padT = 28;
    var padB = 36;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(40, h - padT - padB);
    var maxBookings = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, Number(m.bookings) || 0);
      }, 0)
    );
    var maxIncome = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, Number(m.income) || 0);
      }, 0)
    );
    var baselineY = padT + chartH;

    drawMgrPlotBg(ctx, padL, padT, chartW, chartH);
    drawMgrGrid(ctx, padL, padT, chartW, chartH, 4);
    drawMgrBaseline(ctx, padL, padT, chartW, chartH);

    ctx.save();
    ctx.fillStyle = MGR_CHART_MUTED;
    ctx.font = "600 10px Poppins, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var g;
    for (g = 0; g <= 4; g++) {
      var y = padT + (chartH * g) / 4;
      ctx.fillStyle = MGR_CHART_GREEN_DEEP;
      ctx.fillText(String(Math.round(maxBookings * (1 - g / 4))), padL - 8, y);
      ctx.fillStyle = MGR_CHART_PINK_DEEP;
      ctx.textAlign = "left";
      ctx.fillText(formatMgrAxisPeso(maxIncome * (1 - g / 4)), padL + chartW + 8, y);
      ctx.textAlign = "right";
    }
    ctx.restore();

    var gap = 8;
    var colW = chartW / months.length;
    var barW = Math.max(8, colW * 0.38);
    var hit = [];
    var labelStep = mgrChartMonthLabelStep(w, months.length);

    months.forEach(function (m, idx) {
      var bookings = Number(m.bookings) || 0;
      var income = Number(m.income) || 0;
      var bh = (bookings / maxBookings) * (chartH - 12);
      var x = padL + idx * colW + (colW - barW) / 2;
      var y = baselineY - bh;
      var isHover = hoverIndex === idx;
      var dimmed = hoverIndex != null && !isHover;

      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.35;
      if (bh > 0) {
        var grad = ctx.createLinearGradient(x, y, x, y + Math.max(bh, 3));
        grad.addColorStop(0, isHover ? "#93d45a" : MGR_CHART_GREEN);
        grad.addColorStop(1, MGR_CHART_GREEN_DEEP);
        ctx.fillStyle = grad;
        fillMgrRoundTopBar(ctx, x, y, barW, Math.max(bh, 3), Math.min(7, barW / 2));
      } else {
        ctx.fillStyle = "rgba(127, 193, 66, 0.25)";
        fillMgrRoundTopBar(ctx, x, baselineY - 3, barW, 3, 2);
      }
      ctx.restore();

      if (idx % labelStep === 0 || idx === months.length - 1 || isHover) {
        ctx.save();
        ctx.fillStyle = isHover ? MGR_CHART_TEXT : MGR_CHART_MUTED;
        ctx.font = (isHover ? "700 " : "600 ") + "10px Poppins, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(
          formatMgrChartMonthLabel(m.label, w),
          padL + idx * colW + colW / 2,
          baselineY + 10
        );
        ctx.restore();
      }

      hit.push({
        index: idx,
        label: m.label,
        bookings: bookings,
        income: income,
        bar: { x: x, y: Math.min(y, baselineY - 3), w: barW, h: Math.max(bh, 3) },
        lineX: padL + idx * colW + colW / 2,
        lineY: baselineY - (income / maxIncome) * (chartH - 12)
      });
    });

    /* Revenue line */
    ctx.save();
    ctx.beginPath();
    hit.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.lineX, p.lineY);
      else ctx.lineTo(p.lineX, p.lineY);
    });
    ctx.strokeStyle = MGR_CHART_PINK;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    hit.forEach(function (p) {
      var active = hoverIndex === p.index;
      ctx.beginPath();
      ctx.arc(p.lineX, p.lineY, active ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.lineX, p.lineY, active ? 4.2 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = MGR_CHART_PINK;
      ctx.fill();
    });
    ctx.restore();

    meta.layout = { w: w, h: h, baselineY: baselineY };
    meta.hit = hit;
  }

  function bindManagerTrendInteractions(canvasId, tipId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || canvas.getAttribute("data-mgr-trend-bound") === "1") return;
    canvas.setAttribute("data-mgr-trend-bound", "1");
    canvas.addEventListener("mousemove", function (evt) {
      var meta = managerTrendMetaById[canvasId];
      if (!meta || !meta.layout || !meta.hit) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * meta.layout.w;
      var best = null;
      var bestDist = 40;
      meta.hit.forEach(function (p) {
        var cx = p.bar.x + p.bar.w / 2;
        var d = Math.abs(mx - cx);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      });
      var tip = document.getElementById(tipId);
      if (!best) {
        if (tip) tip.hidden = true;
        if (meta.hoverIndex != null) {
          meta.hoverIndex = null;
          paintManagerTrendChart(canvasId);
        }
        return;
      }
      if (meta.hoverIndex !== best.index) {
        meta.hoverIndex = best.index;
        paintManagerTrendChart(canvasId);
      }
      if (tip && canvas.parentElement) {
        tip.innerHTML =
          '<p class="manager-chart-tooltip__month">' +
          best.label +
          "</p>" +
          '<p class="manager-chart-tooltip__value">' +
          best.bookings +
          " booking" +
          (best.bookings === 1 ? "" : "s") +
          "</p>" +
          '<p class="manager-chart-tooltip__kind manager-chart-tooltip__kind--pink">' +
          fmtPHP(best.income) +
          " confirmed</p>";
        tip.hidden = false;
        var wrap = canvas.parentElement.getBoundingClientRect();
        var left = evt.clientX - wrap.left;
        var tipW = tip.offsetWidth || 120;
        left = Math.max(tipW / 2 + 4, Math.min(wrap.width - tipW / 2 - 4, left));
        tip.style.left = left + "px";
        tip.style.top = Math.max(8, evt.clientY - wrap.top) + "px";
      }
    });
    canvas.addEventListener("mouseleave", function () {
      var tip = document.getElementById(tipId);
      if (tip) tip.hidden = true;
      var meta = managerTrendMetaById[canvasId];
      if (meta && meta.hoverIndex != null) {
        meta.hoverIndex = null;
        paintManagerTrendChart(canvasId);
      }
    });
  }

  function drawTrendChart(items, canvasId, months, options) {
    options = options || {};
    canvasId = canvasId || "managerReportTrendChart";
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    months = months || buildTrendMonths(items);
    if (!months.length) {
      var prepEmpty = prepareManagerChartContext(canvas, 640, 260, 180);
      if (prepEmpty) drawCanvasTextFallback(prepEmpty.ctx, prepEmpty.w, prepEmpty.h, "No data yet");
      return;
    }

    var totalIncome = months.reduce(function (a, m) {
      return a + (Number(m.income) || 0);
    }, 0);
    var peak = months.reduce(function (best, m) {
      return (Number(m.income) || 0) > (Number(best.income) || 0) ? m : best;
    }, months[0]);
    if (options.subId) {
      var sub = document.getElementById(options.subId);
      if (sub) {
        sub.textContent =
          totalIncome > 0
            ? "Monthly bookings (bars) and confirmed revenue (line). Peak earnings: " +
              peak.label +
              " · " +
              fmtPHP(peak.income) +
              "."
            : "Monthly reservation counts and confirmed earnings from live records.";
      }
    }

    managerTrendMetaById[canvasId] = {
      months: months,
      hoverIndex: managerTrendMetaById[canvasId] ? managerTrendMetaById[canvasId].hoverIndex : null,
      layout: null,
      hit: []
    };
    paintManagerTrendChart(canvasId);
    bindManagerTrendInteractions(canvasId, options.tipId || "");
    bindManagerChartsResize();
  }

  function drawFacilityUsageChart(items, canvasId) {
    var canvas = document.getElementById(canvasId || "managerReportFacilityChart");
    if (!canvas) return;
    var order = ["Rooms", "Entrance", "Event halls", "Events", "Cottages", "Other"];
    var counts = {};
    var incomeBy = {};
    order.forEach(function (k) {
      counts[k] = 0;
      incomeBy[k] = 0;
    });
    (items || []).forEach(function (it) {
      var b = it.booking || it || {};
      var cat = facilityCategoryForBooking(b);
      if (!counts.hasOwnProperty(cat)) {
        counts[cat] = 0;
        incomeBy[cat] = 0;
      }
      counts[cat] += 1;
      if (isConfirmedIncome(b)) incomeBy[cat] += bookingIncome(b);
    });
    var rows = order
      .filter(function (k) {
        return counts[k] > 0;
      })
      .map(function (k) {
        return { label: k, value: counts[k], income: incomeBy[k] };
      });
    if (!rows.length) rows = [{ label: "No facility data", value: 0, income: 0 }];

    var prep = prepareManagerChartContext(canvas, 640, 240, 190);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 112;
    var padR = 88;
    var padT = 16;
    var padB = 16;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(40, h - padT - padB);
    var maxVal = Math.max(
      1,
      rows.reduce(function (a, r) {
        return Math.max(a, r.value);
      }, 0)
    );
    var rowH = chartH / rows.length;
    var barH = Math.max(12, Math.min(30, rowH * 0.58));

    drawMgrPlotBg(ctx, padL, padT, chartW, chartH);
    drawMgrGrid(ctx, padL, padT, chartW, chartH, 4);

    rows.forEach(function (r, idx) {
      var y = padT + idx * rowH + (rowH - barH) / 2;
      var bw = (r.value / maxVal) * chartW;
      var drawW = Math.max(r.value > 0 ? 6 : 0, bw);
      var top = idx % 2 === 0 ? MGR_CHART_GREEN : MGR_CHART_PINK;
      var deep = idx % 2 === 0 ? MGR_CHART_GREEN_DEEP : MGR_CHART_PINK_DEEP;
      ctx.fillStyle = "rgba(61, 51, 64, 0.045)";
      fillMgrRoundBar(ctx, padL, y, chartW, barH, 7);
      if (drawW > 0) {
        var grad = ctx.createLinearGradient(padL, y, padL + drawW, y);
        grad.addColorStop(0, top);
        grad.addColorStop(1, deep);
        ctx.fillStyle = grad;
        fillMgrRoundBar(ctx, padL, y, drawW, barH, 7);
      }
      ctx.fillStyle = MGR_CHART_TEXT;
      ctx.font = "600 12px Poppins, 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, padL - 12, y + barH / 2);
      ctx.textAlign = "left";
      ctx.fillStyle = MGR_CHART_MUTED;
      ctx.font = "700 11px Poppins, 'Segoe UI', sans-serif";
      ctx.fillText(
        String(r.value) + (r.income > 0 ? " · " + formatMgrAxisPeso(r.income) : ""),
        padL + drawW + 10,
        y + barH / 2
      );
    });
  }

  function paintManagerRevenueChart(canvasId) {
    var meta = managerRevenueMetaById[canvasId];
    var canvas = document.getElementById(canvasId);
    if (!canvas || !meta || !meta.months) return;
    var months = meta.months;
    var hoverIndex = meta.hoverIndex;
    var peakIndex = meta.peakIndex;
    var prep = prepareManagerChartContext(canvas, 640, 250, 200);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 54;
    var padR = 16;
    var padT = 22;
    var padB = 38;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(40, h - padT - padB);
    var maxIncome = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, Number(m.income) || 0);
      }, 0)
    );
    var baselineY = padT + chartH;

    drawMgrPlotBg(ctx, padL, padT, chartW, chartH);
    drawMgrGrid(ctx, padL, padT, chartW, chartH, 4);
    drawMgrBaseline(ctx, padL, padT, chartW, chartH);

    ctx.save();
    ctx.fillStyle = MGR_CHART_MUTED;
    ctx.font = "600 10px Poppins, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var g;
    for (g = 0; g <= 4; g++) {
      ctx.fillText(formatMgrAxisPeso(maxIncome * (1 - g / 4)), padL - 8, padT + (chartH * g) / 4);
    }
    ctx.restore();

    var gap = 8;
    var barW = Math.max(10, (chartW - gap * (months.length + 1)) / months.length);
    var hit = [];
    var labelStep = mgrChartMonthLabelStep(w, months.length);
    months.forEach(function (m, idx) {
      var income = Number(m.income) || 0;
      var bh = (income / maxIncome) * (chartH - 10);
      var x = padL + gap + idx * (barW + gap);
      var y = baselineY - bh;
      var isPeak = idx === peakIndex && income > 0;
      var isHover = hoverIndex === idx;
      var dimmed = hoverIndex != null && !isHover;
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.38;
      if (bh > 0) {
        var grad = ctx.createLinearGradient(x, y, x, y + Math.max(bh, 3));
        grad.addColorStop(0, isPeak || isHover ? "#d47a90" : MGR_CHART_PINK);
        grad.addColorStop(1, isPeak || isHover ? MGR_CHART_PINK_DEEP : "#d9a0b0");
        ctx.fillStyle = grad;
        fillMgrRoundTopBar(ctx, x, y, barW, Math.max(bh, 3), Math.min(8, barW / 2));
      } else {
        ctx.fillStyle = "rgba(196, 107, 130, 0.28)";
        fillMgrRoundTopBar(ctx, x, baselineY - 3, barW, 3, 2);
      }
      ctx.restore();
      if (idx % labelStep === 0 || idx === months.length - 1 || isPeak || isHover) {
        ctx.save();
        ctx.fillStyle = isPeak || isHover ? MGR_CHART_TEXT : MGR_CHART_MUTED;
        ctx.font = (isPeak || isHover ? "700 " : "600 ") + "10px Poppins, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(formatMgrChartMonthLabel(m.label, w), x + barW / 2, baselineY + 10);
        ctx.restore();
      }
      if (isPeak && bh > 28) {
        ctx.save();
        ctx.fillStyle = MGR_CHART_PINK_DEEP;
        ctx.font = "700 10px Poppins, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatMgrAxisPeso(income), x + barW / 2, y - 6);
        ctx.restore();
      }
      hit.push({
        index: idx,
        label: m.label,
        income: income,
        bar: { x: x, y: y, w: barW, h: Math.max(bh, 3) }
      });
    });
    meta.layout = { w: w, h: h, baselineY: baselineY };
    meta.hit = hit;
  }

  function bindManagerRevenueInteractions(canvasId, tipId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || canvas.getAttribute("data-mgr-rev-bound") === "1") return;
    canvas.setAttribute("data-mgr-rev-bound", "1");
    canvas.addEventListener("mousemove", function (evt) {
      var meta = managerRevenueMetaById[canvasId];
      if (!meta || !meta.layout || !meta.hit) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * meta.layout.w;
      var best = null;
      meta.hit.forEach(function (p) {
        if (mx >= p.bar.x - 4 && mx <= p.bar.x + p.bar.w + 4) best = p;
      });
      var tip = document.getElementById(tipId);
      if (!best) {
        if (tip) tip.hidden = true;
        if (meta.hoverIndex != null) {
          meta.hoverIndex = null;
          paintManagerRevenueChart(canvasId);
        }
        return;
      }
      if (meta.hoverIndex !== best.index) {
        meta.hoverIndex = best.index;
        paintManagerRevenueChart(canvasId);
      }
      if (tip && canvas.parentElement) {
        tip.innerHTML =
          '<p class="manager-chart-tooltip__month">' +
          best.label +
          "</p>" +
          '<p class="manager-chart-tooltip__value">' +
          fmtPHP(best.income) +
          "</p>" +
          '<p class="manager-chart-tooltip__kind manager-chart-tooltip__kind--pink">Confirmed revenue</p>';
        tip.hidden = false;
        var wrap = canvas.parentElement.getBoundingClientRect();
        var left = evt.clientX - wrap.left;
        var tipW = tip.offsetWidth || 120;
        left = Math.max(tipW / 2 + 4, Math.min(wrap.width - tipW / 2 - 4, left));
        tip.style.left = left + "px";
        tip.style.top = Math.max(8, evt.clientY - wrap.top) + "px";
      }
    });
    canvas.addEventListener("mouseleave", function () {
      var tip = document.getElementById(tipId);
      if (tip) tip.hidden = true;
      var meta = managerRevenueMetaById[canvasId];
      if (meta && meta.hoverIndex != null) {
        meta.hoverIndex = null;
        paintManagerRevenueChart(canvasId);
      }
    });
  }

  function drawRevenueChart(items, months, canvasId, options) {
    options = options || {};
    canvasId = canvasId || "managerReportRevenueChart";
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    months = (months || buildTrendMonths(items)).map(function (m) {
      return { key: m.key, label: m.label, income: Number(m.income) || 0 };
    });
    var total = months.reduce(function (a, m) {
      return a + m.income;
    }, 0);
    var peakIndex = 0;
    months.forEach(function (m, idx) {
      if (m.income > months[peakIndex].income) peakIndex = idx;
    });
    if (options.subId) {
      var sub = document.getElementById(options.subId);
      if (sub) {
        sub.textContent =
          total > 0
            ? "Confirmed earnings by month. Peak: " +
              months[peakIndex].label +
              " · " +
              fmtPHP(months[peakIndex].income) +
              "."
            : "Confirmed earnings by month from live reservation records.";
      }
    }
    managerRevenueMetaById[canvasId] = {
      months: months,
      peakIndex: total > 0 ? peakIndex : -1,
      hoverIndex: managerRevenueMetaById[canvasId] ? managerRevenueMetaById[canvasId].hoverIndex : null,
      layout: null,
      hit: []
    };
    paintManagerRevenueChart(canvasId);
    bindManagerRevenueInteractions(canvasId, options.tipId || "");
    bindManagerChartsResize();
  }

  function fillMgrSmoothBand(ctx, lowerPts, upperPts, fillStyle) {
    if (!lowerPts || !upperPts || lowerPts.length < 2) return;
    ctx.beginPath();
    buildMgrSmoothPath(ctx, upperPts);
    for (var i = lowerPts.length - 1; i >= 0; i--) {
      if (i === lowerPts.length - 1) ctx.lineTo(lowerPts[i].x, lowerPts[i].y);
      else {
        var p0 = lowerPts[i + 2] || lowerPts[i + 1];
        var p1 = lowerPts[i + 1];
        var p2 = lowerPts[i];
        var p3 = lowerPts[i - 1] || p2;
        ctx.bezierCurveTo(
          p1.x - (p0.x - p2.x) / 6,
          p1.y - (p0.y - p2.y) / 6,
          p2.x + (p3.x - p1.x) / 6,
          p2.y + (p3.y - p1.y) / 6,
          p2.x,
          p2.y
        );
      }
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawReviewsCompositionChart(buckets, canvasId) {
    var canvas = document.getElementById(canvasId || "managerReportReviewsChart");
    if (!canvas) return;
    var prep = prepareManagerChartContext(canvas, 640, 210, 180);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = MGR_CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var working = (buckets || []).map(function (b) {
      return {
        label: b.label,
        pos: Number(b.pos) || 0,
        neu: Number(b.neu) || 0,
        neg: Number(b.neg) || 0
      };
    });
    var hasAny = working.some(function (b) {
      return b.pos + b.neu + b.neg > 0;
    });

    var padL = 42;
    var padR = 16;
    var padT = 14;
    var padB = 32;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(70, h - padT - padB);
    var x0 = padL;
    var y0 = padT;
    var yBase = y0 + chartH;
    var plotH = Math.max(40, chartH - 4);
    var maxT = Math.max(
      1,
      working.reduce(function (a, b) {
        return Math.max(a, b.pos + b.neu + b.neg);
      }, 0)
    );
    var niceMax = maxT;
    if (maxT > 4) {
      var step = Math.ceil(maxT / 4);
      var mag = Math.pow(10, Math.max(0, String(step).length - 1));
      step = Math.ceil(step / mag) * mag;
      niceMax = step * 4;
    }

    ctx.fillStyle = "rgba(61, 51, 64, 0.02)";
    ctx.fillRect(x0, y0, chartW, chartH);
    drawMgrGrid(ctx, x0, y0, chartW, chartH, 4);
    drawMgrBaseline(ctx, x0, y0, chartW, chartH);

    ctx.save();
    ctx.font = "600 11px Poppins, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#8a8490";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var yt;
    for (yt = 0; yt <= 4; yt++) {
      ctx.fillText(String(Math.round(niceMax * (1 - yt / 4))), x0 - 8, y0 + (chartH * yt) / 4);
    }
    ctx.restore();

    var n = Math.max(1, working.length);
    var cPos = "#5f9e2e";
    var cNeu = "#7b7480";
    var cNeg = "#c46b82";
    var pts = working.map(function (b, i) {
      var x = n === 1 ? x0 + chartW / 2 : x0 + (i * chartW) / (n - 1);
      return {
        x: x,
        yNeg: yBase - (b.neg / niceMax) * plotH,
        yNeu: yBase - ((b.neg + b.neu) / niceMax) * plotH,
        yPos: yBase - ((b.neg + b.neu + b.pos) / niceMax) * plotH,
        yBase: yBase,
        total: b.pos + b.neu + b.neg,
        pos: b.pos,
        neu: b.neu,
        neg: b.neg,
        label: b.label,
        index: i
      };
    });
    var basePts = pts.map(function (p) {
      return { x: p.x, y: p.yBase };
    });
    var negPts = pts.map(function (p) {
      return { x: p.x, y: p.yNeg };
    });
    var neuPts = pts.map(function (p) {
      return { x: p.x, y: p.yNeu };
    });
    var posPts = pts.map(function (p) {
      return { x: p.x, y: p.yPos };
    });

    if (hasAny && pts.length >= 2) {
      var negGrad = ctx.createLinearGradient(0, y0, 0, yBase);
      negGrad.addColorStop(0, "rgba(196, 107, 130, 0.28)");
      negGrad.addColorStop(1, "rgba(196, 107, 130, 0.06)");
      var neuGrad = ctx.createLinearGradient(0, y0, 0, yBase);
      neuGrad.addColorStop(0, "rgba(123, 116, 128, 0.24)");
      neuGrad.addColorStop(1, "rgba(123, 116, 128, 0.05)");
      var posGrad = ctx.createLinearGradient(0, y0, 0, yBase);
      posGrad.addColorStop(0, "rgba(127, 193, 66, 0.32)");
      posGrad.addColorStop(1, "rgba(127, 193, 66, 0.06)");
      fillMgrSmoothBand(ctx, basePts, negPts, negGrad);
      fillMgrSmoothBand(ctx, negPts, neuPts, neuGrad);
      fillMgrSmoothBand(ctx, neuPts, posPts, posGrad);

      function strokeEdge(ptsEdge, color, width) {
        ctx.beginPath();
        buildMgrSmoothPath(ctx, ptsEdge);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
      strokeEdge(negPts, cNeg, 2);
      strokeEdge(neuPts, cNeu, 2);
      strokeEdge(posPts, cPos, 2.4);

      pts.forEach(function (p) {
        [
          { y: p.yNeg, color: cNeg },
          { y: p.yNeu, color: cNeu },
          { y: p.yPos, color: cPos }
        ].forEach(function (dot) {
          ctx.beginPath();
          ctx.arc(p.x, dot.y, 4.6, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, dot.y, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = dot.color;
          ctx.fill();
        });
      });
    }

    ctx.font = "600 11px Poppins, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    working.forEach(function (b, i) {
      ctx.fillStyle = "#8a8490";
      ctx.fillText(b.label, pts[i].x, yBase + 8);
    });

    if (!hasAny) {
      ctx.fillStyle = "#8a8490";
      ctx.font = "600 12px Poppins, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No guest reviews in this period yet", x0 + chartW / 2, y0 + chartH / 2);
    }
  }

  function renderManagerGuestReviews() {
    function paint(list) {
      var rows = list || [];
      var homeKpis = computeHomeStyleReviewKpis(rows);
      var pos = 0;
      var neu = 0;
      var neg = 0;
      rows.forEach(function (f) {
        var cl = classifySentimentFromStars(f.stars);
        if (cl === "pos") pos += 1;
        else if (cl === "neg") neg += 1;
        else neu += 1;
      });
      var total = homeKpis.total;
      var pct = function (n) {
        return total ? Math.round((n / total) * 100) : 0;
      };
      setText(
        "managerReportReviewsAvg",
        total && homeKpis.average ? homeKpis.average.toFixed(1) + "/5" : "—"
      );
      setText(
        "managerReportReviewsPos",
        total ? homeKpis.recommend + "%" : "—"
      );
      setText("managerReportReviewsTotal", String(total));
      setText("managerReportPctPos", pct(pos) + "%");
      setText("managerReportPctNeg", pct(neg) + "%");
      setText("managerReportPctNeu", pct(neu) + "%");
      var setWidth = function (id, width) {
        var el = document.getElementById(id);
        if (el) el.style.width = width;
      };
      setWidth("managerReportBarPos", pct(pos) + "%");
      setWidth("managerReportBarNeg", pct(neg) + "%");
      setWidth("managerReportBarNeu", pct(neu) + "%");
      var sub = document.getElementById("managerReportReviewsSub");
      if (sub) {
        sub.textContent = total
          ? "Same totals as the home page — " +
            total.toLocaleString() +
            " review" +
            (total === 1 ? "" : "s") +
            " on file."
          : "Same totals as the home page. Charts update when new reviews are saved.";
      }

      var now = new Date();
      var buckets = [];
      var byKey = {};
      var i;
      for (i = 5; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var mk = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
        var row = {
          key: mk,
          label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
          pos: 0,
          neu: 0,
          neg: 0
        };
        buckets.push(row);
        byKey[mk] = row;
      }
      rows.forEach(function (f) {
        var iso = f.createdAt || f.created_at || f.submittedAt || "";
        var mk2 = monthKeyFromIso(iso);
        if (!mk2 || !byKey[mk2]) return;
        var cl2 = classifySentimentFromStars(f.stars);
        if (cl2 === "pos") byKey[mk2].pos += 1;
        else if (cl2 === "neg") byKey[mk2].neg += 1;
        else byKey[mk2].neu += 1;
      });
      drawReviewsCompositionChart(buckets, "managerReportReviewsChart");
      if (
        window.ElenestGuestFeedback &&
        typeof window.ElenestGuestFeedback.mountRecentReviewNames === "function"
      ) {
        window.ElenestGuestFeedback.mountRecentReviewNames(
          document.getElementById("managerReportGuestReviewsCard")
        );
      }
    }

    paint(readAllReviewRecordsForHomeKpis());

    // Reuse cache — do not force-reload on every paint (keeps analytics smooth).
    loadFullReviewRecordsForHomeKpis(false).then(function (list) {
      paint(list || []);
    });
  }

  function printTable(headers, rows, foot) {
    var html = '<table class="mgr-doc__table"><thead><tr>';
    headers.forEach(function (h) {
      html += "<th" + (h.num ? ' class="num"' : "") + ">" + escapeHtml(h.label) + "</th>";
    });
    html += "</tr></thead><tbody>";
    if (!rows.length) {
      html +=
        '<tr><td colspan="' +
        headers.length +
        '">No records were found for the selected coverage period.</td></tr>';
    } else {
      rows.forEach(function (row) {
        html += "<tr>";
        row.forEach(function (cell, i) {
          html += "<td" + (headers[i] && headers[i].num ? ' class="num"' : "") + ">" + escapeHtml(cell) + "</td>";
        });
        html += "</tr>";
      });
    }
    html += "</tbody>";
    if (foot && foot.length) {
      html += "<tfoot><tr>";
      foot.forEach(function (cell, i) {
        html += "<td" + (headers[i] && headers[i].num ? ' class="num"' : "") + ">" + escapeHtml(cell) + "</td>";
      });
      html += "</tr></tfoot>";
    }
    html += "</table>";
    return html;
  }

  function printFindings(items) {
    if (!items || !items.length) return "";
    return (
      '<ol class="mgr-doc__findings">' +
      items
        .map(function (text) {
          return "<li>" + escapeHtml(text) + "</li>";
        })
        .join("") +
      "</ol>"
    );
  }

  function canvasDataUrl(id) {
    var canvas = document.getElementById(id);
    if (!canvas || typeof canvas.toDataURL !== "function") return "";
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      return "";
    }
  }

  function reportDocumentNo(d) {
    return (
      "ER-MGR-" +
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      "-" +
      pad2(d.getHours()) +
      pad2(d.getMinutes())
    );
  }

  function currentManagerUser() {
    var Auth = window.ElenestAuth;
    return Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
  }

  function buildManagerPrintSheet() {
    var sheet = document.getElementById("managerPrintSheet");
    if (!sheet) return;
    renderAnalytics();
    var report = renderReports() || computeManagerReport();
    var user = currentManagerUser();
    var preparedName = (user && (user.name || user.email)) || "Resort Manager";
    var preparedEmail = (user && user.email) || "—";
    var docNo = reportDocumentNo(report.generatedAt);
    var confirmedCount = report.items.filter(function (it) {
      return isConfirmedIncome(it.booking || {});
    }).length;
    var avgValue = confirmedCount ? report.periodIncome / confirmedCount : 0;
    var statusRows = [
      ["Pending", report.statuses.Pending || 0],
      ["Confirmed", report.statuses.Confirmed || 0],
      ["Checked In", report.statuses["Checked In"] || 0],
      ["Checked Out", report.statuses["Checked Out"] || 0],
      ["Cancelled", report.statuses.Cancelled || 0]
    ]
      .filter(function (row) {
        return row[0] === "Pending" || row[0] === "Confirmed" || row[0] === "Cancelled" || row[1];
      })
      .map(function (row) {
        return [row[0], String(row[1]), pctShare(row[1], report.counts.total)];
      });
    var roomRows = report.rooms.map(function (row) {
      return [row.label, String(row.bookings), String(row.approved), String(row.nights), fmtPHP(row.income)];
    });
    var hallRows = report.halls.map(function (row) {
      return [row.label, String(row.bookings), String(row.approved), fmtPHP(row.income)];
    });
    var monthRows = report.months.map(function (row) {
      return [
        row.fullLabel || row.label,
        String(row.bookings),
        String(row.approved),
        String(row.cancelled),
        fmtPHP(row.income)
      ];
    });
    var registerItems = report.items.slice().sort(function (a, c) {
      var ad = bookingAnchorDate(a.booking || {});
      var cd = bookingAnchorDate(c.booking || {});
      if (ad !== cd) return ad < cd ? -1 : 1;
      var an = String((a.booking || {}).fullName || "").toLowerCase();
      var cn = String((c.booking || {}).fullName || "").toLowerCase();
      if (an !== cn) return an < cn ? -1 : 1;
      return 0;
    });
    var registerRows = registerItems.map(function (it) {
      var b = it.booking || {};
      return [
        b.id || "—",
        b.fullName || "Guest",
        fmtDateOfficial(b.checkIn),
        fmtDateOfficial(b.checkOut),
        String(stayNights(b) || "—"),
        labelRoomType(b.roomType),
        labelEventHall(b.eventHall),
        normalizeStatus(b.status),
        isConfirmedIncome(b) ? fmtPHP(bookingIncome(b)) : "—"
      ];
    });
    var statusSrc = canvasDataUrl("managerReportStatusChart");
    var trendSrc = canvasDataUrl("managerReportTrendChart");
    var facilitySrc = canvasDataUrl("managerReportFacilityChart");
    var revenueSrc = canvasDataUrl("managerReportRevenueChart");
    var reviewsSrc = canvasDataUrl("managerReportReviewsChart");
    var modelHost = document.getElementById("managerModelEvaluation");
    var modelHtml =
      modelHost && modelHost.innerHTML
        ? '<div class="mgr-doc__model-eval">' + modelHost.innerHTML + "</div>"
        : '<p class="mgr-doc__empty">Model evaluation unavailable.</p>';

    sheet.innerHTML =
      '<article class="mgr-doc">' +
      '<div class="mgr-doc__letterhead">' +
      '<img class="mgr-doc__logo" src="../Images/elenest_logo_pink.png" alt="Elenest Resort">' +
      '<div class="mgr-doc__org">' +
      '<p class="mgr-doc__org-name">Elenest Resort</p>' +
      '<p class="mgr-doc__org-sub">Event Center &amp; Guest Accommodations</p>' +
      '<ul class="mgr-doc__org-lines">' +
      "<li>Mataasnakahoy, Batangas, Philippines</li>" +
      "<li>09177906661 · elenest@mail.com</li>" +
      "<li>Open daily: 8:00 AM – 9:00 PM · Reservation Desk: 9:00 AM – 6:00 PM</li>" +
      "</ul></div>" +
      '<div class="mgr-doc__mark">' +
      "<strong>Official record</strong>" +
      "For management use<br>Confidential" +
      "</div></div>" +
      '<div class="mgr-doc__title-block">' +
      '<h1 class="mgr-doc__title">Manager Analytics and Operations Report</h1>' +
      '<p class="mgr-doc__subtitle">Live reservation records as of ' +
      escapeHtml(fmtDateTimeOfficial(report.generatedAt)) +
      "</p>" +
      "</div>" +
      '<table class="mgr-doc__meta">' +
      "<tr><th>Document no.</th><td>" +
      escapeHtml(docNo) +
      "</td><th>Report date</th><td>" +
      escapeHtml(fmtDateTimeOfficial(report.generatedAt)) +
      "</td></tr>" +
      "<tr><th>Coverage period</th><td>" +
      escapeHtml(report.range.label) +
      "</td><th>Period type</th><td>" +
      escapeHtml(report.range.presetLabel) +
      "</td></tr>" +
      "<tr><th>Prepared by</th><td>" +
      escapeHtml(preparedName) +
      "</td><th>Position</th><td>Manager</td></tr>" +
      "<tr><th>Office / email</th><td>" +
      escapeHtml(preparedEmail) +
      "</td><th>Data source</th><td>Live booking records (real-time)</td></tr>" +
      "</table>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">1. Executive summary</h2>' +
      '<p class="mgr-doc__note">Figures are taken from live reservation records at the time shown above. Coverage uses check-in dates within the stated period, unless marked all-time. Approved income uses confirmed stays.</p>' +
      '<table class="mgr-doc__kpis"><thead><tr>' +
      "<th>Bookings in period</th><th>Approved in period</th><th>Pending</th><th>Cancelled</th>" +
      "</tr></thead><tbody><tr>" +
      "<td>" + escapeHtml(report.counts.total) + "</td>" +
      "<td>" + escapeHtml(report.counts.approved) + "</td>" +
      "<td>" + escapeHtml(report.counts.pending) + "</td>" +
      "<td>" + escapeHtml(report.counts.cancelled) + "</td>" +
      "</tr></tbody></table>" +
      '<table class="mgr-doc__kpis" style="margin-top:8px;"><thead><tr>' +
      "<th>Period income (approved)</th><th>All-time income (approved)</th><th>Stay nights</th><th>Approval rate</th>" +
      "</tr></thead><tbody><tr>" +
      "<td>" + escapeHtml(fmtPHP(report.periodIncome)) + "</td>" +
      "<td>" + escapeHtml(fmtPHP(report.allTimeIncome)) + "</td>" +
      "<td>" + escapeHtml(report.periodNights) + "</td>" +
      "<td>" + escapeHtml(report.approvalRate + "%") + "</td>" +
      "</tr></tbody></table>" +
      '<table class="mgr-doc__table" style="margin-top:8px;"><tbody>' +
      "<tr><th>Average confirmed booking value</th><td class=\"num\">" +
      escapeHtml(fmtPHP(avgValue)) +
      "</td></tr>" +
      "<tr><th>Leading room type (period)</th><td>" +
      escapeHtml(report.topRoom ? report.topRoom.label + " — " + report.topRoom.bookings + " booking(s)" : "—") +
      "</td></tr>" +
      "</tbody></table>" +
      "</section>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">2. Booking status summary</h2>' +
      printTable(
        [{ label: "Status" }, { label: "Count", num: true }, { label: "Share of period", num: true }],
        statusRows,
        ["Total", String(report.counts.total), report.counts.total ? "100%" : "—"]
      ) +
      printFindings(report.statusInsights) +
      "</section>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">3. Facility utilization</h2>' +
      '<p class="mgr-doc__note">Room types</p>' +
      printTable(
        [
          { label: "Room type" },
          { label: "Bookings", num: true },
          { label: "Approved", num: true },
          { label: "Nights", num: true },
          { label: "Approved income", num: true }
        ],
        roomRows
      ) +
      '<p class="mgr-doc__note" style="margin-top:10px;">Event halls</p>' +
      printTable(
        [
          { label: "Event hall" },
          { label: "Bookings", num: true },
          { label: "Approved", num: true },
          { label: "Approved income", num: true }
        ],
        hallRows
      ) +
      "</section>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">4. Monthly performance trend</h2>' +
      '<p class="mgr-doc__note">Monthly counts through the end of the coverage period. The view expands to six months when the selected range is shorter, so management can compare recent demand.</p>' +
      printTable(
        [
          { label: "Month" },
          { label: "Bookings", num: true },
          { label: "Approved", num: true },
          { label: "Cancelled", num: true },
          { label: "Approved income", num: true }
        ],
        monthRows
      ) +
      printFindings(report.trendInsights) +
      "</section>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">5. Analytics charts</h2>' +
      '<p class="mgr-doc__note">Same Report &amp; Analytics charts as Admin (live reservation and feedback data).</p>' +
      '<div class="mgr-doc__charts">' +
      '<div class="mgr-doc__chart"><h4>Booking trends</h4>' +
      (trendSrc ? '<img src="' + trendSrc + '" alt="Booking trends chart">' : '<p class="mgr-doc__empty">Chart unavailable.</p>') +
      "</div>" +
      '<div class="mgr-doc__chart"><h4>Booking status</h4>' +
      (statusSrc ? '<img src="' + statusSrc + '" alt="Booking status chart">' : '<p class="mgr-doc__empty">Chart unavailable.</p>') +
      "</div>" +
      '<div class="mgr-doc__chart"><h4>Facility usage</h4>' +
      (facilitySrc ? '<img src="' + facilitySrc + '" alt="Facility usage chart">' : '<p class="mgr-doc__empty">Chart unavailable.</p>') +
      "</div>" +
      '<div class="mgr-doc__chart"><h4>Confirmed revenue by month</h4>' +
      (revenueSrc ? '<img src="' + revenueSrc + '" alt="Revenue chart">' : '<p class="mgr-doc__empty">Chart unavailable.</p>') +
      "</div>" +
      '<div class="mgr-doc__chart mgr-doc__chart--wide"><h4>Guest review composition</h4>' +
      (reviewsSrc ? '<img src="' + reviewsSrc + '" alt="Guest reviews chart">' : '<p class="mgr-doc__empty">Chart unavailable.</p>') +
      "</div>" +
      '<div class="mgr-doc__chart mgr-doc__chart--wide"><h4>Model evaluation</h4>' +
      modelHtml +
      "</div></div></section>" +
      '<section class="mgr-doc__section mgr-doc__section--break mgr-doc__section--register">' +
      '<h2 class="mgr-doc__h">6. Reservation register (coverage period)</h2>' +
      '<p class="mgr-doc__note">' +
      escapeHtml(registerRows.length) +
      " reservation record(s), arranged by check-in date. Amount is shown for confirmed stays only.</p>" +
      printTable(
        [
          { label: "Booking ID" },
          { label: "Guest" },
          { label: "Check-in" },
          { label: "Check-out" },
          { label: "Nights", num: true },
          { label: "Room" },
          { label: "Event hall" },
          { label: "Status" },
          { label: "Amount", num: true }
        ],
        registerRows
      ) +
      "</section>" +
      '<section class="mgr-doc__section">' +
      '<h2 class="mgr-doc__h">7. Certification</h2>' +
      '<p class="mgr-doc__note">This report was generated from the live reservation records of Elenest Resort at the date and time shown above. I certify that the figures reflect the data available at the time of generation.</p>' +
      '<table class="mgr-doc__sign"><tr>' +
      "<td><div class=\"mgr-doc__sign-label\">Prepared by</div>" +
      '<div class="mgr-doc__sign-line">' +
      escapeHtml(preparedName) +
      "<br>Manager, Elenest Resort<br>Date: " +
      escapeHtml(fmtDateOfficial(isoFromLocalDate(report.generatedAt))) +
      "</div></td>" +
      "<td><div class=\"mgr-doc__sign-label\">Noted / received by</div>" +
      '<div class="mgr-doc__sign-line">Name and signature<br>Position<br>Date: ____________________</div></td>' +
      "</tr></table></section>" +
      '<p class="mgr-doc__foot">Elenest Resort · Mataasnakahoy, Batangas · ' +
      escapeHtml(docNo) +
      " · Live records as of " +
      escapeHtml(fmtDateTimeOfficial(report.generatedAt)) +
      " · Not for public release without management approval.</p>" +
      "</article>";
  }

  function finishManagerPrint() {
    document.body.classList.remove("manager-printing");
    var sheet = document.getElementById("managerPrintSheet");
    if (sheet) {
      sheet.setAttribute("hidden", "");
      sheet.setAttribute("aria-hidden", "true");
    }
  }

  function printManagerReport() {
    return pullLiveBookings().then(function () {
      renderAnalytics();
      renderReports();
      var EV = window.ElenestModelEvaluation;
      var wait =
        EV && typeof EV.render === "function"
          ? Promise.resolve(EV.render()).catch(function () {
              return null;
            })
          : Promise.resolve();
      return wait.then(function () {
        buildManagerPrintSheet();
        var sheet = document.getElementById("managerPrintSheet");
        if (sheet) {
          sheet.removeAttribute("hidden");
          sheet.setAttribute("aria-hidden", "false");
        }
        document.body.classList.add("manager-printing");
        window.setTimeout(function () {
          try {
            window.print();
          } catch (e) {
            finishManagerPrint();
          }
        }, 80);
      });
    });
  }

  function downloadJsonReport() {
    var Auth = window.ElenestAuth;
    var u = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    var feedbackSnap = readFeedback();
    var report = computeManagerReport();
    var payload = {
      generatedAt: report.generatedAt.toISOString(),
      dataSource: "live",
      generatedBy: u ? { email: u.email || "", name: u.name || "", role: u.role || "" } : null,
      coverage: report.range,
      summary: {
        totals: report.counts,
        statuses: report.statuses,
        periodIncome: report.periodIncome,
        allTimeIncome: report.allTimeIncome,
        periodNights: report.periodNights,
        approvalRate: report.approvalRate,
        topRoom: report.topRoom,
        rooms: report.rooms,
        halls: report.halls,
        months: report.months,
        avgBookingValue: report.avgBookingValue
      },
      bookings: report.items,
      guestFeedback: feedbackSnap
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "elenest-manager-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
  }

  function init() {
    var Auth = window.ElenestAuth;
    if (!Auth) return;

    function boot(user) {
      if (!Auth.assertPageAccess) {
        if (!user) {
          window.location.replace("login.html");
          return;
        }
        if ((Auth.normalizeRole ? Auth.normalizeRole(user.role) : "") !== "manager") {
          window.location.replace(Auth.getHomePathForRole(user.role));
          return;
        }
        initManagerDashboard(user);
        return;
      }
      Auth.assertPageAccess("manager").then(function (result) {
        if (!result || !result.ok) {
          var dest = (result && result.redirect) || "login.html";
          if (/book\.html/i.test(String(dest))) dest = "login.html";
          window.location.replace(dest);
          return;
        }
        initManagerDashboard(result.user);
      });
    }

    if (Auth.ready) {
      Auth.ready.then(boot);
      return;
    }
    boot(Auth.getCurrentUser ? Auth.getCurrentUser() : null);
  }

  function initManagerDashboard(sessionUser) {
    var Auth = window.ElenestAuth;
    if (!Auth) return;

    var navLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
    var MANAGER_MOBILE_NAV_BP = 1100;

    function isManagerMobileNav() {
      return window.innerWidth <= MANAGER_MOBILE_NAV_BP;
    }

    function closeManagerNavDropdowns(exceptDropdown) {
      document.querySelectorAll(".admin-nav-dropdown.is-open").forEach(function (dropdown) {
        if (exceptDropdown && dropdown === exceptDropdown) return;
        dropdown.classList.remove("is-open");
        var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }

    function initManagerNavDropdowns() {
      document.querySelectorAll(".admin-nav-dropdown").forEach(function (dropdown) {
        var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
        var menu = dropdown.querySelector(".admin-nav-dropdown-menu");
        if (!toggle || !menu) return;

        toggle.addEventListener("click", function (e) {
          if (isManagerMobileNav()) return;
          e.preventDefault();
          e.stopPropagation();
          if (dropdown.classList.contains("is-open")) {
            closeManagerNavDropdowns();
            return;
          }
          closeManagerNavDropdowns(dropdown);
          dropdown.classList.add("is-open");
          toggle.setAttribute("aria-expanded", "true");
        });

        menu.querySelectorAll('a[href^="#section-"]').forEach(function (link) {
          link.addEventListener("click", function () {
            closeManagerNavDropdowns();
          });
        });
      });

      document.addEventListener("click", function (e) {
        if (isManagerMobileNav()) return;
        var insideDropdown = e.target && e.target.closest && e.target.closest(".admin-nav-dropdown");
        if (insideDropdown) return;
        closeManagerNavDropdowns();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeManagerNavDropdowns();
      });
    }

    initManagerNavDropdowns();
    navLinks.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var href = a.getAttribute("href") || "";
        e.preventDefault();
        try {
          window.location.hash = href;
        } catch (err) {}
        showSection(href);
      });
    });

    window.addEventListener("hashchange", function () {
      currentSectionId = null;
      showSection(window.location.hash);
    });

    window.addEventListener("elenest-content-updated", function () {
      if (currentSectionId === "section-content" && window.ElenestContentManagement) {
        window.ElenestContentManagement.renderSection();
      }
    });

    window.addEventListener("elenest-review-names-updated", function () {
      if (document.getElementById("managerFeedbackList")) renderFeedbackPeople();
      if (
        window.ElenestGuestFeedback &&
        typeof window.ElenestGuestFeedback.mountRecentReviewNames === "function"
      ) {
        window.ElenestGuestFeedback.mountRecentReviewNames(
          document.getElementById("managerReportGuestReviewsCard")
        );
      }
    });

    window.addEventListener("elenest-feedback-updated", function () {
      invalidateFullReviewsCache();
      loadFullReviewRecordsForHomeKpis(true).then(function () {
        renderDashboard();
        if (currentSectionId === "section-recommendations") renderRecommendations();
        if (currentSectionId === "section-analytics" || currentSectionId === "section-reports") {
          renderManagerGuestReviews();
        }
      });
    });

    window.addEventListener("elenest-bookings-updated", function () {
      renderDashboard();
      if (currentSectionId === "section-manage") renderManage();
      if (currentSectionId === "section-calendar") renderCalendarSection();
      if (currentSectionId === "section-analytics") {
        renderAnalytics();
        renderReports();
      }
    });

    window.addEventListener("storage", function (e) {
      if (!e) return;
      if (e.key !== "elenest_bookings" && e.key !== "elenest_manager_blocks" &&
          e.key !== "elenest_notification_broadcasts" && e.key !== "elenest_feedback") return;
      renderDashboard();
      if (currentSectionId === "section-content" && window.ElenestContentManagement) {
        window.ElenestContentManagement.renderSection();
      }
      if (currentSectionId === "section-manage") renderManage();
      if (currentSectionId === "section-calendar") renderCalendarSection();
      if (currentSectionId === "section-analytics") {
        renderAnalytics();
        renderReports();
      }
      if (currentSectionId === "section-recommendations") renderRecommendations();
    });

    var refreshDash = document.getElementById("managerRefreshDashboard");
    if (refreshDash) {
      refreshDash.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshDash, function () { return pullLiveBookings(); });
        else pullLiveBookings();
      });
    }

    var dashPrev = document.getElementById("managerDashCalPrev");
    var dashNext = document.getElementById("managerDashCalNext");
    if (dashPrev) {
      dashPrev.addEventListener("click", function () {
        dashCalView.m--;
        if (dashCalView.m < 0) {
          dashCalView.m = 11;
          dashCalView.y--;
        }
        renderDashboardCalendar();
      });
    }
    if (dashNext) {
      dashNext.addEventListener("click", function () {
        dashCalView.m++;
        if (dashCalView.m > 11) {
          dashCalView.m = 0;
          dashCalView.y++;
        }
        renderDashboardCalendar();
      });
    }
    var refreshMessages = document.getElementById("managerRefreshMessages");
    if (refreshMessages) {
      refreshMessages.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = function () {
          var api = window.ElenestContactMessages;
          if (api && typeof api.refresh === "function") {
            return api.refresh().then(renderMessages);
          }
          renderMessages();
        };
        if (BL) BL.run(refreshMessages, work);
        else work();
      });
    }
    window.addEventListener("elenest-contact-messages-updated", renderMessages);
    if (window.ElenestContactMessages && window.ElenestContactMessages.ready) {
      window.ElenestContactMessages.ready.then(renderMessages);
    }

    var approvalsFilter = document.getElementById("managerApprovalsFilter");
    if (approvalsFilter) approvalsFilter.addEventListener("change", renderApprovals);
    var refreshApprovals = document.getElementById("managerRefreshApprovals");
    if (refreshApprovals) {
      refreshApprovals.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshApprovals, function () { renderApprovals(); });
        else renderApprovals();
      });
    }

    var searchEl = document.getElementById("managerManageSearch");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        managePage = 1;
        renderManage();
      });
    }
    var refreshManage = document.getElementById("managerRefreshManage");
    if (refreshManage) {
      refreshManage.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshManage, function () { renderManage(); });
        else renderManage();
      });
    }

    var calPrev = document.getElementById("managerCalPrev");
    var calNext = document.getElementById("managerCalNext");
    if (calPrev) {
      calPrev.addEventListener("click", function () {
        managerCalView.m--;
        if (managerCalView.m < 0) {
          managerCalView.m = 11;
          managerCalView.y--;
        }
        renderManagerCalendar();
      });
    }
    if (calNext) {
      calNext.addEventListener("click", function () {
        managerCalView.m++;
        if (managerCalView.m > 11) {
          managerCalView.m = 0;
          managerCalView.y++;
        }
        renderManagerCalendar();
      });
    }
    var calRefresh = document.getElementById("managerCalendarRefresh");
    if (calRefresh) {
      calRefresh.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = function () {
          if (window.ElenestAvailability && typeof window.ElenestAvailability.refreshManagerBlocks === "function") {
            return window.ElenestAvailability.refreshManagerBlocks().finally(function () {
              renderManagerCalendar();
              renderAppointmentsForSelectedDate();
            });
          }
          renderCalendarSection();
        };
        if (BL) {
          BL.run(calRefresh, work).catch(function () {
            warnManagerCalendar("Could not refresh the calendar. Please try again.");
          });
        } else {
          Promise.resolve()
            .then(work)
            .catch(function () {
              warnManagerCalendar("Could not refresh the calendar. Please try again.");
            });
        }
      });
    }
    var clearSel = document.getElementById("managerClearSelectedDate");
    if (clearSel) {
      clearSel.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.run(clearSel, function () {
            selectedIsoDate = null;
            renderManagerCalendar();
            renderAppointmentsForSelectedDate();
          });
        } else {
          selectedIsoDate = null;
          renderManagerCalendar();
          renderAppointmentsForSelectedDate();
        }
      });
    }

    function warnManagerCalendar(text) {
      var statusEl = document.getElementById("managerSelectedDateStatus");
      if (statusEl) statusEl.textContent = text;
      if (window.ElenestErrors && typeof window.ElenestErrors.toast === "function") {
        window.ElenestErrors.toast(text);
      }
    }

    var blockBtn = document.getElementById("managerBlockBtn");
    if (blockBtn) {
      blockBtn.addEventListener("click", function () {
        if (!selectedIsoDate) {
          warnManagerCalendar("Select a date on the calendar first.");
          return;
        }
        var CA = window.ElenestCalendarAccess;
        if (!CA || typeof CA.promptManagerRequest !== "function") {
          warnManagerCalendar("Calendar controls are still loading. Please try again.");
          return;
        }
        Promise.resolve(CA.promptManagerRequest(selectedIsoDate, "block")).then(function () {
          renderManagerCalendar();
          renderAppointmentsForSelectedDate();
        }).catch(function () {
          warnManagerCalendar("Could not send the block request. Please try again.");
        });
      });
    }
    var unblockBtn = document.getElementById("managerUnblockBtn");
    if (unblockBtn) {
      unblockBtn.addEventListener("click", function () {
        if (!selectedIsoDate) {
          warnManagerCalendar("Select a date on the calendar first.");
          return;
        }
        var CA = window.ElenestCalendarAccess;
        if (!CA || typeof CA.promptManagerRequest !== "function") {
          warnManagerCalendar("Calendar controls are still loading. Please try again.");
          return;
        }
        Promise.resolve(CA.promptManagerRequest(selectedIsoDate, "unblock")).then(function () {
          renderManagerCalendar();
          renderAppointmentsForSelectedDate();
        }).catch(function () {
          warnManagerCalendar("Could not send the unblock request. Please try again.");
        });
      });
    }

    var refreshAnalytics = document.getElementById("managerRefreshAnalytics");
    if (refreshAnalytics) {
      refreshAnalytics.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.run(refreshAnalytics, function () {
            return pullLiveBookings();
          });
        } else {
          pullLiveBookings();
        }
      });
    }

    var refreshRecommendations = document.getElementById("managerRefreshRecommendations");
    if (refreshRecommendations) {
      refreshRecommendations.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshRecommendations, function () { renderRecommendations(); });
        else renderRecommendations();
      });
    }

    function refreshAnalyticsReports() {
      return pullLiveBookings();
    }

    var presetEl = document.getElementById("managerReportPreset");
    var fromEl = document.getElementById("managerReportFrom");
    var toEl = document.getElementById("managerReportTo");
    var applyRangeBtn = document.getElementById("managerApplyReportRange");
    ensureReportRangeDefaults();

    if (presetEl) {
      presetEl.addEventListener("change", function () {
        if (presetEl.value !== "custom") syncReportRangeInputs(presetEl.value);
        else {
          if (fromEl) fromEl.disabled = false;
          if (toEl) toEl.disabled = false;
        }
        refreshAnalyticsReports();
      });
    }
    function onManualRangeChange() {
      if (presetEl && presetEl.value !== "custom") presetEl.value = "custom";
      if (fromEl) fromEl.disabled = false;
      if (toEl) toEl.disabled = false;
      refreshAnalyticsReports();
    }
    if (fromEl) fromEl.addEventListener("change", onManualRangeChange);
    if (toEl) toEl.addEventListener("change", onManualRangeChange);
    if (applyRangeBtn) {
      applyRangeBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(applyRangeBtn, function () { refreshAnalyticsReports(); });
        else refreshAnalyticsReports();
      });
    }

    var dl = document.getElementById("managerDownloadReport");
    if (dl) {
      dl.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        var work = function () {
          return pullLiveBookings().then(function () {
            downloadJsonReport();
          });
        };
        if (BL) BL.run(dl, work, "Loading live records…");
        else work();
      });
    }

    var printBtn = document.getElementById("managerPrintReport");
    if (printBtn) {
      printBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(printBtn, function () { return printManagerReport(); }, "Loading live records…");
        else printManagerReport();
      });
    }

    window.addEventListener("beforeprint", function () {
      if (document.body.classList.contains("manager-printing")) return;
      if (currentSectionId !== "section-analytics") return;
      buildManagerPrintSheet();
      var sheet = document.getElementById("managerPrintSheet");
      if (sheet) {
        sheet.removeAttribute("hidden");
        sheet.setAttribute("aria-hidden", "false");
      }
      document.body.classList.add("manager-printing");
    });
    window.addEventListener("afterprint", finishManagerPrint);

    if (window.ElenestCmsMarketing && window.ElenestCmsMarketing.init) {
      window.ElenestCmsMarketing.init();
    }
    if (window.ElenestContentManagement && window.ElenestContentManagement.init) {
      window.ElenestContentManagement.init();
    }
    if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.init) {
      window.ElenestCalendarAccess.init();
    }
    window.addEventListener("elenest-calendar-access-updated", function () {
      if (currentSectionId === "section-calendar") {
        renderManagerCalendar();
        renderAppointmentsForSelectedDate();
      }
    });

    function bootDashboard() {
      showSection(getSectionIdFromHash(window.location.hash));
      renderRecommendations();
      renderDashboard();
      pullLiveBookings();
      if (window.ElenestStaffBootLoading && typeof window.ElenestStaffBootLoading.hide === "function") {
        window.ElenestStaffBootLoading.hide();
      }
    }

    bootDashboard();
    function refreshAfterData() {
      renderRecommendations();
      renderDashboard();
      pullLiveBookings();
    }
    if (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready) {
      window.ElenestGuestFeedback.ready.then(refreshAfterData);
    }
    if (window.ElenestBookings && window.ElenestBookings.ready) {
      window.ElenestBookings.ready.then(refreshAfterData);
    }

    setInterval(function () {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      if (currentSectionId !== "section-dashboard" && currentSectionId !== "section-analytics") return;
      pullLiveBookings();
    }, 15000);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (currentSectionId !== "section-dashboard" && currentSectionId !== "section-analytics") return;
      pullLiveBookings();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

