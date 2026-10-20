(function () {
  var cache = {};
  var occupancyRows = [];
  var availabilityBookings = [];
  var optimisticAvailability = {};
  var historicalBookingsList = [];
  var historicalLoaded = false;
  var historicalLoadPromise = null;
  /** Mobile public calendar map: isoDate -> { canonicalUnitId: true } */
  var publicFacilityBlocksByDate = {};
  var broadcastChannel = null;
  var postgresChannel = null;
  var realtimeSetupDone = false;
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoToUtcDate(iso) {
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10) - 1;
    var d = parseInt(iso.slice(8, 10), 10);
    return new Date(Date.UTC(y, m, d));
  }

  function utcDateToIso(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  var lastSoftPollFingerprint = "";

  function availabilityFingerprint() {
    try {
      var days = Object.keys(publicFacilityBlocksByDate || {}).sort();
      var parts = days.map(function (d) {
        var map = publicFacilityBlocksByDate[d] || {};
        return d + ":" + Object.keys(map).sort().map(function (id) {
          return id + "=" + String(map[id]);
        }).join(",");
      });
      var bookingBits = (availabilityBookings || [])
        .map(function (b) {
          if (!b) return "";
          return (
            String(b.id || "") +
            ":" +
            String(b.status || "") +
            ":" +
            String(b.paymentVerifiedAt || b.payment_verified_at || "") +
            ":" +
            String(b.paymentVerified === true || b.payment_verified === true) +
            ":" +
            String(b.workflow || "") +
            ":" +
            String(b.holdExpiresAt || b.hold_expires_at || "")
          );
        })
        .sort()
        .join(";");
      return parts.join("|") + "#" + bookingBits;
    } catch (e) {
      return String(Date.now());
    }
  }

  var emitUpdatedTimer = null;
  function emitUpdated() {
    if (emitUpdatedTimer) return;
    emitUpdatedTimer = setTimeout(function () {
      emitUpdatedTimer = null;
      try {
        window.dispatchEvent(new CustomEvent("elenest-bookings-updated"));
      } catch (e) {}
    }, 160);
  }

  function parseJsonArray(val) {
    if (Array.isArray(val)) return val.filter(function (x) { return x != null && String(x).trim() !== ""; });
    if (val == null) return [];
    if (typeof val === "string") {
      var s = val.trim();
      if (!s) return [];
      // JSON array: ["a","b"]
      if (s.charAt(0) === "[") {
        try {
          var parsed = JSON.parse(s);
          return Array.isArray(parsed)
            ? parsed.filter(function (x) { return x != null && String(x).trim() !== ""; })
            : [];
        } catch (e) {
          return [];
        }
      }
      // Postgres text[] literal: {a,b} or {"a","b"}
      if (s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") {
        var inner = s.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(",").map(function (part) {
          var p = String(part || "").trim();
          if (p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') {
            p = p.slice(1, -1);
          }
          return p;
        }).filter(Boolean);
      }
      // Comma-separated ids
      if (s.indexOf(",") !== -1) {
        return s.split(",").map(function (part) { return String(part || "").trim(); }).filter(Boolean);
      }
      return [s];
    }
    return [];
  }

  /** Normalize mobile/public RPC room_ids + singular room_id into one id list. */
  function coerceFacilityIdList(row) {
    row = row || {};
    var payload = parsePayload(row);
    return uniqueCanonicalIds(
      []
        .concat(parseJsonArray(row.room_ids))
        .concat(parseJsonArray(row.facilityIds))
        .concat(parseJsonArray(payload.room_ids))
        .concat(parseJsonArray(payload.facilityIds))
        .concat(parseJsonArray(payload.roomCatalogIds))
        .concat(parseJsonArray(payload.cottageCatalogIds))
        .concat(parseJsonArray(payload.hallCatalogIds))
        .concat(row.room_id ? [row.room_id] : [])
        .concat(payload.room_id ? [payload.room_id] : [])
        .concat(payload.roomCatalogId ? [payload.roomCatalogId] : [])
        .concat(payload.hallCatalogId ? [payload.hallCatalogId] : [])
    );
  }

  function isHistoricalId(id) {
    return String(id || "").indexOf("past-") === 0;
  }

  function isHistoricalBooking(booking) {
    if (!booking) return false;
    var id = String(booking.id || "");
    if (isHistoricalId(id)) return true;
    if (booking.historical === true) return true;
    if (String(booking.source || "") === "historical_import") return true;
    var payload = booking.payload;
    if (payload && typeof payload === "object") {
      if (payload.historical === true) return true;
      if (String(payload.source || "") === "historical_import") return true;
    }
    return false;
  }

  function isRecentOrUpcomingStay(checkIn, checkOut) {
    var from = addDaysIso(localTodayIso(), -21);
    var to = addDaysIso(localTodayIso(), 540);
    var ci = normalizeDateField(checkIn);
    var co = normalizeDateField(checkOut);
    if (!ci || !co) return false;
    return co >= from && ci <= to;
  }

  function bookingToAvailabilityShape(booking) {
    return bookingRecordToAvailabilityBooking(booking);
  }

  function upsertAvailabilityBooking(booking) {
    var b = bookingRecordToAvailabilityBooking(booking);
    if (!b) return;
    var PF = window.ElenestPaymentFlow;
    availabilityBookings = availabilityBookings.filter(function (x) {
      return x.id !== b.id;
    });
    if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
      if (PF.bookingBlocksCalendarSlot(b)) {
        availabilityBookings.push(b);
        if (b.id) optimisticAvailability[b.id] = Date.now();
      } else if (b.id) {
        delete optimisticAvailability[b.id];
      }
    } else {
      availabilityBookings.push(b);
      if (b.id) optimisticAvailability[b.id] = Date.now();
    }
  }

  function bookingUnitIds(booking) {
    var ids = [];
    function add(value) {
      var id = canonicalizeUnitId(value);
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    if (!booking) return ids;
    add(booking.roomId);
    add(booking.room_id);
    add(booking.facilityId);
    add(booking.roomCatalogId);
    add(booking.hallCatalogId);
    add(booking.cottageId);
    ["roomCatalogIds", "hallCatalogIds", "cottageCatalogIds", "facilityIds", "room_ids"].forEach(
      function (key) {
        var list = booking[key];
        if (!Array.isArray(list)) return;
        list.forEach(add);
      }
    );
    if (Array.isArray(booking.facilities)) {
      booking.facilities.forEach(function (facility) {
        if (!facility) return;
        if (typeof facility === "string") add(facility);
        else add(facility.id || facility.facilityId || facility.roomId);
      });
    }
    return ids;
  }

  function stayNightIsos(booking) {
    var start = normalizeDateField(booking && (booking.checkIn || booking.check_in));
    var end = normalizeDateField(booking && (booking.checkOut || booking.check_out));
    if (!start) return [];
    if (!end || end < start) end = start;
    if (end === start) return [start];
    var nights = [];
    var cur = start;
    var guard = 0;
    while (cur < end && guard < 400) {
      nights.push(cur);
      cur = addDaysIso(cur, 1);
      guard += 1;
    }
    return nights;
  }

  function bookingStillHoldsUnit(booking, unitId, day, exceptId) {
    if (!booking || !unitId || !day) return false;
    var id = String(booking.id || "");
    var parent = String(booking.parentBookingId || "");
    var group = String(booking.bookingGroupId || "");
    if (exceptId && (id === exceptId || parent === exceptId || group === exceptId || id.indexOf(exceptId + "__") === 0)) {
      return false;
    }
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingBlocksCalendarSlot === "function" && !PF.bookingBlocksCalendarSlot(booking)) {
      return false;
    }
    if (bookingUnitIds(booking).indexOf(unitId) === -1) return false;
    return stayNightIsos(booking).indexOf(day) !== -1;
  }

  function anotherBookingStillHolds(unitId, day, exceptId) {
    var i;
    var live = listLive();
    for (i = 0; i < live.length; i++) {
      if (live[i] && bookingStillHoldsUnit(live[i].booking, unitId, day, exceptId)) return true;
    }
    for (i = 0; i < availabilityBookings.length; i++) {
      if (bookingStillHoldsUnit(availabilityBookings[i], unitId, day, exceptId)) return true;
    }
    return false;
  }

  function releaseDeclinedBookingAvailability(booking, opts) {
    if (!booking) return;
    opts = opts || {};
    var exceptId = String(booking.bookingGroupId || booking.parentBookingId || booking.id || "");
    var units = bookingUnitIds(booking);
    var nights = stayNightIsos(booking);
    availabilityBookings = availabilityBookings.filter(function (row) {
      if (!row) return false;
      var id = String(row.id || "");
      if (!exceptId) return true;
      if (id === exceptId || id.indexOf(exceptId + "__") === 0) return false;
      if (String(row.parentBookingId || "") === exceptId) return false;
      if (String(row.bookingGroupId || "") === exceptId) return false;
      return true;
    });
    nights.forEach(function (day) {
      var blocks = publicFacilityBlocksByDate[day];
      if (!blocks) return;
      units.forEach(function (unitId) {
        if (!anotherBookingStillHolds(unitId, day, exceptId)) delete blocks[unitId];
      });
    });
    if (opts.notify === false) return;
    emitUpdated();
    broadcastAvailabilityChanged();
  }

  function pruneBlocksHeldOnlyByReleasedBookings() {
    listLive().forEach(function (item) {
      var booking = item && item.booking;
      if (!booking) return;
      var status = String(booking.status || "").toLowerCase();
      var workflow = String(booking.workflow || "").toLowerCase();
      var stage = String(booking.verificationStage || "").toLowerCase();
      var declined = !!(
        booking.paymentRejectedAt ||
        status === "rejected" ||
        status === "declined" ||
        workflow === "rejected" ||
        workflow === "booking_declined" ||
        stage === "booking_declined"
      );
      if (!declined) return;
      releaseDeclinedBookingAvailability(booking, { notify: false });
    });
  }

  function broadcastAvailabilityChanged() {
    var sb = getClient();
    if (!sb) return;
    if (!broadcastChannel) setupRealtimeAvailability();
    if (!broadcastChannel) return;
    try {
      broadcastChannel.send({
        type: "broadcast",
        event: "availability-changed",
        payload: { at: Date.now() }
      });
    } catch (e) {}
  }

  function refreshAvailabilityAndNotify() {
    return loadPublicAvailability().catch(function () {
      return false;
    });
  }

  function teardownRealtimeAvailability() {
    var sb = getClient();
    if (broadcastChannel && sb) {
      try {
        sb.removeChannel(broadcastChannel);
      } catch (e) {}
    }
    if (postgresChannel && sb) {
      try {
        sb.removeChannel(postgresChannel);
      } catch (e2) {}
    }
    broadcastChannel = null;
    postgresChannel = null;
    realtimeSetupDone = false;
  }

  function scheduleRealtimeReconnect() {
    if (scheduleRealtimeReconnect._pending) return;
    scheduleRealtimeReconnect._pending = true;
    setTimeout(function () {
      scheduleRealtimeReconnect._pending = false;
      teardownRealtimeAvailability();
      setupRealtimeAvailability();
    }, 2500);
  }

  function onAvailabilityVersionChanged() {
    if (onAvailabilityVersionChanged._timer) {
      clearTimeout(onAvailabilityVersionChanged._timer);
    }
    onAvailabilityVersionChanged._timer = setTimeout(function () {
      onAvailabilityVersionChanged._timer = null;
      refreshAvailabilityAndNotify();
      if (
        window.ElenestAvailability &&
        typeof window.ElenestAvailability.refreshManagerBlocks === "function"
      ) {
        window.ElenestAvailability.refreshManagerBlocks();
      }
    }, 1200);
  }

  function setupRealtimeAvailability(force) {
    var sb = getClient();
    if (!sb) return;
    if (realtimeSetupDone && !force) return;
    if (force) teardownRealtimeAvailability();
    realtimeSetupDone = true;

    broadcastChannel = sb.channel("elenest-availability", {
      config: { broadcast: { self: false } }
    });
    broadcastChannel.on("broadcast", { event: "availability-changed" }, function () {
      onAvailabilityVersionChanged();
    });
    broadcastChannel.on("broadcast", { event: "payment-verified" }, function (msg) {
      try {
        applyPaymentVerifiedPayload(msg && msg.payload);
      } catch (e) {}
    });
    broadcastChannel.subscribe(function (status) {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        try {
          console.warn("[Elenest Bookings] Availability broadcast channel:", status);
        } catch (e) {}
        scheduleRealtimeReconnect();
      }
    });

    // availability_version (anon) + bookings (staff / authenticated realtime)
    postgresChannel = sb
      .channel("elenest-availability-db")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability_version" },
        function () {
          onAvailabilityVersionChanged();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        function (payload) {
          var row = payload && payload.new;
          var old = payload && payload.old;
          var changedId = (row && row.id) || (old && old.id) || "";
          if (isHistoricalId(changedId)) return;
          if (row && payload.eventType !== "DELETE") {
            try {
              applyLiveDecisionRows([row]);
              applyBookingRowToCache(row);
            } catch (e) {}
          }
          onAvailabilityVersionChanged();
        }
      );

    postgresChannel.subscribe(function (status) {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        try {
          console.warn("[Elenest Bookings] Availability DB channel:", status);
        } catch (e) {}
        scheduleRealtimeReconnect();
      } else if (status === "SUBSCRIBED") {
        try {
          console.info("[Elenest Bookings] Live Supabase realtime connected");
        } catch (e3) {}
        if (
          getCurrentUserFromAuth() &&
          (!lastLoadAllBookingsAt || Date.now() - lastLoadAllBookingsAt > 20000)
        ) {
          loadAllBookings();
        }
      }
    });
  }

  function parsePayload(row) {
    var payload = row && row.payload;
    if (!payload) return {};
    if (typeof payload === "object") return payload;
    if (typeof payload === "string") {
      try {
        var parsed = JSON.parse(payload);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  function statusProgressRank(st) {
    var s = String(st || "")
      .trim()
      .toLowerCase();
    if (s === "checked out" || s === "checked_out" || s === "completed") return 80;
    if (s === "checked in" || s === "checked_in") return 70;
    if (s === "confirmed" || s === "approved" || s === "active") return 60;
    if (s === "reserved") return 50;
    if (s === "rejected" || s === "no show" || s === "no_show") return 40;
    if (s === "cancelled" || s === "canceled") return 30;
    if (s === "for verification" || s === "pending payment verification") return 20;
    if (s === "awaiting payment" || s === "awaiting_payment") return 15;
    if (s === "pending") return 10;
    return 0;
  }

  function pickLaterStatus(a, b) {
    if (!a) return b || "";
    if (!b) return a;
    return statusProgressRank(a) >= statusProgressRank(b) ? a : b;
  }

  function workflowProgressRank(wf) {
    var s = String(wf || "")
      .trim()
      .toLowerCase();
    if (s === "checked_out" || s === "completed") return 80;
    if (s === "checked_in") return 70;
    if (s === "confirmed") return 60;
    if (s === "approved" || s === "verified_by_receptionist") return 50;
    if (
      s === "rejected" ||
      s === "cancelled" ||
      s === "canceled" ||
      s === "payment_expired" ||
      s === "booking_declined"
    ) {
      return 40;
    }
    if (s === "pending_payment" || s === "pending_verification" || s === "awaiting_admin") return 12;
    if (s === "awaiting_payment") return 8;
    if (s === "pending") return 5;
    if (s === "awaiting_booking_review") return 3;
    return 0;
  }

  function pickLaterWorkflow(a, b) {
    if (!a) return b || "";
    if (!b) return a;
    return workflowProgressRank(a) >= workflowProgressRank(b) ? a : b;
  }

  function paymentStatusProgressRank(st) {
    var s = String(st || "")
      .trim()
      .toLowerCase();
    if (s.indexOf("fully paid") !== -1) return 80;
    if (s.indexOf("down payment received") !== -1) return 70;
    if (s.indexOf("checked in") !== -1 || s.indexOf("checked out") !== -1) return 65;
    if (s.indexOf("approved") !== -1) return 60;
    if (s.indexOf("reject") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("no show") !== -1) {
      return 40;
    }
    if (s.indexOf("for verification") !== -1 || s.indexOf("pending") !== -1) return 10;
    if (s.indexOf("awaiting payment") !== -1) return 4;
    if (s.indexOf("awaiting admin") !== -1) return 2;
    return 0;
  }

  function pickLaterPaymentStatus(a, b) {
    if (!a) return b || "";
    if (!b) return a;
    return paymentStatusProgressRank(a) >= paymentStatusProgressRank(b) ? a : b;
  }

  function applyDownPaymentHoldShape(booking) {
    if (!booking) return booking;
    var arrival = String(booking.arrivalStatus || "").toLowerCase();
    if (arrival === "arrived" || booking.checkedInAt) return booking;
    if (String(booking.paymentType || "").toLowerCase() === "full") return booking;
    if (String(booking.status || "").toLowerCase() !== "confirmed") return booking;
    if (booking.holdExpiresAt || booking.paymentVerifiedAt) {
      booking.status = "Reserved";
    }
    return booking;
  }

  function mergeBookingPreferringLater(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    var out = Object.assign({}, prev, next);
    out.status = pickLaterStatus(prev.status, next.status);
    out.workflow = pickLaterWorkflow(prev.workflow, next.workflow);
    out.paymentStatus = pickLaterPaymentStatus(prev.paymentStatus, next.paymentStatus);
    out.verificationStage = pickLaterWorkflow(prev.verificationStage, next.verificationStage);
    if (next.arrivalStatus) out.arrivalStatus = next.arrivalStatus;
    if (Object.prototype.hasOwnProperty.call(next, "holdExpiresAt")) {
      out.holdExpiresAt = next.holdExpiresAt;
    }
    applyDownPaymentHoldShape(out);
    if (prev.paymentVerifiedAt && !next.paymentVerifiedAt) {
      out.paymentVerifiedAt = prev.paymentVerifiedAt;
      out.paymentVerifiedBy = out.paymentVerifiedBy || prev.paymentVerifiedBy;
    }
    if (prev.paymentRejectedAt && !next.paymentRejectedAt) {
      out.paymentRejectedAt = prev.paymentRejectedAt;
    }
    var approvedLike =
      !!out.paymentVerifiedAt ||
      String(out.verificationStage || "").toLowerCase() === "approved" ||
      String(out.workflow || "").toLowerCase() === "approved" ||
      String(out.workflow || "").toLowerCase() === "confirmed" ||
      String(out.paymentStatus || "")
        .toLowerCase()
        .indexOf("fully paid") !== -1 ||
      String(out.paymentStatus || "")
        .toLowerCase()
        .indexOf("down payment received") !== -1;
    var stNow = String(out.status || "").toLowerCase();
    if (
      approvedLike &&
      !isPrePaymentHold(out) &&
      (stNow === "for verification" || stNow === "pending" || stNow === "pending payment verification")
    ) {
      out.status = String(out.paymentType || "").toLowerCase() === "full" ? "Confirmed" : "Reserved";
      if (!out.verificationStage || String(out.verificationStage).toLowerCase() === "awaiting_admin") {
        out.verificationStage = "approved";
      }
    }
    applyDownPaymentHoldShape(out);
    return out;
  }

  function getBookingGroupId(booking) {
    if (!booking) return "";
    if (booking.parentBookingId) return String(booking.parentBookingId);
    if (booking.bookingGroupId) return String(booking.bookingGroupId);
    var id = String(booking.id || "");
    if (!id) return "";
    var cut = id.indexOf("__");
    return cut > 0 ? id.slice(0, cut) : id;
  }

  function isLinkedFacilityRow(booking) {
    return !!(booking && (booking.linkedFacilityBooking || booking.parentBookingId));
  }

  function isPrePaymentHold(booking) {
    if (!booking) return false;
    var wf = String(booking.workflow || "").toLowerCase();
    var stage = String(booking.verificationStage || "").toLowerCase();
    var st = String(booking.status || "").toLowerCase();
    return (
      wf === "awaiting_booking_review" ||
      wf === "awaiting_payment" ||
      stage === "awaiting_booking_review" ||
      stage === "awaiting_payment" ||
      st === "awaiting payment" ||
      st === "awaiting_payment"
    );
  }

  function bookingHasPaymentDecision(booking) {
    if (!booking) return false;
    if (booking.paymentVerifiedAt || booking.paymentRejectedAt) return true;
    var stage = String(booking.verificationStage || "").toLowerCase();
    if (stage === "approved" || stage === "rejected") return true;
    var wf = String(booking.workflow || "").toLowerCase();
    if (wf === "approved" || wf === "confirmed" || wf === "rejected") return true;
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isPaymentApproved === "function" && PF.isPaymentApproved(booking)) {
      return true;
    }
    return false;
  }

  var PAYMENT_SYNC_KEYS = [
    "status",
    "paymentStatus",
    "paymentVerifiedAt",
    "paymentVerifiedBy",
    "paymentRejectedAt",
    "paymentRejectedBy",
    "paymentRejectionReason",
    "verificationStage",
    "workflow",
    "holdExpiresAt",
    "verificationExpiresAt",
    "paymentDeadlineAt",
    "bookingConfirmedAt",
    "slotLocked",
    "nonRefundable",
    "amountPaid",
    "balanceDue",
    "arrivalStatus"
  ];

  function copyPaymentApprovalFields(from, to) {
    if (!from || !to || from === to) return;
    PAYMENT_SYNC_KEYS.forEach(function (k) {
      if (k === "status") {
        to.status = pickLaterStatus(to.status, from.status);
        return;
      }
      if (k === "workflow" || k === "verificationStage") {
        to[k] = pickLaterWorkflow(to[k], from[k]);
        return;
      }
      if (k === "paymentStatus") {
        to.paymentStatus = pickLaterPaymentStatus(to.paymentStatus, from.paymentStatus);
        return;
      }
      if (from[k] != null && from[k] !== "") {
        to[k] = from[k];
      }
    });
    if (from.paymentVerifiedAt || bookingHasPaymentDecision(from)) {
      delete to.verificationExpiresAt;
    }
  }

  function listGroupMembers(groupId) {
    var gid = String(groupId || "");
    var members = [];
    if (!gid) return members;
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      var list = cache[email];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!b) continue;
        if (String(b.id) === gid || getBookingGroupId(b) === gid) members.push(b);
      }
    }
    return members;
  }

  function preferredPaymentSource(members) {
    var best = null;
    for (var i = 0; i < members.length; i++) {
      var b = members[i];
      if (!bookingHasPaymentDecision(b)) continue;
      if (!best) {
        best = b;
        continue;
      }
      if (b.paymentVerifiedAt && !best.paymentVerifiedAt) {
        best = b;
        continue;
      }
      if (pickLaterStatus(best.status, b.status) === b.status && b.status !== best.status) {
        best = b;
      }
    }
    return best;
  }

  function syncGroupPaymentState(groupId) {
    var members = listGroupMembers(groupId);
    if (!members.length) return false;
    var source = preferredPaymentSource(members);
    if (!source) return false;
    var changed = false;
    for (var i = 0; i < members.length; i++) {
      var b = members[i];
      if (b === source) continue;
      var before =
        String(b.status || "") +
        "|" +
        String(b.paymentVerifiedAt || "") +
        "|" +
        String(b.verificationStage || "") +
        "|" +
        String(b.paymentStatus || "");
      copyPaymentApprovalFields(source, b);
      var after =
        String(b.status || "") +
        "|" +
        String(b.paymentVerifiedAt || "") +
        "|" +
        String(b.verificationStage || "") +
        "|" +
        String(b.paymentStatus || "");
      if (before !== after) changed = true;
    }
    if (changed) {
      persistRepairedPrimaryMembers(members);
    }
    return changed;
  }

  function syncAllGroupsPaymentState() {
    var seen = {};
    var changed = false;
    var stayGroups = {};
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      var list = cache[email];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i++) {
        var booking = list[i];
        var gid = getBookingGroupId(booking);
        if (gid && !seen[gid]) {
          seen[gid] = true;
          if (syncGroupPaymentState(gid)) changed = true;
        }
        var stayKey =
          normalizeEmail(booking && (booking.email || email)) +
          "|" +
          String((booking && booking.checkIn) || "") +
          "|" +
          String((booking && booking.checkOut) || "");
        if (stayKey.indexOf("||") === 0 || stayKey.slice(-1) === "|") continue;
        if (!stayGroups[stayKey]) stayGroups[stayKey] = [];
        stayGroups[stayKey].push(booking);
      }
    }
    Object.keys(stayGroups).forEach(function (stayKey) {
      var members = stayGroups[stayKey];
      if (!members || members.length < 2) return;
      var source = preferredPaymentSource(members);
      if (!source) return;
      for (var s = 0; s < members.length; s++) {
        if (members[s] === source) continue;
        var before =
          String(members[s].status || "") + "|" + String(members[s].paymentVerifiedAt || "");
        copyPaymentApprovalFields(source, members[s]);
        var after =
          String(members[s].status || "") + "|" + String(members[s].paymentVerifiedAt || "");
        if (before !== after) {
          changed = true;
          persistRepairedPrimaryMembers([members[s]]);
        }
      }
    });
    return changed;
  }

  function persistRepairedPrimaryMembers(members) {
    (members || []).forEach(function (booking) {
      if (!booking || isLinkedFacilityRow(booking)) return;
      if (!bookingHasPaymentDecision(booking)) return;
      var email = normalizeEmail(booking.email);
      if (!email) return;
      persistRow(email, booking, { skipProofUpload: true, skipAvailabilityRefresh: true });
    });
  }

  var VERIFIED_STORE_KEY = "elenest_verified_bookings";

  function stayKeyFor(booking, email) {
    return (
      normalizeEmail((booking && booking.email) || email || "") +
      "|" +
      String((booking && booking.checkIn) || "") +
      "|" +
      String((booking && booking.checkOut) || "")
    );
  }

  function readVerifiedStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(VERIFIED_STORE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeVerifiedStore(map) {
    try {
      localStorage.setItem(VERIFIED_STORE_KEY, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function rememberVerifiedBooking(booking, email) {
    if (!booking) return;
    if (
      !bookingHasPaymentDecision(booking) &&
      !booking.paymentRejectedAt &&
      !booking.payment_rejected_at
    ) {
      return;
    }
    var rec = {
      id: booking.id || "",
      status: booking.status || "Reserved",
      paymentStatus: booking.paymentStatus || "Down Payment Received",
      paymentVerifiedAt: booking.paymentVerifiedAt || booking.payment_verified_at || "",
      paymentRejectedAt: booking.paymentRejectedAt || booking.payment_rejected_at || "",
      paymentVerifiedBy: booking.paymentVerifiedBy || "",
      verificationStage: booking.verificationStage || "approved",
      workflow: booking.workflow || "approved",
      holdExpiresAt: booking.holdExpiresAt || null,
      arrivalStatus: booking.arrivalStatus || "",
      checkedInAt: booking.checkedInAt || "",
      paymentType: booking.paymentType || "down",
      email: normalizeEmail(email || booking.email || ""),
      checkIn: booking.checkIn || "",
      checkOut: booking.checkOut || ""
    };
    var map = readVerifiedStore();
    [booking.id, getBookingGroupId(booking), stayKeyFor(booking, rec.email)].forEach(function (k) {
      if (k && String(k).indexOf("||") !== 0 && String(k).slice(-1) !== "|") {
        map[String(k)] = rec;
      }
    });
    writeVerifiedStore(map);
  }

  function findRememberedVerification(booking, email) {
    if (!booking) return null;
    var map = readVerifiedStore();
    var keys = [booking.id, getBookingGroupId(booking), stayKeyFor(booking, email || booking.email)];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && map[String(keys[i])]) return map[String(keys[i])];
    }
    return null;
  }

  function applyRememberedVerification(booking, email) {
    if (!booking) return booking;
    var rec = findRememberedVerification(booking, email);
    if (!rec) return booking;
    if (rec.paymentRejectedAt) {
      booking.paymentRejectedAt = rec.paymentRejectedAt;
      booking.status = "Rejected";
      booking.paymentStatus = rec.paymentStatus || "Rejected";
      booking.verificationStage = "rejected";
      delete booking.verificationExpiresAt;
      return booking;
    }
    if (!booking.paymentVerifiedAt) booking.paymentVerifiedAt = rec.paymentVerifiedAt;
    if (!booking.paymentVerifiedBy && rec.paymentVerifiedBy) {
      booking.paymentVerifiedBy = rec.paymentVerifiedBy;
    }
    booking.verificationStage = pickLaterWorkflow(booking.verificationStage, rec.verificationStage);
    booking.workflow = pickLaterWorkflow(booking.workflow, rec.workflow);
    booking.paymentStatus = pickLaterPaymentStatus(booking.paymentStatus, rec.paymentStatus);
    booking.status = pickLaterStatus(booking.status, rec.status);
    var stNow = String(booking.status || "").toLowerCase();
    if (
      booking.paymentVerifiedAt &&
      (stNow === "for verification" || stNow === "pending" || stNow === "pending payment verification")
    ) {
      booking.status =
        String(booking.paymentType || rec.paymentType || "").toLowerCase() === "full"
          ? "Confirmed"
          : "Reserved";
      booking.verificationStage = booking.verificationStage || "approved";
    }
    if (booking.paymentVerifiedAt) {
      delete booking.verificationExpiresAt;
      if (String(booking.paymentStatus || "").toLowerCase().indexOf("for verification") !== -1) {
        booking.paymentStatus = rec.paymentStatus || booking.paymentStatus;
      }
    }
    if (rec.holdExpiresAt && !booking.holdExpiresAt) booking.holdExpiresAt = rec.holdExpiresAt;
    if (rec.arrivalStatus) booking.arrivalStatus = rec.arrivalStatus;
    if (rec.checkedInAt && !booking.checkedInAt) booking.checkedInAt = rec.checkedInAt;
    applyDownPaymentHoldShape(booking);
    return booking;
  }

  var HIDDEN_STORE_KEY = "elenest_hidden_appointments";

  function readHiddenStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(HIDDEN_STORE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeHiddenStore(map) {
    try {
      localStorage.setItem(HIDDEN_STORE_KEY, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function rememberHiddenAppointment(booking, email) {
    if (!booking) return;
    var rec = {
      id: booking.id || "",
      hiddenAt: new Date().toISOString(),
      checkIn: booking.checkIn || "",
      checkOut: booking.checkOut || ""
    };
    var map = readHiddenStore();
    [booking.id, getBookingGroupId(booking), stayKeyFor(booking, email || booking.email)].forEach(function (k) {
      if (k && String(k).indexOf("||") !== 0 && String(k).slice(-1) !== "|") {
        map[String(k)] = rec;
      }
    });
    writeHiddenStore(map);
  }

  function isHiddenFromCustomerAppointments(booking, email) {
    if (!booking) return true;
    if (booking.customerRemovedAt) return true;
    var map = readHiddenStore();
    var keys = [booking.id, getBookingGroupId(booking), stayKeyFor(booking, email || booking.email)];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && map[String(keys[i])]) return true;
    }
    var name = String(booking.fullName || "")
      .trim()
      .toLowerCase();
    var ci = String(booking.checkIn || "").slice(0, 10);
    var co = String(booking.checkOut || "").slice(0, 10);
    var submitted = String(booking.submittedAt || "").slice(0, 10);
    // One-time hide of the stuck Joan Briones verification card (Sep 18–19, 2026).
    if (name === "joan briones" && ci === "2026-09-18" && co === "2026-09-19") {
      if (!submitted || submitted === "2026-09-15") return true;
    }
    return false;
  }

  function applyPaymentVerifiedPayload(payload) {
    if (!payload) return;
    var fake = {
      id: payload.id,
      email: payload.email,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      status: payload.status || "Reserved",
      paymentStatus: payload.paymentStatus || "",
      paymentVerifiedAt: payload.paymentVerifiedAt || new Date().toISOString(),
      paymentVerifiedBy: payload.paymentVerifiedBy || "",
      verificationStage: payload.verificationStage || "approved",
      workflow: payload.workflow || "approved",
      holdExpiresAt: payload.holdExpiresAt || null,
      arrivalStatus: payload.arrivalStatus || "",
      checkedInAt: payload.checkedInAt || "",
      paymentType: payload.paymentType || "down"
    };
    rememberVerifiedBooking(fake, payload.email);
    var stay = stayKeyFor(fake, payload.email);
    var gid = getBookingGroupId(fake);
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      (cache[email] || []).forEach(function (b) {
        if (!b) return;
        if (
          (payload.id && String(b.id) === String(payload.id)) ||
          (gid && getBookingGroupId(b) === gid) ||
          (stay && stayKeyFor(b, email) === stay)
        ) {
          copyPaymentApprovalFields(fake, b);
          applyRememberedVerification(b, email);
        }
      });
    }
    emitUpdated();
  }

  function broadcastPaymentVerified(booking, email) {
    rememberVerifiedBooking(booking, email);
    if (!broadcastChannel) setupRealtimeAvailability();
    if (!broadcastChannel) return;
    try {
      broadcastChannel.send({
        type: "broadcast",
        event: "payment-verified",
        payload: {
          id: booking && booking.id,
          email: normalizeEmail(email || (booking && booking.email) || ""),
          checkIn: booking && booking.checkIn,
          checkOut: booking && booking.checkOut,
          status: booking && booking.status,
          paymentStatus: booking && booking.paymentStatus,
          paymentVerifiedAt: booking && booking.paymentVerifiedAt,
          paymentVerifiedBy: booking && booking.paymentVerifiedBy,
          verificationStage: (booking && booking.verificationStage) || "approved",
          workflow: (booking && booking.workflow) || "approved",
          holdExpiresAt: booking && booking.holdExpiresAt,
          arrivalStatus: booking && booking.arrivalStatus,
          checkedInAt: booking && booking.checkedInAt,
          paymentType: booking && booking.paymentType
        }
      });
    } catch (e) {}
  }

  function resolvePrimaryEntry(id) {
    var entry = findEntryById(id);
    if (!entry) return null;
    var b = entry.booking;
    if (!isLinkedFacilityRow(b)) return entry;
    var gid = getBookingGroupId(b);
    var members = listGroupMembers(gid);
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (m && !isLinkedFacilityRow(m)) {
        return findEntryById(m.id) || entry;
      }
    }
    return findEntryById(gid) || entry;
  }

  function applyBookingRowToCache(row, skipEmit) {
    if (!row || !row.id) return;
    if (isHistoricalId(row.id) || isHistoricalBooking(row)) return;
    var booking = rowToBooking(row);
    var user = getCurrentUserFromAuth();
    var existing = findEntryById(row.id);
    var email = normalizeEmail(row.user_email || booking.email);
    if (!email && existing) email = existing.accountEmail;
    if (!email && user && user.email) email = normalizeEmail(user.email);
    if (!email) return;
    if (user && !isStaffUser(user)) {
      var mine = normalizeEmail(user.email);
      var sameEmail = email === mine || (existing && existing.accountEmail === mine);
      var sameUser =
        !!(user.id && booking.userId && String(booking.userId) === String(user.id)) ||
        !!(existing && existing.booking && String(existing.booking.userId || "") === String(user.id));
      if (!sameEmail && !sameUser) return;
      if (existing && existing.accountEmail === mine) email = mine;
    }
    if (existing) {
      booking = mergeBookingPreferringLater(existing.booking, booking);
      if (existing.accountEmail !== email) {
        cache[existing.accountEmail].splice(existing.index, 1);
        if (!Array.isArray(cache[email])) cache[email] = [];
        cache[email].push(booking);
      } else {
        cache[existing.accountEmail][existing.index] = booking;
      }
    } else {
      if (!Array.isArray(cache[email])) cache[email] = [];
      cache[email].push(booking);
    }
    syncGroupPaymentState(getBookingGroupId(booking));
    if (!skipEmit) emitUpdated();
  }

  function normalizeDateField(val) {
    if (!val) return "";
    var s = String(val);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  }

  function canonicalizeUnitId(unitId) {
    var id = String(unitId || "").trim();
    if (!id) return "";
    var m = id.match(/^def-room-(small|big|couple)-(\d+)$/i);
    if (m) return String(m[1]).toLowerCase() + "-room-" + m[2];
    return id;
  }

  function mapRoomIdToUnitFields(roomId) {
    var id = canonicalizeUnitId(roomId);
    var lower = id.toLowerCase();
    if (!id || lower === "none") {
      return {
        roomCatalogId: "",
        cottageCatalogIds: [],
        hallCatalogId: "",
        roomType: "",
        cottageQty: 0,
        eventHall: ""
      };
    }

    // Prefer live catalog type (matches mobile room_id / room_catalog.id)
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.getCatalog === "function") {
      var found = UA.getCatalog().find(function (u) {
        return String(u.id) === id || String(u.id).toLowerCase() === lower;
      });
      if (found) {
        var fType = String(found.type || "room").toLowerCase();
        if (fType === "cottage") {
          return {
            roomCatalogId: "",
            cottageCatalogIds: [String(found.id)],
            hallCatalogId: "",
            roomType: "",
            cottageQty: 1,
            eventHall: ""
          };
        }
        if (fType === "hall") {
          return {
            roomCatalogId: "",
            cottageCatalogIds: [],
            hallCatalogId: String(found.id),
            roomType: "",
            cottageQty: 0,
            eventHall: String(found.id)
          };
        }
        return {
          roomCatalogId: String(found.id),
          cottageCatalogIds: [],
          hallCatalogId: "",
          roomType: found.roomKind || "",
          cottageQty: 0,
          eventHall: ""
        };
      }
    }

    if (lower === "small" || lower === "couple" || lower === "big") {
      return {
        roomCatalogId: "",
        cottageCatalogIds: [],
        hallCatalogId: "",
        roomType: lower,
        cottageQty: 0,
        eventHall: ""
      };
    }
    if (lower.indexOf("cottage") === 0 || lower.indexOf("cot-") === 0) {
      return {
        roomCatalogId: "",
        cottageCatalogIds: [id],
        hallCatalogId: "",
        roomType: "",
        cottageQty: 1,
        eventHall: ""
      };
    }
    if (lower.indexOf("hall") === 0 || lower.indexOf("fac-") === 0) {
      var looksHall =
        lower.indexOf("hall") === 0 ||
        lower.indexOf("poolside") !== -1 ||
        lower.indexOf("function") !== -1;
      if (looksHall || lower.indexOf("hall") !== -1) {
        return {
          roomCatalogId: "",
          cottageCatalogIds: [],
          hallCatalogId: id,
          roomType: "",
          cottageQty: 0,
          eventHall: id
        };
      }
    }
    return {
      roomCatalogId: id,
      cottageCatalogIds: [],
      hallCatalogId: "",
      roomType: "",
      cottageQty: 0,
      eventHall: ""
    };
  }

  function explicitPaymentVerifiedAt(row) {
    if (!row) return "";
    var payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    return (
      row.payment_verified_at ||
      row.paymentVerifiedAt ||
      payload.paymentVerifiedAt ||
      payload.payment_verified_at ||
      ""
    );
  }

  function rowCalendarPaymentVerified(row) {
    if (!row) return false;
    if (row.paymentRejectedAt || row.payment_rejected_at) return false;
    var payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    if (payload.paymentRejectedAt || payload.payment_rejected_at) return false;
    if (explicitPaymentVerifiedAt(row)) return true;
    if (row.payment_verified === false || row.paymentVerified === false || payload.paymentVerified === false) {
      return false;
    }
    if (row.payment_verified === true || row.paymentVerified === true || payload.paymentVerified === true) {
      return true;
    }
    if (row.walkIn === true || payload.walkIn === true) return true;
    var st = String(row.status || payload.status || "").trim().toLowerCase();
    var wf = String(row.workflow || payload.workflow || payload.mobileWorkflow || "").trim().toLowerCase();
    var stage = String(
      row.verificationStage || row.verification_stage || payload.verificationStage || payload.verification_stage || ""
    )
      .trim()
      .toLowerCase();
    if (
      wf === "awaiting_booking_review" ||
      wf === "awaiting_payment" ||
      wf === "pending_payment" ||
      wf === "pending_verification" ||
      wf === "pending" ||
      st === "pending" ||
      st === "awaiting payment" ||
      st === "awaiting_payment" ||
      st === "for verification" ||
      st === "pending payment verification" ||
      stage === "awaiting_booking_review" ||
      stage === "awaiting_payment" ||
      stage === "awaiting_admin"
    ) {
      return false;
    }
    if (
      wf === "confirmed" ||
      wf === "approved" ||
      wf === "checked_in" ||
      wf === "verified_by_receptionist" ||
      stage === "approved" ||
      st === "confirmed" ||
      st === "reserved" ||
      st === "approved" ||
      st === "active" ||
      st === "checked in" ||
      st === "checked_in" ||
      st === "checked out" ||
      st === "checked_out" ||
      st === "completed"
    ) {
      return true;
    }
    return false;
  }

  function mapMobilePaymentType(raw) {
    var s = String(raw || "").toLowerCase();
    if (s.indexOf("full") !== -1) return "full";
    return "down";
  }

  function mapMobilePublicStatus(row) {
    var st = String(row.status || "").trim().toLowerCase();
    var wf = String(row.workflow || "").trim().toLowerCase();
    var notes = String(row.notes || "");
    if (st === "rejected" || wf === "rejected") return "Rejected";
    if (st === "cancelled" || st === "canceled" || wf === "cancelled") return "Cancelled";
    if (st === "no show" || st === "no_show" || st === "noshow") return "No Show";
    if (
      st === "checked out" ||
      st === "checked_out" ||
      wf === "checked_out" ||
      st === "completed"
    ) {
      return "Checked Out";
    }
    if (st === "checked in" || st === "checked_in" || wf === "checked_in") {
      return "Checked In";
    }
    if (st === "reserved" || wf === "reserved") return "Reserved";
    var ptype = mapMobilePaymentType(row.payment_type || row.paymentType);
    if (wf === "approved") {
      return ptype === "full" ? "Confirmed" : "Reserved";
    }
    if (
      wf === "confirmed" ||
      wf === "verified_by_receptionist" ||
      st === "confirmed" ||
      st === "approved" ||
      st === "active"
    ) {
      return "Confirmed";
    }
    if (
      wf === "pending_payment" ||
      wf === "pending_verification" ||
      st === "for verification" ||
      st === "pending payment verification" ||
      notes.indexOf("__payment_status__:pending") !== -1 ||
      notes.indexOf("Proof:") !== -1
    ) {
      return "For Verification";
    }
    if (wf === "awaiting_booking_review") return "Pending";
    if (wf === "awaiting_payment" || st === "awaiting payment" || st === "awaiting_payment") {
      return "Awaiting Payment";
    }
    if (st === "pending" || wf === "pending") return "Reserved";
    return row.status || "Reserved";
  }

  /** Normalize mobile + website public availability RPC / table rows into one shape. */
  function normalizePublicAvailabilityRow(row) {
    if (!row) return null;
    // Mobile / existing live RPC: { id, room_id, check_in, check_out, status, workflow, ... }
    if (row.room_id != null || row.workflow != null || row.room_ids != null) {
      // Trust Supabase/mobile public RPC: room_ids[] lists every booked facility.
      var multiIds = coerceFacilityIdList(row);
      var split = multiIds.length ? splitFacilityIdsByType(multiIds) : null;
      var units = split
        ? {
            roomCatalogId: split.roomCatalogIds[0] || "",
            roomCatalogIds: split.roomCatalogIds,
            cottageCatalogIds: split.cottageCatalogIds,
            hallCatalogId: split.hallCatalogIds[0] || "",
            hallCatalogIds: split.hallCatalogIds,
            roomType: "",
            cottageQty: split.cottageCatalogIds.length,
            eventHall: split.hallCatalogIds[0] || ""
          }
        : mapRoomIdToUnitFields(row.room_id);
      if (!units.roomCatalogIds) {
        units.roomCatalogIds = units.roomCatalogId ? [units.roomCatalogId] : [];
      }
      if (!units.hallCatalogIds) {
        units.hallCatalogIds = units.hallCatalogId ? [units.hallCatalogId] : [];
      }
      var facilityIds = uniqueCanonicalIds(
        multiIds
          .concat(units.roomCatalogIds || [])
          .concat(units.cottageCatalogIds || [])
          .concat(units.hallCatalogIds || [])
      );
      var status = mapMobilePublicStatus(row);
      var paymentType = mapMobilePaymentType(row.payment_type);
      var notes = String(row.notes || "");
      var hasProof =
        notes.indexOf("Proof:") !== -1 ||
        notes.indexOf("__payment_status__") !== -1 ||
        notes.indexOf("payment_proof") !== -1;
      var calendarVerified = rowCalendarPaymentVerified(row);
      var explicitVerified = explicitPaymentVerifiedAt(row);
      return {
        id: row.id || "",
        check_in: row.check_in,
        check_out: row.check_out,
        status: status,
        workflow: row.workflow || (row.payload && row.payload.workflow) || "",
        verification_stage:
          row.verificationStage ||
          row.verification_stage ||
          (row.payload && (row.payload.verificationStage || row.payload.verification_stage)) ||
          "",
        walkIn: row.walkIn === true || (row.payload && row.payload.walkIn === true),
        payment_type: paymentType,
        hold_expires_at: row.hold_expires_at || null,
        payment_verified_at: calendarVerified ? explicitVerified || null : null,
        payment_verified: calendarVerified,
        payment_rejected_at: row.payment_rejected_at || row.paymentRejectedAt || null,
        slot_locked:
          status === "Confirmed" ||
          status === "Reserved" ||
          status === "For Verification",
        paymentProof: hasProof ? "mobile-proof" : "",
        hasPaymentProof: hasProof,
        room_catalog_id: units.roomCatalogId,
        room_catalog_ids: units.roomCatalogIds || [],
        cottage_catalog_ids: units.cottageCatalogIds,
        hall_catalog_id: units.hallCatalogId,
        hall_catalog_ids: units.hallCatalogIds || [],
        room_ids: facilityIds,
        room_type: units.roomType,
        cottage_qty: units.cottageQty,
        event_hall: units.eventHall,
        payload: {
          roomCatalogId: units.roomCatalogId,
          roomCatalogIds: units.roomCatalogIds || [],
          cottageCatalogIds: units.cottageCatalogIds,
          hallCatalogId: units.hallCatalogId,
          hallCatalogIds: units.hallCatalogIds || [],
          facilityIds: facilityIds,
          room_ids: facilityIds,
          roomType: units.roomType,
          cottageQty: units.cottageQty,
          eventHall: units.eventHall,
          paymentType: paymentType,
          status: status,
          workflow: row.workflow || (row.payload && row.payload.workflow) || "",
          verificationStage:
            row.verificationStage ||
            row.verification_stage ||
            (row.payload && (row.payload.verificationStage || row.payload.verification_stage)) ||
            "",
          paymentVerified: calendarVerified,
          paymentVerifiedAt: calendarVerified ? explicitVerified || null : null,
          walkIn: row.walkIn === true || (row.payload && row.payload.walkIn === true),
          slotLocked: true,
          hasPaymentProof: hasProof,
          paymentProof: hasProof ? "mobile-proof" : "",
          mobileRoomId: row.room_id,
          mobileWorkflow: row.workflow,
          notes: notes
        }
      };
    }
    return row;
  }

  function uniqueCanonicalIds(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (raw) {
      var id = canonicalizeUnitId(raw);
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function splitFacilityIdsByType(ids) {
    var roomCatalogIds = [];
    var cottageCatalogIds = [];
    var hallCatalogIds = [];
    var UA = window.ElenestUnitAvailability;
    var catalog = UA && typeof UA.getCatalog === "function" ? UA.getCatalog() : [];
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    uniqueCanonicalIds(ids).forEach(function (id) {
      var unit = byId[id];
      if (unit) {
        var t = String(unit.type || "room").toLowerCase();
        if (t === "cottage") cottageCatalogIds.push(id);
        else if (t === "hall") hallCatalogIds.push(id);
        else roomCatalogIds.push(id);
        return;
      }
      var mapped = mapRoomIdToUnitFields(id);
      if (mapped.cottageCatalogIds && mapped.cottageCatalogIds.length) {
        cottageCatalogIds = cottageCatalogIds.concat(mapped.cottageCatalogIds);
      } else if (mapped.hallCatalogId) {
        hallCatalogIds.push(mapped.hallCatalogId);
      } else if (mapped.roomCatalogId) {
        roomCatalogIds.push(mapped.roomCatalogId);
      }
    });
    return {
      roomCatalogIds: uniqueCanonicalIds(roomCatalogIds),
      cottageCatalogIds: uniqueCanonicalIds(cottageCatalogIds),
      hallCatalogIds: uniqueCanonicalIds(hallCatalogIds)
    };
  }

  function extractUnitFields(row) {
    var payload = parsePayload(row);
    var fromRoomId =
      row.room_id || payload.room_id || payload.mobileRoomId
        ? mapRoomIdToUnitFields(row.room_id || payload.room_id || payload.mobileRoomId)
        : null;

    var roomCatalogIds = uniqueCanonicalIds(
      []
        .concat(parseJsonArray(row.room_catalog_ids || row.roomCatalogIds || payload.roomCatalogIds || payload.room_catalog_ids))
        .concat(
          row.room_catalog_id || row.roomCatalogId || payload.roomCatalogId || payload.room_catalog_id
            ? [row.room_catalog_id || row.roomCatalogId || payload.roomCatalogId || payload.room_catalog_id]
            : []
        )
        .concat(fromRoomId && fromRoomId.roomCatalogId ? [fromRoomId.roomCatalogId] : [])
    );

    var cottageCatalogIds = uniqueCanonicalIds(
      []
        .concat(
          parseJsonArray(
            row.cottage_catalog_ids ||
              row.cottageCatalogIds ||
              payload.cottageCatalogIds ||
              payload.cottage_catalog_ids ||
              (fromRoomId && fromRoomId.cottageCatalogIds)
          )
        )
    );

    var hallCatalogIds = uniqueCanonicalIds(
      []
        .concat(parseJsonArray(row.hall_catalog_ids || row.hallCatalogIds || payload.hallCatalogIds || payload.hall_catalog_ids))
        .concat(
          row.hall_catalog_id || row.hallCatalogId || payload.hallCatalogId || payload.hall_catalog_id
            ? [row.hall_catalog_id || row.hallCatalogId || payload.hallCatalogId || payload.hall_catalog_id]
            : []
        )
        .concat(fromRoomId && fromRoomId.hallCatalogId ? [fromRoomId.hallCatalogId] : [])
    );

    var multiIds = uniqueCanonicalIds(
      []
        .concat(coerceFacilityIdList(row))
        .concat(roomCatalogIds)
        .concat(cottageCatalogIds)
        .concat(hallCatalogIds)
    );

    if (
      multiIds.length &&
      (!roomCatalogIds.length || !cottageCatalogIds.length || !hallCatalogIds.length)
    ) {
      var split = splitFacilityIdsByType(multiIds);
      if (!roomCatalogIds.length) roomCatalogIds = split.roomCatalogIds;
      if (!cottageCatalogIds.length) cottageCatalogIds = split.cottageCatalogIds;
      if (!hallCatalogIds.length) hallCatalogIds = split.hallCatalogIds;
    }

    var facilityIds = uniqueCanonicalIds(
      multiIds.concat(roomCatalogIds).concat(cottageCatalogIds).concat(hallCatalogIds)
    );

    return {
      roomCatalogId: roomCatalogIds[0] || "",
      roomCatalogIds: roomCatalogIds,
      cottageCatalogIds: cottageCatalogIds,
      hallCatalogId: hallCatalogIds[0] || "",
      hallCatalogIds: hallCatalogIds,
      facilityIds: facilityIds,
      room_ids: facilityIds.slice(),
      roomType:
        row.room_type ||
        row.roomType ||
        payload.roomType ||
        (fromRoomId && fromRoomId.roomType) ||
        "",
      cottageQty:
        row.cottage_qty != null
          ? row.cottage_qty
          : payload.cottageQty != null
            ? payload.cottageQty
            : cottageCatalogIds.length || (fromRoomId ? fromRoomId.cottageQty : 0),
      eventHall:
        row.event_hall ||
        row.eventHall ||
        payload.eventHall ||
        (fromRoomId && fromRoomId.eventHall) ||
        "",
      capacityTotal:
        payload.capacityTotal != null
          ? Number(payload.capacityTotal)
          : row.capacity_total != null
            ? Number(row.capacity_total)
            : null
    };
  }

  function rowToAvailabilityBooking(row) {
    if (!row) return null;
    row = normalizePublicAvailabilityRow(row) || row;
    var checkIn = normalizeDateField(row.check_in || row.checkIn);
    var checkOut = normalizeDateField(row.check_out || row.checkOut);
    if (!checkIn || !checkOut) return null;
    var units = extractUnitFields(row);
    var payload = parsePayload(row);
    return {
      id: row.id || "",
      checkIn: checkIn,
      checkOut: checkOut,
      checkInTime:
        row.checkInTime ||
        row.check_in_time ||
        payload.checkInTime ||
        payload.check_in_time ||
        "",
      checkOutTime:
        row.checkOutTime ||
        row.check_out_time ||
        payload.checkOutTime ||
        payload.check_out_time ||
        "",
      status: row.status || payload.status || "Pending",
      workflow: row.workflow || payload.workflow || payload.mobileWorkflow || "",
      verificationStage:
        row.verificationStage ||
        row.verification_stage ||
        payload.verificationStage ||
        payload.verification_stage ||
        "",
      walkIn: row.walkIn === true || row.walk_in === true || payload.walkIn === true,
      paymentType: row.payment_type || row.paymentType || payload.paymentType || "down",
      holdExpiresAt: row.hold_expires_at || row.holdExpiresAt || payload.holdExpiresAt || null,
      paymentVerified:
        row.payment_verified === true ||
        row.paymentVerified === true ||
        payload.paymentVerified === true,
      paymentVerifiedAt: row.payment_verified_at || row.paymentVerifiedAt || payload.paymentVerifiedAt || null,
      paymentRejectedAt: row.payment_rejected_at || row.paymentRejectedAt || payload.paymentRejectedAt || null,
      slotLocked:
        row.slot_locked === true ||
        row.slotLocked === true ||
        payload.slotLocked === true,
      paymentProof: "",
      hasPaymentProof:
        row.hasPaymentProof === true ||
        payload.hasPaymentProof === true ||
        !!(row.paymentProofUrl || payload.paymentProofUrl || row.paymentProof || payload.paymentProof),
      room_id:
        units.roomCatalogId ||
        (units.cottageCatalogIds && units.cottageCatalogIds[0]) ||
        units.hallCatalogId ||
        row.room_id ||
        payload.room_id ||
        "",
      roomCatalogId: units.roomCatalogId,
      roomCatalogIds: units.roomCatalogIds || (units.roomCatalogId ? [units.roomCatalogId] : []),
      cottageCatalogIds: units.cottageCatalogIds,
      hallCatalogId: units.hallCatalogId,
      hallCatalogIds: units.hallCatalogIds || (units.hallCatalogId ? [units.hallCatalogId] : []),
      facilityIds: units.facilityIds || [],
      room_ids: units.room_ids || units.facilityIds || [],
      roomType: units.roomType,
      cottageQty: units.cottageQty,
      eventHall: units.eventHall,
      capacityTotal: units.capacityTotal,
      _dateOnlyOccupancy: row._dateOnlyOccupancy === true
    };
  }

  function bookingRecordToAvailabilityBooking(booking) {
    if (!booking) return null;
    return rowToAvailabilityBooking(
      Object.assign({}, booking, {
        check_in: booking.checkIn,
        check_out: booking.checkOut,
        checkInTime: booking.checkInTime,
        checkOutTime: booking.checkOutTime,
        payment_type: booking.paymentType,
        hold_expires_at: booking.holdExpiresAt,
        payment_verified_at: booking.paymentVerifiedAt,
        payment_rejected_at: booking.paymentRejectedAt,
        room_catalog_id: booking.roomCatalogId,
        room_catalog_ids: booking.roomCatalogIds,
        cottage_catalog_ids: booking.cottageCatalogIds,
        hall_catalog_id: booking.hallCatalogId,
        hall_catalog_ids: booking.hallCatalogIds,
        room_ids: booking.room_ids || booking.facilityIds,
        room_type: booking.roomType,
        cottage_qty: booking.cottageQty,
        event_hall: booking.eventHall,
        payload: booking
      })
    );
  }

  function rebuildAvailabilityFromRows(rows, opts) {
    opts = opts || {};
    var trustServer = opts.trustServer === true;
    var prevById = {};
    availabilityBookings.forEach(function (existing) {
      if (existing && existing.id) prevById[existing.id] = existing;
    });
    // Also pull fuller multi-facility lists from local cache / occupancy when available.
    try {
      occupancyRows.forEach(function (ob) {
        if (!ob || !ob.id || prevById[ob.id]) return;
        var shaped = bookingRecordToAvailabilityBooking(ob);
        if (shaped) prevById[ob.id] = shaped;
      });
    } catch (eOcc) {}

    var fromServer = [];
    (rows || []).forEach(function (row) {
      var b = rowToAvailabilityBooking(row);
      if (!b) return;
      // Public RPC already decided which bookings block the calendar (mobile + website).
      if (!trustServer) {
        var PF = window.ElenestPaymentFlow;
        if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
          if (!PF.bookingBlocksCalendarSlot(b)) return;
        }
      } else {
        // Only drop clearly cancelled/rejected rows if status sneaks through
        var st = String(b.status || "").toLowerCase();
        if (
          st === "cancelled" ||
          st === "canceled" ||
          st === "rejected" ||
          st === "no show" ||
          st === "no_show" ||
          st === "completed"
        ) {
          return;
        }
        b.slotLocked = true;
      }

      // If server/RPC returned fewer facility ids than a known local copy, keep the union
      // so multi-facility bookings stay fully marked unavailable on the public calendar.
      var prev = b.id ? prevById[b.id] : null;
      if (prev) {
        var serverFacilityIds = collectBookingFacilityIds(b);
        var localFacilityIds = collectBookingFacilityIds(prev);
        if (localFacilityIds.length > serverFacilityIds.length) {
          applyFacilityIdsToBookingShape(b, serverFacilityIds.concat(localFacilityIds));
        } else if (serverFacilityIds.length) {
          applyFacilityIdsToBookingShape(b, serverFacilityIds);
        }
      } else if (collectBookingFacilityIds(b).length) {
        applyFacilityIdsToBookingShape(b, collectBookingFacilityIds(b));
      }

      fromServer.push(b);
    });

    var serverIds = {};
    fromServer.forEach(function (b) {
      serverIds[b.id] = true;
    });

    fromServer.forEach(function (b) {
      if (b && b.id) delete optimisticAvailability[b.id];
    });

    var now = Date.now();
    var PF2 = window.ElenestPaymentFlow;
    availabilityBookings.forEach(function (existing) {
      if (!existing || !existing.id || serverIds[existing.id]) return;
      var optimisticAt = optimisticAvailability[existing.id];
      if (!optimisticAt || now - optimisticAt > 90000) {
        delete optimisticAvailability[existing.id];
        return;
      }
      if (PF2 && typeof PF2.bookingBlocksCalendarSlot === "function") {
        if (!PF2.bookingBlocksCalendarSlot(existing)) return;
      }
      fromServer.push(existing);
    });

    availabilityBookings = fromServer;
  }

  function lookupUnitType(unitId) {
    var uid = String(unitId || "");
    if (!uid) return "";
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.getCatalog === "function") {
      var found = UA.getCatalog().find(function (u) {
        return String(u.id) === uid;
      });
      if (found) return String(found.type || "room");
    }
    if (uid.indexOf("cottage") === 0) return "cottage";
    if (uid.indexOf("hall") === 0) return "hall";
    return "room";
  }

  function slotsToAvailabilityRows(slots) {
    var byBooking = {};
    (slots || []).forEach(function (slot) {
      if (!slot || !slot.booking_id) return;
      var id = slot.booking_id;
      if (!byBooking[id]) {
        byBooking[id] = {
          id: id,
          check_in: slot.check_in,
          check_out: slot.check_out,
          status: slot.status || "Reserved",
          payment_type: "down",
          hold_expires_at: null,
          payment_verified_at: null,
          payment_rejected_at: null,
          slot_locked: slot.blocks_slot !== false,
          room_catalog_id: "",
          room_catalog_ids: [],
          cottage_catalog_ids: [],
          hall_catalog_id: "",
          hall_catalog_ids: [],
          room_ids: [],
          room_type: "",
          cottage_qty: 0,
          event_hall: ""
        };
      }
      var row = byBooking[id];
      var unitId = String(slot.unit_id || "");
      if (!unitId) return;
      if (row.room_ids.indexOf(unitId) === -1) row.room_ids.push(unitId);
      var type = lookupUnitType(unitId);
      if (type === "cottage") {
        if (row.cottage_catalog_ids.indexOf(unitId) === -1) {
          row.cottage_catalog_ids.push(unitId);
        }
        row.cottage_qty = row.cottage_catalog_ids.length;
      } else if (type === "hall") {
        if (row.hall_catalog_ids.indexOf(unitId) === -1) {
          row.hall_catalog_ids.push(unitId);
        }
        row.hall_catalog_id = row.hall_catalog_ids[0] || unitId;
        row.event_hall = row.hall_catalog_id;
      } else {
        if (row.room_catalog_ids.indexOf(unitId) === -1) {
          row.room_catalog_ids.push(unitId);
        }
        row.room_catalog_id = row.room_catalog_ids[0] || unitId;
      }
      if (slot.blocks_slot === false) row.slot_locked = false;
    });
    return Object.keys(byBooking).map(function (k) {
      return byBooking[k];
    });
  }

  function occupancyRpcToAvailabilityRows(rows) {
    return (rows || []).map(function (r, i) {
      var checkIn = normalizeDateField(r.check_in || r.checkIn);
      var checkOut = normalizeDateField(r.check_out || r.checkOut);
      return {
        id: r.id || "occ-" + i + "-" + checkIn + "-" + checkOut,
        check_in: checkIn,
        check_out: checkOut,
        status: r.status || "Reserved",
        payment_type: r.payment_type || r.paymentType || "down",
        hold_expires_at: r.hold_expires_at || r.holdExpiresAt || null,
        payment_verified_at: r.payment_verified_at || r.paymentVerifiedAt || null,
        payment_rejected_at: r.payment_rejected_at || r.paymentRejectedAt || null,
        slot_locked: true,
        room_catalog_id: "",
        cottage_catalog_ids: [],
        hall_catalog_id: "",
        room_type: "",
        cottage_qty: 0,
        event_hall: "",
        _dateOnlyOccupancy: true
      };
    });
  }

  function applyAvailabilitySource(rows, opts) {
    var list = (rows || []).filter(function (row) {
      if (!row) return false;
      if (isHistoricalId(row.id) || isHistoricalBooking(row)) return false;
      var checkIn = normalizeDateField(row.check_in || row.checkIn);
      var checkOut = normalizeDateField(row.check_out || row.checkOut);
      if (checkIn && checkOut && !isRecentOrUpcomingStay(checkIn, checkOut)) return false;
      var shaped = rowToAvailabilityBooking(row);
      var PF = window.ElenestPaymentFlow;
      if (
        shaped &&
        PF &&
        typeof PF.bookingBlocksCalendarSlot === "function" &&
        !PF.bookingBlocksCalendarSlot(shaped)
      ) {
        return false;
      }
      return true;
    });
    rebuildAvailabilityFromRows(list, {
      trustServer: !opts || opts.trustServer !== false
    });
    if (opts && opts.seedOccupancy) {
      occupancyRows = [];
      list.forEach(function (row) {
        var shaped = rowToAvailabilityBooking(row) || bookingRecordToAvailabilityBooking(row);
        if (shaped && shaped.checkIn && shaped.checkOut) {
          shaped.slotLocked = true;
          occupancyRows.push(shaped);
          return;
        }
        var checkIn = normalizeDateField(row.check_in || row.checkIn);
        var checkOut = normalizeDateField(row.check_out || row.checkOut);
        if (!checkIn || !checkOut) return;
        occupancyRows.push({
          id: row.id || "",
          checkIn: checkIn,
          checkOut: checkOut,
          status: row.status || "Reserved",
          paymentType: row.payment_type || "down",
          holdExpiresAt: row.hold_expires_at || null,
          slotLocked: true
        });
      });
    }
    emitUpdated();
    return true;
  }

  function localTodayIso() {
    var n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
  }

  function addDaysIso(iso, days) {
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 0));
    return utcDateToIso(d);
  }

  /** Apply mobile get_public_availability_snapshot rows (booked_room_ids[] per day). */
  function applyMobileAvailabilitySnapshot(rows) {
    var next = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var day = normalizeDateField(row.day || row.unavailable_date || row.date);
      if (!day) return;
      var ids = parseJsonArray(row.booked_room_ids || row.room_ids || row.facility_ids);
      if (!ids.length && row.room_id) ids = [row.room_id];
      if (!ids.length) return;
      if (!next[day]) next[day] = {};
      var pendingSet = {};
      parseJsonArray(row.pending_room_ids).forEach(function (raw) {
        var pendingId = canonicalizeUnitId(raw);
        if (pendingId) pendingSet[pendingId] = true;
      });
      ids.forEach(function (raw) {
        var id = canonicalizeUnitId(raw);
        if (!id) return;
        next[day][id] = pendingSet[id] ? "pending" : "booked";
      });
    });
    publicFacilityBlocksByDate = next;
  }

  function mergeFacilityBlocksForDate(iso, ids) {
    var day = normalizeDateField(iso);
    if (!day) return;
    if (!publicFacilityBlocksByDate[day]) publicFacilityBlocksByDate[day] = {};
    parseJsonArray(ids).forEach(function (raw) {
      var id = canonicalizeUnitId(raw);
      if (id) publicFacilityBlocksByDate[day][id] = true;
    });
  }

  function getBlockedFacilityIdsOnDate(iso) {
    var day = normalizeDateField(iso);
    var map = (day && publicFacilityBlocksByDate[day]) || {};
    return Object.keys(map);
  }

  function facilityBlockValue(unitId, iso) {
    var id = canonicalizeUnitId(unitId);
    var day = normalizeDateField(iso);
    if (!id || !day) return "";
    var map = publicFacilityBlocksByDate[day] || {};
    return map[id] || map[String(unitId || "").trim()] || "";
  }

  function isFacilityBlockedOnDate(unitId, iso) {
    return !!facilityBlockValue(unitId, iso);
  }

  function getFacilityBlockKindOnDate(unitId, iso) {
    var value = facilityBlockValue(unitId, iso);
    if (!value) return "";
    return value === "pending" ? "pending" : "booked";
  }

  function forEachBlockedFacilityInRange(checkIn, checkOut, fn) {
    if (!checkIn || !checkOut || typeof fn !== "function") return;
    var cur = isoToUtcDate(checkIn);
    var end = isoToUtcDate(checkOut);
    if (!(cur < end)) return;
    var seen = {};
    while (cur < end) {
      var iso = utcDateToIso(cur);
      getBlockedFacilityIdsOnDate(iso).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        fn(id, iso);
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  /** Same mobile RPC used by the app: unavailable facility ids for one night. */
  function prefetchUnavailableFacilitiesForRange(checkIn, checkOut) {
    var sb = getClient();
    if (!sb || !checkIn || !checkOut) return Promise.resolve([]);
    var nights = [];
    var cur = isoToUtcDate(checkIn);
    var end = isoToUtcDate(checkOut);
    while (cur < end) {
      nights.push(utcDateToIso(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (!nights.length) return Promise.resolve([]);
    return Promise.all(
      nights.map(function (day) {
        return sb
          .rpc("get_public_unavailable_facility_ids_for_date", { p_date: day })
          .then(function (res) {
            if (res.error) throw res.error;
            var ids = (res.data || [])
              .map(function (row) {
                return row && (row.room_id || row.facility_id || row.id || row);
              })
              .filter(Boolean);
            mergeFacilityBlocksForDate(day, ids);
            return { day: day, ids: ids };
          })
          .catch(function () {
            return { day: day, ids: getBlockedFacilityIdsOnDate(day) };
          });
      })
    ).then(function (parts) {
      emitUpdated();
      return parts;
    });
  }

  function loadMobileAvailabilitySnapshot() {
    var sb = getClient();
    if (!sb) return Promise.resolve(false);
    var from = addDaysIso(localTodayIso(), -14);
    var to = addDaysIso(localTodayIso(), 180);
    return sb
      .rpc("get_public_availability_snapshot", { p_from: from, p_to: to })
      .then(function (res) {
        if (res.error) throw res.error;
        applyMobileAvailabilitySnapshot(res.data || []);
        try {
          console.info(
            "[Elenest Bookings] Loaded mobile availability snapshot (" +
              (res.data || []).length +
              " day(s))"
          );
        } catch (e) {}
        return true;
      })
      .catch(function (err) {
        try {
          console.warn(
            "[Elenest Bookings] get_public_availability_snapshot failed:",
            err && err.message ? err.message : err
          );
        } catch (e) {}
        return false;
      });
  }

  var loadPublicAvailabilityPromise = null;
  var lastAvailabilityFingerprint = "";

  function loadPublicAvailability() {
    if (loadPublicAvailabilityPromise) return loadPublicAvailabilityPromise;
    var sb = getClient();
    if (!sb) return Promise.resolve();

    var bookingsP;
    if (isStaffUser(getCurrentUserFromAuth()) && listLiveCache().length) {
      rebuildAvailabilityFromOccupancyCache();
      syncOccupancyFromCache();
      bookingsP = Promise.resolve(true);
    } else {
      bookingsP = sb
        .rpc("get_public_availability_bookings")
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = (res.data || []).filter(function (row) {
            if (!row) return false;
            if (isHistoricalId(row.id)) return false;
            return isRecentOrUpcomingStay(row.check_in || row.checkIn, row.check_out || row.checkOut);
          });
          return applyAvailabilitySource(rows, {
            seedOccupancy: true,
            trustServer: true
          });
        })
        .catch(function (err) {
          try {
            console.warn(
              "[Elenest Bookings] get_public_availability_bookings failed:",
              err && err.message ? err.message : err
            );
          } catch (e) {}
          if (isStaffUser(getCurrentUserFromAuth())) {
            rebuildAvailabilityFromOccupancyCache();
            syncOccupancyFromCache();
          }
          return false;
        });
    }

    var snapshotP = loadMobileAvailabilitySnapshot();

    loadPublicAvailabilityPromise = Promise.all([bookingsP, snapshotP]).then(function () {
      pruneBlocksHeldOnlyByReleasedBookings();
      var fp = availabilityFingerprint();
      if (fp !== lastAvailabilityFingerprint) {
        lastAvailabilityFingerprint = fp;
        emitUpdated();
      }
      return true;
    }).then(function (ok) {
      loadPublicAvailabilityPromise = null;
      return ok;
    }, function () {
      loadPublicAvailabilityPromise = null;
    });
    return loadPublicAvailabilityPromise;
  }

  function getCurrentUserFromAuth() {
    return window.ElenestAuth && window.ElenestAuth.getCurrentUser
      ? window.ElenestAuth.getCurrentUser()
      : null;
  }

  function rebuildAvailabilityFromOccupancyCache() {
    availabilityBookings = [];
    listLive().forEach(function (item) {
      if (!item || !item.booking) return;
      if (isHistoricalBooking(item.booking)) return;
      var b = bookingRecordToAvailabilityBooking(item.booking);
      if (!b) return;
      var PF = window.ElenestPaymentFlow;
      if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
        if (!PF.bookingBlocksCalendarSlot(b)) return;
      }
      availabilityBookings.push(b);
    });
  }

  function listForAvailability() {
    var PF = window.ElenestPaymentFlow;
    function stillBlocks(b) {
      if (!b) return false;
      if (isHistoricalBooking(b)) return false;
      if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
        return PF.bookingBlocksCalendarSlot(b);
      }
      return true;
    }

    function normalizeListItem(b) {
      var shaped = bookingRecordToAvailabilityBooking(b) || b;
      return { accountEmail: "", booking: shaped };
    }

    if (isStaffUser(getCurrentUserFromAuth())) {
      var staffList = listLive().filter(function (item) {
        return item && item.booking && stillBlocks(item.booking);
      });
      var merged = availabilityBookings.filter(stillBlocks).map(normalizeListItem);
      var seen = {};
      merged.forEach(function (item) {
        if (item.booking && item.booking.id) seen[item.booking.id] = item;
      });
      staffList.forEach(function (item) {
        var shaped = normalizeListItem(item.booking);
        if (shaped.booking && shaped.booking.id) seen[shaped.booking.id] = shaped;
      });
      return Object.keys(seen).map(function (id) {
        return seen[id];
      });
    }

    return availabilityBookings.filter(stillBlocks).map(normalizeListItem);
  }

  function rowToBooking(row) {
    var payload = parsePayload(row);
    var booking = Object.assign({}, payload);
    booking.id = row.id;
    booking.workflow = pickLaterWorkflow(row.workflow, payload.workflow);
    booking.verificationStage = pickLaterWorkflow(
      row.verification_stage,
      payload.verificationStage || payload.verification_stage
    );
    booking.checkIn = row.check_in || booking.checkIn || "";
    booking.checkOut = row.check_out || booking.checkOut || "";
    booking.submittedAt = row.submitted_at || booking.submittedAt || new Date().toISOString();
    booking.requestedAt = row.requested_at || payload.requestedAt || booking.requestedAt || "";
    var guestQueueRole = payload.guestQueueRole || "";
    var guestQueueMessage = payload.guestQueueMessage || "";
    booking.queueRole = guestQueueRole || row.queue_role || payload.queueRole || "";
    booking.queueMessage = guestQueueMessage || row.queue_message || payload.queueMessage || "";
    if (row.queue_position != null && row.queue_position !== "") {
      booking.queuePosition = row.queue_position;
    } else if (payload.queuePosition != null && payload.queuePosition !== "") {
      booking.queuePosition = payload.queuePosition;
    }
    booking.queueRoomId = row.queue_room_id || payload.queueRoomId || booking.queueRoomId || "";
    booking.paymentStatus = pickLaterPaymentStatus(row.payment_status, payload.paymentStatus);
    booking.paymentType = row.payment_type || booking.paymentType || "down";
    booking.amountPaid = row.amount_paid != null ? row.amount_paid : booking.amountPaid;
    booking.balanceDue = row.balance_due != null ? row.balance_due : booking.balanceDue;
    booking.holdExpiresAt =
      row.hold_expires_at ||
      payload.holdExpiresAt ||
      payload.hold_expires_at ||
      booking.holdExpiresAt ||
      null;
    booking.arrivalStatus = row.arrival_status || booking.arrivalStatus || "not_arrived";
    booking.nonRefundable = row.non_refundable === true || booking.nonRefundable === true;
    if (Object.prototype.hasOwnProperty.call(row, "payment_verified_at")) {
      booking.paymentVerifiedAt =
        row.payment_verified_at ||
        payload.paymentVerifiedAt ||
        payload.payment_verified_at ||
        booking.paymentVerifiedAt ||
        "";
    } else {
      booking.paymentVerifiedAt =
        payload.paymentVerifiedAt || payload.payment_verified_at || booking.paymentVerifiedAt || "";
    }
    booking.paymentVerifiedBy = row.payment_verified_by || booking.paymentVerifiedBy || "";
    booking.paymentRejectedAt = row.payment_rejected_at || booking.paymentRejectedAt || "";
    booking.paymentRejectedBy = row.payment_rejected_by || booking.paymentRejectedBy || "";
    booking.paymentRejectionReason =
      row.payment_rejection_reason || booking.paymentRejectionReason || "";
    booking.paymentProofUrl = row.payment_proof_url || booking.paymentProofUrl || "";
    if (booking.paymentProofUrl) booking.hasPaymentProof = true;
    if (row.full_name && !booking.fullName) booking.fullName = row.full_name;
    if (row.phone && !booking.phone) booking.phone = row.phone;
    if (row.room_type && !booking.roomType) booking.roomType = row.room_type;
    if (row.user_email && !booking.email) booking.email = row.user_email;
    if (row.total_estimate != null && booking.totalEstimate == null) {
      booking.totalEstimate = row.total_estimate;
    }
    if (row.amount_down != null && booking.amountDown == null) {
      booking.amountDown = row.amount_down;
    }
    booking.userId = row.user_id || booking.userId || "";

    var columnStatus = row.status || "";
    var payloadStatus = payload.status || "";
    var mapped = mapMobilePublicStatus({
      status: columnStatus || payloadStatus,
      workflow: booking.workflow,
      notes: booking.notes || row.notes || "",
      payment_type: booking.paymentType || row.payment_type || payload.paymentType
    });
    booking.status = pickLaterStatus(pickLaterStatus(columnStatus, payloadStatus), mapped) || "Pending";
    var arrivalNow = String(booking.arrivalStatus || "").toLowerCase();
    if (
      String(booking.paymentType || "").toLowerCase() !== "full" &&
      String(booking.status || "").toLowerCase() === "confirmed" &&
      arrivalNow !== "arrived" &&
      arrivalNow !== "no_show" &&
      !booking.checkedInAt &&
      (booking.holdExpiresAt || booking.paymentVerifiedAt)
    ) {
      booking.status = "Reserved";
    }

    var pay = String(booking.paymentStatus || "").toLowerCase();
    var wf = String(booking.workflow || "").toLowerCase();
    var stage = String(booking.verificationStage || "").toLowerCase();
    var approvedLike =
      !!booking.paymentVerifiedAt ||
      stage === "approved" ||
      wf === "confirmed" ||
      wf === "approved" ||
      wf === "verified_by_receptionist" ||
      pay.indexOf("fully paid") !== -1 ||
      pay.indexOf("down payment received") !== -1 ||
      pay.indexOf("payment approved") !== -1;
    var stNow = String(booking.status || "").toLowerCase();
    if (approvedLike && !isPrePaymentHold(booking)) {
      if (stNow === "for verification" || stNow === "pending" || stNow === "pending payment verification") {
        if (mapped && mapped !== "For Verification") {
          booking.status = mapped;
        } else {
          booking.status =
            String(booking.paymentType || "").toLowerCase() === "full" ? "Confirmed" : "Reserved";
        }
      }
      if (!booking.paymentVerifiedAt) booking.paymentVerifiedAt = new Date().toISOString();
      if (!booking.verificationStage || String(booking.verificationStage).toLowerCase() === "awaiting_admin") {
        booking.verificationStage = "approved";
      }
      if (String(booking.paymentStatus || "").toLowerCase().indexOf("for verification") !== -1) {
        booking.paymentStatus =
          String(booking.paymentType || "").toLowerCase() === "full"
            ? "Fully Paid"
            : "Down Payment Received";
      }
      delete booking.verificationExpiresAt;
    }
    if (isPrePaymentHold(booking) && !row.payment_verified_at) {
      var holdHasProof = !!(
        booking.paymentProof ||
        booking.paymentProofUrl ||
        booking.paymentSubmittedAt ||
        booking.hasPaymentProof
      );
      if (!holdHasProof) {
        booking.paymentVerifiedAt = "";
        var holdWf = String(booking.workflow || "").toLowerCase();
        var holdStage = String(booking.verificationStage || "").toLowerCase();
        if (holdWf === "awaiting_payment" || holdStage === "awaiting_payment") {
          booking.status = "Awaiting Payment";
          booking.workflow = "awaiting_payment";
        } else {
          booking.status = "Pending";
          booking.workflow = "awaiting_booking_review";
        }
      }
    }
    var units = extractUnitFields(row);
    if (units) {
      if (!booking.roomCatalogId && units.roomCatalogId) booking.roomCatalogId = units.roomCatalogId;
      if ((!booking.roomCatalogIds || !booking.roomCatalogIds.length) && units.roomCatalogIds) {
        booking.roomCatalogIds = units.roomCatalogIds;
      }
      if ((!booking.cottageCatalogIds || !booking.cottageCatalogIds.length) && units.cottageCatalogIds) {
        booking.cottageCatalogIds = units.cottageCatalogIds;
      }
      if (!booking.hallCatalogId && units.hallCatalogId) booking.hallCatalogId = units.hallCatalogId;
      if ((!booking.hallCatalogIds || !booking.hallCatalogIds.length) && units.hallCatalogIds) {
        booking.hallCatalogIds = units.hallCatalogIds;
      }
      if ((!booking.facilityIds || !booking.facilityIds.length) && units.facilityIds) {
        booking.facilityIds = units.facilityIds;
      }
      if ((!booking.room_ids || !booking.room_ids.length) && units.room_ids) {
        booking.room_ids = units.room_ids;
      }
      if ((!booking.roomType || booking.roomType === "none") && units.roomType) {
        booking.roomType = units.roomType;
      }
      if (!booking.cottageQty && units.cottageQty) booking.cottageQty = units.cottageQty;
      if ((!booking.eventHall || booking.eventHall === "none") && units.eventHall) {
        booking.eventHall = units.eventHall;
      }
    }
    applyRememberedVerification(booking, booking.email || row.user_email);
    applyDownPaymentHoldShape(booking);
    if (booking.paymentProof && String(booking.paymentProof).length > 1500) {
      booking.hasPaymentProof = true;
      delete booking.paymentProof;
    }
    return booking;
  }

  function getCurrentUserId() {
    var u =
      window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
    return u && u.id ? u.id : null;
  }

  function getAuthSession() {
    var sb = getClient();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (result) {
      return result.data && result.data.session ? result.data.session : null;
    });
  }

  function isStaffUser(user) {
    if (!user || !user.role) return false;
    var r = String(user.role).trim().toLowerCase();
    return r === "admin" || r === "manager" || r === "receptionist" || r === "reception";
  }

  function readLocalBookingsStore() {
    try {
      var raw = localStorage.getItem("elenest_bookings");
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  /** One-time push of legacy localStorage bookings into Supabase. */
  function migrateLocalBookingsToSupabase(user) {
    var sb = getClient();
    if (!sb) return Promise.resolve();
    if (localStorage.getItem("elenest_bookings_migrated_v2") === "1") {
      return Promise.resolve();
    }

    var store = readLocalBookingsStore();
    var emails = Object.keys(store);
    if (!emails.length) {
      localStorage.setItem("elenest_bookings_migrated_v2", "1");
      return Promise.resolve();
    }

    var staff = isStaffUser(user);
    var tasks = [];

    emails.forEach(function (emailKey) {
      var email = normalizeEmail(emailKey);
      if (!staff && user && normalizeEmail(user.email) !== email) return;
      var list = store[emailKey];
      if (!Array.isArray(list)) return;
      list.forEach(function (booking) {
        if (!booking || !booking.id) return;
        if (findEntryById(booking.id)) return;
        if (!booking.userId) booking.userId = booking.user_id || null;
        if (!Array.isArray(cache[email])) cache[email] = [];
        cache[email].push(booking);
        tasks.push(persistRow(email, booking, { skipProofUpload: true }));
      });
    });

    return Promise.all(tasks)
      .then(function () {
        localStorage.setItem("elenest_bookings_migrated_v2", "1");
        syncOccupancyFromCache();
      })
      .catch(function () {
        /* allow retry on next load if migration partially failed */
      });
  }

  function bookingToRow(email, booking) {
    var roomId =
      booking.room_id ||
      booking.roomCatalogId ||
      (Array.isArray(booking.cottageCatalogIds) && booking.cottageCatalogIds[0]) ||
      booking.hallCatalogId ||
      "";
    var workflow =
      booking.workflow ||
      (function () {
        var st = String(booking.status || "").toLowerCase();
        if (st === "checked in" || st === "checked_in") return "checked_in";
        if (st === "checked out" || st === "checked_out" || st === "completed") return "checked_out";
        if (st === "confirmed" || st === "approved" || st === "active") return "confirmed";
        if (st === "reserved") return "approved";
        if (st === "for verification" || st === "pending payment verification") {
          return "pending_payment";
        }
        if (st === "cancelled" || st === "canceled") return "cancelled";
        if (st === "rejected") return "rejected";
        return "pending";
      })();
    if (!booking.room_id && roomId) booking.room_id = roomId;
    if (!booking.workflow) booking.workflow = workflow;
    var row = {
      id: booking.id,
      user_email: normalizeEmail(email),
      user_id: booking.userId || booking.user_id || null,
      payload: booking,
      status: booking.status || "Pending",
      payment_status: booking.paymentStatus || "",
      payment_type: booking.paymentType || "down",
      check_in: booking.checkIn || null,
      check_out: booking.checkOut || null,
      full_name: booking.fullName || booking.name || "",
      phone: booking.phone || "",
      room_type: booking.roomType || "",
      total_estimate: booking.totalEstimate != null ? booking.totalEstimate : null,
      amount_down: booking.amountDown != null ? booking.amountDown : null,
      amount_paid: booking.amountPaid != null ? booking.amountPaid : null,
      balance_due: booking.balanceDue != null ? booking.balanceDue : null,
      payment_method: booking.paymentMethod || "",
      hold_expires_at: booking.holdExpiresAt || null,
      arrival_status: booking.arrivalStatus || "not_arrived",
      non_refundable: booking.nonRefundable === true,
      payment_verified_at: booking.paymentVerifiedAt || null,
      payment_verified_by: booking.paymentVerifiedBy || null,
      payment_rejected_at: booking.paymentRejectedAt || null,
      payment_rejected_by: booking.paymentRejectedBy || null,
      payment_rejection_reason: booking.paymentRejectionReason || null,
      payment_proof_url: booking.paymentProofUrl || null,
      submitted_at: booking.submittedAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    // Never wipe an admin verification with a stale customer save.
    if (!booking.paymentVerifiedAt && !booking.payment_verified_at) {
      delete row.payment_verified_at;
      delete row.payment_verified_by;
    }
    if (!booking.paymentRejectedAt) {
      delete row.payment_rejected_at;
      delete row.payment_rejected_by;
      if (!booking.paymentRejectionReason) delete row.payment_rejection_reason;
    }
    return row;
  }

  function rebuildCacheFromRows(rows) {
    var user = getCurrentUserFromAuth();
    if (user && !isStaffUser(user) && rows && rows.length) {
      rows.forEach(function (row) {
        applyBookingRowToCache(row, true);
      });
      syncAllGroupsPaymentState();
      applyRememberedVerificationToCache();
      rememberVerifiedBookingsInCache();
      syncOccupancyFromCache();
      return;
    }
    cache = {};
    occupancyRows = [];
    (rows || []).forEach(function (row) {
      if (!row || isHistoricalId(row.id) || isHistoricalBooking(row)) return;
      var email = normalizeEmail(row.user_email);
      var booking = rowToBooking(row);
      if (isHistoricalBooking(booking)) return;
      if (!email) email = normalizeEmail(booking.email);
      if (!email) return;
      if (!Array.isArray(cache[email])) cache[email] = [];
      cache[email].push(booking);
      occupancyRows.push(booking);
    });
    syncAllGroupsPaymentState();
    applyRememberedVerificationToCache();
    rememberVerifiedBookingsInCache();
  }

  function applyRememberedVerificationToCache() {
    var changed = false;
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      (cache[email] || []).forEach(function (b) {
        if (!b) return;
        var before =
          String(b.status || "") +
          "|" +
          String(b.paymentVerifiedAt || "") +
          "|" +
          String(b.verificationExpiresAt || "") +
          "|" +
          String(b.arrivalStatus || "") +
          "|" +
          String(b.holdExpiresAt || "");
        applyRememberedVerification(b, email);
        var after =
          String(b.status || "") +
          "|" +
          String(b.paymentVerifiedAt || "") +
          "|" +
          String(b.verificationExpiresAt || "") +
          "|" +
          String(b.arrivalStatus || "") +
          "|" +
          String(b.holdExpiresAt || "");
        if (before !== after) changed = true;
      });
    }
    return changed;
  }

  function rememberVerifiedBookingsInCache() {
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      (cache[email] || []).forEach(function (b) {
        if (b && bookingHasPaymentDecision(b) && b.paymentVerifiedAt) {
          rememberVerifiedBooking(b, email);
        }
      });
    }
  }

  var repairedVerifiedOnce = false;
  function repairVerifiedDecisionsToDatabase() {
    if (repairedVerifiedOnce) return Promise.resolve(false);
    if (!isStaffUser(getCurrentUserFromAuth())) return Promise.resolve(false);
    repairedVerifiedOnce = true;
    var tasks = [];
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      (cache[email] || []).forEach(function (b) {
        if (!b || isLinkedFacilityRow(b)) return;
        if (!bookingHasPaymentDecision(b)) return;
        tasks.push(persistPaymentDecisionLive(b, email));
      });
    }
    if (!tasks.length) return Promise.resolve(false);
    return Promise.all(tasks)
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function findEntryById(id) {
    if (!id) return null;
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      var list = cache[email];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(id)) {
          return { accountEmail: email, booking: list[i], index: i };
        }
      }
    }
    return null;
  }

  function syncOccupancyFromCache() {
    occupancyRows = [];
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      var list = cache[email];
      if (!Array.isArray(list)) continue;
      list.forEach(function (booking) {
        if (booking && booking.checkIn && booking.checkOut) {
          occupancyRows.push(booking);
        }
      });
    }
  }

  function loadOccupancy() {
    // Live cache is enough for the calendar. The occupancy RPC returns every
    // historical stay and makes the site lag after the past-data import.
    syncOccupancyFromCache();
    return Promise.resolve();
  }

  var loadAllBookingsPromise = null;
  var lastLoadAllBookingsAt = 0;

  function loadAllBookings(force) {
    if (loadAllBookingsPromise) return loadAllBookingsPromise;
    if (!force && lastLoadAllBookingsAt && Date.now() - lastLoadAllBookingsAt < 12000) {
      return Promise.resolve();
    }
    var sb = getClient();
    if (!sb) {
      readyResolve();
      return Promise.resolve();
    }

    function dropInlineProof(row) {
      if (!row) return;
      var payload = row.payload;
      if (typeof payload === "string") {
        if (payload.indexOf("paymentProof") === -1) return;
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          return;
        }
        row.payload = payload;
      }
      if (!payload || typeof payload !== "object" || !payload.paymentProof) return;
      var proof = String(payload.paymentProof);
      if (proof.length > 1500) {
        payload.hasPaymentProof = true;
        delete payload.paymentProof;
      }
    }

    function fetchBookingsPage(from, pageSize, acc, seen) {
      if (from > pageSize * 40) return Promise.resolve({ data: acc, error: null });
      var query = sb
        .from("bookings")
        .select("*")
        .not("id", "like", "past-%")
        .order("submitted_at", { ascending: false })
        .range(from, from + pageSize - 1);
      var viewer = getCurrentUserFromAuth();
      if (viewer && viewer.email && !isStaffUser(viewer)) {
        query = query.eq("user_email", normalizeEmail(viewer.email));
      }
      return query.then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (!rows.length) return { data: acc, error: null };
        var firstId = rows[0] && rows[0].id ? String(rows[0].id) : "";
        if (firstId && seen[firstId]) return { data: acc, error: null };
        if (firstId) seen[firstId] = true;
        rows.forEach(dropInlineProof);
        var all = acc.concat(rows);
        if (rows.length === pageSize) {
          return fetchBookingsPage(from + pageSize, pageSize, all, seen);
        }
        return { data: all, error: null };
      });
    }

    loadAllBookingsPromise = fetchBookingsPage(0, 200, [], {})
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (!rows.length) {
          var user = getCurrentUserFromAuth();
          var key = user && user.email ? normalizeEmail(user.email) : "";
          if (key && Array.isArray(cache[key]) && cache[key].length) {
            readyResolve();
            emitUpdated();
            return loadOccupancy();
          }
        }
        rebuildCacheFromRows(rows);
        return loadOccupancy();
      })
      .then(function () {
        processAutoNoShows();
        applyRememberedVerificationToCache();
        if (isStaffUser(getCurrentUserFromAuth())) {
          rebuildAvailabilityFromOccupancyCache();
        }
        lastLoadAllBookingsAt = Date.now();
        readyResolve();
        emitUpdated();
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Bookings] Supabase load failed:", err);
        } catch (e) {}
        readyResolve();
      })
      .then(function () {
        loadAllBookingsPromise = null;
      });
    return loadAllBookingsPromise;
  }

  function rowToHistoricalEntry(row) {
    if (!row) return null;
    var booking = rowToBooking(row);
    if (!booking || !booking.id) return null;
    booking.historical = true;
    booking.source = booking.source || "historical_import";
    var email = normalizeEmail(row.user_email || booking.email || "past@imported.elenest.local");
    return { accountEmail: email, booking: booking };
  }

  function historicalManifestUrl() {
    return "../data/historical-manifest.json";
  }

  function fetchJsonFile(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + url);
      return res.json();
    });
  }

  function loadHistoricalRowsFromFiles(kind) {
    var HD = window.ElenestHistoricalData;
    if (HD) {
      var loader = kind === "feedback" ? HD.loadFeedback : HD.loadBookings;
      if (typeof loader === "function") {
        return loader.call(HD).then(function (result) {
          return (result && result.rows) || [];
        });
      }
    }
    return fetchJsonFile(historicalManifestUrl())
      .then(function (manifest) {
        var urls = (manifest && manifest[kind]) || [];
        var i = 0;
        var acc = [];
        function next() {
          if (i >= urls.length) return Promise.resolve(acc);
          var url = urls[i++];
          return fetchJsonFile(url).then(function (rows) {
            acc = acc.concat(rows || []);
            return next();
          });
        }
        return next();
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Bookings] Historical files failed:", err);
        } catch (e) {}
        return [];
      });
  }

  function mergeHistoricalById(a, b) {
    var byId = {};
    (a || []).concat(b || []).forEach(function (item) {
      if (!item || !item.booking || !item.booking.id) return;
      byId[String(item.booking.id)] = item;
    });
    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function fetchHistoricalFromSupabase(sb) {
    if (!sb) return Promise.resolve([]);
    function fetchHistoricalPage(from, pageSize, acc) {
      return sb
        .from("bookings")
        .select(
          "id,user_email,user_id,status,check_in,check_out,submitted_at,full_name,phone,room_type,total_estimate,amount_down,payload"
        )
        .like("id", "past-%")
        .order("check_in", { ascending: true })
        .range(from, from + pageSize - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          var all = acc.concat(rows);
          if (rows.length === pageSize) {
            return fetchHistoricalPage(from + pageSize, pageSize, all);
          }
          return all;
        });
    }
    return fetchHistoricalPage(0, 500, []).catch(function (err) {
      try {
        console.warn("[Elenest Bookings] Historical database load failed:", err);
      } catch (e) {}
      return [];
    });
  }

  function ensureHistoricalLoaded(force) {
    if (force) {
      historicalLoaded = false;
      historicalLoadPromise = null;
      historicalBookingsList = [];
    }
    if (historicalLoaded) return Promise.resolve(historicalBookingsList);
    if (historicalLoadPromise) return historicalLoadPromise;

    // Prefer Supabase past-% rows when present; otherwise fall back to /data JSON files.
    historicalLoadPromise = Promise.all([
      fetchHistoricalFromSupabase(getClient()).then(function (rows) {
        return (rows || []).map(rowToHistoricalEntry).filter(Boolean);
      }),
      loadHistoricalRowsFromFiles("bookings").then(function (rows) {
        return (rows || []).map(rowToHistoricalEntry).filter(Boolean);
      })
    ])
      .then(function (parts) {
        var fromDb = parts[0] || [];
        var fromFiles = parts[1] || [];
        // When historical has been imported to Supabase, KPIs/analytics use DB only.
        historicalBookingsList = fromDb.length ? fromDb : fromFiles;
        historicalLoaded = true;
        historicalLoadPromise = null;
        return historicalBookingsList;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Bookings] Historical load failed:", err);
        } catch (e) {}
        historicalLoaded = true;
        historicalLoadPromise = null;
        return historicalBookingsList;
      });
    return historicalLoadPromise;
  }

  setInterval(function () {
    processAutoNoShows();
  }, 30000);

  function collectBookingFacilityIds(source) {
    source = source || {};
    var payload = source.payload && typeof source.payload === "object" ? source.payload : {};
    return uniqueCanonicalIds(
      []
        .concat(parseJsonArray(source.room_ids))
        .concat(parseJsonArray(source.facilityIds))
        .concat(parseJsonArray(source.roomCatalogIds || source.room_catalog_ids))
        .concat(parseJsonArray(source.cottageCatalogIds || source.cottage_catalog_ids))
        .concat(parseJsonArray(source.hallCatalogIds || source.hall_catalog_ids))
        .concat(parseJsonArray(payload.room_ids))
        .concat(parseJsonArray(payload.facilityIds))
        .concat(parseJsonArray(payload.roomCatalogIds || payload.room_catalog_ids))
        .concat(parseJsonArray(payload.cottageCatalogIds || payload.cottage_catalog_ids))
        .concat(parseJsonArray(payload.hallCatalogIds || payload.hall_catalog_ids))
        .concat(
          source.roomCatalogId || source.room_catalog_id || payload.roomCatalogId || payload.room_catalog_id
            ? [source.roomCatalogId || source.room_catalog_id || payload.roomCatalogId || payload.room_catalog_id]
            : []
        )
        .concat(
          source.hallCatalogId || source.hall_catalog_id || payload.hallCatalogId || payload.hall_catalog_id
            ? [source.hallCatalogId || source.hall_catalog_id || payload.hallCatalogId || payload.hall_catalog_id]
            : []
        )
        .concat(source.room_id || payload.room_id ? [source.room_id || payload.room_id] : [])
    );
  }

  function applyFacilityIdsToBookingShape(target, ids) {
    if (!target) return target;
    var mergedIds = uniqueCanonicalIds(ids || []);
    var split = splitFacilityIdsByType(mergedIds);
    target.room_ids = mergedIds;
    target.facilityIds = mergedIds.slice();
    target.roomCatalogIds = uniqueCanonicalIds(
      [].concat(parseJsonArray(target.roomCatalogIds)).concat(split.roomCatalogIds)
    );
    target.cottageCatalogIds = uniqueCanonicalIds(
      [].concat(parseJsonArray(target.cottageCatalogIds)).concat(split.cottageCatalogIds)
    );
    target.hallCatalogIds = uniqueCanonicalIds(
      [].concat(parseJsonArray(target.hallCatalogIds)).concat(split.hallCatalogIds)
    );
    target.roomCatalogId = target.roomCatalogIds[0] || target.roomCatalogId || "";
    target.hallCatalogId = target.hallCatalogIds[0] || target.hallCatalogId || "";
    target.room_id =
      target.room_id ||
      target.roomCatalogId ||
      target.cottageCatalogIds[0] ||
      target.hallCatalogId ||
      mergedIds[0] ||
      "";
    if (target.payload && typeof target.payload === "object") {
      target.payload.room_ids = mergedIds.slice();
      target.payload.facilityIds = mergedIds.slice();
      target.payload.roomCatalogIds = target.roomCatalogIds.slice();
      target.payload.cottageCatalogIds = target.cottageCatalogIds.slice();
      target.payload.hallCatalogIds = target.hallCatalogIds.slice();
      target.payload.roomCatalogId = target.roomCatalogId;
      target.payload.hallCatalogId = target.hallCatalogId;
      if (!target.payload.room_id) target.payload.room_id = target.room_id;
    }
    return target;
  }

  function prepareRowForPersist(email, booking) {
    var row = bookingToRow(email, booking);
    var payload = Object.assign({}, booking);
    // Always union every selected facility id so the public calendar marks them all.
    var mergedIds = collectBookingFacilityIds(payload);
    payload.room_ids = mergedIds;
    payload.facilityIds = mergedIds.slice();
    // Prefer the scoped room_id for this row (mobile: one facility per booking row).
    if (booking && booking.room_id) {
      payload.room_id = canonicalizeUnitId(booking.room_id) || booking.room_id;
    } else if (!payload.room_id && mergedIds.length) {
      payload.room_id = mergedIds[0];
    }
    if (booking && booking.bookingGroupId) {
      payload.bookingGroupId = booking.bookingGroupId;
    }
    if (booking && booking.parentBookingId) {
      payload.parentBookingId = booking.parentBookingId;
      payload.linkedFacilityBooking = true;
    }
    if (booking && Array.isArray(booking.groupFacilityIds) && booking.groupFacilityIds.length) {
      payload.groupFacilityIds = booking.groupFacilityIds.slice();
    }
    if (mergedIds.length) {
      var splitPersist = splitFacilityIdsByType(mergedIds);
      payload.roomCatalogIds = uniqueCanonicalIds(
        [].concat(parseJsonArray(payload.roomCatalogIds)).concat(splitPersist.roomCatalogIds)
      );
      payload.cottageCatalogIds = uniqueCanonicalIds(
        [].concat(parseJsonArray(payload.cottageCatalogIds)).concat(splitPersist.cottageCatalogIds)
      );
      payload.hallCatalogIds = uniqueCanonicalIds(
        [].concat(parseJsonArray(payload.hallCatalogIds)).concat(splitPersist.hallCatalogIds)
      );
      payload.roomCatalogId = payload.roomCatalogIds[0] || payload.roomCatalogId || "";
      payload.hallCatalogId = payload.hallCatalogIds[0] || payload.hallCatalogId || "";
      if (payload.capacityTotal == null || payload.capacityTotal === "") {
        var UAPersist = window.ElenestUnitAvailability;
        if (UAPersist && typeof UAPersist.getCombinedCapacity === "function") {
          payload.capacityTotal = UAPersist.getCombinedCapacity({
            roomCatalogIds: payload.roomCatalogIds || [],
            cottageCatalogIds: payload.cottageCatalogIds || [],
            hallCatalogIds: payload.hallCatalogIds || []
          }).totalMax;
          payload.capacityLabel = payload.capacityTotal ? payload.capacityTotal + " pax" : "";
        }
      }
    }
    if (!payload.workflow) {
      var st = String(payload.status || "").toLowerCase();
      if (st === "checked in" || st === "checked_in") payload.workflow = "checked_in";
      else if (st === "checked out" || st === "checked_out" || st === "completed") {
        payload.workflow = "checked_out";
      } else if (st === "confirmed" || st === "approved" || st === "active") {
        payload.workflow = "confirmed";
      } else if (st === "reserved") payload.workflow = "approved";
      else if (st === "for verification" || st === "pending payment verification") {
        payload.workflow = "pending_payment";
      } else if (st === "cancelled" || st === "canceled") payload.workflow = "cancelled";
      else if (st === "rejected") payload.workflow = "rejected";
      else payload.workflow = "pending";
    }
    if (payload.paymentType && !payload.payment_type) {
      payload.payment_type = payload.paymentType;
    }
    if (payload.holdExpiresAt && !payload.hold_expires_at) {
      payload.hold_expires_at = payload.holdExpiresAt;
    }
    if (payload.paymentProofUrl) {
      delete payload.paymentProof;
      payload.hasPaymentProof = true;
    } else {
      var proof = payload.paymentProof ? String(payload.paymentProof) : "";
      if (proof.length > 150000) {
        try {
          localStorage.setItem("elenest_proof_" + booking.id, proof);
        } catch (e) {}
        payload.hasPaymentProof = true;
        delete payload.paymentProof;
      }
    }
    row.payload = payload;
    return row;
  }

  /**
   * Mobile creates one bookings row per facility (same dates). The public calendar
   * RPCs mark unavailable from each row's room_id — so website must match that.
   */
  function buildFacilityScopedCopy(primary, facilityId, allIds, isPrimary) {
    var b = {};
    for (var k in primary) {
      if (!Object.prototype.hasOwnProperty.call(primary, k)) continue;
      if (k === "_savePromise") continue;
      b[k] = primary[k];
    }
    var fid = canonicalizeUnitId(facilityId);
    var split = splitFacilityIdsByType([fid]);
    var groupId = primary.bookingGroupId || primary.id;
    b.bookingGroupId = groupId;
    b.groupFacilityIds = (allIds || []).slice();
    b.room_ids = (allIds || []).slice();
    b.facilityIds = (allIds || []).slice();
    b.room_id = fid;
    b.roomCatalogIds = split.roomCatalogIds.slice();
    b.cottageCatalogIds = split.cottageCatalogIds.slice();
    b.hallCatalogIds = split.hallCatalogIds.slice();
    b.roomCatalogId = split.roomCatalogIds[0] || "";
    b.hallCatalogId = split.hallCatalogIds[0] || "";
    b.cottageQty = String(split.cottageCatalogIds.length || 0);
    if (split.roomCatalogIds.length) {
      var UA = window.ElenestUnitAvailability;
      if (UA && typeof UA.getCatalog === "function") {
        var unit = UA.getCatalog().find(function (u) {
          return canonicalizeUnitId(u.id) === fid;
        });
        if (unit) {
          var kind = String(unit.roomKind || "").toLowerCase();
          b.roomType = kind === "big" ? "big" : kind === "small" ? "couple" : b.roomType || "couple";
        }
      }
    } else if (split.cottageCatalogIds.length) {
      b.roomType = b.roomType || "none";
    } else if (split.hallCatalogIds.length) {
      b.roomType = b.roomType || "none";
    }
    if (isPrimary) {
      b.id = primary.id;
      b.isPrimaryFacilityBooking = true;
      b.linkedFacilityBooking = false;
      delete b.parentBookingId;
      // Customer-facing primary keeps the full multi-facility selection.
      applyFacilityIdsToBookingShape(b, allIds);
      b.room_id = fid;
    } else {
      b.id = String(groupId) + "__" + String(fid).replace(/[^a-zA-Z0-9_-]/g, "_");
      b.parentBookingId = groupId;
      b.isPrimaryFacilityBooking = false;
      b.linkedFacilityBooking = true;
      delete b.paymentProof;
    }
    return b;
  }

  function persistBookingLikeMobile(email, primary, opts) {
    opts = opts || {};
    var allIds = collectBookingFacilityIds(primary);
    if (!allIds.length) {
      return persistRow(email, primary, opts);
    }
    primary.bookingGroupId = primary.bookingGroupId || primary.id;
    applyFacilityIdsToBookingShape(primary, allIds);

    var ent = findEntryById(primary.id);
    if (ent && ent.booking) {
      applyFacilityIdsToBookingShape(ent.booking, allIds);
      ent.booking.bookingGroupId = primary.id;
      ent.booking.room_id = allIds[0];
    }

    var primaryRow = buildFacilityScopedCopy(primary, allIds[0], allIds, true);
    var multi = allIds.length > 1;
    return persistRow(
      email,
      primaryRow,
      Object.assign({}, opts, { skipAvailabilityRefresh: multi })
    ).then(function (ok) {
      if (!ok) return false;
      if (!multi) return readQueueFields(primary);

      var fresh = findEntryById(primary.id);
      var proofUrl =
        (fresh && fresh.booking && fresh.booking.paymentProofUrl) || primary.paymentProofUrl || "";
      var chain = Promise.resolve(true);
      allIds.slice(1).forEach(function (fid) {
        chain = chain.then(function (prevOk) {
          if (!prevOk) return false;
          var sib = buildFacilityScopedCopy(primary, fid, allIds, false);
          if (proofUrl) sib.paymentProofUrl = proofUrl;
          sib.hasPaymentProof = !!(proofUrl || primary.hasPaymentProof);
          return persistRow(email, sib, {
            skipProofUpload: true,
            skipAvailabilityRefresh: true
          });
        });
      });
      return chain.then(function (sibOk) {
        return loadPublicAvailability()
          .catch(function () {
            return false;
          })
          .then(function () {
            return loadOccupancy().then(function () {
              broadcastAvailabilityChanged();
              return readQueueFields(primary).then(function () {
                return !!sibOk;
              });
            });
          });
      });
    });
  }

  function dateOnlyIso(iso) {
    var s = String(iso || "");
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  }

  function slimStatusPayload(booking) {
    var p = {};
    if (!booking) return p;
    for (var k in booking) {
      if (!Object.prototype.hasOwnProperty.call(booking, k)) continue;
      if (k === "paymentProof" || k === "_savePromise") continue;
      p[k] = booking[k];
    }
    p.hasPaymentProof = !!(booking.hasPaymentProof || booking.paymentProofUrl);
    return p;
  }

  function persistPaymentDecisionLive(booking, email) {
    var sb = getClient();
    if (!sb || !booking || !booking.id) return Promise.resolve(false);
    var payload = slimStatusPayload(booking);
    delete payload.verificationExpiresAt;
    if (booking.paymentVerifiedAt || booking.paymentRejectedAt) {
      payload.verificationExpiresAt = null;
    }
    var corePatch = {
      status: booking.status,
      payment_status: booking.paymentStatus || "",
      updated_at: new Date().toISOString()
    };
    if (booking.paymentType) corePatch.payment_type = booking.paymentType;
    if (booking.workflow) corePatch.workflow = booking.workflow;
    if (booking.arrivalStatus) corePatch.arrival_status = booking.arrivalStatus;
    if (String(booking.arrivalStatus || "").toLowerCase() === "arrived" || booking.checkedInAt) {
      corePatch.hold_expires_at = null;
    } else if (booking.holdExpiresAt) {
      corePatch.hold_expires_at = booking.holdExpiresAt;
    } else if (booking.holdExpiresAt === null) {
      corePatch.hold_expires_at = null;
    }
    if (booking.paymentVerifiedAt) {
      corePatch.payment_verified_at = booking.paymentVerifiedAt;
      corePatch.payment_verified_by = booking.paymentVerifiedBy || "";
    }
    if (booking.paymentRejectedAt) {
      corePatch.payment_rejected_at = booking.paymentRejectedAt;
      corePatch.payment_rejected_by = booking.paymentRejectedBy || "";
      corePatch.payment_rejection_reason = booking.paymentRejectionReason || "";
    }
    var em = normalizeEmail(email || booking.email);
    function finishOk() {
      rememberVerifiedBooking(booking, em);
      broadcastPaymentVerified(booking, em);
      return true;
    }
    function updateById(patch) {
      return sb.from("bookings").update(patch).eq("id", booking.id);
    }
    function updateStaySiblings(patch) {
      var ci = dateOnlyIso(booking.checkIn);
      var co = dateOnlyIso(booking.checkOut);
      if (!em || !ci) return Promise.resolve({ error: null });
      var q = sb.from("bookings").update(patch).ilike("user_email", em).eq("check_in", ci);
      if (co) q = q.eq("check_out", co);
      return q.catch(function () {
        return { error: null };
      });
    }
    function updateDeclinedGroup(patch) {
      var id = String(booking.bookingGroupId || booking.id || "");
      if (!id) return Promise.resolve({ error: null });
      var safeId = id.replace(/[,.()]/g, "");
      return sb
        .from("bookings")
        .update(patch)
        .or("id.eq." + safeId + ",id.like." + safeId + "__*")
        .then(function (res) {
          return res || { error: null };
        })
        .catch(function () {
          return { error: null };
        });
    }
    var updateRelated = booking.paymentRejectedAt ? updateDeclinedGroup : updateStaySiblings;
    return updateById(corePatch)
      .then(function (res) {
        if (res && res.error) throw res.error;
        return updateRelated(corePatch).then(function () {
          return updateById({ payload: payload }).then(function (payRes) {
            if (payRes && payRes.error) return finishOk();
            return updateRelated({ payload: payload }).then(finishOk);
          });
        });
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Bookings] Live payment decision save failed:", err);
        } catch (e) {}
        return updateById(corePatch)
          .then(function (res2) {
            if (res2 && res2.error) throw res2.error;
            return finishOk();
          })
          .catch(function () {
            return false;
          });
      });
  }

  function liveLooksApproved(live) {
    if (!live) return false;
    if (live.paymentRejectedAt) return false;
    if (live.paymentVerifiedAt) return true;
    var stage = String(live.verificationStage || "").toLowerCase();
    if (stage === "approved") return true;
    var wf = String(live.workflow || "").toLowerCase();
    if (wf === "approved" || wf === "confirmed" || wf === "verified_by_receptionist") return true;
    var pay = String(live.paymentStatus || "").toLowerCase();
    if (
      pay.indexOf("fully paid") !== -1 ||
      pay.indexOf("down payment received") !== -1 ||
      pay.indexOf("payment approved") !== -1
    ) {
      return true;
    }
    var st = String(live.status || "").toLowerCase();
    return (
      st === "reserved" ||
      st === "confirmed" ||
      st === "checked in" ||
      st === "checked_in" ||
      st === "checked out" ||
      st === "checked_out"
    );
  }

  function liveDecisionFromRow(row) {
    var payload = parsePayload(row);
    return {
      id: row.id,
      email: row.user_email || payload.email || "",
      checkIn: row.check_in || payload.checkIn || "",
      checkOut: row.check_out || payload.checkOut || "",
      fullName: row.full_name || payload.fullName || "",
      status: row.status || payload.status || "",
      paymentStatus: row.payment_status || payload.paymentStatus || "",
      paymentVerifiedAt: row.payment_verified_at || payload.paymentVerifiedAt || "",
      paymentRejectedAt: row.payment_rejected_at || payload.paymentRejectedAt || "",
      paymentVerifiedBy: row.payment_verified_by || payload.paymentVerifiedBy || "",
      workflow: payload.workflow || row.workflow || "",
      holdExpiresAt: row.hold_expires_at || payload.holdExpiresAt || null,
      arrivalStatus: row.arrival_status || payload.arrivalStatus || "",
      checkedInAt: row.checked_in_at || payload.checkedInAt || "",
      verificationStage: payload.verificationStage || "",
      paymentType: row.payment_type || payload.paymentType || "down"
    };
  }

  function matchLiveBooking(cacheBooking, live, emailKey) {
    if (!cacheBooking || !live) return false;
    if (live.id && String(cacheBooking.id) === String(live.id)) return true;
    var gid = getBookingGroupId(cacheBooking);
    if (gid && live.id && String(live.id).indexOf(String(gid)) === 0) return true;
    var stayA = stayKeyFor(cacheBooking, emailKey);
    var stayB = stayKeyFor(
      { email: live.email, checkIn: live.checkIn, checkOut: live.checkOut },
      live.email
    );
    if (stayA && stayB && stayA === stayB) return true;
    var n1 = String(cacheBooking.fullName || "").trim().toLowerCase();
    var n2 = String(live.fullName || "").trim().toLowerCase();
    return !!(
      n1 &&
      n2 &&
      n1 === n2 &&
      dateOnlyIso(cacheBooking.checkIn) === dateOnlyIso(live.checkIn)
    );
  }

  function overlayLiveDecisionOnBooking(target, live) {
    if (!target || !live) return false;
    var before =
      String(target.status || "") +
      "|" +
      String(target.paymentVerifiedAt || "") +
      "|" +
      String(target.paymentRejectedAt || "") +
      "|" +
      String(target.verificationStage || "") +
      "|" +
      String(target.paymentStatus || "") +
      "|" +
      String(target.verificationExpiresAt || "") +
      "|" +
      String(target.arrivalStatus || "") +
      "|" +
      String(target.holdExpiresAt || "") +
      "|" +
      String(target.checkedInAt || "");
    if (live.paymentRejectedAt || String(live.status || "").toLowerCase() === "rejected") {
      target.paymentRejectedAt = live.paymentRejectedAt || target.paymentRejectedAt || new Date().toISOString();
      target.status = "Rejected";
      target.paymentStatus = live.paymentStatus || "Rejected";
      target.verificationStage = "rejected";
      delete target.verificationExpiresAt;
    } else if (liveLooksApproved(live)) {
      if (live.paymentVerifiedAt) target.paymentVerifiedAt = live.paymentVerifiedAt;
      if (!target.paymentVerifiedAt) target.paymentVerifiedAt = new Date().toISOString();
      if (live.paymentVerifiedBy) target.paymentVerifiedBy = live.paymentVerifiedBy;
      target.verificationStage = "approved";
      if (live.workflow) target.workflow = pickLaterWorkflow(target.workflow, live.workflow);
      if (live.paymentStatus) {
        target.paymentStatus = pickLaterPaymentStatus(target.paymentStatus, live.paymentStatus);
      }
      target.status = pickLaterStatus(target.status, live.status);
      var st = String(target.status || "").toLowerCase();
      if (st === "for verification" || st === "pending" || st === "pending payment verification") {
        target.status =
          String(target.paymentType || live.paymentType || "").toLowerCase() === "full"
            ? "Confirmed"
            : "Reserved";
      }
      if (String(target.paymentStatus || "").toLowerCase().indexOf("for verification") !== -1) {
        target.paymentStatus =
          String(target.paymentType || live.paymentType || "").toLowerCase() === "full"
            ? "Fully Paid"
            : "Down Payment Received";
      }
      delete target.verificationExpiresAt;
      if (live.holdExpiresAt) target.holdExpiresAt = live.holdExpiresAt;
      if (live.arrivalStatus) target.arrivalStatus = live.arrivalStatus;
      if (live.checkedInAt) target.checkedInAt = live.checkedInAt;
      if (String(live.arrivalStatus || "").toLowerCase() === "arrived") {
        target.arrivalStatus = "arrived";
        // Arrived always ends the 3-hour hold, even if a stale hold_expires_at remains remotely.
        target.holdExpiresAt = null;
      }
      applyDownPaymentHoldShape(target);
    } else {
      return false;
    }
    var after =
      String(target.status || "") +
      "|" +
      String(target.paymentVerifiedAt || "") +
      "|" +
      String(target.paymentRejectedAt || "") +
      "|" +
      String(target.verificationStage || "") +
      "|" +
      String(target.paymentStatus || "") +
      "|" +
      String(target.verificationExpiresAt || "") +
      "|" +
      String(target.arrivalStatus || "") +
      "|" +
      String(target.holdExpiresAt || "") +
      "|" +
      String(target.checkedInAt || "");
    return before !== after;
  }

  function applyLiveDecisionRows(rows) {
    var changed = false;
    (rows || []).forEach(function (row) {
      if (!row) return;
      var live = liveDecisionFromRow(row);
      var decided =
        liveLooksApproved(live) ||
        !!live.paymentRejectedAt ||
        String(live.status || "").toLowerCase() === "rejected";
      if (!decided) return;
      rememberVerifiedBooking(
        {
          id: live.id,
          status: live.status,
          paymentStatus: live.paymentStatus,
          paymentVerifiedAt: live.paymentVerifiedAt,
          paymentRejectedAt: live.paymentRejectedAt,
          verificationStage: live.verificationStage,
          workflow: live.workflow,
          paymentType: live.paymentType,
          holdExpiresAt: live.holdExpiresAt,
          arrivalStatus: live.arrivalStatus,
          checkedInAt: live.checkedInAt,
          checkIn: live.checkIn,
          checkOut: live.checkOut,
          email: live.email
        },
        live.email
      );
      for (var email in cache) {
        if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
        (cache[email] || []).forEach(function (b) {
          if (matchLiveBooking(b, live, email) && overlayLiveDecisionOnBooking(b, live)) {
            changed = true;
          }
        });
      }
    });
    if (changed) emitUpdated();
    return changed;
  }

  function collectLiveBookingIds() {
    var ids = [];
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      (cache[email] || []).forEach(function (b) {
        if (!b || !b.id || isHistoricalBooking(b)) return;
        if (b.linkedFacilityBooking || b.parentBookingId) return;
        if (String(b.id).indexOf("__") !== -1) return;
        var st = String(b.status || "").toLowerCase();
        if (
          st === "cancelled" ||
          st === "canceled" ||
          st === "rejected" ||
          st === "no show" ||
          st === "no_show" ||
          st === "checked out" ||
          st === "checked_out" ||
          st === "completed"
        ) {
          return;
        }
        ids.push(b.id);
      });
    }
    return ids;
  }

  function syncLivePaymentStatuses() {
    var sb = getClient();
    if (!sb) return Promise.resolve(false);
    var ids = collectLiveBookingIds();
    if (!ids.length) {
      if (applyRememberedVerificationToCache()) emitUpdated();
      return Promise.resolve(false);
    }

    var CHUNK = 80;
    var i = 0;
    function nextChunk(acc) {
      if (i >= ids.length) return Promise.resolve(acc);
      var chunk = ids.slice(i, i + CHUNK);
      i += chunk.length;
      return sb
        .from("bookings")
        .select(
          "id,status,payment_status,payment_verified_at,payment_verified_by,payment_rejected_at,payment_rejected_by,check_in,check_out,full_name,user_email,hold_expires_at,arrival_status,payment_type"
        )
        .in("id", chunk)
        .then(function (res) {
          if (res.error) throw res.error;
          return nextChunk(acc.concat(res.data || []));
        });
    }

    return nextChunk([])
      .then(function (rows) {
        applyLiveDecisionRows(rows || []);
        if (applyRememberedVerificationToCache()) emitUpdated();
        return true;
      })
      .catch(function () {
        if (applyRememberedVerificationToCache()) emitUpdated();
        return false;
      });
  }

  function applyQueueRow(booking, row) {
    if (!booking || !row) return;
    var payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    if (row.requested_at) booking.requestedAt = row.requested_at;
    var guestRole = payload.guestQueueRole || "";
    var guestMsg = payload.guestQueueMessage || "";
    booking.queueRole = guestRole || row.queue_role || "";
    booking.queueMessage = guestMsg || row.queue_message || "";
    if (row.queue_position != null) booking.queuePosition = row.queue_position;
    if (row.queue_room_id) booking.queueRoomId = row.queue_room_id;
  }

  function readQueueFields(booking) {
    var sb = getClient();
    if (!sb || !booking || !booking.id) return Promise.resolve(true);
    return sb
      .from("bookings")
      .select("id,requested_at,queue_role,queue_position,queue_message,queue_room_id,payload")
      .eq("id", booking.id)
      .maybeSingle()
      .then(function (res) {
        if (res && !res.error && res.data) {
          applyQueueRow(booking, res.data);
          var ent = findEntryById(booking.id);
          if (ent && ent.booking && ent.booking !== booking) applyQueueRow(ent.booking, res.data);
        }
        return true;
      })
      .catch(function () {
        return true;
      });
  }

  function persistRow(email, booking, opts) {
    opts = opts || {};
    var sb = getClient();
    if (!sb) return Promise.resolve(false);

    return getAuthSession()
      .then(function (session) {
        if (!session || !session.user) {
          try {
            console.warn("[Elenest Bookings] Not signed in — cannot save to Supabase yet.");
          } catch (e) {}
          return false;
        }

        var working = booking;
        if (!working.userId && session.user.id) {
          working = Object.assign({}, booking, { userId: session.user.id });
          var entry = findEntryById(working.id);
          if (entry && cache[entry.accountEmail] && cache[entry.accountEmail][entry.index]) {
            cache[entry.accountEmail][entry.index] = working;
          }
        }

        if (opts.skipProofUpload) {
          return working;
        }

        var PP = window.ElenestPaymentProofs;
        if (PP && typeof PP.prepareForPersist === "function") {
          return PP.prepareForPersist(working).then(function (prepared) {
            if (prepared && prepared !== working) {
              var ent = findEntryById(prepared.id);
              if (ent && cache[ent.accountEmail] && cache[ent.accountEmail][ent.index]) {
                cache[ent.accountEmail][ent.index] = prepared;
              }
            }
            return prepared || working;
          });
        }
        return working;
      })
      .then(function (prepared) {
        if (prepared === false) return false;
        // Keep singular room_id as the facility this row represents (mobile-compatible).
        if (prepared && prepared.room_id) {
          prepared.room_id = canonicalizeUnitId(prepared.room_id) || prepared.room_id;
        }
        applyRememberedVerification(prepared, email);
        var existingSel =
          "id,status,payment_status,payment_verified_at,payment_verified_by,payment_rejected_at,payment_rejected_by,check_in,check_out,full_name,user_email,payload,payment_type";
        return sb
          .from("bookings")
          .select(existingSel)
          .eq("id", prepared.id)
          .maybeSingle()
          .then(function (existingRes) {
            if (existingRes && existingRes.data) {
              overlayLiveDecisionOnBooking(prepared, liveDecisionFromRow(existingRes.data));
              applyRememberedVerification(prepared, email);
            }
            var row = prepareRowForPersist(email, prepared);
            if (!prepared.paymentVerifiedAt && !prepared.payment_verified_at) {
              delete row.payment_verified_at;
              delete row.payment_verified_by;
            }
            if (!prepared.paymentRejectedAt) {
              delete row.payment_rejected_at;
              delete row.payment_rejected_by;
              if (!prepared.paymentRejectionReason) delete row.payment_rejection_reason;
            }
            return sb
              .from("bookings")
              .upsert(row, { onConflict: "id" })
              .then(function (res) {
                if (res.error) throw res.error;
                if (!prepared.paymentVerifiedAt) {
                  if (opts.skipAvailabilityRefresh) return readQueueFields(prepared);
                  return loadPublicAvailability()
                    .catch(function () {
                      return false;
                    })
                    .then(function () {
                      return loadOccupancy().then(function () {
                        broadcastAvailabilityChanged();
                        return readQueueFields(prepared);
                      });
                    });
                }
                return sb
                  .from("bookings")
                  .update({
                    status: prepared.status,
                    payment_status: prepared.paymentStatus || "",
                    payment_verified_at: prepared.paymentVerifiedAt,
                    payment_verified_by: prepared.paymentVerifiedBy || "",
                    payload: row.payload
                  })
                  .eq("id", prepared.id)
                  .then(function (upd) {
                    if (upd && upd.error) throw upd.error;
                    rememberVerifiedBooking(prepared, email);
                    broadcastPaymentVerified(prepared, email);
                    if (opts.skipAvailabilityRefresh) return readQueueFields(prepared);
                    return loadPublicAvailability()
                      .catch(function () {
                        return false;
                      })
                      .then(function () {
                        return loadOccupancy().then(function () {
                          broadcastAvailabilityChanged();
                          return readQueueFields(prepared);
                        });
                      });
                  });
              });
          });
      })
      .catch(function (err) {
        try {
          console.warn(
            "[Elenest Bookings] Save failed:",
            err && err.message ? err.message : err,
            err && err.details ? err.details : ""
          );
        } catch (e) {}
        return false;
      });
  }

  function deleteRow(id) {
    var sb = getClient();
    if (!sb) return Promise.resolve(false);
    return sb
      .from("bookings")
      .delete()
      .eq("id", id)
      .then(function (res) {
        if (res.error) throw res.error;
        var entry = findEntryById(id);
        if (entry) {
          cache[entry.accountEmail].splice(entry.index, 1);
        }
        availabilityBookings = availabilityBookings.filter(function (b) {
          return !b || b.id !== id;
        });
        delete optimisticAvailability[id];
        return loadPublicAvailability()
          .catch(function () {
            return false;
          })
          .then(function () {
            return loadOccupancy().then(function () {
              emitUpdated();
              broadcastAvailabilityChanged();
              return true;
            });
          });
      })
      .catch(function () {
        return false;
      });
  }

  function sortChronological(list) {
    return list.slice().sort(function (a, b) {
      var ak = a.checkIn || a.submittedAt || "";
      var bk = b.checkIn || b.submittedAt || "";
      if (ak !== bk) {
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      }
      var as = a.submittedAt || "";
      var bs = b.submittedAt || "";
      return as < bs ? -1 : as > bs ? 1 : 0;
    });
  }

  function isNightOccupiedInList(iso, list) {
    var PF = window.ElenestPaymentFlow;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || !b.checkIn || !b.checkOut) continue;
      if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
        if (!PF.bookingBlocksCalendarSlot(b)) continue;
      } else {
        var lower = String(b.status || "").toLowerCase();
        if (
          lower === "cancelled" ||
          lower === "canceled" ||
          lower === "rejected" ||
          lower === "no show" ||
          lower === "no_show"
        ) {
          continue;
        }
      }
      var cur = isoToUtcDate(b.checkIn);
      var end = isoToUtcDate(b.checkOut);
      while (cur < end) {
        if (utcDateToIso(cur) === iso) return true;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    return false;
  }

  var processAutoNoShowsBusy = false;
  var processAutoNoShowsQueued = false;

  function processAutoNoShows() {
    var PF = window.ElenestPaymentFlow;
    if (!PF) return;
    if (processAutoNoShowsBusy) {
      processAutoNoShowsQueued = true;
      return;
    }
    processAutoNoShowsBusy = true;
    processAutoNoShowsQueued = false;
    var changed = false;
    try {
      for (var email in cache) {
        if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
        var list = cache[email];
        if (!Array.isArray(list)) continue;
        for (var i = 0; i < list.length; i++) {
          var b = list[i];
          if (isHistoricalBooking(b)) continue;
          var patch = null;
          var kind = "";
          if (PF.shouldAutoCompleteCheckout && PF.shouldAutoCompleteCheckout(b)) {
            patch = PF.buildCheckoutCompletePatch();
            kind = "checkout";
          } else if (PF.shouldActivateDeferredHold && PF.shouldActivateDeferredHold(b)) {
            // Start 3-hour timer on check-in day only — never marks Arrived.
            patch = PF.buildActivateDeferredHoldPatch();
            kind = "deferred_hold";
          } else if (PF.shouldAutoNoShow && PF.shouldAutoNoShow(b)) {
            patch = PF.buildNoShowPatch();
            kind = "no_show";
          } else if (PF.shouldAutoExpireUnpaidBooking && PF.shouldAutoExpireUnpaidBooking(b) && !isLinkedFacilityRow(b)) {
            patch = PF.buildPaymentDeadlineExpiredPatch();
            kind = "payment_expired";
          } else if (PF.shouldAutoCancelExpiredHold && PF.shouldAutoCancelExpiredHold(b)) {
            patch = PF.buildExpiredHoldPatch();
            kind = "expired_hold";
          }
          if (!patch) continue;
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) b[k] = patch[k];
          }
          list[i] = b;
          if (kind === "payment_expired") {
            var expireGroup = getBookingGroupId(b);
            for (var expireEmail in cache) {
              if (!Object.prototype.hasOwnProperty.call(cache, expireEmail)) continue;
              var expireList = cache[expireEmail];
              if (!Array.isArray(expireList)) continue;
              for (var expireIndex = 0; expireIndex < expireList.length; expireIndex++) {
                var expireRow = expireList[expireIndex];
                if (!expireRow || expireRow === b) continue;
                if (expireGroup && getBookingGroupId(expireRow) === expireGroup) {
                  for (var expireKey in patch) {
                    if (Object.prototype.hasOwnProperty.call(patch, expireKey)) expireRow[expireKey] = patch[expireKey];
                  }
                }
              }
            }
            persistBookingLikeMobile(email, b, { skipAvailabilityRefresh: true });
            if (
              window.ElenestNotifications &&
              typeof window.ElenestNotifications.notifyPaymentWindowExpired === "function"
            ) {
              window.ElenestNotifications.notifyPaymentWindowExpired(email, b);
            }
          } else {
            persistRow(email, b, { skipAvailabilityRefresh: kind === "deferred_hold" });
          }
          if (kind !== "payment_expired") rememberVerifiedBooking(b, email);
          // Avoid broadcast storms on timer activation — payment was already verified earlier.
          if (kind !== "deferred_hold" && kind !== "payment_expired") {
            broadcastPaymentVerified(b, email);
          }
          changed = true;
        }
      }
    } finally {
      processAutoNoShowsBusy = false;
    }
    if (changed) {
      syncOccupancyFromCache();
      loadPublicAvailability().finally(function () {
        emitUpdated();
        broadcastAvailabilityChanged();
        if (processAutoNoShowsQueued) {
          processAutoNoShowsQueued = false;
          setTimeout(processAutoNoShows, 1500);
        }
      });
    } else if (processAutoNoShowsQueued) {
      processAutoNoShowsQueued = false;
      setTimeout(processAutoNoShows, 1500);
    }
  }

  function isGlobalNightOccupied(iso) {
    if (occupancyRows.length) return isNightOccupiedInList(iso, occupancyRows);

    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      if (isNightOccupiedInList(iso, cache[email])) return true;
    }
    return false;
  }

  function sortBookingEntries(list) {
    list.sort(function (a, c) {
      var as = (a.booking && a.booking.submittedAt) || "";
      var bs = (c.booking && c.booking.submittedAt) || "";
      if (as !== bs) return bs < as ? -1 : bs > as ? 1 : 0;
      var ai = (a.booking && a.booking.checkIn) || "";
      var bi = (c.booking && c.booking.checkIn) || "";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return 0;
    });
    return list;
  }

  function listLiveCache() {
    var list = [];
    for (var email in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, email)) continue;
      var bookings = cache[email];
      if (!Array.isArray(bookings)) continue;
      for (var i = 0; i < bookings.length; i++) {
        var b = bookings[i];
        if (!b || !b.id || isHistoricalBooking(b)) continue;
        list.push({ accountEmail: email, booking: b });
      }
    }
    return sortBookingEntries(list);
  }

  function listAll() {
    var live = listLiveCache();
    if (!historicalBookingsList.length) return live;
    return sortBookingEntries(live.concat(historicalBookingsList));
  }

  function listLive() {
    return listLiveCache();
  }

  function updateFields(accountEmail, id, patch) {
    if (!id || !patch || typeof patch !== "object") return Promise.resolve(false);
    var resolved = resolvePrimaryEntry(id);
    if (resolved && resolved.booking) {
      id = resolved.booking.id;
      accountEmail = resolved.accountEmail;
    }
    var key = normalizeEmail(accountEmail);
    var list = cache[key];
    if (!Array.isArray(list)) {
      var entry = findEntryById(id);
      if (!entry) return Promise.resolve(false);
      key = entry.accountEmail;
      list = cache[key];
    }
    if (!Array.isArray(list)) return Promise.resolve(false);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || String(b.id) !== String(id)) continue;
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) {
          // Keep explicit nulls for hold/verification deadlines so Arrive can stop the 3-hour timer.
          if (
            patch[k] === null &&
            k !== "holdExpiresAt" &&
            k !== "verificationExpiresAt" &&
            k !== "hold_expires_at" &&
            k !== "verification_expires_at"
          ) {
            delete b[k];
          } else {
            b[k] = patch[k];
          }
        }
      }
      list[i] = b;
      if (
        patch.paymentVerifiedAt ||
        patch.paymentRejectedAt ||
        patch.arrivalStatus ||
        Object.prototype.hasOwnProperty.call(patch, "holdExpiresAt") ||
        patch.checkedInAt ||
        bookingHasPaymentDecision(b)
      ) {
        rememberVerifiedBooking(b, key);
        broadcastPaymentVerified(b, key);
      }
      syncGroupPaymentState(getBookingGroupId(b));
      syncOccupancyFromCache();
      upsertAvailabilityBooking(b);
      emitUpdated();
      var isDecision = !!(
        patch.paymentVerifiedAt ||
        patch.paymentRejectedAt ||
        patch.arrivalStatus ||
        Object.prototype.hasOwnProperty.call(patch, "holdExpiresAt") ||
        patch.checkedInAt
      );
      var liveSave = isDecision ? persistPaymentDecisionLive(b, key) : Promise.resolve(false);
      return liveSave.then(function (okLive) {
        return persistBookingLikeMobile(key, b).then(function (ok) {
          if (ok || okLive) return true;
          return loadAllBookings().then(function () {
            return false;
          });
        });
      });
    }
    return Promise.resolve(false);
  }

  function updateById(id, patch) {
    var entry = findEntryById(id);
    if (!entry) return Promise.resolve(false);
    return updateFields(entry.accountEmail, id, patch);
  }

  function bootstrapBookings(user) {
    var sb = getClient();
    if (!sb) {
      readyResolve();
      return Promise.resolve();
    }
    return migrateLocalBookingsToSupabase(user)
      .then(function () {
        return loadAllBookings(true);
      })
      .then(function () {
        return loadPublicAvailability().catch(function () {
          return false;
        });
      })
      .then(function () {
        // Force realtime after auth so staff get bookings channel + live check-in/out lists
        setupRealtimeAvailability(true);
        emitUpdated();
      })
      .catch(function () {
        setupRealtimeAvailability(true);
        readyResolve();
      });
  }

  if (window.ElenestAuth && window.ElenestAuth.ready) {
    window.ElenestAuth.ready.then(function (user) {
      bootstrapBookings(user);
    });
  } else {
    bootstrapBookings(null);
  }

  // Safety: never leave Bookings.ready hanging forever
  setTimeout(function () {
    try {
      readyResolve();
    } catch (e) {}
  }, 6000);

  // Soft backup poll (realtime is primary). Skip when tab hidden; emit only if data changed.
  setInterval(function () {
    if (!window.ElenestBookings) return;
    if (document.visibilityState && document.visibilityState !== "visible") return;
    if (typeof window.ElenestBookings.refreshAvailability === "function") {
      window.ElenestBookings.refreshAvailability();
    }
  }, 60000);

  var lastVisRefreshAt = 0;
  function onCalendarVisibilityRefresh() {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    var now = Date.now();
    if (now - lastVisRefreshAt < 20000) return;
    lastVisRefreshAt = now;
    refreshAvailabilityAndNotify();
  }

  document.addEventListener("visibilitychange", onCalendarVisibilityRefresh);
  window.addEventListener("focus", onCalendarVisibilityRefresh);
  var paymentSyncBusy = false;
  setInterval(function () {
    if (!window.ElenestBookings) return;
    if (document.visibilityState && document.visibilityState !== "visible") return;
    if (paymentSyncBusy) return;
    paymentSyncBusy = true;
    syncLivePaymentStatuses().then(
      function () {
        paymentSyncBusy = false;
      },
      function () {
        paymentSyncBusy = false;
      }
    );
  }, 30000);
  window.addEventListener("storage", function (e) {
    if (!e || e.key !== VERIFIED_STORE_KEY) return;
    applyRememberedVerificationToCache();
    emitUpdated();
  });

  window.ElenestBookings = {
    ready: ready,
    isGlobalNightOccupied: isGlobalNightOccupied,
    listAll: listAll,
    listLive: listLive,
    isHistoricalBooking: isHistoricalBooking,
    ensureHistoricalLoaded: ensureHistoricalLoaded,
    isHistoricalLoaded: function () {
      return historicalLoaded;
    },
    listPendingVerifications: function () {
      var PF = window.ElenestPaymentFlow;
      var list = listLive();
      return list.filter(function (item) {
        if (!item || !item.booking) return false;
        if (item.booking.linkedFacilityBooking || item.booking.parentBookingId) return false;
        if (PF && typeof PF.isAwaitingPaymentVerification === "function") {
          return PF.isAwaitingPaymentVerification(item.booking);
        }
        var b = item.booking;
        if (b.paymentVerifiedAt || b.paymentRejectedAt) return false;
        var st = String(b.status || "").toLowerCase();
        if (st === "rejected" || st === "cancelled" || st === "canceled") return false;
        return (
          st === "for verification" ||
          st === "pending payment verification" ||
          ((b.paymentProof || b.paymentProofUrl || b.paymentSubmittedAt || b.hasPaymentProof) &&
            st === "pending")
        );
      });
    },
    updateFields: updateFields,
    updateById: updateById,
    findById: function (id) {
      var entry = findEntryById(id);
      return entry ? { accountEmail: entry.accountEmail, booking: entry.booking } : null;
    },

    refresh: loadAllBookings,
    syncLivePaymentStatuses: syncLivePaymentStatuses,
    refreshAvailability: loadPublicAvailability,
    refreshAvailabilityAndNotify: refreshAvailabilityAndNotify,
    releaseDeclinedBookingAvailability: releaseDeclinedBookingAvailability,
    listForAvailability: listForAvailability,
    processAutoNoShows: processAutoNoShows,
    broadcastAvailabilityChanged: broadcastAvailabilityChanged,
    /** Mobile calendar sync helpers (booked_room_ids / unavailable facility ids). */
    getBlockedFacilityIdsOnDate: getBlockedFacilityIdsOnDate,
    isFacilityBlockedOnDate: isFacilityBlockedOnDate,
    getFacilityBlockKindOnDate: getFacilityBlockKindOnDate,
    forEachBlockedFacilityInRange: forEachBlockedFacilityInRange,
    prefetchUnavailableFacilitiesForRange: prefetchUnavailableFacilitiesForRange,

    listForUser: function (email) {
      syncAllGroupsPaymentState();
      var key = normalizeEmail(email);
      var user = getCurrentUserFromAuth();
      var uid = user && user.id ? String(user.id) : "";
      var collected = [];
      var seen = {};
      function take(list) {
        (list || []).forEach(function (b) {
          if (!b || !b.id) return;
          if (b.linkedFacilityBooking || b.parentBookingId) return;
          if (isHiddenFromCustomerAppointments(b, key)) return;
          applyRememberedVerification(b, key);
          var bid = String(b.id);
          if (seen[bid]) return;
          seen[bid] = true;
          collected.push(b);
        });
      }
      take(cache[key]);
      if (uid) {
        for (var k in cache) {
          if (!Object.prototype.hasOwnProperty.call(cache, k)) continue;
          if (k === key) continue;
          take(
            (cache[k] || []).filter(function (b) {
              return b && (String(b.userId || "") === uid || String(b.user_id || "") === uid);
            })
          );
        }
      }
      return sortChronological(collected);
    },

    add: function (email, record) {
      var key = normalizeEmail(email);
      if (!Array.isArray(cache[key])) cache[key] = [];
      var copy = {};
      for (var k in record) {
        if (Object.prototype.hasOwnProperty.call(record, k)) {
          copy[k] = record[k];
        }
      }
      copy.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      copy.submittedAt = new Date().toISOString();
      copy.status = copy.status || "For Verification";
      copy.paymentStatus = copy.paymentStatus || "For Verification";
      if (!copy.email) copy.email = key;
      if (copy.paymentProof) copy.hasPaymentProof = true;
      copy.userId = copy.userId || getCurrentUserId() || null;
      // Full multi-facility list on the customer-facing primary booking.
      applyFacilityIdsToBookingShape(copy, collectBookingFacilityIds(copy));
      copy.bookingGroupId = copy.id;
      cache[key].push(copy);
      syncOccupancyFromCache();
      upsertAvailabilityBooking(copy);
      emitUpdated();
      // Persist like mobile: one Supabase row per facility so the public calendar
      // marks every selected unit unavailable.
      var savePromise = persistBookingLikeMobile(key, copy).then(function (ok) {
        if (ok) {
          upsertAvailabilityBooking(copy);
          emitUpdated();
          broadcastAvailabilityChanged();
          return copy;
        }
        try {
          console.warn("[Elenest Bookings] Booking was not saved to Supabase:", copy.id);
        } catch (e) {}
        return copy;
      });
      copy._savePromise = savePromise;
      return copy;
    },

    waitForSave: function (booking) {
      if (!booking) return Promise.resolve(null);
      if (booking._savePromise && typeof booking._savePromise.then === "function") {
        return booking._savePromise;
      }
      return Promise.resolve(booking);
    },

    applyRememberedVerification: applyRememberedVerification,
    rememberVerifiedBooking: rememberVerifiedBooking,
    rememberHiddenAppointment: rememberHiddenAppointment,
    isHiddenFromCustomerAppointments: isHiddenFromCustomerAppointments,

    removeById: function (email, id) {
      if (!id) return Promise.resolve(false);
      var key = normalizeEmail(email);
      var list = cache[key];
      var victim = null;
      var entry = findEntryById(id);
      if (entry && entry.booking) {
        victim = entry.booking;
        key = entry.accountEmail;
        list = cache[key];
      }
      if (!victim && Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === String(id)) {
            victim = list[i];
            break;
          }
        }
      }
      if (victim) {
        victim.customerRemovedAt = new Date().toISOString();
        rememberHiddenAppointment(victim, key || email);
      } else {
        rememberHiddenAppointment({ id: id, email: email }, email);
      }
      if (Array.isArray(list)) {
        cache[key] = list.filter(function (b) {
          return b && String(b.id) !== String(id);
        });
      }
      emitUpdated();
      var deleteIds = [id];
      if (victim) {
        var groupId = getBookingGroupId(victim) || victim.id;
        collectBookingFacilityIds(victim).forEach(function (fid) {
          var sibId =
            String(groupId) + "__" + String(canonicalizeUnitId(fid)).replace(/[^a-zA-Z0-9_-]/g, "_");
          if (sibId !== id) deleteIds.push(sibId);
        });
      }
      var hideSave = victim
        ? persistPaymentDecisionLive(
            Object.assign({}, victim, { customerRemovedAt: victim.customerRemovedAt }),
            key || email
          ).catch(function () {
            return false;
          })
        : Promise.resolve(false);
      return hideSave
        .then(function () {
          return Promise.all(
            deleteIds.map(function (delId) {
              return deleteRow(delId);
            })
          );
        })
        .then(function () {
          emitUpdated();
          return true;
        })
        .catch(function () {
          emitUpdated();
          return true;
        });
    }
  };
})();
