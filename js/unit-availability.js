/**
 * Per-unit availability — rooms, cottages, and event halls from the facilities catalog.
 * Multiple guests may book the same dates when they choose different units.
 */
(function () {
  var STORAGE_CATALOG = "elenest_room_catalog";

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

  function rangesOverlap(checkInA, checkOutA, checkInB, checkOutB) {
    if (!checkInA || !checkOutA || !checkInB || !checkOutB) return false;
    return checkInA < checkOutB && checkInB < checkOutA;
  }

  function normalizeTimeWindow(timeWindow) {
    timeWindow = timeWindow || {};
    return {
      checkInTime: String(timeWindow.checkInTime || timeWindow.check_in_time || "").trim(),
      checkOutTime: String(timeWindow.checkOutTime || timeWindow.check_out_time || "").trim()
    };
  }

  function parseTimeToMinutes(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var ampm = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/i);
    if (ampm) {
      var h = parseInt(ampm[1], 10);
      var m = parseInt(ampm[2] || "0", 10);
      var ap = String(ampm[4] || "").toUpperCase();
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return h * 60 + m;
    }
    var parts = s.split(":");
    if (parts.length < 2) return null;
    var hour = parseInt(parts[0], 10);
    var min = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(min)) return null;
    return hour * 60 + min;
  }

  function bookingTimeWindow(booking) {
    booking = booking || {};
    return normalizeTimeWindow({
      checkInTime: booking.checkInTime || booking.check_in_time,
      checkOutTime: booking.checkOutTime || booking.check_out_time
    });
  }

  function stayStartMs(iso, timeStr) {
    var d = isoToUtcDate(iso);
    var mins = parseTimeToMinutes(timeStr);
    if (mins == null) mins = 0;
    return d.getTime() + mins * 60000;
  }

  function stayEndMs(iso, timeStr) {
    var d = isoToUtcDate(iso);
    var mins = parseTimeToMinutes(timeStr);
    if (mins == null) mins = 0;
    return d.getTime() + mins * 60000;
  }

  function staysOverlap(checkInA, timeInA, checkOutA, timeOutA, checkInB, timeInB, checkOutB, timeOutB) {
    if (!rangesOverlap(checkInA, checkOutA, checkInB, checkOutB)) return false;
    var aStart = stayStartMs(checkInA, timeInA);
    var aEnd = stayEndMs(checkOutA, timeOutA);
    var bStart = stayStartMs(checkInB, timeInB);
    var bEnd = stayEndMs(checkOutB, timeOutB);
    if (!(aStart < aEnd) || !(bStart < bEnd)) return rangesOverlap(checkInA, checkOutA, checkInB, checkOutB);
    return aStart < bEnd && bStart < aEnd;
  }

  function isActiveBooking(b) {
    if (!b) return false;
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingBlocksCalendarSlot === "function") {
      return PF.bookingBlocksCalendarSlot(b);
    }
    var st = String(b.status || "Pending").toLowerCase();
    return (
      st !== "cancelled" &&
      st !== "canceled" &&
      st !== "rejected" &&
      st !== "no show" &&
      st !== "no_show"
    );
  }

  /** True when a booking blocks dates but has no room/cottage/hall identity (legacy occupancy RPC). */
  function isDateOnlyOccupancyBooking(b) {
    if (!b) return false;
    if (b._dateOnlyOccupancy) return true;
    var hasRoom =
      !!(b.roomCatalogId || (Array.isArray(b.roomCatalogIds) && b.roomCatalogIds.length) ||
        (b.roomType && String(b.roomType) !== "none"));
    var hasCottage =
      (Array.isArray(b.cottageCatalogIds) && b.cottageCatalogIds.length > 0) ||
      (parseInt(b.cottageQty, 10) || 0) > 0;
    var hall = b.eventHall != null ? String(b.eventHall) : "";
    var hasHall = !!(
      b.hallCatalogId ||
      (Array.isArray(b.hallCatalogIds) && b.hallCatalogIds.length) ||
      (hall && hall !== "none" && hall !== "no")
    );
    var hasMulti =
      (Array.isArray(b.room_ids) && b.room_ids.length > 0) ||
      (Array.isArray(b.facilityIds) && b.facilityIds.length > 0);
    return !hasRoom && !hasCottage && !hasHall && !hasMulti;
  }

  function normalizeRoomKind(kind, roomType) {
    var k = String(kind || roomType || "").toLowerCase();
    if (k === "big") return "big";
    if (k === "small") return "small";
    if (k === "couple") return "couple";
    if (roomType === "big") return "big";
    if (roomType === "small" || roomType === "couple") return "couple";
    return k || "couple";
  }

  function getCatalog() {
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilities === "function") {
      var list = S.getFacilities();
      if (list.length) return list;
    }
    try {
      var raw = localStorage.getItem(STORAGE_CATALOG);
      if (!raw) return defaultCatalog();
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : defaultCatalog();
    } catch (e) {
      return defaultCatalog();
    }
  }

  function defaultCatalog() {
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilities === "function") {
      var fromStore = S.getFacilities();
      if (fromStore && fromStore.length) return fromStore;
    }
    var list = [];
    var n;
    for (n = 1; n <= 8; n++) {
      list.push({
        id: "small-room-" + n,
        type: "room",
        roomKind: "small",
        name: "Small Room " + n,
        price: 2500,
        priceUnit: "night",
        image: "../Images/small-room-bed.jpg",
        images: [
          "../Images/small-room-bed.jpg",
          "../Images/small-room-bath.jpg",
          "../Images/small-room-tv.jpg"
        ],
        description: "Cozy small room for up to 4 persons (4 pax).",
        capacity: 4,
        capacityMin: null
      });
    }
    for (n = 1; n <= 2; n++) {
      list.push({
        id: "big-room-" + n,
        type: "room",
        roomKind: "big",
        name: "Family Room " + n,
        price: 7500,
        priceUnit: "night",
        image: n === 1 ? "../Images/big-room-1-bed.jpg" : "../Images/big-room-2-beds.jpg",
        images: n === 1
          ? [
              "../Images/big-room-1-bed.jpg",
              "../Images/big-room-1-living-tv.jpg",
              "../Images/big-room-1-living-sofa.jpg",
              "../Images/big-room-1-kitchen.jpg",
              "../Images/big-room-1-bath.jpg"
            ]
          : [
              "../Images/big-room-2-beds.jpg",
              "../Images/big-room-2-living-sofa.jpg",
              "../Images/big-room-2-tv.jpg",
              "../Images/big-room-2-bath.jpg"
            ],
        description: "Spacious family room for up to 15 persons (15 pax).",
        capacity: 15,
        capacityMin: null
      });
    }
    for (n = 1; n <= 10; n++) {
      list.push({
        id: "cottage-" + n,
        type: "cottage",
        name: "Cottage " + n,
        price: 1000,
        priceUnit: "day",
        image: n % 2 === 0 ? "../Images/gallery-4.png" : "../Images/gallery-5.png",
        description: "Open-air cottage for up to 20 persons (20 pax).",
        capacity: 20,
        capacityMin: null
      });
    }
    list.push(
      { id: "hall-poolside", type: "hall", name: "Poolside Hall", price: 10000, priceUnit: "event", image: "../Images/gallery-2.png", description: "Event hall for 60–150 persons (60–150 pax).", capacity: 150, capacityMin: 60 },
      { id: "hall-upper", type: "hall", name: "Upper Hall", price: 15000, priceUnit: "event", image: "../Images/gallery-3.png", description: "Event hall for 60–150 persons (60–150 pax).", capacity: 150, capacityMin: 60 },
      { id: "hall-function", type: "hall", name: "New Function Hall", price: 15000, priceUnit: "event", image: "../Images/gallery-1.png", description: "Event hall for 60–150 persons (60–150 pax).", capacity: 150, capacityMin: 60 },
      { id: "hall-ac", type: "hall", name: "Air-conditioned Hall", price: 8500, priceUnit: "event", image: "../Images/gallery-6.png", description: "Indoor cooled hall for 60–150 persons (60–150 pax).", capacity: 150, capacityMin: 60 }
    );
    return list;
  }

  function defaultCapacityForUnit(unit) {
    var t = String((unit && unit.type) || "room");
    if (t === "cottage") return { capacity: 20, capacityMin: null };
    if (t === "hall") return { capacity: 150, capacityMin: 60 };
    if (normalizeRoomKind(unit && unit.roomKind, "") === "big") return { capacity: 15, capacityMin: null };
    return { capacity: 4, capacityMin: null };
  }

  function getUnitCapacity(unit) {
    var defaults = defaultCapacityForUnit(unit || {});
    var max = unit && unit.capacity != null ? Number(unit.capacity) : defaults.capacity;
    if (!max || max <= 0 || isNaN(max)) max = defaults.capacity;
    var min = null;
    if (String((unit && unit.type) || "") === "hall") {
      min = unit && unit.capacityMin != null ? Number(unit.capacityMin) : defaults.capacityMin;
      if (!min || min <= 0 || isNaN(min)) min = 60;
    }
    return { min: min, max: max };
  }

  function formatCapacityLabel(unit) {
    var caps = getUnitCapacity(unit);
    if (caps.min != null && caps.min > 0 && caps.min !== caps.max) {
      return caps.min + "–" + caps.max + " pax";
    }
    return "Up to " + caps.max + " pax";
  }

  function uniqueIds(ids) {
    var seen = {};
    var out = [];
    (ids || []).forEach(function (id) {
      var key = String(id || "").trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  /** Normalize selection to multi-facility arrays while keeping legacy single-id fields. */
  function normalizeSelection(selection) {
    selection = selection || {};
    var roomIds = uniqueIds(
      []
        .concat(Array.isArray(selection.roomCatalogIds) ? selection.roomCatalogIds : [])
        .concat(selection.roomCatalogId ? [selection.roomCatalogId] : [])
    );
    var cottageIds = uniqueIds(
      Array.isArray(selection.cottageCatalogIds) ? selection.cottageCatalogIds : []
    );
    var hallIds = uniqueIds(
      []
        .concat(Array.isArray(selection.hallCatalogIds) ? selection.hallCatalogIds : [])
        .concat(selection.hallCatalogId ? [selection.hallCatalogId] : [])
    );
    return {
      roomCatalogIds: roomIds,
      roomCatalogId: roomIds[0] || "",
      cottageCatalogIds: cottageIds,
      hallCatalogIds: hallIds,
      hallCatalogId: hallIds[0] || "",
      allowNoFacility: !!selection.allowNoFacility
    };
  }

  function listSelectedUnitIds(selection) {
    var sel = normalizeSelection(selection);
    return sel.roomCatalogIds.concat(sel.cottageCatalogIds).concat(sel.hallCatalogIds);
  }

  function countSelectedFacilities(selection) {
    return listSelectedUnitIds(selection).length;
  }

  function getCombinedCapacity(selection) {
    var sel = normalizeSelection(selection);
    var catalog = getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    var totalMax = 0;
    var units = [];
    listSelectedUnitIds(sel).forEach(function (id) {
      var unit = byId[id];
      if (!unit) return;
      var caps = getUnitCapacity(unit);
      totalMax += caps.max;
      units.push({
        id: id,
        name: unit.name || id,
        type: unit.type || "room",
        capacity: caps.max,
        capacityMin: caps.min,
        label: formatCapacityLabel(unit)
      });
    });
    return { totalMax: totalMax, units: units };
  }

  /**
   * Capacity counts adults + children ages 6–12.
   * childrenUnder6 (ages 0–5) are stored for records but do not count toward
   * capacity or entrance fees. Total counted guests = adults + children 6–12.
   */
  function parseGuestCount(adults, children6Plus, childrenUnder6OrOpts) {
    var a = Math.max(0, parseInt(adults, 10) || 0);
    var c6 = Math.max(0, parseInt(children6Plus, 10) || 0);
    var under6 = 0;
    if (childrenUnder6OrOpts && typeof childrenUnder6OrOpts === "object") {
      under6 = Math.max(0, parseInt(childrenUnder6OrOpts.childrenUnder6, 10) || 0);
    } else {
      under6 = Math.max(0, parseInt(childrenUnder6OrOpts, 10) || 0);
    }
    return {
      adults: a,
      children: c6,
      children6Plus: c6,
      childrenUnder6: under6,
      total: a + c6,
      totalAll: a + c6 + under6
    };
  }

  function validateGuestCapacity(selection, adults, children, childrenUnder6OrOpts) {
    var guests = parseGuestCount(adults, children, childrenUnder6OrOpts);
    var combined = getCombinedCapacity(selection);
    var facilityCount = combined.units.length;
    if (!facilityCount) {
      return {
        ok: true,
        guests: guests,
        capacity: combined,
        errors: []
      };
    }
    var errors = [];
    if (guests.total > combined.totalMax) {
      if (facilityCount === 1) {
        var unit = combined.units[0];
        var max = unit && unit.capacity != null ? unit.capacity : combined.totalMax;
        var kind = "facility";
        if (unit && unit.type) {
          var t = String(unit.type).toLowerCase();
          if (t.indexOf("room") >= 0) kind = "room";
          else if (t.indexOf("cottage") >= 0) kind = "cottage";
          else if (t.indexOf("hall") >= 0 || t.indexOf("event") >= 0) kind = "event hall";
        } else if (unit && unit.name) {
          var n = String(unit.name).toLowerCase();
          if (n.indexOf("room") >= 0) kind = "room";
          else if (n.indexOf("cottage") >= 0) kind = "cottage";
          else if (n.indexOf("hall") >= 0) kind = "event hall";
        }
        errors.push(
          "This " +
            kind +
            " can only accommodate up to " +
            max +
            " persons. Please select another facility or reduce the number of guests."
        );
      } else {
        errors.push(
          "Your guest count (" +
            guests.total +
            " persons ages 6+) exceeds the selected facilities' combined capacity (" +
            combined.totalMax +
            " persons). Please select another facility or reduce the number of guests."
        );
      }
    }
    return {
      ok: errors.length === 0,
      guests: guests,
      capacity: combined,
      errors: errors
    };
  }

  function listOverlappingBookings(checkIn, checkOut, excludeBookingId, timeWindow) {
    var tw = normalizeTimeWindow(timeWindow);
    var B = window.ElenestBookings;
    var rows =
      B && typeof B.listForAvailability === "function"
        ? B.listForAvailability()
        : B && typeof B.listLive === "function"
          ? B.listLive()
          : [];
    return rows.filter(function (item) {
      var b = item.booking || {};
      if (excludeBookingId && String(b.id) === String(excludeBookingId)) return false;
      if (!isActiveBooking(b)) return false;
      var bt = bookingTimeWindow(b);
      return staysOverlap(
        checkIn,
        tw.checkInTime,
        checkOut,
        tw.checkOutTime,
        b.checkIn,
        bt.checkInTime,
        b.checkOut,
        bt.checkOutTime
      );
    });
  }

  function isTemporaryHoldBooking(b) {
    if (!b) return false;
    var PF = window.ElenestPaymentFlow;
    if (!PF) return false;
    if (PF.normalizePaymentType(b.paymentType) !== "down") return false;
    if (!b.holdExpiresAt || PF.isHoldExpired(b)) return false;
    var st = PF.normalizeBookingStatus(b.status);
    return st === PF.STATUS.FOR_VERIFICATION || st === PF.STATUS.RESERVED;
  }

  function getDateHoldStats(iso, excludeBookingId, timeWindow) {
    if (!iso) return { holds: 0, confirmed: 0 };
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    var next = utcDateToIso(d);
    var holds = 0;
    var confirmed = 0;
    listOverlappingBookings(iso, next, excludeBookingId, timeWindow).forEach(function (item) {
      var b = item.booking || {};
      if (isTemporaryHoldBooking(b)) holds++;
      else confirmed++;
    });
    return { holds: holds, confirmed: confirmed };
  }

  function markOccupiedUnit(byUnitId, unitId) {
    var id = canonicalizeUnitId(unitId);
    if (!id) return false;
    byUnitId[id] = true;
    // Also mark raw string so mixed legacy ids still match.
    var raw = String(unitId || "").trim();
    if (raw && raw !== id) byUnitId[raw] = true;
    return true;
  }

  function buildOccupancy(checkIn, checkOut, excludeBookingId, timeWindow) {
    var byUnitId = {};
    var legacyRooms = { big: 0, couple: 0, small: 0 };
    var legacyCottages = 0;
    var legacyHalls = 0;
    var dateOnlyCount = 0;

    listOverlappingBookings(checkIn, checkOut, excludeBookingId, timeWindow).forEach(function (item) {
      var b = item.booking || {};

      if (isDateOnlyOccupancyBooking(b)) {
        dateOnlyCount += 1;
        return;
      }

      var markedRoom = false;
      if (Array.isArray(b.roomCatalogIds) && b.roomCatalogIds.length) {
        b.roomCatalogIds.forEach(function (rid) {
          if (markOccupiedUnit(byUnitId, rid)) markedRoom = true;
        });
      }
      if (!markedRoom && b.roomCatalogId) {
        if (markOccupiedUnit(byUnitId, b.roomCatalogId)) markedRoom = true;
      }
      if (!markedRoom && b.roomType && String(b.roomType) !== "none") {
        var rk = normalizeRoomKind("", b.roomType);
        legacyRooms[rk] = (legacyRooms[rk] || 0) + 1;
      }

      var markedCottage = false;
      if (Array.isArray(b.cottageCatalogIds) && b.cottageCatalogIds.length) {
        b.cottageCatalogIds.forEach(function (cid) {
          if (markOccupiedUnit(byUnitId, cid)) markedCottage = true;
        });
      }
      if (!markedCottage) {
        legacyCottages += Math.max(0, parseInt(b.cottageQty, 10) || 0);
      }

      var markedHall = false;
      if (Array.isArray(b.hallCatalogIds) && b.hallCatalogIds.length) {
        b.hallCatalogIds.forEach(function (hid) {
          if (markOccupiedUnit(byUnitId, hid)) markedHall = true;
        });
      }
      if (!markedHall && b.hallCatalogId) {
        if (markOccupiedUnit(byUnitId, b.hallCatalogId)) markedHall = true;
      }
      if (!markedHall && b.eventHall && String(b.eventHall) !== "none" && String(b.eventHall) !== "no") {
        legacyHalls += 1;
      }

      // Explicit multi-facility id list (payload.room_ids / facilityIds) — mark ALL units.
      if (Array.isArray(b.room_ids)) {
        b.room_ids.forEach(function (rid) {
          markOccupiedUnit(byUnitId, rid);
        });
      }
      if (Array.isArray(b.facilityIds)) {
        b.facilityIds.forEach(function (fid) {
          markOccupiedUnit(byUnitId, fid);
        });
      }
    });

    // Mobile public calendar: get_public_availability_snapshot.booked_room_ids[]
    // (and per-date unavailable facility ids) — marks every booked facility.
    var B = window.ElenestBookings;
    if (B && typeof B.forEachBlockedFacilityInRange === "function") {
      B.forEachBlockedFacilityInRange(checkIn, checkOut, function (unitId) {
        markOccupiedUnit(byUnitId, unitId);
      });
    }

    return {
      byUnitId: byUnitId,
      legacyRooms: legacyRooms,
      legacyCottages: legacyCottages,
      legacyHalls: legacyHalls,
      dateOnlyCount: dateOnlyCount
    };
  }

  function freeUnitsOfType(catalog, type, kindFilter) {
    return catalog
      .filter(function (u) {
        if (String(u.type || "room") !== type) return false;
        if (type === "room" && kindFilter) {
          return normalizeRoomKind(u.roomKind, "") === kindFilter;
        }
        return true;
      })
      .slice()
      .sort(function (a, b) {
        return String(a.id).localeCompare(String(b.id));
      });
  }

  function isUnitOccupiedInMap(byUnitId, unitId) {
    if (!byUnitId || !unitId) return false;
    var id = canonicalizeUnitId(unitId);
    var raw = String(unitId || "").trim();
    return !!(byUnitId[id] || byUnitId[raw] || byUnitId[String(unitId)]);
  }

  /** Per-range occupancy cache — calendar months call this dozens of times. */
  var occupancyCache = Object.create(null);
  var statsCache = Object.create(null);

  function clearAvailabilityCaches() {
    occupancyCache = Object.create(null);
    statsCache = Object.create(null);
  }

  function occupancyCacheKey(checkIn, checkOut, excludeBookingId, timeWindow) {
    var tw = normalizeTimeWindow(timeWindow);
    return (
      String(checkIn || "") +
      "|" +
      String(checkOut || "") +
      "|" +
      String(excludeBookingId || "") +
      "|" +
      String(tw.checkInTime || "") +
      "|" +
      String(tw.checkOutTime || "")
    );
  }

  function getOccupancyCached(checkIn, checkOut, excludeBookingId, timeWindow) {
    var key = occupancyCacheKey(checkIn, checkOut, excludeBookingId, timeWindow);
    if (!occupancyCache[key]) {
      occupancyCache[key] = buildOccupancy(checkIn, checkOut, excludeBookingId, timeWindow);
    }
    return occupancyCache[key];
  }

  function isUnitAvailableWithOcc(unit, occ, checkIn, checkOut) {
    if (!unit || !unit.id || !occ || !checkIn || !checkOut) return false;
    if (isUnitOccupiedInMap(occ.byUnitId, unit.id)) return false;

    var catalog = getCatalog();
    var type = String(unit.type || "room");

    if (type === "room") {
      var kind = normalizeRoomKind(unit.roomKind, "");
      var free = freeUnitsOfType(catalog, "room", kind).filter(function (u) {
        return !isUnitOccupiedInMap(occ.byUnitId, u.id);
      });
      var legacyDemand = occ.legacyRooms[kind] || 0;
      var idx = free.findIndex(function (u) {
        return unitIdsMatch(u.id, unit.id);
      });
      return idx >= 0 && idx >= legacyDemand;
    }

    if (type === "cottage") {
      var freeC = freeUnitsOfType(catalog, "cottage").filter(function (u) {
        return !isUnitOccupiedInMap(occ.byUnitId, u.id);
      });
      var idxC = freeC.findIndex(function (u) {
        return unitIdsMatch(u.id, unit.id);
      });
      return idxC >= 0 && idxC >= occ.legacyCottages;
    }

    if (type === "hall") {
      var freeH = freeUnitsOfType(catalog, "hall").filter(function (u) {
        return !isUnitOccupiedInMap(occ.byUnitId, u.id);
      });
      var idxH = freeH.findIndex(function (u) {
        return unitIdsMatch(u.id, unit.id);
      });
      return idxH >= 0 && idxH >= occ.legacyHalls;
    }

    return true;
  }

  function isUnitAvailable(unit, checkIn, checkOut, excludeBookingId, timeWindow) {
    if (!unit || !unit.id || !checkIn || !checkOut) return false;
    var occ = getOccupancyCached(checkIn, checkOut, excludeBookingId, timeWindow);
    return isUnitAvailableWithOcc(unit, occ, checkIn, checkOut);
  }

  function listUnitsWithAvailability(checkIn, checkOut, excludeBookingId, timeWindow) {
    var catalog = getCatalog();
    var occ = getOccupancyCached(checkIn, checkOut, excludeBookingId, timeWindow);
    return catalog.map(function (unit) {
      return {
        unit: unit,
        available: isUnitAvailableWithOcc(unit, occ, checkIn, checkOut)
      };
    });
  }

  window.addEventListener("elenest-bookings-updated", clearAvailabilityCaches);
  window.addEventListener("elenest-manager-blocks-updated", clearAvailabilityCaches);

  function validateSelection(selection, checkIn, checkOut, excludeBookingId, guestOpts) {
    selection = normalizeSelection(selection);
    guestOpts = guestOpts || {};
    var timeWindow = normalizeTimeWindow(guestOpts);
    var errors = [];
    if (!checkIn || !checkOut) {
      errors.push("Select check-in and check-out dates first.");
      return { ok: false, errors: errors };
    }

    var roomIds = selection.roomCatalogIds;
    var cottageIds = selection.cottageCatalogIds;
    var hallIds = selection.hallCatalogIds;
    var catalog = getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });

    roomIds.forEach(function (rid) {
      var room = byId[rid];
      if (!room) errors.push("A selected room is no longer in the catalog.");
      else if (!isUnitAvailable(room, checkIn, checkOut, excludeBookingId, timeWindow)) {
        errors.push(
          "This room is unavailable for your selected date and time. Please select another available room."
        );
      }
    });

    cottageIds.forEach(function (cid) {
      var cot = byId[cid];
      if (!cot) errors.push("A selected cottage is no longer in the catalog.");
      else if (!isUnitAvailable(cot, checkIn, checkOut, excludeBookingId, timeWindow)) {
        errors.push(
          "This cottage is unavailable for your selected date and time. Please select another available cottage."
        );
      }
    });

    hallIds.forEach(function (hid) {
      var hall = byId[hid];
      if (!hall) errors.push("A selected event hall is no longer in the catalog.");
      else if (!isUnitAvailable(hall, checkIn, checkOut, excludeBookingId, timeWindow)) {
        errors.push(
          "This event hall is unavailable for your selected date and time. Please select another available event hall."
        );
      }
    });

    var facilityCount = roomIds.length + cottageIds.length + hallIds.length;
    if (!facilityCount && !selection.allowNoFacility) {
      errors.push("Select at least one room, cottage, or event hall.");
    }

    if (guestOpts.validateGuests && facilityCount > 0) {
      var guestCheck = validateGuestCapacity(
        selection,
        guestOpts.adults,
        guestOpts.children,
        { childrenUnder6: guestOpts.childrenUnder6 }
      );
      guestCheck.errors.forEach(function (msg) {
        errors.push(msg);
      });
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      selection: selection,
      capacity: getCombinedCapacity(selection)
    };
  }

  function deriveLegacyFields(selection) {
    selection = normalizeSelection(selection);
    var catalog = getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });

    var roomType = "none";
    var roomNames = [];
    selection.roomCatalogIds.forEach(function (rid) {
      if (!byId[rid]) return;
      var room = byId[rid];
      roomNames.push(room.name || "");
      if (roomType === "none") {
        var kind = normalizeRoomKind(room.roomKind, "");
        roomType = kind === "big" ? "big" : "couple";
      }
    });

    var cottageIds = selection.cottageCatalogIds;
    var cottageQty = String(cottageIds.length);
    var cottageNames = cottageIds
      .map(function (id) {
        return byId[id] ? byId[id].name : "";
      })
      .filter(Boolean);

    var eventHall = "none";
    var hallNames = [];
    selection.hallCatalogIds.forEach(function (hid) {
      if (!byId[hid]) return;
      var hall = byId[hid];
      hallNames.push(hall.name || "");
      if (eventHall === "none") {
        var lower = String(hall.name || "").toLowerCase();
        if (lower.indexOf("pool") !== -1) eventHall = "poolside";
        else if (lower.indexOf("upper") !== -1) eventHall = "upper";
        else if (lower.indexOf("function") !== -1) eventHall = "new_function";
        else if (lower.indexOf("air") !== -1 || lower.indexOf("ac") !== -1) eventHall = "ac";
        else eventHall = "poolside";
      }
    });

    var facilityIds = listSelectedUnitIds(selection);
    var combined = getCombinedCapacity(selection);

    return {
      roomType: roomType,
      roomCatalogId: selection.roomCatalogId || "",
      roomCatalogIds: selection.roomCatalogIds.slice(),
      roomCatalogName: roomNames.join(", "),
      roomCatalogNames: roomNames,
      cottageQty: cottageQty,
      cottageCatalogIds: cottageIds.slice(),
      cottageCatalogNames: cottageNames,
      eventHall: eventHall,
      hallCatalogId: selection.hallCatalogId || "",
      hallCatalogIds: selection.hallCatalogIds.slice(),
      hallCatalogName: hallNames.join(", "),
      hallCatalogNames: hallNames,
      room_ids: facilityIds.slice(),
      facilityIds: facilityIds.slice(),
      capacityTotal: combined.totalMax,
      capacityLabel: combined.totalMax ? combined.totalMax + " pax" : ""
    };
  }

  function unitPriceForStay(unit, nights) {
    if (!unit) return 0;
    var n = Math.max(1, nights || 1);
    var price = Number(unit.price) || 0;
    var unitType = String(unit.priceUnit || "night");
    if (String(unit.type) === "hall" || unitType === "event") return price;
    if (unitType === "day") return price * n;
    return price * n;
  }

  var POOL_ENTRANCE_FEE_PER_GUEST = 250;

  function formatPoolEntranceLineLabel(paidGuests) {
    var n = Math.max(0, parseInt(paidGuests, 10) || 0);
    return "Swimming Pool Entrance: ₱250 × " + n + (n === 1 ? " guest" : " guests");
  }

  function selectionFromBookingRecord(b) {
    b = b || {};
    var roomIds = Array.isArray(b.roomCatalogIds) ? b.roomCatalogIds.slice() : [];
    if (!roomIds.length && b.roomCatalogId) roomIds = [String(b.roomCatalogId)];
    var hallIds = Array.isArray(b.hallCatalogIds) ? b.hallCatalogIds.slice() : [];
    if (!hallIds.length && b.hallCatalogId) hallIds = [String(b.hallCatalogId)];
    var cottageIds = Array.isArray(b.cottageCatalogIds) ? b.cottageCatalogIds.slice() : [];
    return normalizeSelection({
      roomCatalogIds: roomIds,
      cottageCatalogIds: cottageIds,
      hallCatalogIds: hallIds
    });
  }

  /** Cottage-only (no room/hall): ₱250 × chargeable guests. Legacy pool_only stays supported. */
  function selectionRequiresPoolEntranceFee(selection, poolUse) {
    if (String(poolUse || "").toLowerCase() === "pool_only") return true;
    selection = normalizeSelection(selection);
    if (!selection.cottageCatalogIds.length) return false;
    if (selection.roomCatalogIds.length || selection.hallCatalogIds.length) return false;
    return true;
  }

  function computePoolEntranceFee(selection, poolUse, guestOpts) {
    if (!selectionRequiresPoolEntranceFee(selection, poolUse)) {
      return { poolFee: 0, paidGuests: 0, lineLabel: "" };
    }
    var guests = parseGuestCount(
      guestOpts && guestOpts.adults,
      guestOpts && (guestOpts.children != null ? guestOpts.children : guestOpts.children6Plus),
      guestOpts || {}
    );
    var paidGuests = guests.total;
    var poolFee = paidGuests * POOL_ENTRANCE_FEE_PER_GUEST;
    return {
      poolFee: poolFee,
      paidGuests: paidGuests,
      lineLabel: formatPoolEntranceLineLabel(paidGuests)
    };
  }

  function nightsBetweenIso(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 1;
    var d1 = new Date(checkIn + "T12:00:00");
    var d2 = new Date(checkOut + "T12:00:00");
    return Math.max(1, Math.round((d2 - d1) / 86400000));
  }

  function computeBookingRecordPricing(booking) {
    booking = booking || {};
    if (!booking.checkIn || !booking.checkOut) return null;
    return computeSelectionPricing(
      selectionFromBookingRecord(booking),
      nightsBetweenIso(booking.checkIn, booking.checkOut),
      booking.poolUse || "none",
      {
        adults: booking.adults,
        children: booking.children,
        childrenUnder6: booking.childrenUnder6
      }
    );
  }

  function swimmingPoolLabelForBooking(b) {
    b = b || {};
    var poolUse = b.poolUse || "none";
    var sel = selectionFromBookingRecord(b);
    if (selectionRequiresPoolEntranceFee(sel, poolUse)) {
      var guests = parseGuestCount(b.adults, b.children, { childrenUnder6: b.childrenUnder6 });
      return formatPoolEntranceLineLabel(guests.total);
    }
    if (sel.hallCatalogIds.length) {
      return "Complimentary FREE for 20–25 guests only";
    }
    if (String(poolUse).toLowerCase() === "day_tour") return "Swimming Included (Day Tour)";
    return "Swimming Included";
  }

  function computeSelectionPricing(selection, nights, poolUse, guestOpts) {
    var catalog = getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    var sel = normalizeSelection(selection);
    var n = Math.max(1, nights || 1);
    var roomSub = 0;
    var cottageSub = 0;
    var hallFee = 0;
    var lines = [];

    sel.roomCatalogIds.forEach(function (rid) {
      if (!byId[rid]) return;
      var room = byId[rid];
      var sub = unitPriceForStay(room, n);
      roomSub += sub;
      lines.push({ label: room.name || "Room", amount: sub });
    });

    sel.cottageCatalogIds.forEach(function (cid) {
      if (!byId[cid]) return;
      var sub = unitPriceForStay(byId[cid], n);
      cottageSub += sub;
      lines.push({ label: byId[cid].name || "Cottage", amount: sub });
    });

    sel.hallCatalogIds.forEach(function (hid) {
      if (!byId[hid]) return;
      var hall = byId[hid];
      var sub = unitPriceForStay(hall, n);
      hallFee += sub;
      lines.push({ label: hall.name || "Event hall", amount: sub });
    });

    // Room / event hall: swimming included. Cottage-only (or legacy pool_only): ₱250 × chargeable guests.
    var entrance = computePoolEntranceFee(sel, poolUse, guestOpts);
    var poolFee = entrance.poolFee;
    var paidGuests = entrance.paidGuests;
    if (poolFee > 0 && entrance.lineLabel) {
      lines.push({ label: entrance.lineLabel, amount: poolFee });
    }

    var subtotal = roomSub + cottageSub + hallFee + poolFee;
    return {
      nights: n,
      roomSub: roomSub,
      cottageSub: cottageSub,
      hallFee: hallFee,
      poolFee: poolFee,
      paidGuests: paidGuests,
      subtotal: subtotal,
      down: Math.round(subtotal * 0.2),
      lines: lines,
      capacityTotal: getCombinedCapacity(sel).totalMax
    };
  }

  function canonicalizeUnitId(unitId) {
    var id = String(unitId || "").trim();
    if (!id) return "";
    var m = id.match(/^def-room-(small|big|couple)-(\d+)$/i);
    if (m) return String(m[1]).toLowerCase() + "-room-" + m[2];
    return id;
  }

  function unitIdsMatch(a, b) {
    var left = canonicalizeUnitId(a);
    var right = canonicalizeUnitId(b);
    if (!left || !right) return false;
    return left === right;
  }

  function bookingOccupiesUnit(booking, unitId) {
    if (!booking || !unitId) return false;
    var uid = canonicalizeUnitId(unitId);
    if (Array.isArray(booking.roomCatalogIds)) {
      for (var r = 0; r < booking.roomCatalogIds.length; r++) {
        if (unitIdsMatch(booking.roomCatalogIds[r], uid)) return true;
      }
    }
    if (booking.roomCatalogId && unitIdsMatch(booking.roomCatalogId, uid)) return true;
    if (Array.isArray(booking.hallCatalogIds)) {
      for (var h = 0; h < booking.hallCatalogIds.length; h++) {
        if (unitIdsMatch(booking.hallCatalogIds[h], uid)) return true;
      }
    }
    if (booking.hallCatalogId && unitIdsMatch(booking.hallCatalogId, uid)) return true;
    if (Array.isArray(booking.cottageCatalogIds)) {
      for (var i = 0; i < booking.cottageCatalogIds.length; i++) {
        if (unitIdsMatch(booking.cottageCatalogIds[i], uid)) return true;
      }
    }
    if (Array.isArray(booking.room_ids)) {
      for (var j = 0; j < booking.room_ids.length; j++) {
        if (unitIdsMatch(booking.room_ids[j], uid)) return true;
      }
    }
    if (Array.isArray(booking.facilityIds)) {
      for (var k = 0; k < booking.facilityIds.length; k++) {
        if (unitIdsMatch(booking.facilityIds[k], uid)) return true;
      }
    }
    return false;
  }

  function getUnitNightStatus(unitId, iso, excludeBookingId, timeWindow) {
    if (!unitId || !iso) return "available";
    var catalog = getCatalog();
    var unit = catalog.find(function (u) {
      return unitIdsMatch(u.id, unitId) || String(u.id) === String(unitId);
    });
    if (!unit) return "available";
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    var next = utcDateToIso(d);
    var overlapping = listOverlappingBookings(iso, next, excludeBookingId, timeWindow);
    var hasHold = false;
    overlapping.forEach(function (item) {
      var b = item.booking || {};
      if (!bookingOccupiesUnit(b, unitId)) return;
      if (isTemporaryHoldBooking(b)) hasHold = true;
    });
    if (!isUnitAvailable(unit, iso, next, excludeBookingId, timeWindow)) {
      return hasHold ? "hold" : "booked";
    }
    var B = window.ElenestBookings;
    if (
      !timeWindow &&
      B &&
      typeof B.isFacilityBlockedOnDate === "function" &&
      B.isFacilityBlockedOnDate(unitId, iso)
    ) {
      return "booked";
    }
    return "available";
  }

  function dateHasDateOnlyOccupancy(iso, excludeBookingId) {
    if (!iso) return false;
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    var next = utcDateToIso(d);
    return listOverlappingBookings(iso, next, excludeBookingId).some(function (item) {
      return isDateOnlyOccupancyBooking(item.booking || {});
    });
  }

  function isUnitNightUnavailable(unitId, iso, excludeBookingId, timeWindow) {
    return getUnitNightStatus(unitId, iso, excludeBookingId, timeWindow) !== "available";
  }

  function isUnitBlockedForStay(unitId, checkIn, checkOut, excludeBookingId, timeWindow) {
    if (!unitId || !checkIn || !checkOut) return true;
    var cur = isoToUtcDate(checkIn);
    var end = isoToUtcDate(checkOut);
    while (cur < end) {
      if (isUnitNightUnavailable(unitId, utcDateToIso(cur), excludeBookingId, timeWindow)) return true;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return false;
  }

  function listUnitsByType(type) {
    return getCatalog().filter(function (u) {
      return !type || String(u.type || "room") === type;
    });
  }

  /** True when every catalog unit is booked for this night (for calendar hints). */
  function isDateFullyBooked(iso) {
    return getDateBookingStatus(iso) === "full";
  }

  function getDateBookingStats(iso, excludeBookingId) {
    if (!iso) return { total: 0, available: 0, booked: 0, dateOnly: 0 };
    var cacheKey = occupancyCacheKey(iso, "stats", excludeBookingId);
    if (statsCache[cacheKey]) return statsCache[cacheKey];

    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + 1);
    var next = utcDateToIso(d);
    var catalog = getCatalog();
    var total = catalog.length;
    var occ = getOccupancyCached(iso, next, excludeBookingId);
    var available = 0;
    catalog.forEach(function (unit) {
      if (isUnitAvailableWithOcc(unit, occ, iso, next)) available++;
    });
    var booked = Math.max(0, total - available);
    // Date-only rows still count as occupancy for resort-wide legend colors.
    if (occ.dateOnlyCount > 0 && booked === 0) {
      booked = Math.min(total, occ.dateOnlyCount);
      available = Math.max(0, total - booked);
    }
    var result = {
      total: total,
      available: available,
      booked: booked,
      dateOnly: occ.dateOnlyCount || 0
    };
    statsCache[cacheKey] = result;
    return result;
  }

  /** "available" | "full" — per-night facility occupancy from the catalog. */
  function getDateBookingStatus(iso, excludeBookingId) {
    var stats = getDateBookingStats(iso, excludeBookingId);
    if (!stats.total) return "available";
    if (stats.available === 0) return "full";
    return "available";
  }

  /** True when at least one catalog unit is reserved for this night. */
  function hasReservationsOnDate(iso, excludeBookingId) {
    return getDateBookingStats(iso, excludeBookingId).booked > 0;
  }

  window.ElenestUnitAvailability = {
    getCatalog: getCatalog,
    rangesOverlap: rangesOverlap,
    staysOverlap: staysOverlap,
    normalizeTimeWindow: normalizeTimeWindow,
    listOverlappingBookings: listOverlappingBookings,
    isUnitAvailable: isUnitAvailable,
    listUnitsWithAvailability: listUnitsWithAvailability,
    validateSelection: validateSelection,
    deriveLegacyFields: deriveLegacyFields,
    computeSelectionPricing: computeSelectionPricing,
    computeBookingRecordPricing: computeBookingRecordPricing,
    selectionFromBookingRecord: selectionFromBookingRecord,
    selectionRequiresPoolEntranceFee: selectionRequiresPoolEntranceFee,
    formatPoolEntranceLineLabel: formatPoolEntranceLineLabel,
    swimmingPoolLabelForBooking: swimmingPoolLabelForBooking,
    POOL_ENTRANCE_FEE_PER_GUEST: POOL_ENTRANCE_FEE_PER_GUEST,
    normalizeSelection: normalizeSelection,
    listSelectedUnitIds: listSelectedUnitIds,
    countSelectedFacilities: countSelectedFacilities,
    getUnitCapacity: getUnitCapacity,
    formatCapacityLabel: formatCapacityLabel,
    getCombinedCapacity: getCombinedCapacity,
    validateGuestCapacity: validateGuestCapacity,
    parseGuestCount: parseGuestCount,
    isDateFullyBooked: isDateFullyBooked,
    getDateBookingStats: getDateBookingStats,
    getDateBookingStatus: getDateBookingStatus,
    hasReservationsOnDate: hasReservationsOnDate,
    getDateHoldStats: getDateHoldStats,
    isTemporaryHoldBooking: isTemporaryHoldBooking,
    bookingOccupiesUnit: bookingOccupiesUnit,
    getUnitNightStatus: getUnitNightStatus,
    dateHasDateOnlyOccupancy: dateHasDateOnlyOccupancy,
    isDateOnlyOccupancyBooking: isDateOnlyOccupancyBooking,
    isUnitNightUnavailable: isUnitNightUnavailable,
    isUnitBlockedForStay: isUnitBlockedForStay,
    listUnitsByType: listUnitsByType
  };
})();
