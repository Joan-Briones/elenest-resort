/**
 * Shared availability: live Supabase bookings + manager blocks only (no Google Calendar).
 */
(function () {
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Google Calendar is disabled — calendar colors come from Supabase only.
  var googleCalendarIcsUrl = "";
  var googleBusyByIso = {};
  var googleBusyLoaded = true;
  var googleBusyLoadPromise = null;
  var googleBusyLoadError = null;
  var STORAGE_MANAGER_BLOCKS = "elenest_manager_blocks";
  var managerBlockedByIso = {};
  var useSupabaseOnly = true;
  var googleBusyKeywords = [];

  function isoToUtcDate(iso) {
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10) - 1;
    var d = parseInt(iso.slice(8, 10), 10);
    return new Date(Date.UTC(y, m, d));
  }

  function utcDateToIso(d) {
    return (
      d.getUTCFullYear() +
      "-" +
      pad2(d.getUTCMonth() + 1) +
      "-" +
      pad2(d.getUTCDate())
    );
  }

  function yyyymmddToIso(yyyymmdd) {
    if (!yyyymmdd || String(yyyymmdd).length < 8) return "";
    return (
      yyyymmdd.slice(0, 4) +
      "-" +
      yyyymmdd.slice(4, 6) +
      "-" +
      yyyymmdd.slice(6, 8)
    );
  }

  function unfoldIcs(text) {
    return String(text || "")
      .replace(/\r\n[ \t]/g, "")
      .replace(/\r/g, "\n");
  }

  function legacyUnavailable(iso) {
    var d = new Date(iso + "T12:00:00");
    var day = d.getDay();
    return day === 0 && d.getDate() % 3 === 0;
  }

  function loadGoogleBusyOnce() {
    // Supabase-only mode: skip Google iCal entirely.
    if (useSupabaseOnly || !googleCalendarIcsUrl) {
      googleBusyByIso = {};
      googleBusyLoaded = true;
      googleBusyLoadError = null;
      return Promise.resolve();
    }
    if (googleBusyLoaded) return Promise.resolve();
    if (googleBusyLoadPromise) return googleBusyLoadPromise;

    googleBusyLoadPromise = fetch(googleCalendarIcsUrl)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Failed to load Google Calendar iCal (" + res.status + ")");
        }
        return res.text();
      })
      .then(function (ics) {
        var today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        var windowStartUtc = new Date(today.getTime());
        var windowEndUtc = new Date(today.getTime());
        windowEndUtc.setUTCDate(windowEndUtc.getUTCDate() + 365);

        var lines = unfoldIcs(ics).split("\n");

        googleBusyByIso = {};

        var inEvent = false;
        var dtStartVal = null;
        var dtEndVal = null;
        var dtStartIsAllDay = false;
        var dtEndIsAllDay = false;
        var summaryVal = null;

        function setIfInWindow(iso) {
          if (!iso) return;
          var d = isoToUtcDate(iso);
          if (d < windowStartUtc || d >= windowEndUtc) return;
          googleBusyByIso[iso] = true;
        }

        function addAllDayRange(startIso, endIsoExclusive) {
          if (!startIso || !endIsoExclusive) return;
          var cur = isoToUtcDate(startIso);
          var end = isoToUtcDate(endIsoExclusive);
          while (cur < end) {
            setIfInWindow(utcDateToIso(cur));
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
        }

        for (var i = 0; i < lines.length; i++) {
          var line = String(lines[i] || "").trim();
          if (!line) continue;

          if (line === "BEGIN:VEVENT") {
            inEvent = true;
            dtStartVal = null;
            dtEndVal = null;
            dtStartIsAllDay = false;
            dtEndIsAllDay = false;
            summaryVal = null;
            continue;
          }
          if (line === "END:VEVENT") {
            if (inEvent && dtStartVal) {
              var summaryLower = summaryVal ? String(summaryVal).toLowerCase() : "";
              var isBusyKeywordMatch =
                !googleBusyKeywords.length ||
                googleBusyKeywords.some(function (k) {
                  return summaryLower.indexOf(k) !== -1;
                });
              if (!isBusyKeywordMatch) {
                inEvent = false;
                continue;
              }
              var dtStartDatePart = dtStartVal.split("T")[0];
              if (dtStartIsAllDay) {
                var startIso = yyyymmddToIso(dtStartDatePart);
                var endIsoExclusive = dtEndVal
                  ? yyyymmddToIso(dtEndVal.split("T")[0])
                  : yyyymmddToIso(dtStartDatePart);
                if (!dtEndVal) {
                  var tmp = isoToUtcDate(startIso);
                  tmp.setUTCDate(tmp.getUTCDate() + 1);
                  endIsoExclusive = utcDateToIso(tmp);
                }
                addAllDayRange(startIso, endIsoExclusive);
              } else {
                setIfInWindow(yyyymmddToIso(dtStartDatePart));
              }
            }
            inEvent = false;
            continue;
          }

          if (!inEvent) continue;

          if (line.indexOf("DTSTART") === 0) {
            var colon = line.indexOf(":");
            dtStartVal = colon >= 0 ? line.slice(colon + 1) : null;
            dtStartIsAllDay = line.indexOf("VALUE=DATE") !== -1;
          } else if (line.indexOf("DTEND") === 0) {
            var colon2 = line.indexOf(":");
            dtEndVal = colon2 >= 0 ? line.slice(colon2 + 1) : null;
            dtEndIsAllDay = line.indexOf("VALUE=DATE") !== -1;
          } else if (line.indexOf("SUMMARY") === 0) {
            var colon3 = line.indexOf(":");
            summaryVal = colon3 >= 0 ? line.slice(colon3 + 1) : null;
          }
        }

        googleBusyLoaded = true;
        return;
      })
      .catch(function (err) {
        googleBusyLoadError = err;
        googleBusyLoaded = true;
      });

    return googleBusyLoadPromise;
  }

  function getSupabase() {
    return window.ElenestSupabase || null;
  }

  function emitManagerBlocksUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-manager-blocks-updated"));
    } catch (e) {}
  }

  function loadManagerBlocks() {
    try {
      var raw = localStorage.getItem(STORAGE_MANAGER_BLOCKS);
      if (!raw) {
        managerBlockedByIso = {};
        return;
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        managerBlockedByIso = {};
        return;
      }
      var map = {};
      parsed.forEach(function (iso) {
        var k = String(iso || "").trim();
        if (k && /^\d{4}-\d{2}-\d{2}$/.test(k)) map[k] = true;
      });
      managerBlockedByIso = map;
    } catch (e) {
      managerBlockedByIso = {};
    }
  }

  function saveManagerBlocksLocal() {
    try {
      var list = Object.keys(managerBlockedByIso).filter(function (k) {
        return managerBlockedByIso[k];
      });
      localStorage.setItem(STORAGE_MANAGER_BLOCKS, JSON.stringify(list));
    } catch (e) {}
  }

  function applyManagerBlockRows(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      var iso = String(
        (row && (row.blocked_date || row.blockedDate || row.date || row.iso)) || ""
      ).trim();
      if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
        map[iso.slice(0, 10)] = true;
      }
    });
    managerBlockedByIso = map;
    saveManagerBlocksLocal();
    emitManagerBlocksUpdated();
    return map;
  }

  function loadManagerBlocksFromSupabase() {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(managerBlockedByIso);
    return sb
      .from("manager_blocked_dates")
      .select("blocked_date, note")
      .then(function (res) {
        if (res.error) throw res.error;
        applyManagerBlockRows(res.data || []);
        return managerBlockedByIso;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Availability] manager_blocked_dates load failed:", err);
        } catch (e) {}
        return managerBlockedByIso;
      });
  }

  function persistManagerBlockToSupabase(iso, blocked) {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(false);
    var key = String(iso || "").trim().slice(0, 10);
    if (!key) return Promise.resolve(false);

    var CA = window.ElenestCalendarAccess;
    var run =
      CA && typeof CA.applyOwnerChange === "function"
        ? CA.applyOwnerChange(key, !!blocked, blocked ? "Blocked by owner" : "")
        : sb.rpc("owner_set_calendar_block", {
            p_date: key,
            p_blocked: !!blocked,
            p_note: blocked ? "Blocked by owner" : ""
          }).then(function (res) {
            if (res.error) throw res.error;
            return res.data;
          });

    return Promise.resolve(run)
      .then(function () {
        return true;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest Availability] official calendar change failed:", err);
        } catch (e) {}
        return false;
      });
  }

  function setupManagerBlocksRealtime() {
    var sb = getSupabase();
    if (!sb || setupManagerBlocksRealtime._done) return;
    setupManagerBlocksRealtime._done = true;
    try {
      sb.channel("elenest-manager-blocks")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "manager_blocked_dates" },
          function () {
            loadManagerBlocksFromSupabase();
          }
        )
        .subscribe();
    } catch (e) {}
  }

  // Local cache first, then live Supabase (so guest calendars see manager Closed dates).
  loadManagerBlocks();
  var managerBlocksReady = loadManagerBlocksFromSupabase()
    .then(function () {
      setupManagerBlocksRealtime();
      return managerBlockedByIso;
    })
    .catch(function () {
      // Never leave calendars waiting forever if Supabase is offline.
      setupManagerBlocksRealtime();
      return managerBlockedByIso;
    });
  // Soft backup only — realtime is primary. Skip when tab is hidden.
  setInterval(function () {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    loadManagerBlocksFromSupabase();
  }, 60000);

  function isResortWideBlock(iso) {
    if (managerBlockedByIso[iso]) return true;
    if (googleBusyByIso[iso]) return true;
    return false;
  }

  function getDateFacilityStatusForUnit(iso, unitCatalogId) {
    if (managerBlockedByIso[iso]) {
      return { status: "blocked", kind: "manager", label: "Blocked by manager" };
    }
    if (
      unitCatalogId &&
      window.ElenestUnitAvailability &&
      typeof window.ElenestUnitAvailability.getUnitNightStatus === "function"
    ) {
      var unitStatus = window.ElenestUnitAvailability.getUnitNightStatus(unitCatalogId, iso);
      if (unitStatus === "pending") {
        var pendingLabel =
          typeof window.ElenestUnitAvailability.pendingCalendarLabel === "function"
            ? window.ElenestUnitAvailability.pendingCalendarLabel()
            : "Pending Admin Confirmation";
        return {
          status: "pending",
          kind: "pending",
          label: pendingLabel
        };
      }
      if (unitStatus === "booked" || unitStatus === "hold") {
        return {
          status: "booked",
          kind: "booked",
          label: "Booked — this unit is reserved"
        };
      }
      return { status: "available", kind: null, label: "Available for this room" };
    }
    return { status: "available", kind: null, label: "Select a room to view its calendar" };
  }

  function isUnavailableForUnit(iso, unitCatalogId) {
    if (!iso) return true;
    if (managerBlockedByIso[iso]) return true;
    if (
      unitCatalogId &&
      window.ElenestUnitAvailability &&
      typeof window.ElenestUnitAvailability.isUnitNightUnavailable === "function"
    ) {
      return window.ElenestUnitAvailability.isUnitNightUnavailable(unitCatalogId, iso);
    }
    return false;
  }

  function getDateFacilityStatus(iso) {
    if (managerBlockedByIso[iso]) {
      return { status: "blocked", kind: "manager", label: "Blocked by manager" };
    }
    if (googleBusyByIso[iso]) {
      return { status: "blocked", kind: "google", label: "Unavailable" };
    }
    if (
      window.ElenestUnitAvailability &&
      typeof window.ElenestUnitAvailability.getDateBookingStats === "function"
    ) {
      var stats = window.ElenestUnitAvailability.getDateBookingStats(iso);
      var bookingStatus = !stats || !stats.total
        ? "available"
        : stats.available === 0
          ? "full"
          : "available";
      var pendingLabel =
        window.ElenestUnitAvailability &&
        typeof window.ElenestUnitAvailability.pendingCalendarLabel === "function"
          ? window.ElenestUnitAvailability.pendingCalendarLabel()
          : "Pending Admin Confirmation";
      if (bookingStatus === "full") {
        if (!stats || (stats.verified || 0) === 0) {
          return {
            status: "pending",
            kind: "pending",
            label: pendingLabel,
            stats: stats
          };
        }
        return {
          status: "full",
          kind: "limited",
          label: "Booked — no units left for this date",
          stats: stats
        };
      }
      if (stats && (stats.pending || 0) > 0) {
        return {
          status: "available",
          kind: null,
          label: pendingLabel,
          stats: stats,
          hasPending: true
        };
      }
      return { status: "available", kind: null, label: "Available", stats: stats };
    }

    // Supabase-only: open dates stay available (no Google / legacy fake blocks).
    return { status: "available", kind: null, label: "Available", stats: null };
  }

  function isUnavailable(iso) {
    if (managerBlockedByIso[iso]) return true;
    if (googleBusyByIso[iso]) return true;
    var facility = getDateFacilityStatus(iso);
    if (facility.status === "full" || facility.status === "pending") return true;
    if (useSupabaseOnly) return false;
    if (googleBusyLoaded && !googleBusyLoadError) return false;
    return legacyUnavailable(iso);
  }

  /**
   * For calendar cell labels (not past).
   * "limited" = all catalog units reserved for this night.
   * Dates with remaining open units stay available (green).
   */
  function getUnavailableKind(iso) {
    var facility = getDateFacilityStatus(iso);
    if (facility.kind === "manager") return "manager";
    if (facility.kind === "google") return "google";
    if (facility.kind === "pending") return "pending";
    if (facility.kind === "limited") return "limited";
    if (facility.kind === "booked") return "booked";
    if (facility.kind === "hold") return "hold";
    if (facility.kind === "legacy") return "legacy";
    return null;
  }

  /** Legacy whole-resort night check (manager dashboards / reports). */
  function isGlobalNightOccupied(iso) {
    if (
      window.ElenestBookings &&
      typeof window.ElenestBookings.isGlobalNightOccupied === "function"
    ) {
      return window.ElenestBookings.isGlobalNightOccupied(iso);
    }
    return false;
  }

  window.ElenestAvailability = {
    loadGoogleBusyOnce: loadGoogleBusyOnce,
    isUnavailable: isUnavailable,
    getUnavailableKind: getUnavailableKind,
    getManagerBlocked: function (iso) {
      return !!managerBlockedByIso[String(iso || "").trim()];
    },
    setManagerBlocked: function (iso, blocked) {
      var key = String(iso || "").trim();
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return Promise.resolve(false);
      return persistManagerBlockToSupabase(key, !!blocked).then(function (ok) {
        if (!ok) return false;
        return loadManagerBlocksFromSupabase().then(function () {
          return true;
        });
      });
    },
    listManagerBlocked: function () {
      return Object.keys(managerBlockedByIso).filter(function (k) { return managerBlockedByIso[k]; }).sort();
    },
    refreshManagerBlocks: loadManagerBlocksFromSupabase,
    ready: managerBlocksReady,
    getGoogleBusyLoaded: function () {
      return googleBusyLoaded;
    },
    getGoogleBusyLoadError: function () {
      return googleBusyLoadError;
    },
    getDateFacilityStatus: getDateFacilityStatus,
    getDateFacilityStatusForUnit: getDateFacilityStatusForUnit,
    isUnavailableForUnit: isUnavailableForUnit,
    isResortWideBlock: isResortWideBlock,
    isGlobalNightOccupied: isGlobalNightOccupied
  };
})();
