/**
 * Shared month grid used on book.html (date selection) and calendar.html (availability).
 */
(function () {
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function resolveEl(idOrEl) {
    if (!idOrEl) return null;
    if (typeof idOrEl === "string") return document.getElementById(idOrEl);
    return idOrEl;
  }

  function getFacilityStatus(av, iso, unitCatalogId, resortWideView, showLiveOccupancy) {
    if (unitCatalogId && av && typeof av.getDateFacilityStatusForUnit === "function") {
      return av.getDateFacilityStatusForUnit(iso, unitCatalogId);
    }
    if (
      (resortWideView || showLiveOccupancy) &&
      av &&
      typeof av.getDateFacilityStatus === "function"
    ) {
      return av.getDateFacilityStatus(iso);
    }
    if (av && typeof av.getDateFacilityStatusForUnit === "function") {
      return av.getDateFacilityStatusForUnit(iso, "");
    }
    return null;
  }

  function dateHasReservations(iso, unitCatalogId) {
    if (unitCatalogId) {
      var UA = window.ElenestUnitAvailability;
      if (UA && typeof UA.getUnitNightStatus === "function") {
        return UA.getUnitNightStatus(unitCatalogId, iso) !== "available";
      }
      return false;
    }
    var UA2 = window.ElenestUnitAvailability;
    if (UA2 && typeof UA2.hasReservationsOnDate === "function") {
      return UA2.hasReservationsOnDate(iso);
    }
    return false;
  }

  /**
   * @param {object} opts
   * @param {string|HTMLElement} opts.host — calendar grid container
   * @param {string|HTMLElement} opts.monthLabel — element for "Month YYYY"
   * @param {{y:number,m:number}} opts.calView
   * @param {{checkIn:string|null,checkOut:string|null}} [opts.wizardState]
   * @param {function(string):void} [opts.onDayClick] — called with YYYY-MM-DD for selectable days
   * @param {boolean} [opts.highlightRange] — show check-in / check-out / in-between (booking flow)
   * @param {boolean} [opts.allowManagerToggle] — allow clicking manager-blocked days to unblock (manager portal)
   * @param {boolean} [opts.allowUnavailableClick] — allow clicking unavailable days (for selection in manager portal)
   * @param {boolean} [opts.allowAllDayClick] — allow clicking every day including past/booked (owner dashboard)
   * @param {boolean} [opts.resortWideView] — manager/admin: show resort-wide occupancy (default false)
   * @param {boolean} [opts.showLiveOccupancy] — book Step 2: color days from live Supabase bookings; only manager closures and fully booked nights block selection
   * @param {string|null} [opts.selectedIso] — YYYY-MM-DD to keep highlighted after click (admin/manager)
   */
  function render(opts) {
    var host = resolveEl(opts.host);
    var label = resolveEl(opts.monthLabel);
    if (!host || !label) return;

    var calView = opts.calView || { y: new Date().getFullYear(), m: new Date().getMonth() };
    var wizardState = opts.wizardState || { checkIn: null, checkOut: null };
    var highlightRange = opts.highlightRange !== false;
    var onDayClick = typeof opts.onDayClick === "function" ? opts.onDayClick : null;
    var allowManagerToggle = !!opts.allowManagerToggle;
    var allowUnavailableClick = !!opts.allowUnavailableClick;
    var allowAllDayClick = !!opts.allowAllDayClick;
    var unitCatalogId = opts.unitCatalogId ? String(opts.unitCatalogId) : "";
    var resortWideView = opts.resortWideView === true;
    var showLiveOccupancy = opts.showLiveOccupancy === true;
    var liveResortView = resortWideView || showLiveOccupancy;
    var extraIsUnavailable =
      typeof opts.extraIsUnavailable === "function" ? opts.extraIsUnavailable : null;
    var selectedIso = opts.selectedIso ? String(opts.selectedIso) : "";

    var y = calView.y;
    var m = calView.m;
    var av = window.ElenestAvailability;
    if (!av) return;

    // Wait for availability once, then paint a single time (avoids double full-month rebuild).
    // Fallback timeout so the grid never stays stuck on "Loading…".
    if (av.ready && typeof av.ready.then === "function" && !av._calendarReadySettled) {
      if (!av._calendarReadyPending) {
        av._calendarReadyPending = true;
        var settle = function () {
          if (av._calendarReadySettled) return;
          av._calendarReadySettled = true;
          av._calendarReadyPending = false;
          render(opts);
        };
        av.ready.then(settle).catch(settle);
        setTimeout(settle, 2500);
      }
      label.textContent = new Date(y, m, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric"
      });
      if (!host.getAttribute("data-cal-waiting")) {
        host.setAttribute("data-cal-waiting", "1");
        host.innerHTML = '<p class="note" style="margin:12px 0;text-align:center;">Loading calendar…</p>';
      }
      return;
    }
    host.removeAttribute("data-cal-waiting");

    label.textContent = new Date(y, m, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
    host.textContent = "";
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var first = new Date(y, m, 1);
    var startPad = first.getDay();
    var daysIn = new Date(y, m + 1, 0).getDate();
    var weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var head = document.createElement("div");
    head.className = "book-flow-cal-weekdays";
    weekdays.forEach(function (w) {
      var c = document.createElement("div");
      c.className = "book-flow-cal-wd";
      c.textContent = w;
      head.appendChild(c);
    });
    host.appendChild(head);
    var grid = document.createElement("div");
    grid.className = "book-flow-cal-grid";
    for (var i = 0; i < startPad; i++) {
      var e = document.createElement("div");
      e.className = "book-flow-cal-cell book-flow-cal-cell--empty";
      grid.appendChild(e);
    }
    for (var day = 1; day <= daysIn; day++) {
      var iso = y + "-" + pad2(m + 1) + "-" + pad2(day);
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "book-flow-cal-day";
      cell.setAttribute("data-iso", iso);
      var cellDate = new Date(y, m, day);
      var past = cellDate < today;
      var facilityStatus = getFacilityStatus(
        av,
        iso,
        unitCatalogId,
        resortWideView,
        showLiveOccupancy
      );
      var blocked;
      if (unitCatalogId) {
        blocked =
          av.isUnavailableForUnit(iso, unitCatalogId) ||
          (extraIsUnavailable && extraIsUnavailable(iso));
      } else if (resortWideView) {
        blocked = av.isUnavailable(iso) || (extraIsUnavailable && extraIsUnavailable(iso));
      } else {
        blocked =
          (av.getManagerBlocked && av.getManagerBlocked(iso)) ||
          (extraIsUnavailable && extraIsUnavailable(iso));
      }
      var kind = blocked
        ? unitCatalogId || !resortWideView
          ? facilityStatus && facilityStatus.kind
          : av.getUnavailableKind(iso)
        : facilityStatus
          ? facilityStatus.kind
          : null;
      if (!unitCatalogId && !liveResortView && blocked && !kind) {
        kind = av.getManagerBlocked && av.getManagerBlocked(iso) ? "manager" : null;
      }
      if (!unitCatalogId && !liveResortView && blocked && !kind) {
        blocked = false;
      }
      if (!unitCatalogId && !liveResortView && blocked && kind !== "manager" && kind !== "google") {
        blocked = false;
        kind = null;
      }
      if (
        blocked &&
        extraIsUnavailable &&
        extraIsUnavailable(iso) &&
        kind !== "manager" &&
        kind !== "booked" &&
        kind !== "limited" &&
        kind !== "hold"
      ) {
        kind = "booked";
      }
      if (past || blocked) {
        // Manager portal exception: allow unblocking manager-blocked dates.
        var isManagerBlocked = !past && kind === "manager";
        var canClickUnavailable = !past && allowUnavailableClick && onDayClick;
        if ((!isManagerBlocked || !allowManagerToggle || !onDayClick) && !canClickUnavailable) {
          cell.classList.add("book-flow-cal-day--disabled");
          cell.disabled = true;
        } else {
          cell.classList.add("book-flow-cal-day--manager-blocked");
          cell.disabled = false;
        }
        kind = past ? "past" : kind;
        if (past) {
          cell.classList.add("book-flow-cal-day--past");
        } else if (kind === "booked" || kind === "limited" || kind === "hold") {
          cell.classList.add("book-flow-cal-day--booked");
        } else {
          cell.classList.add("book-flow-cal-day--unavailable");
        }
        if (past) {
          cell.title = "Past date";
        } else if (kind === "booked" || kind === "limited" || kind === "hold") {
          cell.title =
            facilityStatus && facilityStatus.label
              ? facilityStatus.label
              : unitCatalogId
                ? "Booked — this unit is reserved"
                : "Booked — no units left for this date";
        } else if (kind === "manager") {
          cell.title = "Blocked by manager — tap to unblock";
        } else {
          cell.title = "Unavailable";
        }
        var numPast = document.createElement("span");
        numPast.className = "book-flow-cal-day__num";
        numPast.textContent = String(day);
        var statusPast = document.createElement("span");
        statusPast.className = "book-flow-cal-day__status";
        if (past) statusPast.textContent = "Past";
        else if (kind === "booked" || kind === "limited" || kind === "hold") {
          statusPast.textContent = "Booked";
        } else if (kind === "manager") {
          statusPast.textContent = "Block";
        } else statusPast.textContent = "Closed";
        cell.appendChild(numPast);
        cell.appendChild(statusPast);

        if (
          !allowAllDayClick &&
          !past &&
          onDayClick &&
          (canClickUnavailable || (allowManagerToggle && kind === "manager"))
        ) {
          (function (isoVal) {
            cell.addEventListener("click", function () {
              onDayClick(isoVal);
            });
          })(iso);
        }
      } else {
        var liveStatus = facilityStatus && facilityStatus.status;
        var liveKind = facilityStatus && facilityStatus.kind;
        var isFull =
          liveResortView &&
          !unitCatalogId &&
          (liveStatus === "full" || liveKind === "limited" || liveKind === "booked");
        var isUnitBookedHint =
          !!unitCatalogId &&
          facilityStatus &&
          (facilityStatus.kind === "booked" ||
            facilityStatus.kind === "hold" ||
            facilityStatus.status === "booked" ||
            facilityStatus.status === "hold");
        // Fully booked nights / this unit already reserved — gray and unclickable.
        if (isFull || isUnitBookedHint) {
          cell.classList.add("book-flow-cal-day--disabled");
          cell.classList.add("book-flow-cal-day--booked");
          cell.disabled = true;
          cell.title =
            facilityStatus && facilityStatus.label
              ? facilityStatus.label
              : unitCatalogId
                ? "Booked — this unit is reserved"
                : "Booked — no units left for this date";
          var numFull = document.createElement("span");
          numFull.className = "book-flow-cal-day__num";
          numFull.textContent = String(day);
          var statusFull = document.createElement("span");
          statusFull.className = "book-flow-cal-day__status";
          statusFull.textContent = "Booked";
          cell.appendChild(numFull);
          cell.appendChild(statusFull);
        } else {
          var numOk = document.createElement("span");
          numOk.className = "book-flow-cal-day__num";
          numOk.textContent = String(day);
          cell.appendChild(numOk);
          cell.classList.add("book-flow-cal-day--available");
          cell.title = "Available — tap to select";
          if (highlightRange) {
            if (wizardState.checkIn === iso) cell.classList.add("book-flow-cal-day--checkin");
            if (wizardState.checkOut === iso) cell.classList.add("book-flow-cal-day--checkout");
            if (
              wizardState.checkIn &&
              wizardState.checkOut &&
              iso > wizardState.checkIn &&
              iso < wizardState.checkOut
            ) {
              cell.classList.add("book-flow-cal-day--range");
            }
          }
          if (onDayClick && !allowAllDayClick) {
            (function (isoVal) {
              cell.addEventListener("click", function () {
                onDayClick(isoVal);
              });
            })(iso);
          }
        }
      }
      if (allowAllDayClick && onDayClick) {
        cell.disabled = false;
        (function (isoVal) {
          cell.addEventListener("click", function () {
            onDayClick(isoVal);
          });
        })(iso);
      }
      if (selectedIso && iso === selectedIso) {
        cell.classList.add("book-flow-cal-day--selected");
        cell.setAttribute("aria-pressed", "true");
        cell.setAttribute("aria-current", "date");
      }
      grid.appendChild(cell);
    }
    host.appendChild(grid);
  }

  window.ElenestCalendarWidget = {
    render: render
  };
})();
