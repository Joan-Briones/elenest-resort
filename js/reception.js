(function () {
  var STORAGE_USERS = "elenest_users";
  var RECEPTION_PAGE_SIZE = 5;
  var receptionListPages = {
    checkIn: 1,
    checkOut: 1,
    recordsConfirmed: 1,
    recordsCheckout: 1
  };

  function notifyReceptionError(message) {
    var text = message || "Could not complete that action. Please try again.";
    if (typeof Swal !== "undefined" && typeof Swal.fire === "function") {
      Swal.fire({ icon: "error", title: "Action failed", text: text });
      return;
    }
    if (window.ElenestErrors && typeof window.ElenestErrors.toast === "function") {
      window.ElenestErrors.toast(text);
      return;
    }
    window.alert(text);
  }

  function paginateItems(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Number(pageSize) || RECEPTION_PAGE_SIZE);
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
    if (!state || !state.total) {
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

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function getUsers() {
    try {
      var raw = localStorage.getItem(STORAGE_USERS);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }

  function updateUserPassword(email, currentPassword, newPassword) {
    var users = getUsers();
    var targetEmail = normalizeEmail(email);
    var idx = -1;
    for (var i = 0; i < users.length; i++) {
      if (normalizeEmail(users[i].email) === targetEmail && users[i].password === currentPassword) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return { ok: false, message: "Current password is incorrect." };
    users[idx].password = newPassword;
    saveUsers(users);
    return { ok: true };
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function normalizeStatus(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.normalizeBookingStatus === "function") {
      return PF.normalizeBookingStatus(st);
    }
    var s = String(st || "Pending").trim().toLowerCase();
    if (s === "confirmed" || s === "approved" || s === "active") return "Confirmed";
    if (s === "reserved") return "Reserved";
    if (s === "checked in" || s === "checked_in") return "Checked In";
    if (s === "checked out" || s === "checked_out" || s === "completed") return "Checked Out";
    if (s === "cancelled" || s === "canceled") return "Cancelled";
    if (s === "for verification" || s === "pending payment verification") return "For Verification";
    return "Pending";
  }

  function isPendingPaymentVerification(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isAwaitingPaymentVerification === "function") {
      return PF.isAwaitingPaymentVerification(b);
    }
    if (!b) return false;
    var raw = String(b.status || "").trim().toLowerCase();
    return raw === "pending payment verification" || raw === "for verification";
  }

  function isOwnerPaymentVerified(b) {
    if (!b) return false;
    if (b.paymentVerifiedAt) return true;
    var ps = String(b.paymentStatus || "").toLowerCase();
    return (
      ps.indexOf("payment approved") >= 0 ||
      ps.indexOf("payment verified") >= 0 ||
      ps.indexOf("fully paid") >= 0 ||
      ps.indexOf("down payment received") >= 0
    );
  }

  function getStaffEmail() {
    var u =
      window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
    return (u && u.email) || "";
  }

  /** User-facing label in Reception. */
  function statusLabel(st, booking) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingDisplayStatus === "function" && booking) {
      var display = PF.bookingDisplayStatus(booking);
      if (PF.isFutureBooking && PF.isFutureBooking(booking)) {
        return display + " · " + PF.futureBookingLabel(booking);
      }
      return display;
    }
    var n = normalizeStatus(st);
    if (n === "Confirmed" || n === "Reserved") return "Confirmed";
    if (n === "Checked In") return "Confirmed";
    if (n === "Checked Out" || n === "Completed") return "Completed";
    return n;
  }

  function paymentStatusLabel(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.paymentDisplayLabel === "function") return PF.paymentDisplayLabel(b);
    return (b && b.paymentStatus) || "—";
  }

  function arrivalStatusLabel(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.arrivalDisplayLabel === "function") return PF.arrivalDisplayLabel(b);
    return "Not Arrived";
  }

  function statusClass(st, booking) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getStatusPresentation === "function") {
      return PF.getStatusPresentation(booking || st).badgeClass;
    }
    var s = normalizeStatus(st);
    if (s === "Confirmed" || s === "Checked In" || s === "Reserved" || s === "Checked Out" || s === "Completed") {
      return "booking-status--confirmed";
    }
    if (s === "Cancelled" || s === "Rejected" || s === "No Show") return "booking-status--cancelled";
    return "booking-status--pending";
  }

  function applyReceptionStatusBadge(el, opts) {
    opts = opts || {};
    var PF = window.ElenestPaymentFlow;
    var kind = opts.kind || "pending";
    var label = opts.label || "";
    var badgeClass = opts.badgeClass;
    if (PF && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(el, { kind: kind, label: label, badgeClass: badgeClass });
      return el;
    }
    el.className = "booking-status " + (badgeClass || "booking-status--pending");
    el.textContent = label;
    return el;
  }

  function isEligibleForCheckInQueue(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isEligibleForCheckInQueue === "function") {
      return PF.isEligibleForCheckInQueue(b);
    }
    return isReadyForCheckIn(b);
  }

  function isReadyForCheckIn(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isReadyForReceptionCheckIn === "function") {
      return PF.isReadyForReceptionCheckIn(b);
    }
    if (!b || b.checkedInAt) return false;
    if (isPendingPaymentVerification(b)) return false;
    var st = normalizeStatus(b.status);
    return (st === "Confirmed" || st === "Reserved") && isOwnerPaymentVerified(b);
  }

  function isReadyForCheckOut(b) {
    // Stay end due — highlight as ready (still shown with all in-house on Check-out page)
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isReadyForReceptionCheckOut === "function") {
      return PF.isReadyForReceptionCheckOut(b);
    }
    return !!(b && b.checkedInAt && !b.checkedOutAt);
  }

  /** Any guest currently checked in (appears on Check-out list). */
  function isOnCheckOutList(b) {
    if (!b) return false;
    if (b.checkedOutAt) return false;
    var st = normalizeStatus(b.status);
    if (st === "Checked Out" || st === "Completed" || st === "Cancelled" || st === "Rejected" || st === "No Show") {
      return false;
    }
    return !!(b.checkedInAt || st === "Checked In");
  }

  function isInHouse(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isInHouseGuest === "function") {
      return PF.isInHouseGuest(b);
    }
    return isOnCheckOutList(b) && !isReadyForCheckOut(b);
  }

  function refreshFromSupabase() {
    var B = window.ElenestBookings;
    if (B && typeof B.refresh === "function") {
      return B.refresh()
        .catch(function () {
          return false;
        })
        .then(function () {
          refreshReceptionLists();
          return true;
        });
    }
    refreshReceptionLists();
    return Promise.resolve(false);
  }

  /** True when reception has an approved reservation (legacy helper). */
  function isBookingApproved(b) {
    var st = normalizeStatus(b && b.status);
    return (
      st === "Confirmed" ||
      st === "Reserved" ||
      st === "Checked In" ||
      st === "Approved"
    );
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
      return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (err) {
      return "—";
    }
  }

  function labelRoomType(v) {
    if (v === "big") return "Big room";
    if (v === "small") return "Small room";
    if (v === "couple") return "Couple room";
    if (v === "none") return "No room";
    return v ? String(v) : "—";
  }

  function fmtDateCompact(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (err) {
      return iso;
    }
  }

  function resolveUnitName(id) {
    var key = String(id || "").trim();
    if (!key) return "";
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.getCatalog === "function") {
      var unit = UA.getCatalog().find(function (u) {
        return String(u.id) === key;
      });
      if (unit && unit.name) return String(unit.name);
    }
    return key;
  }

  function formatFacilityLabel(b) {
    if (!b) return "—";
    var names = [];
    function pushName(v) {
      var n = String(v || "").trim();
      if (n && names.indexOf(n) === -1) names.push(n);
    }
    if (Array.isArray(b.roomCatalogNames)) b.roomCatalogNames.forEach(pushName);
    else if (b.roomCatalogName) pushName(b.roomCatalogName);
    if (Array.isArray(b.cottageCatalogNames)) b.cottageCatalogNames.forEach(pushName);
    if (Array.isArray(b.hallCatalogNames)) b.hallCatalogNames.forEach(pushName);
    else if (b.hallCatalogName) pushName(b.hallCatalogName);

    if (!names.length) {
      var roomIds = Array.isArray(b.roomCatalogIds) && b.roomCatalogIds.length
        ? b.roomCatalogIds
        : b.roomCatalogId
          ? [b.roomCatalogId]
          : [];
      var cottageIds = Array.isArray(b.cottageCatalogIds) ? b.cottageCatalogIds : [];
      var hallIds = Array.isArray(b.hallCatalogIds) && b.hallCatalogIds.length
        ? b.hallCatalogIds
        : b.hallCatalogId
          ? [b.hallCatalogId]
          : [];
      roomIds.concat(cottageIds).concat(hallIds).forEach(function (id) {
        pushName(resolveUnitName(id));
      });
    }

    if (names.length) return names.join(", ");
    var room = labelRoomType(b.roomType);
    var bits = [];
    if (room && room !== "—" && room !== "No room") bits.push(room);
    var cottageQty = parseInt(b.cottageQty, 10) || 0;
    if (cottageQty > 0) bits.push(cottageQty === 1 ? "1 cottage" : cottageQty + " cottages");
    var hall = b.eventHall != null ? String(b.eventHall).trim() : "";
    if (hall && hall !== "none" && hall !== "no") bits.push(hall);
    return bits.length ? bits.join(" · ") : room || "—";
  }

  function bookingStayLabel(b) {
    var pool = String((b && b.poolUse) || "").toLowerCase();
    if (pool === "pool_only") return "Swimming Pool Only";
    if (pool === "day_tour") return "One-Day Book";
    if (pool === "swimming_overnight") return "Overnight Book";
    if (b && b.checkIn && b.checkOut && String(b.checkIn) === String(b.checkOut)) return "One-Day Book";
    if (b && b.checkIn && b.checkOut) return "Overnight Book";
    return "";
  }

  function isLocalDevHost(hostname) {
    var h = String(hostname || "")
      .trim()
      .toLowerCase();
    return (
      !h ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h.indexOf("192.168.") === 0 ||
      h.indexOf("10.") === 0
    );
  }

  /** Guest-facing /html/ base for email links (InfinityFree when staff is local). */
  function getPublicHtmlBaseUrl() {
    var cfg = window.ElenestSupabaseConfig || {};
    var publicBase = String(
      cfg.publicSiteHtmlBaseUrl || "https://elenestresort.infinityfreeapp.com/html/"
    ).trim();
    if (publicBase && publicBase.charAt(publicBase.length - 1) !== "/") {
      publicBase += "/";
    }

    try {
      if (
        window.location.protocol === "http:" ||
        window.location.protocol === "https:"
      ) {
        var host = window.location.hostname || "";
        if (!isLocalDevHost(host)) {
          var path = window.location.pathname || "";
          var htmlIdx = path.toLowerCase().lastIndexOf("/html/");
          if (htmlIdx !== -1) {
            return window.location.origin + path.substring(0, htmlIdx + 6);
          }
          var live = String(cfg.siteHtmlBaseUrl || "").trim();
          if (live) {
            if (live.charAt(live.length - 1) !== "/") live += "/";
            return live;
          }
          return window.location.origin + "/html/";
        }
      }
    } catch (e) {}

    return publicBase || "https://elenestresort.infinityfreeapp.com/html/";
  }

  function getReviewInviteApiUrl() {
    if (window.location.protocol === "file:") {
      return "http://localhost/Elenest_Resort/api/send-review-invite.php";
    }
    var path = window.location.pathname || "";
    if (path.indexOf("/html/") !== -1) {
      return "../api/send-review-invite.php";
    }
    return "api/send-review-invite.php";
  }

  function buildReviewPageUrl(booking, accountEmail) {
    var email = String((booking && booking.email) || accountEmail || "").trim();
    var bookingId = booking && booking.id ? String(booking.id) : "";
    // Always a public https URL so guests on phones can open InfinityFree.
    var absolute = getPublicHtmlBaseUrl() + "reviews.html";
    var params = ["review=1"];
    var guestName = String((booking && (booking.fullName || booking.name)) || "").trim();
    if (bookingId) params.push("booking=" + encodeURIComponent(bookingId));
    if (email) params.push("email=" + encodeURIComponent(email));
    if (guestName && guestName.toLowerCase() !== "guest") {
      params.push("name=" + encodeURIComponent(guestName));
    }
    var qs = params.join("&");
    return absolute + "?" + qs + "#guest-review?" + qs;
  }

  function sendReviewInviteEmail(booking, accountEmail) {
    if (!booking) return Promise.resolve({ ok: false, skipped: true });
    if (booking.reviewInviteSentAt) {
      return Promise.resolve({ ok: true, skipped: true, message: "Already sent." });
    }
    var to = String((booking && booking.email) || accountEmail || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return Promise.resolve({ ok: false, skipped: true, message: "Customer email is missing." });
    }
    var facility = formatFacilityLabel(booking);
    if (facility === "—") facility = "";
    return fetch(getReviewInviteApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to,
        name: (booking && (booking.fullName || booking.name)) || "Guest",
        facility: facility,
        stay_label: bookingStayLabel(booking),
        check_in: booking && booking.checkIn ? fmtDateLong(booking.checkIn) : "",
        check_out: booking && booking.checkOut ? fmtDateLong(booking.checkOut) : "",
        booking_id: booking && booking.id ? String(booking.id) : "",
        review_url: buildReviewPageUrl(booking, accountEmail)
      })
    })
      .then(function (res) {
        return res.json().then(
          function (data) {
            if (!res.ok || !data || !data.ok) {
              throw new Error((data && data.message) || "Could not send review invitation email.");
            }
            return data;
          },
          function () {
            throw new Error("Invalid response from email server.");
          }
        );
      })
      .then(function (data) {
        var B = window.ElenestBookings;
        if (B && typeof B.updateFields === "function" && booking.id) {
          return B.updateFields(accountEmail || to, booking.id, {
            reviewInviteSentAt: new Date().toISOString()
          }).then(
            function () {
              return data;
            },
            function () {
              return data;
            }
          );
        }
        return data;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Reception] Review invite email failed:", err);
        } catch (e) {}
        return { ok: false, message: (err && err.message) || "Could not send email." };
      });
  }

  function createReceptionRecordsTable() {
    var wrap = document.createElement("div");
    wrap.className = "reception-table-wrap";
    var table = document.createElement("table");
    table.className = "reception-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [
      { label: "Customer Name", cls: "reception-table__name" },
      { label: "Booking ID", cls: "reception-table__id" },
      { label: "Room / Facility", cls: "reception-table__facility" },
      { label: "Stay", cls: "reception-table__stay" },
      { label: "Status", cls: "reception-table__status" },
      { label: "Actions", cls: "reception-table__actions" }
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
    table.appendChild(tbody);
    wrap.appendChild(table);
    return { wrap: wrap, tbody: tbody };
  }

  function listBookings() {
    var B = window.ElenestBookings;
    if (B && typeof B.listLive === "function") return B.listLive();
    if (B && typeof B.listAll === "function") return B.listAll();
    return [];
  }

  function patchBooking(accountEmail, id, patch) {
    var B = window.ElenestBookings;
    if (B && typeof B.updateFields === "function") {
      return B.updateFields(accountEmail, id, patch).then(function (ok) {
        refreshReceptionLists();
        return ok;
      });
    }
    return Promise.resolve(false);
  }

  var walkCalView = {
    y: new Date().getFullYear(),
    m: new Date().getMonth()
  };

  function emptyWalkInSelection() {
    return {
      roomCatalogIds: [],
      roomCatalogId: "",
      cottageCatalogIds: [],
      hallCatalogIds: [],
      hallCatalogId: ""
    };
  }

  function cloneWalkInSelection(sel) {
    sel = sel || emptyWalkInSelection();
    var roomIds = [];
    if (Array.isArray(sel.roomCatalogIds) && sel.roomCatalogIds.length) {
      roomIds = sel.roomCatalogIds.map(String).filter(Boolean);
    } else if (sel.roomCatalogId) {
      roomIds = [String(sel.roomCatalogId)];
    }
    var hallIds = [];
    if (Array.isArray(sel.hallCatalogIds) && sel.hallCatalogIds.length) {
      hallIds = sel.hallCatalogIds.map(String).filter(Boolean);
    } else if (sel.hallCatalogId) {
      hallIds = [String(sel.hallCatalogId)];
    }
    return {
      roomCatalogIds: roomIds,
      roomCatalogId: roomIds[0] || "",
      cottageCatalogIds: Array.isArray(sel.cottageCatalogIds)
        ? sel.cottageCatalogIds.map(String).filter(Boolean)
        : [],
      hallCatalogIds: hallIds,
      hallCatalogId: hallIds[0] || ""
    };
  }

  var WALK_DAY_TOUR_ARRIVAL = "8:00 AM";
  var WALK_DAY_TOUR_DEPARTURE = "10:00 PM";

  var walkInState = {
    stayType: "overnight",
    checkIn: null,
    checkOut: null,
    checkInTime: "",
    checkOutTime: "",
    facilityConfirmed: false,
    facilityName: "",
    facilityType: "",
    selection: emptyWalkInSelection(),
    draftFacilityName: "",
    draftFacilityType: "",
    draftSelection: emptyWalkInSelection()
  };

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatWalkInTime12h(h24, min) {
    var h = parseInt(h24, 10);
    var m = min === undefined || min === null ? 0 : parseInt(min, 10);
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(m) + " " + ampm;
  }

  function isWalkInDayTour() {
    return walkInState.stayType === "day_tour";
  }

  function getWalkInStayTypeFromForm() {
    var checked = document.querySelector('input[name="receptionWiStayType"]:checked');
    return checked && checked.value === "day_tour" ? "day_tour" : "overnight";
  }

  function fillWalkInTimeSelects() {
    var inS = document.getElementById("receptionWiCheckInTime");
    var outS = document.getElementById("receptionWiCheckOutTime");
    if (!inS || !outS) return;
    var prevIn = walkInState.checkInTime || inS.value || "";
    var prevOut = walkInState.checkOutTime || outS.value || "";
    inS.innerHTML = "";
    outS.innerHTML = "";
    var phIn = document.createElement("option");
    phIn.value = "";
    phIn.textContent = "Select arrival time";
    phIn.disabled = true;
    phIn.selected = true;
    inS.appendChild(phIn);
    var phOut = document.createElement("option");
    phOut.value = "";
    phOut.textContent = "Select departure time";
    phOut.disabled = true;
    phOut.selected = true;
    outS.appendChild(phOut);
    for (var h = 8; h <= 22; h++) {
      var label12 = formatWalkInTime12h(h, 0);
      var o1 = document.createElement("option");
      o1.value = label12;
      o1.textContent = label12;
      inS.appendChild(o1);
      var o2 = document.createElement("option");
      o2.value = label12;
      o2.textContent = label12;
      outS.appendChild(o2);
    }
    function pickValid(sel, pref) {
      if (!pref) {
        sel.selectedIndex = 0;
        return "";
      }
      var opts = sel.querySelectorAll("option");
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === pref) {
          sel.value = pref;
          return pref;
        }
      }
      sel.selectedIndex = 0;
      return "";
    }
    walkInState.checkInTime = pickValid(inS, prevIn);
    walkInState.checkOutTime = pickValid(outS, prevOut);
  }

  function applyWalkInDayTourTimes() {
    walkInState.checkInTime = WALK_DAY_TOUR_ARRIVAL;
    walkInState.checkOutTime = WALK_DAY_TOUR_DEPARTURE;
    var inS = document.getElementById("receptionWiCheckInTime");
    var outS = document.getElementById("receptionWiCheckOutTime");
    var dayTourTime = document.getElementById("receptionWiDayTourTime");
    if (inS) {
      inS.value = WALK_DAY_TOUR_ARRIVAL;
      inS.disabled = true;
      inS.required = false;
    }
    if (outS) {
      outS.value = WALK_DAY_TOUR_DEPARTURE;
      outS.disabled = true;
      outS.required = false;
    }
    if (dayTourTime) dayTourTime.value = WALK_DAY_TOUR_ARRIVAL + " – " + WALK_DAY_TOUR_DEPARTURE;
  }

  function syncWalkInStayTypeUI() {
    var form = document.getElementById("receptionWalkInForm");
    var overnightIn = document.getElementById("receptionWiTimeOvernightWrap");
    var overnightOut = document.getElementById("receptionWiTimeOvernightOutWrap");
    var dayTourWrap = document.getElementById("receptionWiTimeDayTourWrap");
    var co = document.getElementById("receptionWiCheckOut");
    var inS = document.getElementById("receptionWiCheckInTime");
    var outS = document.getElementById("receptionWiCheckOutTime");
    var dayTour = isWalkInDayTour();

    if (form) form.setAttribute("data-stay", dayTour ? "day_tour" : "overnight");
    if (overnightIn) overnightIn.hidden = dayTour;
    if (overnightOut) overnightOut.hidden = dayTour;
    if (dayTourWrap) dayTourWrap.hidden = !dayTour;

    if (co) {
      co.readOnly = dayTour;
      co.disabled = false;
      if (dayTour) co.setAttribute("aria-readonly", "true");
      else co.removeAttribute("aria-readonly");
    }

    if (dayTour) {
      applyWalkInDayTourTimes();
      if (walkInState.checkIn) {
        walkInState.checkOut = nextIsoDay(walkInState.checkIn);
      }
    } else {
      if (inS) {
        inS.disabled = false;
        inS.required = true;
      }
      if (outS) {
        outS.disabled = false;
        outS.required = true;
      }
      if (
        walkInState.checkInTime === WALK_DAY_TOUR_ARRIVAL &&
        walkInState.checkOutTime === WALK_DAY_TOUR_DEPARTURE
      ) {
        walkInState.checkInTime = "";
        walkInState.checkOutTime = "";
        if (inS) inS.selectedIndex = 0;
        if (outS) outS.selectedIndex = 0;
      }
      if (
        walkInState.checkIn &&
        walkInState.checkOut &&
        walkInState.checkOut <= walkInState.checkIn
      ) {
        walkInState.checkOut = nextIsoDay(walkInState.checkIn);
      }
    }
  }

  function isoToUtcDate(iso) {
    var y = parseInt(String(iso).slice(0, 4), 10);
    var m = parseInt(String(iso).slice(5, 7), 10) - 1;
    var d = parseInt(String(iso).slice(8, 10), 10);
    return new Date(Date.UTC(y, m, d));
  }

  function utcDateToIso(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  function nextIsoDay(iso) {
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    return utcDateToIso(d);
  }

  function extractUnitNumber(name) {
    var m = String(name || "").match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function sortUnitsByNumber(a, b) {
    var diff = extractUnitNumber(a.name) - extractUnitNumber(b.name);
    if (diff) return diff;
    return String(a.name || "").localeCompare(b.name || "");
  }

  function isBigRoomUnit(unit) {
    return String((unit && unit.roomKind) || "").toLowerCase() === "big";
  }

  function walkInUnitGalleryImages(unit) {
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilityImages === "function") {
      var fromStore = S.getFacilityImages(unit);
      if (fromStore.length) return fromStore;
    }
    var src = unit && unit.image ? String(unit.image) : "";
    if (!src) return ["../Images/room-1.png"];
    if (/^https?:\/\//i.test(src) || src.indexOf("data:") === 0) return [src];
    if (src.indexOf("../") === 0 || src.indexOf("/") === 0) return [src];
    return ["../" + src.replace(/^\.?\/+/, "")];
  }

  function walkInUnitImageSrc(unit) {
    return walkInUnitGalleryImages(unit)[0] || "../Images/room-1.png";
  }

  function countWalkInFacilities(sel) {
    sel = cloneWalkInSelection(sel);
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.countSelectedFacilities === "function") {
      return UA.countSelectedFacilities(sel);
    }
    return (
      (sel.roomCatalogIds ? sel.roomCatalogIds.length : 0) +
      (sel.cottageCatalogIds ? sel.cottageCatalogIds.length : 0) +
      (sel.hallCatalogIds ? sel.hallCatalogIds.length : 0)
    );
  }

  function hasWalkInSelection(sel) {
    return countWalkInFacilities(sel) > 0;
  }

  function walkInSelectionIdSet(sel) {
    sel = cloneWalkInSelection(sel);
    var set = {};
    (sel.roomCatalogIds || []).forEach(function (id) {
      set[String(id)] = true;
    });
    (sel.cottageCatalogIds || []).forEach(function (id) {
      set[String(id)] = true;
    });
    (sel.hallCatalogIds || []).forEach(function (id) {
      set[String(id)] = true;
    });
    return set;
  }

  function getWalkInFacilityTypeLabel(type) {
    if (type === "cottage") return "Cottage";
    if (type === "hall") return "Event hall";
    if (type === "room") return "Room";
    if (type === "mixed") return "Facilities";
    return "Facility";
  }

  function toggleWalkInDraftFacility(type, id, checked) {
    var sel = cloneWalkInSelection(walkInState.draftSelection);
    id = String(id || "").trim();
    if (!id) return;

    function toggleIn(arr, value, on) {
      var i = arr.indexOf(value);
      if (on && i === -1) arr.push(value);
      if (!on && i !== -1) arr.splice(i, 1);
    }

    if (type === "room") {
      toggleIn(sel.roomCatalogIds, id, checked);
      sel.roomCatalogId = sel.roomCatalogIds[0] || "";
    } else if (type === "hall") {
      toggleIn(sel.hallCatalogIds, id, checked);
      sel.hallCatalogId = sel.hallCatalogIds[0] || "";
    } else if (type === "cottage") {
      toggleIn(sel.cottageCatalogIds, id, checked);
    }
    walkInState.draftSelection = cloneWalkInSelection(sel);
    var types = [];
    if (sel.roomCatalogIds.length) types.push("room");
    if (sel.cottageCatalogIds.length) types.push("cottage");
    if (sel.hallCatalogIds.length) types.push("hall");
    walkInState.draftFacilityType = types.length === 1 ? types[0] : types.length > 1 ? "mixed" : "";
    walkInState.draftFacilityName = walkInSelectionDisplayName(sel, "");
  }

  function getWalkInGuestCounts() {
    var adultsEl = document.getElementById("receptionWiAdults");
    var childrenEl = document.getElementById("receptionWiChildren");
    var under6El = document.getElementById("receptionWiChildrenUnder6");
    return {
      adults: adultsEl ? adultsEl.value : "1",
      children: childrenEl && childrenEl.value !== "" ? childrenEl.value : "0",
      childrenUnder6: under6El && under6El.value !== "" ? under6El.value : "0"
    };
  }

  function runWalkInGuestCapacityCheck(sel) {
    var UA = window.ElenestUnitAvailability;
    var guests = getWalkInGuestCounts();
    if (!UA || typeof UA.validateGuestCapacity !== "function") {
      return { ok: true, guests: guests, errors: [] };
    }
    return UA.validateGuestCapacity(sel, guests.adults, guests.children, {
      childrenUnder6: guests.childrenUnder6
    });
  }

  function isWalkInSelectionAvailable(sel, checkIn, checkOut, validateGuests) {
    var UA = window.ElenestUnitAvailability;
    if (!UA || !hasWalkInSelection(sel) || !checkIn || !checkOut) return false;
    if (typeof UA.validateSelection === "function") {
      var guests = getWalkInGuestCounts();
      var range = getWalkInStayRange() || {};
      var opts = {
        checkInTime: range.checkInTime || walkInState.checkInTime || "",
        checkOutTime: range.checkOutTime || walkInState.checkOutTime || ""
      };
      if (validateGuests) {
        opts.validateGuests = true;
        opts.adults = guests.adults;
        opts.children = guests.children;
        opts.childrenUnder6 = guests.childrenUnder6;
      }
      return UA.validateSelection(sel, checkIn, checkOut, null, opts).ok;
    }
    return true;
  }

  function updateWalkInModalCapacityHint() {
    var el = document.getElementById("receptionWiRoomModalCapacity");
    if (!el) return;
    var UA = window.ElenestUnitAvailability;
    var sel = walkInState.draftSelection || emptyWalkInSelection();
    var count = countWalkInFacilities(sel);
    if (!count || !UA) {
      el.textContent = "No facilities selected yet.";
      el.classList.remove("book-unit-modal__capacity--warn", "book-unit-modal__capacity--ok");
      return;
    }
    var combined = UA.getCombinedCapacity(sel);
    var guestCheck = runWalkInGuestCapacityCheck(sel);
    var guestTotal = guestCheck.guests ? guestCheck.guests.total : 0;
    var under6 = guestCheck.guests ? guestCheck.guests.childrenUnder6 : 0;
    el.textContent =
      "Selected: " +
      count +
      " · Combined capacity: " +
      combined.totalMax +
      " pax · Guests counted (ages 6+): " +
      guestTotal +
      " pax" +
      (under6 > 0 ? " · Children 0–5: " + under6 + " (not counted)" : "");
    el.classList.toggle("book-unit-modal__capacity--warn", !guestCheck.ok);
    el.classList.toggle("book-unit-modal__capacity--ok", guestCheck.ok);
    if (!guestCheck.ok) {
      setWalkInRoomModalError(
        (guestCheck.errors && guestCheck.errors[0]) ||
          "Please select another facility or reduce the number of guests."
      );
    } else {
      setWalkInRoomModalError("");
    }
  }

  function walkInSelectionDisplayName(sel, fallbackName) {
    var UA = window.ElenestUnitAvailability;
    sel = cloneWalkInSelection(sel);
    if (!UA) return fallbackName || "—";
    var catalog = UA.getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    var names = [];
    (sel.roomCatalogIds || []).forEach(function (id) {
      if (byId[id]) names.push(byId[id].name);
    });
    (sel.cottageCatalogIds || []).forEach(function (id) {
      if (byId[id]) names.push(byId[id].name);
    });
    (sel.hallCatalogIds || []).forEach(function (id) {
      if (byId[id]) names.push(byId[id].name);
    });
    if (names.length) return names.join(", ");
    return fallbackName || "—";
  }

  function syncWalkInDateInputs() {
    var ci = document.getElementById("receptionWiCheckIn");
    var co = document.getElementById("receptionWiCheckOut");
    var stayLabel = document.getElementById("receptionWiStayLabel");
    var dayTour = isWalkInDayTour();
    if (ci) ci.value = walkInState.checkIn || "";
    if (co) {
      // Day tour shows the same calendar date; overnight uses exclusive check-out date.
      co.value = walkInState.checkIn
        ? dayTour
          ? walkInState.checkIn
          : walkInState.checkOut || ""
        : "";
    }
    if (stayLabel) {
      if (walkInState.checkIn && dayTour) {
        stayLabel.textContent =
          fmtDateLong(walkInState.checkIn) +
          " · Day tour · " +
          WALK_DAY_TOUR_ARRIVAL +
          " – " +
          WALK_DAY_TOUR_DEPARTURE;
      } else if (walkInState.checkIn && walkInState.checkOut) {
        stayLabel.textContent =
          fmtDateLong(walkInState.checkIn) + " → " + fmtDateLong(walkInState.checkOut);
      } else if (walkInState.checkIn) {
        stayLabel.textContent = fmtDateLong(walkInState.checkIn) + " · pick check-out";
      } else {
        stayLabel.textContent = "—";
      }
    }

    var roomIdEl = document.getElementById("receptionWiRoomCatalogId");
    var hallIdEl = document.getElementById("receptionWiHallCatalogId");
    var cottageIdsEl = document.getElementById("receptionWiCottageCatalogIds");
    var roomTypeEl = document.getElementById("receptionWiRoomType");
    var facilityTypeEl = document.getElementById("receptionWiFacilityType");
    var summary = document.getElementById("receptionWiRoomSummary");
    var hint = document.getElementById("receptionWiRoomHint");
    var selectedName = document.getElementById("receptionWiSelectedRoomName");
    var datesEl = document.getElementById("receptionWiRoomDates");
    var range = getWalkInStayRange();
    var sel = walkInState.selection || emptyWalkInSelection();

    sel = cloneWalkInSelection(sel);
    if (roomIdEl) roomIdEl.value = (sel.roomCatalogIds || []).join(",") || sel.roomCatalogId || "";
    if (hallIdEl) hallIdEl.value = (sel.hallCatalogIds || []).join(",") || sel.hallCatalogId || "";
    if (cottageIdsEl) {
      cottageIdsEl.value = (sel.cottageCatalogIds || []).join(",");
    }
    if (facilityTypeEl) facilityTypeEl.value = walkInState.facilityType || "";

    if (selectedName) {
      selectedName.textContent = hasWalkInSelection(sel)
        ? getWalkInFacilityTypeLabel(walkInState.facilityType) +
          ": " +
          walkInSelectionDisplayName(sel, walkInState.facilityName)
        : "—";
    }
    if (datesEl && range) {
      if (dayTour) {
        datesEl.textContent =
          fmtDateLong(range.checkIn) +
          " · " +
          WALK_DAY_TOUR_ARRIVAL +
          " – " +
          WALK_DAY_TOUR_DEPARTURE;
      } else {
        datesEl.textContent =
          fmtDateLong(range.checkIn) +
          (range.checkOut && range.checkOut !== nextIsoDay(range.checkIn)
            ? " → " + fmtDateLong(range.checkOut)
            : " (1 night)");
      }
    } else if (datesEl) {
      datesEl.textContent = "";
    }

    var hasConfirmed = !!(walkInState.facilityConfirmed && hasWalkInSelection(sel));
    if (summary) summary.hidden = !hasConfirmed;
    if (hint) {
      hint.hidden = hasConfirmed;
      if (!hasConfirmed) {
        hint.textContent = dayTour
          ? "Day tour: tap one date on the calendar, then choose a facility. Time is fixed at 8:00 AM – 10:00 PM."
          : "Overnight: tap check-in, then a later check-out date. Then choose a facility and set arrival/departure times.";
      }
    }

    if (roomTypeEl && window.ElenestUnitAvailability && hasWalkInSelection(sel)) {
      var legacy = window.ElenestUnitAvailability.deriveLegacyFields(sel);
      roomTypeEl.value = legacy.roomType || "none";
    } else if (roomTypeEl) {
      roomTypeEl.value = "";
    }
  }

  function clearWalkInRoomSelection() {
    walkInState.facilityConfirmed = false;
    walkInState.facilityName = "";
    walkInState.facilityType = "";
    walkInState.selection = emptyWalkInSelection();
    walkInState.draftFacilityName = "";
    walkInState.draftFacilityType = "";
    walkInState.draftSelection = emptyWalkInSelection();
    syncWalkInDateInputs();
    updateWalkInRoomModalConfirmButton();
  }

  function resetWalkInStaySelection() {
    walkInState.checkIn = null;
    walkInState.checkOut = null;
    if (!isWalkInDayTour()) {
      walkInState.checkInTime = "";
      walkInState.checkOutTime = "";
    }
    clearWalkInRoomSelection();
  }

  function getWalkInStayRange() {
    if (!walkInState.checkIn) return null;
    var checkOut = walkInState.checkOut;
    if (isWalkInDayTour()) {
      checkOut = nextIsoDay(walkInState.checkIn);
    } else if (!checkOut || checkOut <= walkInState.checkIn) {
      checkOut = nextIsoDay(walkInState.checkIn);
    }
    return {
      checkIn: walkInState.checkIn,
      checkOut: checkOut,
      checkInTime: walkInState.checkInTime || "",
      checkOutTime: walkInState.checkOutTime || ""
    };
  }

  function isWalkInRoomModalOpen() {
    var modal = document.getElementById("receptionWiRoomModal");
    return !!(modal && !modal.hasAttribute("hidden"));
  }

  function updateWalkInRoomModalConfirmButton() {
    var btn = document.getElementById("receptionWiRoomModalDone");
    if (!btn) return;
    var sel = walkInState.draftSelection || emptyWalkInSelection();
    var enabled = hasWalkInSelection(sel);
    var UA = window.ElenestUnitAvailability;
    if (enabled && UA && typeof UA.validateGuestCapacity === "function") {
      enabled = runWalkInGuestCapacityCheck(sel).ok;
    }
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    updateWalkInModalCapacityHint();
  }

  function setWalkInRoomModalError(text) {
    var errEl = document.getElementById("receptionWiRoomModalError");
    if (!errEl) return;
    if (!text) {
      errEl.hidden = true;
      errEl.textContent = "";
      return;
    }
    errEl.hidden = false;
    errEl.textContent = text;
  }

  function openWalkInRoomModal() {
    var modal = document.getElementById("receptionWiRoomModal");
    if (!modal || !walkInState.checkIn) return;
    if (walkInState.facilityConfirmed && hasWalkInSelection(walkInState.selection)) {
      walkInState.draftSelection = cloneWalkInSelection(walkInState.selection);
      walkInState.draftFacilityName = walkInState.facilityName;
      walkInState.draftFacilityType = walkInState.facilityType;
    } else {
      walkInState.draftSelection = emptyWalkInSelection();
      walkInState.draftFacilityName = "";
      walkInState.draftFacilityType = "";
    }
    setWalkInRoomModalError("");
    renderWalkInRooms();
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("book-unit-modal-open");
    updateWalkInRoomModalConfirmButton();
  }

  function closeWalkInRoomModal() {
    var modal = document.getElementById("receptionWiRoomModal");
    if (!modal) return;
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("book-unit-modal-open");
    if (walkInState.facilityConfirmed) {
      walkInState.draftSelection = cloneWalkInSelection(walkInState.selection);
      walkInState.draftFacilityName = walkInState.facilityName;
      walkInState.draftFacilityType = walkInState.facilityType;
    } else {
      walkInState.draftSelection = emptyWalkInSelection();
      walkInState.draftFacilityName = "";
      walkInState.draftFacilityType = "";
    }
    setWalkInRoomModalError("");
    syncWalkInDateInputs();
  }

  function confirmWalkInRoomSelection() {
    var range = getWalkInStayRange();
    var draft = cloneWalkInSelection(walkInState.draftSelection);
    if (!range || !hasWalkInSelection(draft)) {
      setWalkInRoomModalError("Please select at least one available room, cottage, or event hall.");
      return;
    }
    if (!isWalkInSelectionAvailable(draft, range.checkIn, range.checkOut, true)) {
      var UA = window.ElenestUnitAvailability;
      var guests = getWalkInGuestCounts();
      var check = UA
        ? UA.validateSelection(draft, range.checkIn, range.checkOut, null, {
            validateGuests: true,
            adults: guests.adults,
            children: guests.children,
            childrenUnder6: guests.childrenUnder6
          })
        : { errors: [] };
      setWalkInRoomModalError(
        (check.errors && check.errors[0]) ||
          "That selection is unavailable or exceeds capacity. Adjust facilities or guest count."
      );
      renderWalkInRooms();
      updateWalkInRoomModalConfirmButton();
      return;
    }
    walkInState.selection = cloneWalkInSelection(draft);
    walkInState.facilityType = walkInState.draftFacilityType || "";
    walkInState.facilityName = walkInSelectionDisplayName(
      walkInState.selection,
      walkInState.draftFacilityName
    );
    walkInState.facilityConfirmed = true;
    closeWalkInRoomModal();
  }

  function isWalkInDateManagerBlocked(iso) {
    var av = window.ElenestAvailability;
    if (!av || typeof av.getManagerBlocked !== "function") return false;
    return !!av.getManagerBlocked(iso);
  }

  function isWalkInDateUnavailable(iso) {
    if (isWalkInDateManagerBlocked(iso)) return true;
    var av = window.ElenestAvailability;
    return !!(av && typeof av.isUnavailable === "function" && av.isUnavailable(iso));
  }

  function pickWalkInDate(iso) {
    if (!iso || isWalkInDateUnavailable(iso)) return;

    if (isWalkInDayTour()) {
      walkInState.checkIn = iso;
      walkInState.checkOut = nextIsoDay(iso);
      applyWalkInDayTourTimes();
      clearWalkInRoomSelection();
      syncWalkInDateInputs();
      renderWalkInCalendar();
      openWalkInRoomModal();
      return;
    }

    // Overnight: first tap = check-in, second tap = later check-out.
    if (!walkInState.checkIn || (walkInState.checkIn && walkInState.checkOut)) {
      walkInState.checkIn = iso;
      walkInState.checkOut = null;
      clearWalkInRoomSelection();
      syncWalkInDateInputs();
      renderWalkInCalendar();
      return;
    }

    if (iso <= walkInState.checkIn) {
      walkInState.checkIn = iso;
      walkInState.checkOut = null;
      clearWalkInRoomSelection();
      syncWalkInDateInputs();
      renderWalkInCalendar();
      return;
    }

    var cur = isoToUtcDate(walkInState.checkIn);
    var end = isoToUtcDate(iso);
    var blocked = false;
    while (cur < end) {
      if (isWalkInDateUnavailable(utcDateToIso(cur))) {
        blocked = true;
        break;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (blocked) {
      walkInState.checkIn = iso;
      walkInState.checkOut = null;
      clearWalkInRoomSelection();
      syncWalkInDateInputs();
      renderWalkInCalendar();
      return;
    }

    walkInState.checkOut = iso;
    if (
      walkInState.facilityConfirmed &&
      !isWalkInSelectionAvailable(
        walkInState.selection,
        walkInState.checkIn,
        walkInState.checkOut
      )
    ) {
      clearWalkInRoomSelection();
    }
    syncWalkInDateInputs();
    renderWalkInCalendar();
    openWalkInRoomModal();
  }

  function buildWalkInFacilityCard(unit, opts) {
    opts = opts || {};
    var UA = window.ElenestUnitAvailability;
    var available = opts.available !== false;
    var selected = !!opts.selected;
    var facilityType = opts.facilityType || String((unit && unit.type) || "room");
    var card = available ? document.createElement("label") : document.createElement("div");
    card.className =
      "book-facility-card" +
      (selected ? " book-facility-card--selected" : "") +
      (!available ? " book-facility-card--readonly book-facility-card--booked" : "");

    if (available) {
      var input = document.createElement("input");
      input.type = "checkbox";
      input.className = "book-facility-card__input";
      input.name = "receptionWiFacilityUnit";
      input.value = String(unit.id);
      input.checked = selected;
      input.setAttribute("data-facility-type", facilityType);
      card.appendChild(input);
    }

    var media = document.createElement("div");
    media.className = "book-facility-card__media";
    var photos = walkInUnitGalleryImages(unit);
    var S = window.ElenestContentStore;
    if (S && typeof S.renderFacilitySwipeElement === "function") {
      media.appendChild(S.renderFacilitySwipeElement(unit.name || "Facility", photos));
    } else {
      var img = document.createElement("img");
      img.src = photos[0] || "../Images/room-1.png";
      img.alt = unit.name || "Facility";
      img.loading = "lazy";
      img.decoding = "async";
      media.appendChild(img);
    }
    var occStatus = available ? "available" : opts.status === "pending" ? "pending" : "booked";
    if (!available && occStatus !== "pending") {
      var overlay = document.createElement("span");
      overlay.className = "book-facility-card__overlay";
      overlay.textContent = "Booked";
      media.appendChild(overlay);
    }
    card.appendChild(media);

    var body = document.createElement("div");
    body.className = "book-facility-card__body";
    var name = document.createElement("span");
    name.className = "book-facility-card__name";
    name.textContent = unit.name || "Facility";
    var capacity = document.createElement("span");
    capacity.className = "book-facility-card__capacity";
    capacity.textContent =
      UA && typeof UA.formatCapacityLabel === "function"
        ? UA.formatCapacityLabel(unit)
        : "Capacity n/a";
    var meta = document.createElement("span");
    meta.className =
      "book-facility-card__price" + (occStatus === "pending" ? " book-facility-card__price--pending" : "");
    var metaLabel = "Booked";
    if (available) metaLabel = "Available";
    else if (UA && typeof UA.occupancyDisplayLabel === "function") {
      metaLabel = UA.occupancyDisplayLabel(occStatus) || "Booked";
    } else if (occStatus === "pending") {
      metaLabel = "Pending Admin Confirmation";
    }
    meta.textContent = metaLabel;
    body.appendChild(name);
    body.appendChild(capacity);
    body.appendChild(meta);
    if (!available) card.setAttribute("aria-disabled", "true");
    if (!available) {
      card.setAttribute(
        "aria-label",
        (unit.name || "Facility") +
          (occStatus === "pending"
            ? " is pending admin confirmation and unavailable"
            : " is booked and unavailable")
      );
    }
    card.appendChild(body);
    return card;
  }

  function renderWalkInCalendar() {
    var host = document.getElementById("receptionWalkInCalendarHost");
    var label = document.getElementById("receptionWiCalMonthLabel");
    if (!host || !label) return;
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") {
      return;
    }
    var dayTour = isWalkInDayTour();
    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: walkCalView,
      wizardState: {
        checkIn: walkInState.checkIn,
        checkOut: dayTour ? null : walkInState.checkOut
      },
      highlightRange: !dayTour,
      showLiveOccupancy: true,
      onDayClick: pickWalkInDate
    });
  }

  function renderWalkInRooms() {
    var host = document.getElementById("receptionWiRoomModalHost");
    var emptyEl = document.getElementById("receptionWiRoomModalEmpty");
    var datesEl = document.getElementById("receptionWiRoomModalDates");
    if (!host) {
      syncWalkInDateInputs();
      return;
    }

    var range = getWalkInStayRange();
    if (!range) {
      host.textContent = "";
      if (datesEl) datesEl.textContent = "";
      if (emptyEl) emptyEl.hidden = true;
      syncWalkInDateInputs();
      updateWalkInRoomModalConfirmButton();
      return;
    }

    if (datesEl) {
      if (isWalkInDayTour()) {
        datesEl.textContent =
          fmtDateLong(range.checkIn) +
          " · " +
          WALK_DAY_TOUR_ARRIVAL +
          " – " +
          WALK_DAY_TOUR_DEPARTURE;
      } else {
        datesEl.textContent =
          fmtDateLong(range.checkIn) +
          (range.checkOut && range.checkOut !== nextIsoDay(range.checkIn)
            ? " → " + fmtDateLong(range.checkOut)
            : " (1 night)");
      }
    }

    var UA = window.ElenestUnitAvailability;
    if (!UA || typeof UA.listUnitsWithAvailability !== "function") {
      host.textContent = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = "Facility catalog is still loading. Please wait a moment.";
      }
      updateWalkInRoomModalConfirmButton();
      return;
    }

    if (
      hasWalkInSelection(walkInState.draftSelection) &&
      !isWalkInSelectionAvailable(walkInState.draftSelection, range.checkIn, range.checkOut)
    ) {
      walkInState.draftSelection = emptyWalkInSelection();
      walkInState.draftFacilityName = "";
      walkInState.draftFacilityType = "";
    }

    if (
      walkInState.facilityConfirmed &&
      hasWalkInSelection(walkInState.selection) &&
      !isWalkInSelectionAvailable(walkInState.selection, range.checkIn, range.checkOut)
    ) {
      clearWalkInRoomSelection();
    }

    var list = UA.listUnitsWithAvailability(range.checkIn, range.checkOut, null, range);
    var groups = { roomSmall: [], roomBig: [], roomOther: [], cottage: [], hall: [] };
    list.forEach(function (item) {
      var t = String((item.unit && item.unit.type) || "room");
      if (t === "cottage") groups.cottage.push(item);
      else if (t === "hall") groups.hall.push(item);
      else if (isBigRoomUnit(item.unit)) groups.roomBig.push(item);
      else if (String((item.unit && item.unit.roomKind) || "").toLowerCase() === "small") {
        groups.roomSmall.push(item);
      } else {
        groups.roomOther.push(item);
      }
    });
    ["roomSmall", "roomBig", "roomOther", "cottage", "hall"].forEach(function (key) {
      groups[key].sort(function (a, b) {
        return sortUnitsByNumber(a.unit, b.unit);
      });
    });

    var selectedSet = walkInSelectionIdSet(walkInState.draftSelection);
    host.textContent = "";

    function appendUnitCards(listEl, items, type) {
      items.forEach(function (item) {
        listEl.appendChild(
          buildWalkInFacilityCard(item.unit, {
            available: !!item.available,
            status: item.status,
            selected: !!selectedSet[String(item.unit.id)],
            facilityType: type
          })
        );
      });
    }

    function appendGroup(title, type, items, subtypes) {
      var allItems = items || [];
      if (subtypes) {
        allItems = [];
        subtypes.forEach(function (part) {
          allItems = allItems.concat(part.items || []);
        });
      }
      if (!allItems.length) return;

      var wrap = document.createElement("div");
      wrap.className = "book-unit-picker__group";
      wrap.setAttribute("data-unit-group", type);
      var h = document.createElement("h5");
      h.className = "book-unit-picker__group-title";
      h.textContent = title;
      wrap.appendChild(h);

      if (subtypes && subtypes.length) {
        subtypes.forEach(function (part) {
          if (!part.items || !part.items.length) return;
          var sub = document.createElement("p");
          sub.className = "book-step2-facilities__subtype";
          sub.textContent = part.title;
          wrap.appendChild(sub);
          var listEl = document.createElement("div");
          listEl.className = "book-unit-picker__list";
          appendUnitCards(listEl, part.items, type);
          wrap.appendChild(listEl);
        });
      } else {
        var listEl = document.createElement("div");
        listEl.className = "book-unit-picker__list";
        appendUnitCards(listEl, allItems, type);
        wrap.appendChild(listEl);
      }

      host.appendChild(wrap);
    }

    appendGroup("Rooms", "room", null, [
      { title: "Small Rooms", items: groups.roomSmall },
      { title: "Family Rooms", items: groups.roomBig },
      { title: "Other Rooms", items: groups.roomOther }
    ]);
    appendGroup("Cottages", "cottage", groups.cottage);
    appendGroup("Event Halls", "hall", groups.hall);
    var swipeStore = window.ElenestContentStore;
    if (swipeStore && typeof swipeStore.bindFacilitySwipeGalleries === "function") {
      swipeStore.bindFacilitySwipeGalleries(host);
    }

    var anyAvailable = list.some(function (item) {
      return item.available;
    });
    if (emptyEl) {
      emptyEl.hidden = anyAvailable;
      if (!anyAvailable) {
        emptyEl.textContent =
          "All facilities are booked for this stay. Choose another date or adjust check-out.";
      }
    }
    syncWalkInDateInputs();
    updateWalkInRoomModalConfirmButton();
  }

  function refreshWalkInViews() {
    renderWalkInCalendar();
    syncWalkInDateInputs();
    if (isWalkInRoomModalOpen()) {
      renderWalkInRooms();
    } else if (walkInState.facilityConfirmed && hasWalkInSelection(walkInState.selection)) {
      var range = getWalkInStayRange();
      if (range && !isWalkInSelectionAvailable(walkInState.selection, range.checkIn, range.checkOut)) {
        clearWalkInRoomSelection();
      }
    }
  }

  var refreshListsTimer = null;
  function refreshReceptionLists() {
    if (refreshListsTimer) return;
    refreshListsTimer = setTimeout(function () {
      refreshListsTimer = null;
      renderCheckIn();
      renderCheckOut();
      renderRecords();
      refreshWalkInViews();
    }, 200);
  }

  function refreshReceptionListsNow() {
    if (refreshListsTimer) {
      clearTimeout(refreshListsTimer);
      refreshListsTimer = null;
    }
    renderCheckIn();
    renderCheckOut();
    renderRecords();
    refreshWalkInViews();
  }

  function removeBooking(accountEmail, id) {
    var B = window.ElenestBookings;
    if (B && typeof B.removeById === "function") return B.removeById(accountEmail, id);
    return Promise.resolve(false);
  }

  function addReceptionTableCell(row, text, cls) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    var value = text === undefined || text === null || text === "" ? "—" : String(text);
    td.textContent = value;
    td.title = value;
    row.appendChild(td);
    return td;
  }

  function addReceptionStayCell(row, booking) {
    var b = booking || {};
    var checkInText = fmtDateCompact(b.checkIn);
    var checkOutText = fmtDateCompact(b.checkOut);
    var td = document.createElement("td");
    td.className = "reception-table__stay";
    td.title = "Check-in " + checkInText + " · Check-out " + checkOutText;

    var wrap = document.createElement("div");
    wrap.className = "reception-stay";

    function addStayRow(kind, label, value) {
      var line = document.createElement("div");
      line.className = "reception-stay__row reception-stay__row--" + kind;
      var dot = document.createElement("span");
      dot.className = "reception-stay__dot";
      dot.setAttribute("aria-hidden", "true");
      var lab = document.createElement("span");
      lab.className = "reception-stay__label";
      lab.textContent = label;
      var val = document.createElement("span");
      val.className = "reception-stay__value";
      val.textContent = value;
      line.appendChild(dot);
      line.appendChild(lab);
      line.appendChild(val);
      wrap.appendChild(line);
    }

    addStayRow("in", "Check-in", checkInText);
    addStayRow("out", "Check-out", checkOutText);
    td.appendChild(wrap);
    row.appendChild(td);
    return td;
  }

  function receptionRecordStatusBadge(b) {
    var badge = document.createElement("span");
    if (isCompletedCheckoutRecord({ booking: b })) {
      applyReceptionStatusBadge(badge, {
        kind: "success",
        label: "Checked Out",
        badgeClass: "booking-status--confirmed"
      });
    } else if (isInHouse(b)) {
      applyReceptionStatusBadge(badge, {
        kind: "success",
        label: "Checked In (in-house)",
        badgeClass: "booking-status--confirmed"
      });
    } else if (isReadyForCheckOut(b)) {
      applyReceptionStatusBadge(badge, {
        kind: "pending",
        label: "Ready for Check-Out",
        badgeClass: "booking-status--pending"
      });
    } else {
      applyReceptionStatusBadge(badge, {
        kind: "success",
        label: statusLabel(b.status, b),
        badgeClass: statusClass(b.status, b)
      });
    }
    return badge;
  }

  function makeReceptionIconBtn(kind, label, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "admin-pay-icon-btn " +
      (kind === "delete" ? "admin-pay-icon-btn--reject" : "admin-pay-icon-btn--view");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.innerHTML =
      kind === "delete"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var tip = document.createElement("span");
    tip.className = "admin-pay-icon-tip";
    tip.textContent = label;
    btn.appendChild(tip);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function makeReceptionActionBtn(label, className, aria, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    if (aria) btn.setAttribute("aria-label", aria);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function buildReceptionTableRow(item, opts) {
    opts = opts || {};
    var mode = opts.mode || "record";
    var onCheckOut = opts.onCheckOut;
    var b = item.booking || {};
    var guestName = b.fullName || "Guest";
    var row = document.createElement("tr");
    row.className = "reception-table__row";

    addReceptionTableCell(row, guestName, "reception-table__name");
    addReceptionTableCell(row, b.id || "—", "reception-table__id");
    addReceptionTableCell(row, formatFacilityLabel(b), "reception-table__facility");
    addReceptionStayCell(row, b);

    var statusTd = document.createElement("td");
    statusTd.className = "reception-table__status";
    var badge = document.createElement("span");
    if (mode === "checkout") {
      if (isReadyForCheckOut(b)) {
        applyReceptionStatusBadge(badge, {
          kind: "pending",
          label: "Ready for Check-Out",
          badgeClass: "booking-status--pending"
        });
      } else {
        applyReceptionStatusBadge(badge, {
          kind: "success",
          label: "Checked In — In-house",
          badgeClass: "booking-status--confirmed"
        });
      }
    } else if (mode === "record") {
      badge = receptionRecordStatusBadge(b);
    } else {
      applyReceptionStatusBadge(badge, {
        kind:
          statusClass(b.status, b).indexOf("cancelled") !== -1
            ? "cancelled"
            : statusClass(b.status, b).indexOf("confirmed") !== -1
              ? "success"
              : "pending",
        label: statusLabel(b.status, b),
        badgeClass: statusClass(b.status, b)
      });
    }
    statusTd.appendChild(badge);
    row.appendChild(statusTd);

    var actTd = document.createElement("td");
    actTd.className = "reception-table__actions";
    var actions = document.createElement("div");
    actions.className = "reception-table__actions-inner";

    var viewBtn = makeReceptionActionBtn(
      "View",
      "btn btn--outline btn--small reception-checkin-card__view-btn",
      (mode === "record" ? "View full details for " : "Show stay and contact details for ") + guestName,
      function () {
        openReceptionBookingDetail(item);
      }
    );

    if (mode === "checkin") {
      var confirmBtn = makeReceptionActionBtn(
        "Confirm Check-In",
        "btn btn--small",
        "Confirm check-in for " + guestName,
        function () {
          if (!isReadyForCheckIn(b)) return;
          var PF = window.ElenestPaymentFlow;
          var staff = getStaffEmail();
          var patch =
            PF && typeof PF.buildCompleteCheckInPatch === "function"
              ? PF.buildCompleteCheckInPatch(staff)
              : {
                  status: "Checked In",
                  checkedInAt: new Date().toISOString(),
                  checkedInBy: staff,
                  arrivalStatus: "arrived",
                  slotLocked: true,
                  workflow: "checked_in"
                };
          var BL = window.ElenestButtonLoading;
          if (BL) BL.set(confirmBtn, true);
          Promise.resolve(patchBooking(item.accountEmail, b.id, patch))
            .then(function () {
              refreshReceptionLists();
            })
            .catch(function () {
              if (BL) BL.set(confirmBtn, false);
              notifyReceptionError("Could not check this guest in. Please try again.");
            });
        }
      );
      confirmBtn.setAttribute("aria-label", "Confirm check-in for " + guestName);

      var cancelBookingBtn = makeReceptionActionBtn(
        "Cancel booking",
        "btn btn--outline btn--small",
        "Cancel booking for " + guestName,
        function () {
          if (!window.confirm("Mark this booking as cancelled?")) return;
          var BL = window.ElenestButtonLoading;
          if (BL) BL.set(cancelBookingBtn, true);
          Promise.resolve(
            patchBooking(item.accountEmail, b.id, {
              status: "Cancelled",
              workflow: "cancelled",
              slotLocked: false
            })
          )
            .then(function () {
              refreshReceptionLists();
            })
            .catch(function () {
              if (BL) BL.set(cancelBookingBtn, false);
              notifyReceptionError("Could not cancel this booking. Please try again.");
            });
        }
      );

      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBookingBtn);
      actions.appendChild(viewBtn);
    } else if (mode === "checkout") {
      var checkoutBtn = makeReceptionActionBtn(
        "Complete Check-Out",
        "btn btn--small",
        "Complete check-out for " + guestName,
        function () {
          var BL = window.ElenestButtonLoading;
          if (BL) BL.set(checkoutBtn, true);
          Promise.resolve(typeof onCheckOut === "function" ? onCheckOut(item) : null)
            .then(function () {
              refreshReceptionLists();
            })
            .catch(function () {
              if (BL) BL.set(checkoutBtn, false);
              notifyReceptionError("Could not complete check-out. Please try again.");
            });
        }
      );
      actions.appendChild(viewBtn);
      actions.appendChild(checkoutBtn);
    } else {
      actTd.classList.add("reception-table__actions--icons");
      actions.appendChild(
        makeReceptionIconBtn("view", "View full details for " + guestName, function () {
          openReceptionBookingDetail(item);
        })
      );
      var delBtn = makeReceptionIconBtn(
        "delete",
        "Delete record for " + guestName,
        function () {
          var ok = window.confirm(
            b.checkedOutAt
              ? "Delete this checked-out customer record?"
              : "Delete this customer record?"
          );
          if (!ok) return;
          var BL = window.ElenestButtonLoading;
          var work = function () {
            return Promise.resolve(removeBooking(item.accountEmail, b.id)).then(function (removed) {
              if (!removed) throw new Error("Could not delete this record. Please try again.");
              renderCheckIn();
              renderCheckOut();
              renderRecords();
            });
          };
          if (BL) BL.run(delBtn, work);
          else work();
        }
      );
      actions.appendChild(delBtn);
    }

    actTd.appendChild(actions);
    row.appendChild(actTd);
    return row;
  }

  /**
   * Check-in list card: Pending → "Approved" sets reservation status to Approved (stored as Approved/Confirmed).
   * Approved but not yet in-house → "Check in guest" records arrival; then the guest appears under Check-out until they leave.
   * Pending bookings never appear under Check-out. Cancel booking remains available for Pending or Approved (not yet checked in).
   */
  function openReceptionBookingDetail(item) {
    var overlay = document.getElementById("receptionBookingDetailOverlay");
    var bodyEl = document.getElementById("receptionBookingDetailBody");
    var titleEl = document.getElementById("receptionBookingDetailTitle");
    if (!overlay || !bodyEl) return;
    var b = item.booking;
    if (titleEl) titleEl.textContent = (b.fullName || "Guest") + " — booking details";
    bodyEl.textContent = "";
    var dl = document.createElement("dl");
    dl.className = "booking-dl booking-dl--compact";
    function addDtDd(term, val) {
      var dt = document.createElement("dt");
      dt.textContent = term;
      var dd = document.createElement("dd");
      dd.textContent = val === undefined || val === null || val === "" ? "—" : String(val);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    addDtDd("Payment status", paymentStatusLabel(b));
    addDtDd("Booking status", statusLabel(b.status, b));
    addDtDd("Arrival status", arrivalStatusLabel(b));
    addDtDd("Booking ID", b.id);
    addDtDd("Stay begins", fmtDateLong(b.checkIn));
    addDtDd("Check-out", fmtDateLong(b.checkOut));
    addDtDd("Room type", labelRoomType(b.roomType));
    var facilityNames = []
      .concat(b.roomCatalogNames || (b.roomCatalogName ? [b.roomCatalogName] : []))
      .concat(b.cottageCatalogNames || [])
      .concat(b.hallCatalogNames || (b.hallCatalogName ? [b.hallCatalogName] : []))
      .filter(Boolean);
    if (facilityNames.length) addDtDd("Facilities", facilityNames.join(", "));
    if (b.capacityTotal != null && b.capacityTotal !== "") {
      addDtDd("Capacity", String(b.capacityTotal) + " pax");
    }
    addDtDd("Adults", b.adults != null && b.adults !== "" ? String(b.adults) : "—");
    addDtDd("Children", b.children != null && b.children !== "" ? String(b.children) : "—");
    addDtDd("Phone", b.phone);
    addDtDd("Email", b.email || item.accountEmail);
    addDtDd("Record key", item.accountEmail);
    addDtDd("Submitted", fmtWhen(b.submittedAt));
    if (b.checkedInAt) addDtDd("Checked in", fmtWhen(b.checkedInAt));
    if (b.checkedOutAt) addDtDd("Checked out", fmtWhen(b.checkedOutAt));
    if (b.request) addDtDd("Special requests", b.request);
    var recUA = window.ElenestUnitAvailability;
    if (recUA && typeof recUA.swimmingPoolLabelForBooking === "function") {
      addDtDd("Swimming pool", recUA.swimmingPoolLabelForBooking(b));
    }
    if (recUA && typeof recUA.computeBookingRecordPricing === "function") {
      var recPricing = recUA.computeBookingRecordPricing(b);
      if (recPricing && recPricing.lines && recPricing.lines.length) {
        recPricing.lines.forEach(function (line) {
          addDtDd(line.label, "₱" + Number(line.amount).toLocaleString());
        });
      }
    }
    if (b.totalEstimate != null && b.totalEstimate !== "") {
      addDtDd("Estimated total", "₱" + Number(b.totalEstimate).toLocaleString());
    }
    bodyEl.appendChild(dl);
    setHidden(overlay, false);
  }

  function closeReceptionBookingDetail() {
    var overlay = document.getElementById("receptionBookingDetailOverlay");
    if (overlay) setHidden(overlay, true);
  }

  function bookingCreatedStamp(b) {
    if (!b) return "";
    return String(
      b.submittedAt ||
        b.createdAt ||
        b.created_at ||
        b.paymentVerifiedAt ||
        ""
    );
  }

  function sortBookingsNewestFirst(a, c) {
    var as = bookingCreatedStamp(a && a.booking);
    var cs = bookingCreatedStamp(c && c.booking);
    if (as !== cs) return as < cs ? 1 : as > cs ? -1 : 0;
    var ai = (a.booking && a.booking.checkIn) || "";
    var ci = (c.booking && c.booking.checkIn) || "";
    if (ai !== ci) return ai < ci ? 1 : ai > ci ? -1 : 0;
    var aid = String((a.booking && a.booking.id) || "");
    var cid = String((c.booking && c.booking.id) || "");
    return aid < cid ? 1 : aid > cid ? -1 : 0;
  }

  function getReceptionSearchQuery(inputId) {
    var el = document.getElementById(inputId);
    return el ? String(el.value || "").trim().toLowerCase() : "";
  }

  function addCheckInTicketMeta(host, label, value) {
    var item = document.createElement("div");
    item.className = "checkin-ticket__meta-item";
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    var text = value === undefined || value === null || value === "" ? "—" : String(value);
    dd.textContent = text;
    dd.title = text;
    item.appendChild(dt);
    item.appendChild(dd);
    host.appendChild(item);
  }

  function buildCheckInTicketActions(item, guestName, b) {
    var actions = document.createElement("div");
    actions.className = "checkin-ticket__actions";
    var canCheckIn = isReadyForCheckIn(b);
    var PF = window.ElenestPaymentFlow;
    var isFuture = PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(b);

    var confirmBtn = makeReceptionActionBtn(
      canCheckIn ? "Confirm Check-In" : isFuture ? "Check-in unavailable" : "Check-in not open yet",
      "btn btn--small" + (canCheckIn ? "" : " btn--disabled"),
      canCheckIn
        ? "Confirm check-in for " + guestName
        : isFuture
          ? "Future booking — available on " + fmtDateLong(b.checkIn)
          : "Available on the booking date within check-in hours",
      function () {
        if (!isReadyForCheckIn(b)) {
          window.alert(
            isFuture
              ? "This is a future booking. Check-in opens on " + fmtDateLong(b.checkIn) + "."
              : "Check-in is only available on the guest’s booking date within the allowed check-in time."
          );
          return;
        }
        var staff = getStaffEmail();
        var patch =
          PF && typeof PF.buildCompleteCheckInPatch === "function"
            ? PF.buildCompleteCheckInPatch(staff)
            : {
                status: "Checked In",
                checkedInAt: new Date().toISOString(),
                checkedInBy: staff,
                arrivalStatus: "arrived",
                slotLocked: true,
                workflow: "checked_in"
              };
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(confirmBtn, true);
        Promise.resolve(patchBooking(item.accountEmail, b.id, patch))
          .then(function () {
            refreshReceptionLists();
          })
          .catch(function () {
            if (BL) BL.set(confirmBtn, false);
            notifyReceptionError("Could not check this guest in. Please try again.");
          });
      }
    );
    if (!canCheckIn) {
      confirmBtn.disabled = true;
      confirmBtn.setAttribute("aria-disabled", "true");
    }

    var cancelBookingBtn = makeReceptionActionBtn(
      "Cancel booking",
      "btn btn--outline btn--small",
      "Cancel booking for " + guestName,
      function () {
        if (!window.confirm("Mark this booking as cancelled?")) return;
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(cancelBookingBtn, true);
        Promise.resolve(
          patchBooking(item.accountEmail, b.id, {
            status: "Cancelled",
            workflow: "cancelled",
            slotLocked: false
          })
        )
          .then(function () {
            refreshReceptionLists();
          })
          .catch(function () {
            if (BL) BL.set(cancelBookingBtn, false);
            notifyReceptionError("Could not cancel this booking. Please try again.");
          });
      }
    );

    var viewBtn = makeReceptionActionBtn(
      "View",
      "btn btn--outline btn--small reception-checkin-card__view-btn",
      "Show stay and contact details for " + guestName,
      function () {
        openReceptionBookingDetail(item);
      }
    );

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBookingBtn);
    actions.appendChild(viewBtn);
    return actions;
  }

  function buildCheckInTicketStub(item) {
    var b = item.booking || {};
    var guestName = b.fullName || "Guest";
    var ticket = document.createElement("article");
    ticket.className = "checkin-ticket";
    ticket.setAttribute("aria-label", "Check-in ticket for " + guestName);

    var info = document.createElement("div");
    info.className = "checkin-ticket__info";

    var top = document.createElement("div");
    top.className = "checkin-ticket__info-top";
    var nameEl = document.createElement("h3");
    nameEl.className = "checkin-ticket__guest";
    nameEl.textContent = guestName;
    var badge = document.createElement("span");
    applyReceptionStatusBadge(badge, {
      kind:
        statusClass(b.status, b).indexOf("cancelled") !== -1
          ? "cancelled"
          : statusClass(b.status, b).indexOf("confirmed") !== -1
            ? "success"
            : "pending",
      label: statusLabel(b.status, b),
      badgeClass: statusClass(b.status, b)
    });
    top.appendChild(nameEl);
    top.appendChild(badge);

    var idEl = document.createElement("p");
    idEl.className = "checkin-ticket__id";
    idEl.textContent = b.id ? "#" + b.id : "—";
    if (b.id) idEl.title = String(b.id);

    var meta = document.createElement("dl");
    meta.className = "checkin-ticket__meta";
    addCheckInTicketMeta(meta, "Facility", formatFacilityLabel(b));
    addCheckInTicketMeta(meta, "Check-in", fmtDateCompact(b.checkIn));
    addCheckInTicketMeta(meta, "Check-out", fmtDateCompact(b.checkOut));
    addCheckInTicketMeta(meta, "Payment", paymentStatusLabel(b));
    addCheckInTicketMeta(meta, "Booking", statusLabel(b.status, b));
    addCheckInTicketMeta(meta, "Arrival", arrivalStatusLabel(b));
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(b)) {
      addCheckInTicketMeta(meta, "Note", PF.futureBookingLabel(b));
    }

    info.appendChild(top);
    info.appendChild(idEl);
    info.appendChild(meta);

    var perf = document.createElement("div");
    perf.className = "checkin-ticket__perf";
    perf.setAttribute("aria-hidden", "true");
    var notchTop = document.createElement("span");
    notchTop.className = "checkin-ticket__notch checkin-ticket__notch--start";
    var dash = document.createElement("span");
    dash.className = "checkin-ticket__dash";
    var notchBot = document.createElement("span");
    notchBot.className = "checkin-ticket__notch checkin-ticket__notch--end";
    perf.appendChild(notchTop);
    perf.appendChild(dash);
    perf.appendChild(notchBot);

    var stub = document.createElement("div");
    stub.className = "checkin-ticket__stub";
    var stubLabel = document.createElement("p");
    stubLabel.className = "checkin-ticket__stub-label";
    stubLabel.textContent = "Admit";
    var barcode = document.createElement("span");
    barcode.className = "checkin-ticket__barcode";
    barcode.setAttribute("aria-hidden", "true");
    stub.appendChild(stubLabel);
    stub.appendChild(buildCheckInTicketActions(item, guestName, b));
    stub.appendChild(barcode);

    ticket.appendChild(info);
    ticket.appendChild(perf);
    ticket.appendChild(stub);
    return ticket;
  }

  function renderCheckIn() {
    var host = document.getElementById("receptionCheckInList");
    var empty = document.getElementById("receptionCheckInEmpty");
    var pager = document.getElementById("receptionCheckInPager");
    if (!host) return;
    host.textContent = "";
    host.classList.add("checkin-ticket-list");

    // Admin-verified bookings (including future) — check-in action gated to booking date.
    var q = getReceptionSearchQuery("receptionCheckInSearch");
    var filtered = listBookings()
      .filter(function (item) {
        return isEligibleForCheckInQueue(item.booking) && recordMatchesQuery(item, q);
      })
      .sort(sortBookingsNewestFirst);

    if (!filtered.length) {
      host.classList.remove("checkin-ticket-list");
      setHidden(empty, false);
      if (empty) {
        empty.textContent = q
          ? "No matching guests waiting for check-in."
          : "No Admin-verified bookings waiting for check-in. Future confirmed bookings appear here with Check-in disabled until the stay date.";
      }
      renderPaginationControls(pager, null);
      return;
    }
    setHidden(empty, true);

    var pageState = paginateItems(filtered, receptionListPages.checkIn, RECEPTION_PAGE_SIZE);
    receptionListPages.checkIn = pageState.page;
    var list = document.createElement("div");
    list.className = "checkin-ticket-stack";
    list.setAttribute("role", "list");
    pageState.items.forEach(function (item) {
      var ticket = buildCheckInTicketStub(item);
      ticket.setAttribute("role", "listitem");
      list.appendChild(ticket);
    });
    host.appendChild(list);
    renderPaginationControls(pager, pageState, function (page) {
      receptionListPages.checkIn = page;
      renderCheckIn();
    });
  }

  function renderCheckOut() {
    var host = document.getElementById("receptionCheckOutList");
    var empty = document.getElementById("receptionCheckOutEmpty");
    var pager = document.getElementById("receptionCheckOutPager");
    if (!host) return;
    host.textContent = "";

    // All currently checked-in guests (live from Supabase via ElenestBookings)
    var q = getReceptionSearchQuery("receptionCheckOutSearch");
    var items = listBookings().filter(function (item) {
      return isOnCheckOutList(item.booking) && recordMatchesQuery(item, q);
    });
    items.sort(sortBookingsNewestFirst);

    if (!items.length) {
      setHidden(empty, false);
      if (empty) {
        empty.textContent = q
          ? "No matching guests waiting for check-out."
          : "No checked-in guests yet. After Complete Check-In, guests appear here in real time from Supabase.";
      }
      renderPaginationControls(pager, null);
      return;
    }
    setHidden(empty, true);
    var pageState = paginateItems(items, receptionListPages.checkOut, RECEPTION_PAGE_SIZE);
    receptionListPages.checkOut = pageState.page;
    var table = createReceptionRecordsTable();
    pageState.items.forEach(function (item) {
      table.tbody.appendChild(
        buildReceptionTableRow(item, {
          mode: "checkout",
          onCheckOut: function (it) {
            var PF = window.ElenestPaymentFlow;
            var patch =
              PF && typeof PF.buildCompleteCheckOutPatch === "function"
                ? PF.buildCompleteCheckOutPatch(getStaffEmail())
                : {
                    status: "Checked Out",
                    checkedOutAt: new Date().toISOString(),
                    slotLocked: false,
                    workflow: "checked_out"
                  };
            return patchBooking(it.accountEmail, it.booking.id, patch).then(function (ok) {
              if (ok) {
                var completed = Object.assign({}, it.booking, patch);
                sendReviewInviteEmail(completed, it.accountEmail);
              }
              return ok;
            });
          }
        })
      );
    });
    host.appendChild(table.wrap);
    renderPaginationControls(pager, pageState, function (page) {
      receptionListPages.checkOut = page;
      renderCheckOut();
    });
  }

  function recordMatchesQuery(item, q) {
    if (!q) return true;
    var b = item.booking;
    var hay = [
      b.fullName,
      b.phone,
      b.email,
      item.accountEmail,
      b.request,
      b.id,
      formatFacilityLabel(b)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /** In-house: Checked In, stay period not yet ended. */
  function isConfirmedCheckInRecord(item) {
    return isInHouse(item.booking);
  }

  function isCompletedCheckoutRecord(item) {
    var b = item.booking;
    if (!b) return false;
    if (b.checkedOutAt) return true;
    var st = normalizeStatus(b.status);
    return st === "Checked Out" || st === "Completed";
  }

  function renderRecords() {
    var hostConfirmed = document.getElementById("receptionRecordsConfirmedList");
    var hostCheckout = document.getElementById("receptionRecordsCheckoutList");
    var pagerConfirmed = document.getElementById("receptionRecordsConfirmedPager");
    var pagerCheckout = document.getElementById("receptionRecordsCheckoutPager");
    var emptyGlobal = document.getElementById("receptionRecordsEmpty");
    var emptyConfirmed = document.getElementById("receptionRecordsConfirmedEmpty");
    var emptyCheckout = document.getElementById("receptionRecordsCheckoutEmpty");
    var splitEl = document.getElementById("receptionRecordsSplit");
    var searchEl = document.getElementById("receptionRecordSearch");
    if (!hostConfirmed || !hostCheckout) return;
    hostConfirmed.textContent = "";
    hostCheckout.textContent = "";
    var q = searchEl ? String(searchEl.value || "").trim().toLowerCase() : "";

    var confirmedItems = listBookings().filter(function (item) {
      return isConfirmedCheckInRecord(item) && recordMatchesQuery(item, q);
    });
    var checkoutItems = listBookings().filter(function (item) {
      return isCompletedCheckoutRecord(item) && recordMatchesQuery(item, q);
    });

    confirmedItems.sort(sortBookingsNewestFirst);
    checkoutItems.sort(sortBookingsNewestFirst);

    var any = confirmedItems.length > 0 || checkoutItems.length > 0;
    setHidden(emptyGlobal, any);
    if (splitEl) setHidden(splitEl, !any);

    if (!any) {
      renderPaginationControls(pagerConfirmed, null);
      renderPaginationControls(pagerCheckout, null);
      return;
    }

    setHidden(emptyConfirmed, confirmedItems.length > 0);
    setHidden(emptyCheckout, checkoutItems.length > 0);

    var confirmedPage = paginateItems(
      confirmedItems,
      receptionListPages.recordsConfirmed,
      RECEPTION_PAGE_SIZE
    );
    receptionListPages.recordsConfirmed = confirmedPage.page;
    if (confirmedPage.items.length) {
      var confirmedTable = createReceptionRecordsTable();
      confirmedPage.items.forEach(function (item) {
        confirmedTable.tbody.appendChild(buildReceptionTableRow(item, { mode: "record" }));
      });
      hostConfirmed.appendChild(confirmedTable.wrap);
    }
    renderPaginationControls(pagerConfirmed, confirmedPage, function (page) {
      receptionListPages.recordsConfirmed = page;
      renderRecords();
    });

    var checkoutPage = paginateItems(
      checkoutItems,
      receptionListPages.recordsCheckout,
      RECEPTION_PAGE_SIZE
    );
    receptionListPages.recordsCheckout = checkoutPage.page;
    if (checkoutPage.items.length) {
      var checkoutTable = createReceptionRecordsTable();
      checkoutPage.items.forEach(function (item) {
        checkoutTable.tbody.appendChild(buildReceptionTableRow(item, { mode: "record" }));
      });
      hostCheckout.appendChild(checkoutTable.wrap);
    }
    renderPaginationControls(pagerCheckout, checkoutPage, function (page) {
      receptionListPages.recordsCheckout = page;
      renderRecords();
    });
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
        if ((Auth.normalizeRole ? Auth.normalizeRole(user.role) : "") !== "receptionist") {
          window.location.replace(Auth.getHomePathForRole(user.role));
          return;
        }
        initReceptionDashboard(user);
        return;
      }
      Auth.assertPageAccess("receptionist").then(function (result) {
        if (!result || !result.ok) {
          var dest = (result && result.redirect) || "login.html";
          if (/book\.html/i.test(String(dest))) dest = "login.html";
          window.location.replace(dest);
          return;
        }
        initReceptionDashboard(result.user);
      });
    }

    if (Auth.ready) {
      Auth.ready.then(boot);
      return;
    }
    boot(Auth.getCurrentUser ? Auth.getCurrentUser() : null);
  }

  function initReceptionDashboard(sessionUser) {
    var Auth = window.ElenestAuth;
    if (!Auth) return;

    var u = sessionUser;
    var name = u && u.name ? u.name : "";

    var settingsToggle = document.getElementById("staffSettingsToggle");
    var settingsMenu = document.getElementById("staffSettingsMenu");

    var sectionIds = [
      "section-walkin",
      "section-checkin",
      "section-checkout",
      "section-customer-record"
    ];

    function isSectionIdValid(id) {
      return sectionIds.indexOf(id) !== -1;
    }

    function getSectionIdFromHash(h) {
      var id = String(h || "");
      if (id.charAt(0) === "#") id = id.slice(1);
      if (isSectionIdValid(id)) return id;
      return "section-walkin";
    }

    var currentSectionId = null;

    function setActiveSectionNav(targetSectionId) {
      var targetHref = "#" + String(targetSectionId || "");
      var navLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
      navLinks.forEach(function (a) {
        var href = a.getAttribute("href") || "";
        if (href === targetHref) a.classList.add("active");
        else a.classList.remove("active");
      });
    }

    function closeStaffMenu() {
      if (!settingsMenu || !settingsToggle) return;
      setHidden(settingsMenu, true);
      settingsToggle.setAttribute("aria-expanded", "false");
      settingsToggle.classList.remove("active");
      setActiveSectionNav(currentSectionId || getSectionIdFromHash(window.location.hash));
    }

    if (settingsToggle && settingsMenu) {
      settingsToggle.addEventListener("click", function () {
        var menuOpen = !settingsMenu.hasAttribute("hidden");
        if (menuOpen) {
          settingsToggle.classList.add("active");
          var sectionLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
          sectionLinks.forEach(function (a) {
            a.classList.remove("active");
          });
        } else {
          settingsToggle.classList.remove("active");
          setActiveSectionNav(currentSectionId || getSectionIdFromHash(window.location.hash));
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeStaffMenu();
      });
    }

    function showSection(sectionId) {
      sectionId = getSectionIdFromHash(sectionId);
      if (currentSectionId === sectionId) {
        setActiveSectionNav(sectionId);
        return;
      }
      currentSectionId = sectionId;

      if (!settingsMenu || !settingsMenu.hasAttribute("hidden")) {
        closeStaffMenu();
      } else if (settingsToggle) {
        settingsToggle.classList.remove("active");
      }

      sectionIds.forEach(function (sid) {
        var el = document.getElementById(sid);
        if (!el) return;
        setHidden(el, sid !== sectionId);
      });

      setActiveSectionNav(sectionId);

      if (sectionId === "section-walkin") refreshWalkInViews();
      else if (sectionId === "section-checkin") renderCheckIn();
      else if (sectionId === "section-checkout") renderCheckOut();
      else if (sectionId === "section-customer-record") renderRecords();

      var target = document.getElementById(sectionId);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    var navLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
    setActiveSectionNav(getSectionIdFromHash(window.location.hash));
    navLinks.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var href = a.getAttribute("href") || "";
        var id = getSectionIdFromHash(href);
        e.preventDefault();
        try {
          window.location.hash = id;
        } catch (err) {}
        showSection(id);
      });
    });

    window.addEventListener("hashchange", function () {
      currentSectionId = null;
      showSection(window.location.hash);
    });

    // Keep Reception view in sync if bookings change in another tab/window.
    window.addEventListener("storage", function (e) {
      if (!e || (e.key && e.key.indexOf("elenest") === -1)) return;
      refreshReceptionLists();
    });

    window.addEventListener("elenest-bookings-updated", function () {
      refreshReceptionLists();
    });

    if (window.ElenestBookings && window.ElenestBookings.ready) {
      window.ElenestBookings.ready.then(function () {
        refreshFromSupabase();
        if (window.ElenestStaffBootLoading && typeof window.ElenestStaffBootLoading.hide === "function") {
          window.ElenestStaffBootLoading.hide();
        }
      });
    } else {
      refreshFromSupabase();
      if (window.ElenestStaffBootLoading && typeof window.ElenestStaffBootLoading.hide === "function") {
        window.ElenestStaffBootLoading.hide();
      }
    }

    setInterval(function () {
      if (document.hidden) return;
      var Bookings = window.ElenestBookings;
      if (Bookings && typeof Bookings.syncLivePaymentStatuses === "function") {
        Bookings.syncLivePaymentStatuses().then(function () {
          refreshReceptionLists();
        });
      } else {
        refreshReceptionLists();
      }
    }, 60000);

    showSection(getSectionIdFromHash(window.location.hash));

    var searchEl = document.getElementById("receptionRecordSearch");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        receptionListPages.recordsConfirmed = 1;
        receptionListPages.recordsCheckout = 1;
        renderRecords();
      });
    }
    var checkInSearchEl = document.getElementById("receptionCheckInSearch");
    if (checkInSearchEl) {
      checkInSearchEl.addEventListener("input", function () {
        receptionListPages.checkIn = 1;
        renderCheckIn();
      });
    }
    var checkOutSearchEl = document.getElementById("receptionCheckOutSearch");
    if (checkOutSearchEl) {
      checkOutSearchEl.addEventListener("input", function () {
        receptionListPages.checkOut = 1;
        renderCheckOut();
      });
    }

    var walkForm = document.getElementById("receptionWalkInForm");
    var walkMsg = document.getElementById("receptionWalkInMsg");
    var walkPhoneEl = document.getElementById("receptionWiPhone");
    var walkRoomModal = document.getElementById("receptionWiRoomModal");
    var walkCalPrev = document.getElementById("receptionWiCalPrev");
    var walkCalNext = document.getElementById("receptionWiCalNext");
    var walkCheckInEl = document.getElementById("receptionWiCheckIn");
    var walkCheckOutEl = document.getElementById("receptionWiCheckOut");
    var walkChangeRoomBtn = document.getElementById("receptionWiChangeRoom");
    var walkRoomModalDone = document.getElementById("receptionWiRoomModalDone");
    var WALK_PHONE_MAX_DIGITS = 11;
    var WALK_PHONE_ERR = "Phone number must be exactly 11 digits.";

    function walkPhoneDigitsOnly(value) {
      return String(value || "").replace(/\D/g, "");
    }

    function isValidEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
    }

    function clearWalkPhoneLenErrorIfFixed() {
      if (!walkMsg || walkMsg.hidden || !walkMsg.classList.contains("auth-msg--err")) return;
      if ((walkMsg.textContent || "").indexOf("11 digit") === -1) return;
      walkMsg.hidden = true;
      walkMsg.textContent = "";
    }

    function setWalkMsg(ok, text) {
      if (!walkMsg) return;
      walkMsg.hidden = false;
      walkMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      walkMsg.textContent = text;
    }

    if (walkCalPrev) {
      walkCalPrev.addEventListener("click", function () {
        walkCalView.m -= 1;
        if (walkCalView.m < 0) {
          walkCalView.m = 11;
          walkCalView.y -= 1;
        }
        renderWalkInCalendar();
      });
    }
    if (walkCalNext) {
      walkCalNext.addEventListener("click", function () {
        walkCalView.m += 1;
        if (walkCalView.m > 11) {
          walkCalView.m = 0;
          walkCalView.y += 1;
        }
        renderWalkInCalendar();
      });
    }

    if (walkChangeRoomBtn) {
      walkChangeRoomBtn.addEventListener("click", function () {
        if (!walkInState.checkIn) return;
        openWalkInRoomModal();
      });
    }

    if (walkRoomModal) {
      walkRoomModal.addEventListener("change", function (e) {
        var t = e.target;
        if (!t || t.tagName !== "INPUT" || t.name !== "receptionWiFacilityUnit") return;
        var unitId = String(t.value || "").trim();
        var facilityType = String(t.getAttribute("data-facility-type") || "room").trim();
        if (!unitId) return;
        var UA = window.ElenestUnitAvailability;
        var range = getWalkInStayRange();
        if (!UA || !range) return;
        var unit = UA.getCatalog().find(function (u) {
          return String(u.id) === unitId;
        });
        if (t.checked && (!unit || !UA.isUnitAvailable(unit, range.checkIn, range.checkOut))) {
          setWalkInRoomModalError("That facility is no longer available. Please choose another.");
          t.checked = false;
          renderWalkInRooms();
          return;
        }
        toggleWalkInDraftFacility(facilityType, unitId, !!t.checked);
        setWalkInRoomModalError("");
        if (hasWalkInSelection(walkInState.draftSelection)) {
          var guestCheck = runWalkInGuestCapacityCheck(walkInState.draftSelection);
          if (!guestCheck.ok) {
            setWalkInRoomModalError(
              guestCheck.errors[0] ||
                "Please reduce the number of guests or select another facility with a larger capacity."
            );
          }
        }
        renderWalkInRooms();
      });

      walkRoomModal.querySelectorAll("[data-reception-wi-room-close]").forEach(function (el) {
        el.addEventListener("click", closeWalkInRoomModal);
      });
    }

    if (walkRoomModalDone) {
      walkRoomModalDone.addEventListener("click", confirmWalkInRoomSelection);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (isWalkInRoomModalOpen()) {
        closeWalkInRoomModal();
        return;
      }
      var od = document.getElementById("receptionBookingDetailOverlay");
      if (od && !od.hasAttribute("hidden")) closeReceptionBookingDetail();
    });

    function applyWalkInDatesFromInputs() {
      var checkIn = walkCheckInEl ? String(walkCheckInEl.value || "").trim() : "";
      var checkOut = walkCheckOutEl ? String(walkCheckOutEl.value || "").trim() : "";
      if (!checkIn) {
        resetWalkInStaySelection();
        closeWalkInRoomModal();
        refreshWalkInViews();
        return;
      }
      walkInState.checkIn = checkIn;
      if (isWalkInDayTour()) {
        walkInState.checkOut = nextIsoDay(checkIn);
        applyWalkInDayTourTimes();
      } else if (!checkOut || checkOut <= checkIn) {
        setWalkMsg(false, "For Overnight, check-out must be a different date after check-in.");
        walkInState.checkOut = nextIsoDay(checkIn);
      } else {
        walkInState.checkOut = checkOut;
      }
      if (
        walkInState.facilityConfirmed &&
        !isWalkInSelectionAvailable(
          walkInState.selection,
          walkInState.checkIn,
          walkInState.checkOut
        )
      ) {
        clearWalkInRoomSelection();
      }
      syncWalkInDateInputs();
      refreshWalkInViews();
      openWalkInRoomModal();
    }

    function applyWalkInStayTypeChange() {
      walkInState.stayType = getWalkInStayTypeFromForm();
      clearWalkInRoomSelection();
      syncWalkInStayTypeUI();
      if (walkInState.checkIn && isWalkInDayTour()) {
        walkInState.checkOut = nextIsoDay(walkInState.checkIn);
      } else if (
        walkInState.checkIn &&
        (!walkInState.checkOut || walkInState.checkOut <= walkInState.checkIn)
      ) {
        walkInState.checkOut = nextIsoDay(walkInState.checkIn);
      }
      syncWalkInDateInputs();
      refreshWalkInViews();
    }

    document.querySelectorAll('input[name="receptionWiStayType"]').forEach(function (radio) {
      radio.addEventListener("change", applyWalkInStayTypeChange);
    });

    var walkInTimeEl = document.getElementById("receptionWiCheckInTime");
    var walkOutTimeEl = document.getElementById("receptionWiCheckOutTime");
    if (walkInTimeEl) {
      walkInTimeEl.addEventListener("change", function () {
        walkInState.checkInTime = String(walkInTimeEl.value || "");
        if (isWalkInRoomModalOpen()) renderWalkInRooms();
        else if (walkInState.facilityConfirmed) refreshWalkInViews();
      });
    }
    if (walkOutTimeEl) {
      walkOutTimeEl.addEventListener("change", function () {
        walkInState.checkOutTime = String(walkOutTimeEl.value || "");
        if (isWalkInRoomModalOpen()) renderWalkInRooms();
        else if (walkInState.facilityConfirmed) refreshWalkInViews();
      });
    }

    if (walkCheckInEl) {
      walkCheckInEl.addEventListener("change", applyWalkInDatesFromInputs);
    }
    if (walkCheckOutEl) {
      walkCheckOutEl.addEventListener("change", function () {
        if (isWalkInDayTour()) {
          syncWalkInDateInputs();
          return;
        }
        applyWalkInDatesFromInputs();
      });
    }

    if (walkPhoneEl) {
      walkPhoneEl.addEventListener("input", function () {
        var len = walkPhoneDigitsOnly(walkPhoneEl.value).length;
        if (len > WALK_PHONE_MAX_DIGITS) {
          setWalkMsg(false, WALK_PHONE_ERR);
        } else if (len > 0 && len < WALK_PHONE_MAX_DIGITS) {
          setWalkMsg(false, WALK_PHONE_ERR);
        } else {
          clearWalkPhoneLenErrorIfFixed();
        }
      });
    }

    ["receptionWiAdults", "receptionWiChildren", "receptionWiChildrenUnder6"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        updateWalkInRoomModalConfirmButton();
        if (isWalkInRoomModalOpen()) updateWalkInModalCapacityHint();
      });
    });

    if (walkForm && window.ElenestBookings && typeof window.ElenestBookings.add === "function") {
      walkForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fullName = document.getElementById("receptionWiName");
        var emailEl = document.getElementById("receptionWiEmail");
        var phoneEl = document.getElementById("receptionWiPhone");
        var ci = document.getElementById("receptionWiCheckIn");
        var co = document.getElementById("receptionWiCheckOut");
        var adultsEl = document.getElementById("receptionWiAdults");
        var childrenEl = document.getElementById("receptionWiChildren");
        var under6El = document.getElementById("receptionWiChildrenUnder6");

        var guestName = fullName ? String(fullName.value || "").trim() : "";
        var guestEmail = emailEl ? normalizeEmail(emailEl.value || "") : "";
        var phone = phoneEl ? String(phoneEl.value || "").trim() : "";
        var stayType = getWalkInStayTypeFromForm();
        walkInState.stayType = stayType;
        var checkIn = ci ? String(ci.value || "").trim() : walkInState.checkIn || "";
        var checkOutDisplay = co ? String(co.value || "").trim() : "";
        var checkOut =
          stayType === "day_tour"
            ? checkIn
              ? nextIsoDay(checkIn)
              : ""
            : checkOutDisplay || walkInState.checkOut || "";
        var selection =
          walkInState.facilityConfirmed && hasWalkInSelection(walkInState.selection)
            ? cloneWalkInSelection(walkInState.selection)
            : emptyWalkInSelection();
        var adults = adultsEl ? String(adultsEl.value || "").trim() : "1";
        var children = childrenEl ? String(childrenEl.value || "").trim() : "0";
        var childrenUnder6 = under6El ? String(under6El.value || "").trim() : "0";
        var checkInTimeEl = document.getElementById("receptionWiCheckInTime");
        var checkOutTimeEl = document.getElementById("receptionWiCheckOutTime");
        var checkInTime =
          stayType === "day_tour"
            ? WALK_DAY_TOUR_ARRIVAL
            : String((checkInTimeEl && checkInTimeEl.value) || walkInState.checkInTime || "").trim();
        var checkOutTime =
          stayType === "day_tour"
            ? WALK_DAY_TOUR_DEPARTURE
            : String((checkOutTimeEl && checkOutTimeEl.value) || walkInState.checkOutTime || "").trim();

        if (!guestName || !guestEmail || !phone || !checkIn || !checkOut) {
          setWalkMsg(false, "Please complete all required fields.");
          return;
        }
        if (!hasWalkInSelection(selection)) {
          setWalkMsg(false, "Select one or more facilities from the calendar popup, then confirm.");
          if (walkInState.checkIn) openWalkInRoomModal();
          return;
        }
        if (!isValidEmail(guestEmail)) {
          setWalkMsg(false, "Please enter a valid email address (must include @).");
          return;
        }
        if (walkPhoneDigitsOnly(phone).length !== WALK_PHONE_MAX_DIGITS) {
          setWalkMsg(false, WALK_PHONE_ERR);
          return;
        }
        if (stayType === "overnight") {
          if (checkOut <= checkIn) {
            setWalkMsg(false, "For Overnight, check-out must be a different date after check-in.");
            return;
          }
          if (!checkInTime || !checkOutTime) {
            setWalkMsg(false, "Please select arrival and departure times.");
            return;
          }
        } else if (checkOutDisplay && checkOutDisplay !== checkIn) {
          // Keep day-tour UI dates aligned even if the field was edited somehow.
          if (co) co.value = checkIn;
        }

        var UA = window.ElenestUnitAvailability;
        if (!UA || !isWalkInSelectionAvailable(selection, checkIn, checkOut, true)) {
          var failCheck = UA
            ? UA.validateSelection(selection, checkIn, checkOut, null, {
                validateGuests: true,
                adults: adults,
                children: children,
                childrenUnder6: childrenUnder6
              })
            : { errors: [] };
          setWalkMsg(
            false,
            (failCheck.errors && failCheck.errors[0]) ||
              "That selection is unavailable or exceeds capacity. Please adjust."
          );
          clearWalkInRoomSelection();
          openWalkInRoomModal();
          return;
        }

        var legacy =
          typeof UA.deriveLegacyFields === "function"
            ? UA.deriveLegacyFields(selection)
            : {
                roomType: "none",
                roomCatalogId: selection.roomCatalogId || "",
                roomCatalogIds: selection.roomCatalogIds || [],
                cottageCatalogIds: selection.cottageCatalogIds || [],
                cottageQty: String((selection.cottageCatalogIds || []).length),
                hallCatalogId: selection.hallCatalogId || "",
                hallCatalogIds: selection.hallCatalogIds || [],
                eventHall: "none",
                facilityIds: [],
                room_ids: [],
                capacityTotal: 0
              };

        var record = {
          fullName: guestName,
          phone: phone,
          email: guestEmail,
          roomType: legacy.roomType || "none",
          roomCatalogId: legacy.roomCatalogId || "",
          roomCatalogIds: legacy.roomCatalogIds || [],
          roomCatalogName: legacy.roomCatalogName || "",
          roomCatalogNames: legacy.roomCatalogNames || [],
          room_id:
            legacy.roomCatalogId ||
            (legacy.cottageCatalogIds && legacy.cottageCatalogIds[0]) ||
            legacy.hallCatalogId ||
            "",
          room_ids: legacy.room_ids || legacy.facilityIds || [],
          facilityIds: legacy.facilityIds || legacy.room_ids || [],
          capacityTotal: legacy.capacityTotal || 0,
          capacityLabel: legacy.capacityLabel || "",
          adults: adults,
          children: children,
          childrenUnder6: childrenUnder6,
          eventHall: legacy.eventHall || "none",
          hallCatalogId: legacy.hallCatalogId || "",
          hallCatalogIds: legacy.hallCatalogIds || [],
          hallCatalogName: legacy.hallCatalogName || "",
          hallCatalogNames: legacy.hallCatalogNames || [],
          poolUse: stayType === "day_tour" ? "day_tour" : "none",
          cottageQty: legacy.cottageQty || "0",
          cottageCatalogIds: legacy.cottageCatalogIds || [],
          cottageCatalogNames: legacy.cottageCatalogNames || [],
          eventType: "none",
          eventOther: "",
          request: "",
          checkIn: checkIn,
          checkOut: checkOut,
          checkInTime: checkInTime,
          checkOutTime: checkOutTime,
          stayType: stayType,
          totalEstimate: 0,
          amountDown: 0,
          paymentStatus: "Walk-in — settled at front desk",
          status: "Confirmed",
          workflow: "confirmed",
          slotLocked: true,
          paymentVerifiedAt: new Date().toISOString(),
          paymentMethod: "Walk-in",
          walkIn: true
        };

        var submitBtn = walkForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(submitBtn, true);
        var saved = window.ElenestBookings.add(guestEmail, record);
        var saveDone =
          window.ElenestBookings && typeof window.ElenestBookings.waitForSave === "function"
            ? window.ElenestBookings.waitForSave(saved)
            : Promise.resolve(saved);
        saveDone
          .then(function () {
            walkForm.reset();
            if (adultsEl) adultsEl.value = "2";
            if (childrenEl) childrenEl.value = "0";
            if (under6El) under6El.value = "0";
            var overnightRadio = document.querySelector(
              'input[name="receptionWiStayType"][value="overnight"]'
            );
            if (overnightRadio) overnightRadio.checked = true;
            walkInState.stayType = "overnight";
            fillWalkInTimeSelects();
            syncWalkInStayTypeUI();
            closeWalkInRoomModal();
            resetWalkInStaySelection();
            refreshWalkInViews();
            var walkSavedText =
              "It now appears on the Check-in list so you can complete guest arrival.";
            if (typeof Swal !== "undefined" && typeof Swal.fire === "function") {
              if (walkMsg) {
                walkMsg.hidden = true;
                walkMsg.textContent = "";
              }
              Swal.fire({
                icon: "success",
                title: "Walk-in saved",
                text: walkSavedText
              });
            } else {
              setWalkMsg(true, "Walk-in saved. " + walkSavedText);
            }
            refreshReceptionLists();
            try {
              window.location.hash = "section-checkin";
            } catch (err) {}
            showSection("section-checkin");
          })
          .catch(function () {
            setWalkMsg(false, "Could not save walk-in. Please try again.");
          })
          .then(function () {
            if (BL) BL.set(submitBtn, false);
          });
      });
    }

    fillWalkInTimeSelects();
    walkInState.stayType = getWalkInStayTypeFromForm();
    syncWalkInStayTypeUI();
    refreshWalkInViews();
    if (window.ElenestAvailability && window.ElenestAvailability.ready) {
      window.ElenestAvailability.ready.then(function () {
        refreshWalkInViews();
      });
    }
    if (window.ElenestContentStore && window.ElenestContentStore.ready) {
      window.ElenestContentStore.ready.then(function () {
        refreshWalkInViews();
      });
    }

    var bookingDetailOverlay = document.getElementById("receptionBookingDetailOverlay");
    var bookingDetailCloseBtn = document.getElementById("receptionBookingDetailCloseBtn");
    if (bookingDetailCloseBtn) bookingDetailCloseBtn.addEventListener("click", closeReceptionBookingDetail);
    if (bookingDetailOverlay) {
      bookingDetailOverlay.addEventListener("click", function (e) {
        if (e.target === bookingDetailOverlay) closeReceptionBookingDetail();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
