(function () {
  var gate = document.getElementById("authGate");
  var booking = document.getElementById("bookingSection");
  var reserveBanner = document.getElementById("bookReserveBanner");
  var navUser = document.getElementById("bookNavUser");
  var welcomeOverlay = document.getElementById("welcomeModal");
  var welcomeOk = document.getElementById("welcomeModalOk");
  var welcomeTitle = document.getElementById("welcomeModalTitle");
  var feedbackOverlay = document.getElementById("feedbackRequiredOverlay");
  var logoutConfirmStep = document.getElementById("logoutFeedbackConfirmStep");
  var logoutFeedbackYesBtn = document.getElementById("logoutFeedbackYesBtn");
  var logoutFeedbackNoBtn = document.getElementById("logoutFeedbackNoBtn");

  function closeFeedbackOverlay() {
    if (!feedbackOverlay) return;
    feedbackOverlay.setAttribute("hidden", "");
    if (logoutConfirmStep) logoutConfirmStep.removeAttribute("hidden");
  }

  function openLogoutConfirmOverlay() {
    if (!feedbackOverlay) return;
    if (logoutConfirmStep) logoutConfirmStep.removeAttribute("hidden");
    feedbackOverlay.removeAttribute("hidden");
    if (logoutFeedbackYesBtn) logoutFeedbackYesBtn.focus();
  }

  /** @deprecated use openLogoutConfirmOverlay — kept for older call sites */
  function openFeedbackOverlay() {
    openLogoutConfirmOverlay();
  }

  function goHomeAfterLogout() {
    try {
      window.location.replace("index.html");
    } catch (e) {
      window.location.href = "index.html";
    }
  }

  function performLogout(triggerBtn) {
    var BL = window.ElenestButtonLoading;
    if (BL && triggerBtn) BL.set(triggerBtn, true);
    else if (triggerBtn) triggerBtn.disabled = true;
    return window.ElenestAuth
      .logout()
      .then(function () {
        closeFeedbackOverlay();
        goHomeAfterLogout();
      })
      .catch(function () {
        closeFeedbackOverlay();
        goHomeAfterLogout();
      })
      .finally(function () {
        if (BL && triggerBtn) BL.set(triggerBtn, false);
        else if (triggerBtn) triggerBtn.disabled = false;
      });
  }

  var currentFlowStep = 1;
  var BOOK_FLOW_STEP_KEY = "elenest_book_flow_step_v9";
  var BOOK_FLOW_DRAFT_KEY = "elenest_book_flow_draft_v1";
  var LAST_COMPLETED_RECEIPT_KEY = "elenest_last_completed_receipt_v1";
  var lastCompletedBooking = null;
  var wizardState = {
    checkIn: null,
    checkOut: null,
    checkInTime: null,
    checkOutTime: null,
    pendingRecord: null,
    selectedPaymentMethodId: null,
    paymentType: "full",
    downPaymentAgreed: false,
    payableBooking: null,
    reviewBookingId: null,
    paymentProofSubmitted: false,
    skipResume: false,
    unitSelection: {
      roomCatalogIds: [],
      roomCatalogId: "",
      cottageCatalogIds: [],
      hallCatalogIds: [],
      hallCatalogId: ""
    },
    unitSelectionConfirmed: false
  };
  var facilityPickerBusy = false;
  var unitPickerTab = "room";
  var calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var RATES = { couple: 2500, big: 7500, none: 0 };
  /** ₱250 per chargeable guest when a cottage is booked (ages 0–5 free). Included with room/event hall. */
  var POOL_FEE_PER_PAID_GUEST = 250;
  /** Complimentary FREE swimming with Event Hall (not a capacity limit for the hall). */
  var HALL_COMPLIMENTARY_POOL_GUESTS = "20–25";
  var COTTAGE_PER_NIGHT = 1000;
  var DAY_TOUR_ARRIVAL_TIME = "8:00 AM";
  var DAY_TOUR_DEPARTURE_TIME = "10:00 PM";
  var POOL_ONLY_ARRIVAL_TIME = "8:00 AM";
  var POOL_ONLY_DEPARTURE_TIME = "10:00 PM";

  function computeACHallFee(hours) {
    var h = Math.max(5, parseInt(hours, 10) || 5);
    return { hours: h, fee: 8500 + (h - 5) * 1000 };
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function getDraftFieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "") : "";
  }

  function setDraftFieldValue(id, value) {
    var el = document.getElementById(id);
    if (!el || value == null) return;
    el.value = String(value);
  }

  function collectBookingDraft() {
    return {
      savedAt: Date.now(),
      step: currentFlowStep,
      form: {
        fullName: getDraftFieldValue("fullName"),
        phone: getDraftFieldValue("phone"),
        email: getDraftFieldValue("email"),
        adults: getDraftFieldValue("adults"),
        children: getDraftFieldValue("children"),
        childrenUnder6: getDraftFieldValue("childrenUnder6"),
        poolUse: getDraftFieldValue("poolUse"),
        eventType: getDraftFieldValue("eventType"),
        eventOther: getDraftFieldValue("eventOther"),
        request: getDraftFieldValue("request")
      },
      wizard: {
        checkIn: wizardState.checkIn,
        checkOut: wizardState.checkOut,
        checkInTime: wizardState.checkInTime,
        checkOutTime: wizardState.checkOutTime,
        selectedPaymentMethodId: wizardState.selectedPaymentMethodId,
        paymentType: wizardState.paymentType || "full",
        downPaymentAgreed: !!wizardState.downPaymentAgreed,
        unitSelection: cloneUnitSelection(wizardState.unitSelection),
        unitSelectionConfirmed: !!wizardState.unitSelectionConfirmed,
        reviewBookingId: wizardState.reviewBookingId || "",
        payableBookingId:
          wizardState.payableBooking && wizardState.payableBooking.id
            ? wizardState.payableBooking.id
            : ""
      },
      calView: { y: calView.y, m: calView.m }
    };
  }

  function saveBookingDraft() {
    try {
      localStorage.setItem(BOOK_FLOW_DRAFT_KEY, JSON.stringify(collectBookingDraft()));
      localStorage.setItem(BOOK_FLOW_STEP_KEY, String(currentFlowStep));
    } catch (e) {}
  }

  function clearBookingDraft() {
    try {
      localStorage.removeItem(BOOK_FLOW_DRAFT_KEY);
    } catch (e) {}
  }

  function applyDraftForm(form) {
    if (!form || typeof form !== "object") return;
    [
      "fullName",
      "phone",
      "email",
      "adults",
      "children",
      "childrenUnder6",
      "poolUse",
      "eventType",
      "eventOther",
      "request"
    ].forEach(function (id) {
      if (form[id] != null && form[id] !== "") setDraftFieldValue(id, form[id]);
    });
    if (getPoolUseValue() === "pool_only") {
      setDraftFieldValue("poolUse", "day_tour");
      syncStayTypeFromPoolUse();
    }
    if (eventTypeEl && eventOtherWrap) {
      var isOther = eventTypeEl.value === "other";
      eventOtherWrap.hidden = !isOther;
      if (eventOther) eventOther.required = isOther;
    }
    syncAcHallWrap();
    syncStayTypeFromPoolUse();
  }

  function restoreBookingDraft() {
    try {
      var raw = null;
      try {
        raw = localStorage.getItem(BOOK_FLOW_DRAFT_KEY);
      } catch (e) {
        return false;
      }
      if (!raw) return false;
      var draft = null;
      try {
        draft = JSON.parse(raw);
      } catch (e2) {
        return false;
      }
      if (!draft || typeof draft !== "object") return false;

      if (draft.form) applyDraftForm(draft.form);

      if (draft.wizard && typeof draft.wizard === "object") {
        var w = draft.wizard;
        if (w.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(w.checkIn)) wizardState.checkIn = w.checkIn;
        if (w.checkOut && /^\d{4}-\d{2}-\d{2}$/.test(w.checkOut)) wizardState.checkOut = w.checkOut;
        wizardState.checkInTime = w.checkInTime || null;
        wizardState.checkOutTime = w.checkOutTime || null;
        wizardState.selectedPaymentMethodId = w.selectedPaymentMethodId || null;
        wizardState.paymentType = w.paymentType === "down" ? "down" : "full";
        wizardState.downPaymentAgreed = !!w.downPaymentAgreed;
        wizardState.unitSelection = cloneUnitSelection(w.unitSelection);
        var confirmed = !!w.unitSelectionConfirmed;
        try {
          confirmed = confirmed && hasSelectedFacilities();
        } catch (e3) {
          confirmed = false;
        }
        wizardState.unitSelectionConfirmed = confirmed;
        wizardState.reviewBookingId = w.reviewBookingId || null;
        wizardState.payableBooking = w.payableBookingId ? { id: w.payableBookingId } : null;
      }

      if (draft.calView && draft.calView.y != null && draft.calView.m != null) {
        calView.y = Number(draft.calView.y) || calView.y;
        calView.m = Number(draft.calView.m);
        if (isNaN(calView.m) || calView.m < 0 || calView.m > 11) {
          calView.m = new Date().getMonth();
        }
      }
      return true;
    } catch (err) {
      try {
        console.warn("[Elenest Book] Draft restore failed:", err);
      } catch (e) {}
      return false;
    }
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
  }

  function digitsOnly(v) {
    return String(v || "").replace(/\D+/g, "");
  }

  function formatTime12h(h24, min) {
    var h = parseInt(h24, 10);
    var m = min === undefined || min === null ? 0 : parseInt(min, 10);
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(m) + " " + ampm;
  }

  /** Parse times saved as "3:00 PM" (12-hour) or "15:00" (24-hour, legacy). */
  function parseHHmm(s) {
    var raw = String(s || "0:00").trim();
    var m12 = raw.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
    if (m12) {
      var hh = parseInt(m12[1], 10);
      var mm = parseInt(m12[2], 10);
      var ap = m12[3].toUpperCase();
      if (ap === "PM" && hh !== 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
      return { h: hh, m: mm };
    }
    var parts = raw.split(":");
    return { h: parseInt(parts[0], 10) || 0, m: parseInt(parts[1], 10) || 0 };
  }

  function formatStoredTimeHHmm(s) {
    var p = parseHHmm(s);
    return formatTime12h(p.h, p.m);
  }

  function isoToUtcDate(iso) {
    // iso = YYYY-MM-DD
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

  function addDaysIso(iso, days) {
    var d = isoToUtcDate(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return utcDateToIso(d);
  }

  /** Step 2 calendar: manager closures and fully booked nights cannot be selected. */
  function isCalendarDateBlocked(iso) {
    var av = window.ElenestAvailability;
    if (!av || !iso) return false;
    if (av.getManagerBlocked && av.getManagerBlocked(iso)) return true;
    if (typeof av.isUnavailable === "function" && av.isUnavailable(iso)) return true;
    return false;
  }

  function getPoolUseValue() {
    var poolEl = document.getElementById("poolUse");
    return poolEl && poolEl.value ? poolEl.value : "none";
  }

  function getStayTypeValue() {
    var checked = document.querySelector('input[name="bookStayType"]:checked');
    if (checked && checked.value) return checked.value;
    var pool = getPoolUseValue();
    if (pool === "day_tour") return "day_tour";
    if (pool === "pool_only") return "day_tour";
    return "overnight";
  }

  function syncStayTypeFromPoolUse() {
    var overnight = document.querySelector('input[name="bookStayType"][value="overnight"]');
    var dayTour = document.querySelector('input[name="bookStayType"][value="day_tour"]');
    if (!overnight || !dayTour) return;
    var pool = getPoolUseValue();
    if (pool === "day_tour" || pool === "pool_only") dayTour.checked = true;
    else overnight.checked = true;
  }

  function applyStayTypeToPoolUse(stay) {
    var poolEl = document.getElementById("poolUse");
    if (!poolEl) return;
    if (stay === "day_tour") {
      poolEl.value = "day_tour";
    } else {
      poolEl.value = "none";
    }
    resetUnitSelection();
    afterBookingRuleOrDatesChanged();
    saveBookingDraft();
  }

  function ensureDefaultDayTourStayType() {
    var dayTourStay = document.querySelector('input[name="bookStayType"][value="day_tour"]');
    if (dayTourStay) dayTourStay.checked = true;
    var poolEl = document.getElementById("poolUse");
    if (poolEl) poolEl.value = "day_tour";
    syncStayTypeFromPoolUse();
    afterBookingRuleOrDatesChanged();
  }

  function getEventTypeValue() {
    var et = document.getElementById("eventType");
    return et && et.value ? et.value : "";
  }

  function getSelectedCatalogUnit() {
    var sel = getUnitSelection();
    var UA = window.ElenestUnitAvailability;
    if (!UA || typeof UA.getCatalog !== "function") return null;
    var id =
      sel.roomCatalogId ||
      sel.hallCatalogId ||
      (sel.cottageCatalogIds && sel.cottageCatalogIds[0]) ||
      "";
    if (!id) return null;
    return UA.getCatalog().find(function (u) {
      return String(u.id) === String(id);
    }) || null;
  }

  /** Day Tour or Overnight facility bookings include swimming at ₱0. */
  function isSwimmingIncludedBooking() {
    return isDayTourBooking() || isOvernightBooking();
  }

  /** Legacy bookings only — customer flow no longer offers Swimming Pool Only as a stay type. */
  function isPoolOnlyBooking() {
    return getPoolUseValue() === "pool_only";
  }

  function selectionRequiresPoolEntranceFee(sel) {
    var UA = window.ElenestUnitAvailability;
    if (!UA || typeof UA.selectionRequiresPoolEntranceFee !== "function") return false;
    return UA.selectionRequiresPoolEntranceFee(sel || getUnitSelection(), getPoolUseValue());
  }

  function poolEntranceLineLabelForGuestCounts(guests) {
    var UA = window.ElenestUnitAvailability;
    if (!UA || typeof UA.parseGuestCount !== "function") return "";
    var g = UA.parseGuestCount(guests.adults, guests.children, { childrenUnder6: guests.childrenUnder6 });
    if (UA.formatPoolEntranceLineLabel) return UA.formatPoolEntranceLineLabel(g.total);
    return "Swimming Pool Entrance: ₱250 × " + g.total + " guests";
  }

  function swimmingLabelForActiveSelection() {
    var sel = getUnitSelection();
    if (selectionRequiresPoolEntranceFee(sel)) {
      return poolEntranceLineLabelForGuestCounts(getGuestCounts());
    }
    if (isSwimmingIncludedBooking()) {
      return swimmingIncludedLabelForSelection(sel);
    }
    if (isPoolOnlyBooking()) {
      return poolEntranceLineLabelForGuestCounts(getGuestCounts());
    }
    return "Included";
  }

  function selectionHasRoom(sel) {
    sel = sel || getUnitSelection();
    return !!(
      (sel.roomCatalogIds && sel.roomCatalogIds.length) ||
      sel.roomCatalogId
    );
  }

  function selectionHasCottage(sel) {
    sel = sel || getUnitSelection();
    return !!(sel.cottageCatalogIds && sel.cottageCatalogIds.length);
  }

  function selectionHasEventHall(sel) {
    sel = sel || getUnitSelection();
    return !!(
      (sel.hallCatalogIds && sel.hallCatalogIds.length) ||
      sel.hallCatalogId
    );
  }

  function bookingHasEventHall(b) {
    if (!b) return false;
    if (b.hallCatalogId) return true;
    if (Array.isArray(b.hallCatalogIds) && b.hallCatalogIds.length) return true;
    if (b.hallCatalogName) return true;
    if (Array.isArray(b.hallCatalogNames) && b.hallCatalogNames.length) return true;
    var h = b.eventHall != null ? String(b.eventHall) : "";
    return !!(h && h !== "none" && h !== "no");
  }

  function setFacilityPoolNoteVisible(el, show) {
    if (!el) return;
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
  }

  /**
   * Room / Event Hall / Cottage swimming notes are never combined.
   * Each note appears only when that facility type is selected.
   */
  function syncFacilityPoolNotes() {
    var sel = getUnitSelection();
    var hasRoom = selectionHasRoom(sel);
    var hasCottage = selectionHasCottage(sel);
    var hasHall = selectionHasEventHall(sel);
    var confirmed = !!(wizardState.unitSelectionConfirmed && hasSelectedFacilities());

    setFacilityPoolNoteVisible(document.getElementById("bookUnitRoomPoolNote"), hasRoom);
    setFacilityPoolNoteVisible(document.getElementById("bookUnitHallPoolNote"), hasHall);
    setFacilityPoolNoteVisible(document.getElementById("bookUnitCottagePoolNote"), hasCottage);

    setFacilityPoolNoteVisible(
      document.getElementById("bookUnitRoomPoolSummaryNote"),
      confirmed && hasRoom
    );
    setFacilityPoolNoteVisible(
      document.getElementById("bookUnitHallPoolSummaryNote"),
      confirmed && hasHall
    );
    setFacilityPoolNoteVisible(
      document.getElementById("bookUnitCottagePoolSummaryNote"),
      confirmed && hasCottage
    );

    setFacilityPoolNoteVisible(
      document.getElementById("bookStayRoomPoolNote"),
      confirmed && hasRoom
    );
    setFacilityPoolNoteVisible(
      document.getElementById("bookStayHallPoolNote"),
      confirmed && hasHall
    );
    setFacilityPoolNoteVisible(
      document.getElementById("bookStayCottagePoolNote"),
      confirmed && hasCottage
    );
  }

  /** @deprecated Use syncFacilityPoolNotes — kept as alias for older call sites. */
  function syncEventHallPoolNote() {
    syncFacilityPoolNotes();
  }

  function swimmingIncludedLabelForSelection(sel) {
    if (selectionHasEventHall(sel)) {
      return "Complimentary FREE for " + HALL_COMPLIMENTARY_POOL_GUESTS + " guests only";
    }
    return "Included";
  }

  function swimmingIncludedLabelForBooking(b) {
    if (bookingHasEventHall(b)) {
      return "Complimentary FREE for " + HALL_COMPLIMENTARY_POOL_GUESTS + " guests only";
    }
    return "Included";
  }

  function isOvernightBooking() {
    return getStayTypeValue() === "overnight";
  }

  function isSingleDayFacilityType(type) {
    var t = String(type || "").toLowerCase();
    return t === "cottage" || t === "hall";
  }

  function sanitizeSelectionForPoolOnly() {
    if (!isPoolOnlyBooking()) return;
    var sel = getUnitSelection();
    var changed = false;
    if ((sel.roomCatalogIds && sel.roomCatalogIds.length) || sel.roomCatalogId) {
      sel.roomCatalogIds = [];
      sel.roomCatalogId = "";
      changed = true;
    }
    if ((sel.hallCatalogIds && sel.hallCatalogIds.length) || sel.hallCatalogId) {
      sel.hallCatalogIds = [];
      sel.hallCatalogId = "";
      changed = true;
    }
    if (changed) {
      wizardState.unitSelection = cloneUnitSelection(sel);
      wizardState.unitSelectionConfirmed = false;
    }
  }

  /**
   * @returns {{ mode: 'range'|'single', requiresFacility: boolean, facilityKind: string }}
   */
  function getBookingDateRule() {
    if (isDayTourBooking()) {
      return { mode: "single", requiresFacility: true, facilityKind: "day_tour" };
    }

    var unit = getSelectedCatalogUnit();
    var type = unit ? String(unit.type || "room").toLowerCase() : "";

    // Overnight follows the dates the guest already chose, including cottages and halls.
    if (isOvernightBooking()) {
      return { mode: "range", requiresFacility: true, facilityKind: type || "room" };
    }

    if (unit) {
      if (type === "room") {
        return { mode: "range", requiresFacility: true, facilityKind: "room" };
      }
      if (isSingleDayFacilityType(type)) {
        return { mode: "single", requiresFacility: true, facilityKind: type };
      }
      return { mode: "range", requiresFacility: true, facilityKind: type };
    }

    return { mode: "range", requiresFacility: true, facilityKind: "room" };
  }

  function allowsTwoDateSelection() {
    return getBookingDateRule().mode === "range";
  }

  function singleDayCheckoutIso(checkInIso) {
    return addDaysIso(checkInIso, 1);
  }

  function formatDayTourHours() {
    return DAY_TOUR_ARRIVAL_TIME + " – " + DAY_TOUR_DEPARTURE_TIME;
  }

  function formatDayTourScheduleLabel() {
    return formatDayTourHours() + " (fixed)";
  }

  function formatDayTourDateLine() {
    if (!wizardState.checkIn) return "";
    return fmtDateLong(wizardState.checkIn) + " · " + formatDayTourScheduleLabel();
  }

  function syncBookUnitModalCopy() {
    var rule = getBookingDateRule();
    var title = document.getElementById("bookUnitModalTitle");
    var infoTitle = document.getElementById("bookUnitInfoTitle");
    var lead = document.getElementById("bookUnitInfoLead");
    if (title) {
      title.textContent = "Choose a facility";
    }
    if (infoTitle) infoTitle.textContent = "Choose your facility";
    if (lead) {
      lead.textContent =
        "Select a room, cottage, or event hall. Gray units are already booked. Capacity counts adults and children ages 6–12. Swimming pool terms appear for the facility type you select.";
    }
    syncFacilityPoolNotes();
  }

  function hideBookUnitInfoPopup() {
    var popup = document.getElementById("bookUnitInfoPopup");
    if (popup) popup.hidden = true;
  }

  function isBookUnitInfoOpen() {
    var popup = document.getElementById("bookUnitInfoPopup");
    return !!(popup && !popup.hidden);
  }

  function showBookUnitInfoPopup() {
    var popup = document.getElementById("bookUnitInfoPopup");
    if (!popup) return;
    syncBookUnitModalCopy();
    var datesEl = document.getElementById("bookUnitModalDates");
    var infoDates = document.getElementById("bookUnitInfoDates");
    if (infoDates) infoDates.textContent = datesEl ? datesEl.textContent || "" : "";
    popup.hidden = false;
  }

  function setUnitPickerTab(tab) {
    unitPickerTab = tab === "cottage" || tab === "hall" ? tab : "room";
    document.querySelectorAll("[data-book-unit-tab]").forEach(function (btn) {
      var tabName = btn.getAttribute("data-book-unit-tab");
      btn.hidden = false;
      var on = tabName === unitPickerTab;
      btn.classList.toggle("facilities-tab--active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-book-unit-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-book-unit-panel") !== unitPickerTab;
    });
    syncEventHallPoolNote();
  }

  function emptyUnitSelection() {
    return {
      roomCatalogIds: [],
      roomCatalogId: "",
      cottageCatalogIds: [],
      hallCatalogIds: [],
      hallCatalogId: ""
    };
  }

  function cloneUnitSelection(sel) {
    sel = sel || {};
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
    var cottageIds = Array.isArray(sel.cottageCatalogIds)
      ? sel.cottageCatalogIds.map(String).filter(Boolean)
      : [];
    return {
      roomCatalogIds: roomIds,
      roomCatalogId: roomIds[0] || "",
      cottageCatalogIds: cottageIds,
      hallCatalogIds: hallIds,
      hallCatalogId: hallIds[0] || ""
    };
  }

  function getGuestCounts() {
    var adultsEl = document.getElementById("adults");
    var childrenEl = document.getElementById("children");
    var under6El = document.getElementById("childrenUnder6");
    return {
      adults: adultsEl ? adultsEl.value : "1",
      // Ages 6+ count toward facility capacity
      children: childrenEl && childrenEl.value !== "" ? childrenEl.value : "0",
      // Ages 0–5 do not count toward facility capacity
      childrenUnder6: under6El && under6El.value !== "" ? under6El.value : "0"
    };
  }

  function runGuestCapacityCheck(selection) {
    var UA = window.ElenestUnitAvailability;
    var guests = getGuestCounts();
    if (!UA || typeof UA.validateGuestCapacity !== "function") {
      return { ok: true, guests: guests, errors: [] };
    }
    return UA.validateGuestCapacity(selection || getUnitSelection(), guests.adults, guests.children, {
      childrenUnder6: guests.childrenUnder6
    });
  }

  function getActiveFacilitySelectionForCapacity() {
    return getUnitSelection();
  }

  function formatMaxCapacityWarning(maxPax, facilityCount) {
    var max = Math.max(0, parseInt(maxPax, 10) || 0);
    if (facilityCount > 1) {
      return "Maximum capacity is " + max + " pax for the selected facilities.";
    }
    return "Maximum capacity is " + max + " pax for this facility.";
  }

  function clearGuestCapacityLiveUI() {
    var warn = document.getElementById("guestCapacityLiveWarn");
    if (warn) {
      warn.hidden = true;
      warn.textContent = "";
    }
    ["adults", "children"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("book-guest-input--over");
      el.removeAttribute("aria-invalid");
    });
  }

  function updateGuestCapacityLiveUI() {
    var adultsEl = document.getElementById("adults");
    var childrenEl = document.getElementById("children");
    var warn = document.getElementById("guestCapacityLiveWarn");
    var selection = getActiveFacilitySelectionForCapacity();
    var hasFacility = hasSelectedFacilities();

    if (!hasFacility) {
      clearGuestCapacityLiveUI();
      return { ok: true, over: false };
    }

    var check = runGuestCapacityCheck(selection);
    var capacity = check.capacity || {};
    var max = capacity.totalMax != null ? Number(capacity.totalMax) : 0;
    var facilityCount = capacity.units ? capacity.units.length : countSelectedFacilities();
    var over = !check.ok && max > 0;

    if (adultsEl) {
      adultsEl.classList.toggle("book-guest-input--over", over);
      if (over) adultsEl.setAttribute("aria-invalid", "true");
      else adultsEl.removeAttribute("aria-invalid");
    }
    if (childrenEl) {
      childrenEl.classList.toggle("book-guest-input--over", over);
      if (over) childrenEl.setAttribute("aria-invalid", "true");
      else childrenEl.removeAttribute("aria-invalid");
    }

    if (warn) {
      if (over) {
        warn.hidden = false;
        warn.textContent = formatMaxCapacityWarning(max, facilityCount);
      } else {
        warn.hidden = true;
        warn.textContent = "";
      }
    }

    return { ok: !over, over: over, max: max, check: check };
  }

  function updateModalCapacityHint() {
    var el = document.getElementById("bookUnitModalCapacity");
    if (!el) return;
    var UA = window.ElenestUnitAvailability;
    var sel = getUnitSelection();
    var count = countSelectedFacilities();
    if (!count || !UA) {
      el.textContent = "No facilities selected yet. Select one or more units below.";
      el.classList.remove("book-unit-modal__capacity--warn", "book-unit-modal__capacity--ok");
      showUnitModalCapacityMessage("");
      syncEventHallPoolNote();
      return;
    }
    var combined = UA.getCombinedCapacity(sel);
    var guestCheck = runGuestCapacityCheck(sel);
    var guestTotal = guestCheck.guests ? guestCheck.guests.total : 0;
    var under6 = guestCheck.guests ? guestCheck.guests.childrenUnder6 : 0;
    el.textContent =
      "Selected: " +
      count +
      " facility(ies) · Combined capacity: " +
      combined.totalMax +
      " pax · Guests counted (ages 6–12): " +
      guestTotal +
      " pax" +
      (under6 > 0 ? " · Children 0–5: " + under6 + " (not counted)" : "");
    el.classList.toggle("book-unit-modal__capacity--warn", !guestCheck.ok);
    el.classList.toggle("book-unit-modal__capacity--ok", guestCheck.ok);
    if (!guestCheck.ok) {
      showUnitModalCapacityMessage(
        (guestCheck.errors && guestCheck.errors[0]) ||
          "Please select another facility or reduce the number of guests."
      );
    } else {
      showUnitModalCapacityMessage("");
    }
    syncEventHallPoolNote();
  }

  function normalizeDatesForBookingRule() {
    var rule = getBookingDateRule();
    if (!wizardState.checkIn) {
      wizardState.checkOut = null;
      return;
    }
    if (rule.mode === "single") {
      wizardState.checkOut = singleDayCheckoutIso(wizardState.checkIn);
      return;
    }
    if (
      wizardState.checkOut &&
      wizardState.checkOut <= wizardState.checkIn
    ) {
      wizardState.checkOut = null;
    }
  }

  function syncStep2BookingRuleUI() {
    var rule = getBookingDateRule();
    var lead = document.getElementById("bookPanel2Lead");
    var checkInLabel = document.getElementById("checkInTimeLabel");
    var checkOutLabel = document.getElementById("checkOutTimeLabel");
    var timeHint = document.getElementById("bookTimeHint");
    var summaryHint = document.getElementById("bookDetailsSummaryHint");
    var calHint = document.getElementById("bookCalNotesHint");

    if (lead) {
      if (rule.facilityKind === "day_tour") {
        lead.textContent = "One-Day Book: pick one date, then choose your facility.";
      } else if (rule.mode === "single") {
        lead.textContent = "Pick one date, then choose your facility.";
      } else {
        lead.textContent = "Overnight: pick check-in and check-out dates, then choose your facility.";
      }
    }

    if (calHint) {
      if (rule.facilityKind === "day_tour" || rule.mode === "single") {
        calHint.textContent = "Tap one available date to continue.";
      } else {
        calHint.textContent = "Tap check-in, then tap a later date for check-out.";
      }
    }

    if (checkInLabel) {
      checkInLabel.innerHTML =
        rule.mode === "single"
          ? 'Arrival time <span class="req-mark">*</span>'
          : 'Arrival time (day of check-in) <span class="req-mark">*</span>';
    }
    if (checkOutLabel) {
      checkOutLabel.innerHTML =
        rule.mode === "single"
          ? 'Departure time <span class="req-mark">*</span>'
          : 'Departure time (day of check-out) <span class="req-mark">*</span>';
    }
    if (timeHint) {
      if (rule.facilityKind === "day_tour") {
        timeHint.hidden = true;
      } else {
        timeHint.hidden = false;
        timeHint.textContent =
          rule.mode === "single"
            ? "Choose arrival and departure times for your selected date."
            : "Times use 12-hour AM/PM format.";
      }
    }
    if (summaryHint) {
      summaryHint.textContent = "You can still change your selection before continuing.";
    }

    syncStep2TimeControls();
  }

  function applyFixedPoolScheduleTimes() {
    var arrival = isPoolOnlyBooking() ? POOL_ONLY_ARRIVAL_TIME : DAY_TOUR_ARRIVAL_TIME;
    var departure = isPoolOnlyBooking() ? POOL_ONLY_DEPARTURE_TIME : DAY_TOUR_DEPARTURE_TIME;
    wizardState.checkInTime = arrival;
    wizardState.checkOutTime = departure;
    var inS = document.getElementById("checkInTime");
    var outS = document.getElementById("checkOutTime");
    var dayTourSchedule = document.getElementById("bookDayTourSchedule");
    if (inS) {
      inS.value = arrival;
      inS.disabled = true;
    }
    if (outS) {
      outS.value = departure;
      outS.disabled = true;
    }
    if (dayTourSchedule) dayTourSchedule.value = arrival + " – " + departure;
  }

  function applyDayTourFixedTimes() {
    if (!isDayTourBooking() && !isPoolOnlyBooking()) return;
    applyFixedPoolScheduleTimes();
  }

  function syncStep2TimeControls() {
    var timesSection = document.getElementById("bookFlowTimesSection");
    var overnightArrivalWrap = document.getElementById("bookOvernightArrivalWrap");
    var checkOutWrap = document.getElementById("checkOutTimeWrap");
    var dayTourWrap = document.getElementById("bookDayTourScheduleWrap");
    var usesFixedSchedule = isDayTourBooking() || isPoolOnlyBooking();
    if (timesSection) timesSection.hidden = false;
    if (overnightArrivalWrap) overnightArrivalWrap.hidden = usesFixedSchedule;
    if (checkOutWrap) checkOutWrap.hidden = usesFixedSchedule;
    if (dayTourWrap) dayTourWrap.hidden = !usesFixedSchedule;
    var inS = document.getElementById("checkInTime");
    var outS = document.getElementById("checkOutTime");
    if (usesFixedSchedule) {
      applyFixedPoolScheduleTimes();
      if (inS) inS.required = false;
      if (outS) outS.required = false;
      return;
    }
    if (inS) {
      inS.disabled = false;
      inS.required = true;
    }
    if (outS) {
      outS.disabled = false;
      outS.required = true;
    }
    if (
      wizardState.checkInTime === DAY_TOUR_ARRIVAL_TIME &&
      wizardState.checkOutTime === DAY_TOUR_DEPARTURE_TIME
    ) {
      wizardState.checkInTime = null;
      wizardState.checkOutTime = null;
      if (inS) inS.selectedIndex = 0;
      if (outS) outS.selectedIndex = 0;
    }
  }

  function maybeAutoConfirmPoolOnlyBooking() {
    /* Swimming Pool Only requires a cottage — never auto-confirm without one. */
  }

  /** Open facility picker after calendar click when a room/cottage/hall is needed. */
  function hasDatesReadyForFacilityPicker(rule) {
    if (!wizardState.checkIn) return false;
    if (rule.mode === "single") {
      return !!wizardState.checkOut;
    }
    return !!(wizardState.checkOut && wizardState.checkOut > wizardState.checkIn);
  }

  function setFacilityPickerLoading(on) {
    facilityPickerBusy = !!on;
    var overlay = document.getElementById("bookFacilityLoadingOverlay");
    var calendarHost = document.getElementById("calendarHost");
    if (overlay) {
      if (on) {
        overlay.removeAttribute("hidden");
        overlay.setAttribute("aria-hidden", "false");
        overlay.setAttribute("aria-busy", "true");
      } else {
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        overlay.setAttribute("aria-busy", "false");
      }
    }
    if (calendarHost) {
      calendarHost.classList.toggle("is-loading-facilities", !!on);
    }
    document.body.classList.toggle("book-facility-loading-open", !!on);
  }

  function waitForFacilityPickerReady() {
    var tasks = [];
    if (window.ElenestContentStore && window.ElenestContentStore.ready) {
      tasks.push(window.ElenestContentStore.ready);
    }
    if (window.ElenestBookings && window.ElenestBookings.ready) {
      tasks.push(window.ElenestBookings.ready);
    }
    if (window.ElenestAvailability && window.ElenestAvailability.ready) {
      tasks.push(window.ElenestAvailability.ready);
    }
    if (window.ElenestBookings && typeof window.ElenestBookings.refreshAvailability === "function") {
      tasks.push(
        Promise.resolve(window.ElenestBookings.refreshAvailability()).catch(function () {
          return false;
        })
      );
    }
    // Same mobile RPC: load every unavailable facility id for the selected nights.
    var range = getAvailabilityRange();
    if (
      range &&
      range.checkIn &&
      range.checkOut &&
      window.ElenestBookings &&
      typeof window.ElenestBookings.prefetchUnavailableFacilitiesForRange === "function"
    ) {
      tasks.push(
        Promise.resolve(
          window.ElenestBookings.prefetchUnavailableFacilitiesForRange(range.checkIn, range.checkOut)
        ).catch(function () {
          return [];
        })
      );
    }
    var ready = tasks.length ? Promise.all(tasks) : Promise.resolve();
    // Keep the loading state visible briefly so users see feedback and cannot double-tap.
    var minWait = new Promise(function (resolve) {
      setTimeout(resolve, 120);
    });
    return Promise.all([ready, minWait]);
  }

  function openBookUnitModalWithLoading(opts) {
    opts = opts || {};
    if (facilityPickerBusy) return Promise.resolve(false);
    if (!wizardState.checkIn) return Promise.resolve(false);
    if (!opts.forceChange && wizardState.unitSelectionConfirmed) return Promise.resolve(false);
    var rule = getBookingDateRule();
    if (!opts.forceChange && !rule.requiresFacility) return Promise.resolve(false);
    if (!hasDatesReadyForFacilityPicker(rule)) return Promise.resolve(false);

    setFacilityPickerLoading(true);
    return waitForFacilityPickerReady()
      .catch(function () {
        return null;
      })
      .then(function () {
        try {
          if (opts.forceChange) {
            openBookUnitModalForChangeImmediate();
          } else {
            openBookUnitModalImmediate();
          }
          return true;
        } finally {
          setFacilityPickerLoading(false);
        }
      })
      .catch(function () {
        setFacilityPickerLoading(false);
        return false;
      });
  }

  function tryOpenFacilityPickerAfterDateClick() {
    maybeAutoConfirmPoolOnlyBooking();
    if (wizardState.unitSelectionConfirmed) {
      closeBookUnitModal();
      return;
    }
    var rule = getBookingDateRule();
    if (!rule.requiresFacility) {
      closeBookUnitModal();
      return;
    }
    if (!hasDatesReadyForFacilityPicker(rule)) {
      closeBookUnitModal();
      return;
    }
    openBookUnitModalWithLoading();
  }

  function afterBookingRuleOrDatesChanged() {
    normalizeDatesForBookingRule();
    syncStep2BookingRuleUI();
    maybeAutoConfirmPoolOnlyBooking();
    renderCalendar();
    updatePickedSummary();
    renderUnitSelectionSummary();
    renderBookingDetailsSummary();
    updateStep2ContinueButton();
  }

  var OVERNIGHT_BLOCKED_RANGE_MSG =
    "One of the selected dates is blocked. Please select another date range.";

  function stayRangeHasUnavailableNight(checkInIso, checkOutIso) {
    var cur = isoToUtcDate(checkInIso);
    var end = isoToUtcDate(checkOutIso);
    if (end <= cur) return true;
    while (cur < end) {
      if (isCalendarDateBlocked(utcDateToIso(cur))) return true;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return false;
  }

  /**
   * Overnight check-out is exclusive. A stay of Oct 13–15 occupies Oct 13 and Oct 14,
   * so a block on any night in that span must stop the selection.
   */
  function overnightRangeDateError(checkInIso, checkOutIso) {
    if (!checkInIso || !checkOutIso) return "";
    var cur = isoToUtcDate(checkInIso);
    var end = isoToUtcDate(checkOutIso);
    if (end <= cur) return "";
    var managerBlocked = false;
    var unavailable = false;
    var av = window.ElenestAvailability;
    while (cur < end) {
      var nightIso = utcDateToIso(cur);
      if (av && typeof av.getManagerBlocked === "function" && av.getManagerBlocked(nightIso)) {
        managerBlocked = true;
      } else if (isCalendarDateBlocked(nightIso)) {
        unavailable = true;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (managerBlocked) return OVERNIGHT_BLOCKED_RANGE_MSG;
    if (unavailable) {
      return "The selected dates include unavailable days. Please choose different dates.";
    }
    return "";
  }

  function calendarRangeAlertEl() {
    var el = document.getElementById("calendarRangeAlert");
    if (el) return el;
    var summary = document.getElementById("pickedDatesSummary");
    if (!summary || !summary.parentNode) return null;
    el = document.createElement("p");
    el.id = "calendarRangeAlert";
    el.className = "date-range-alert";
    el.hidden = true;
    el.setAttribute("role", "alert");
    summary.insertAdjacentElement("afterend", el);
    return el;
  }

  function showCalendarDateMessage(message) {
    var errEl = document.getElementById("calendarError");
    var alertEl = calendarRangeAlertEl();
    var text = message || "";
    var notice = window.ElenestCalendarWidget;
    var popup = text === OVERNIGHT_BLOCKED_RANGE_MSG;
    if (popup && notice && typeof notice.showDateNotice === "function") {
      notice.showDateNotice(text);
      text = "";
    } else if (notice && typeof notice.hideDateNotice === "function") {
      notice.hideDateNotice();
    }
    if (errEl) {
      errEl.textContent = text;
      errEl.hidden = !text;
    }
    if (alertEl) {
      alertEl.textContent = text;
      alertEl.hidden = !text;
    }
  }

  /** If user did not tap check-out, use the first valid day after check-in (1–14 nights). */
  function findDefaultCheckoutIso(checkInIso) {
    for (var add = 1; add <= 14; add++) {
      var tryIso = addDaysIso(checkInIso, add);
      if (!stayRangeHasUnavailableNight(checkInIso, tryIso)) return tryIso;
    }
    return null;
  }

  function fillTimeSelects() {
    var inS = document.getElementById("checkInTime");
    var outS = document.getElementById("checkOutTime");
    if (!inS || !outS) return;
    var prevIn = wizardState.checkInTime;
    var prevOut = wizardState.checkOutTime;
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
      var label12 = formatTime12h(h, 0);
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
        return null;
      }
      var opts = sel.querySelectorAll("option");
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === pref) {
          sel.value = pref;
          return pref;
        }
      }
      sel.selectedIndex = 0;
      return null;
    }
    wizardState.checkInTime = pickValid(inS, prevIn);
    wizardState.checkOutTime = pickValid(outS, prevOut);
    syncStep2TimeControls();
  }

  function formatTimeLabel(t) {
    return t ? formatStoredTimeHHmm(t) : "not selected";
  }

  function labelRoomType(v, b) {
    if (b && b.roomCatalogName) return b.roomCatalogName;
    if (v === "big") return "Big room";
    if (v === "couple") return "Couple room";
    if (v === "small") return "Couple room (legacy)";
    if (v === "none") return "No room";
    return v ? String(v) : "—";
  }

  function labelHall(v, b) {
    if (b && b.hallCatalogName) return b.hallCatalogName;
    if (v === "yes") return "Hall (legacy)";
    if (v === "no" || v === undefined || v === null || v === "") return "No hall";
    if (v === "ac") {
      if (b && b.acHallHours != null && String(b.acHallHours) !== "") {
        var info = computeACHallFee(b.acHallHours);
        return "Air-conditioned event hall — " + info.hours + " hr — ₱" + info.fee.toLocaleString();
      }
      return "Air-conditioned event hall";
    }
    var m = {
      none: "No hall",
      poolside: "Event hall (beside pool) — ₱10,000",
      upper: "Upper hall — ₱15,000",
      new_function: "New function hall — ₱15,000",
      hall1: "Hall 1 (legacy)",
      hall2: "Hall 2 (legacy)",
      hall3: "Hall 3 (legacy)",
      hall4: "Hall 4 (legacy)"
    };
    return m[v] || String(v);
  }

  function labelEventTypeCard(v, other) {
    if (v === "other" && other) return other;
    var map = {
      birthday: "Birthday",
      wedding: "Wedding",
      reunion: "Reunion",
      swimming: "Swimming",
      other: "Other",
      na: "N/A",
      none: "—"
    };
    return map[v] || (v ? String(v) : "—");
  }

  function catalogNameForId(id) {
    var UA = window.ElenestUnitAvailability;
    if (!id || !UA || typeof UA.getCatalog !== "function") return "";
    var found = UA.getCatalog().find(function (u) {
      return String(u.id) === String(id);
    });
    return found && found.name ? found.name : "";
  }

  function uniqueStayNames(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (name) {
      var n = String(name || "").trim();
      if (!n || n === "No room" || n === "—" || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out;
  }

  function appointmentStayLabel(b) {
    if (!b) return "—";
    var names = [];
    if (b.roomCatalogName) names.push(b.roomCatalogName);
    if (Array.isArray(b.roomCatalogNames)) names = names.concat(b.roomCatalogNames);
    var roomIds = []
      .concat(b.roomCatalogIds || [])
      .concat(b.roomCatalogId ? [b.roomCatalogId] : []);
    roomIds.forEach(function (id) {
      var n = catalogNameForId(id);
      if (n) names.push(n);
    });
    if (b.roomType && b.roomType !== "none") names.push(labelRoomType(b.roomType, b));

    if (Array.isArray(b.cottageCatalogNames)) names = names.concat(b.cottageCatalogNames);
    (b.cottageCatalogIds || []).forEach(function (id) {
      var cn = catalogNameForId(id);
      if (cn) names.push(cn);
    });
    if (b.cottageQty && parseInt(b.cottageQty, 10) > 0 && !names.length) {
      names.push(parseInt(b.cottageQty, 10) + " cottage(s)");
    }

    if (b.hallCatalogName) names.push(b.hallCatalogName);
    if (Array.isArray(b.hallCatalogNames)) names = names.concat(b.hallCatalogNames);
    var hallIds = [].concat(b.hallCatalogIds || []).concat(b.hallCatalogId ? [b.hallCatalogId] : []);
    hallIds.forEach(function (id) {
      var hn = catalogNameForId(id);
      if (hn) names.push(hn);
    });
    if (b.eventHall && b.eventHall !== "none" && b.eventHall !== "no") {
      names.push(labelHall(b.eventHall, b));
    }

    (b.facilityIds || b.room_ids || []).forEach(function (id) {
      var fn = catalogNameForId(id);
      if (fn) names.push(fn);
    });

    var unique = uniqueStayNames(names);
    return unique.length ? unique.join(" · ") : "—";
  }

  function roomEventSummary(b) {
    var stay = appointmentStayLabel(b);
    if (stay && stay !== "—") return stay;
    var bits = [];
    if (b.roomCatalogName) bits.push(b.roomCatalogName);
    else if (b.roomType && b.roomType !== "none") bits.push(labelRoomType(b.roomType, b));
    if (Array.isArray(b.cottageCatalogNames) && b.cottageCatalogNames.length) {
      bits.push(b.cottageCatalogNames.join(", "));
    } else if (b.cottageQty && parseInt(b.cottageQty, 10) > 0) {
      bits.push(parseInt(b.cottageQty, 10) + " cottage(s)");
    }
    var ev = labelEventTypeCard(b.eventType, b.eventOther);
    if (ev && ev !== "—") bits.push(ev);
    if (b.hallCatalogName) bits.push(b.hallCatalogName);
    else {
      var h = b.eventHall;
      if (h && h !== "none" && h !== "no") bits.push(labelHall(h, b));
    }
    return bits.length ? bits.join(" · ") : "—";
  }

  function fmtUnitPHP(n) {
    var v = Number(n);
    if (isNaN(v)) return "₱0";
    return "₱" + Math.round(v).toLocaleString();
  }

  function unitDefaultImage(type) {
    if (type === "cottage") return "../Images/gallery-5.png";
    if (type === "hall") return "../Images/gallery-2.png";
    return "../Images/room-1.png";
  }

  var SMALL_ROOM_PHOTOS = [
    "../Images/small-room-bed.jpg",
    "../Images/small-room-bath.jpg",
    "../Images/small-room-tv.jpg"
  ];

  var BIG_ROOM_1_PHOTOS = [
    "../Images/big-room-1-bed.jpg",
    "../Images/big-room-1-living-tv.jpg",
    "../Images/big-room-1-living-sofa.jpg",
    "../Images/big-room-1-kitchen.jpg",
    "../Images/big-room-1-bath.jpg"
  ];

  var BIG_ROOM_2_PHOTOS = [
    "../Images/big-room-2-beds.jpg",
    "../Images/big-room-2-living-sofa.jpg",
    "../Images/big-room-2-tv.jpg",
    "../Images/big-room-2-bath.jpg"
  ];

  function isSmallRoomUnit(r) {
    if (!r) return false;
    if (String(r.type || "room") !== "room") return false;
    var kind = String(r.roomKind || "").toLowerCase();
    if (kind === "small") return true;
    if (kind === "big") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase().replace(/\s+/g, " ");
    return id.indexOf("small-room") !== -1 || name.indexOf("small room") !== -1;
  }

  function isFirstBigRoomUnit(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-1") return true;
    return name === "family room 1" || name === "big room 1";
  }

  function isSecondBigRoomUnit(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-2") return true;
    return name === "family room 2" || name === "big room 2";
  }

  function unitGalleryImages(unit) {
    if (isFirstBigRoomUnit(unit)) return BIG_ROOM_1_PHOTOS.slice();
    if (isSecondBigRoomUnit(unit)) return BIG_ROOM_2_PHOTOS.slice();
    if (isSmallRoomUnit(unit)) return SMALL_ROOM_PHOTOS.slice();
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilityImages === "function") {
      var fromStore = S.getFacilityImages(unit);
      if (fromStore.length) return fromStore;
    }
    var list = [];
    if (unit && Array.isArray(unit.images)) {
      unit.images.forEach(function (src) {
        var s = String(src || "").trim();
        if (s && list.indexOf(s) === -1) list.push(s);
      });
    }
    var cover = unit && unit.image ? String(unit.image).trim() : "";
    if (cover && list.indexOf(cover) === -1) list.unshift(cover);
    if (!list.length) list.push(unitDefaultImage(String((unit && unit.type) || "room")));
    return list;
  }

  function unitImageSrc(unit) {
    var imgs = unitGalleryImages(unit);
    if (imgs && imgs[0]) return imgs[0];
    return unitDefaultImage(String((unit && unit.type) || "room"));
  }

  function appendFacilityCardMedia(media, unit) {
    var photos = unitGalleryImages(unit);
    var S = window.ElenestContentStore;
    if (S && typeof S.renderFacilitySwipeElement === "function") {
      media.appendChild(S.renderFacilitySwipeElement(unit.name || "Facility", photos));
      return;
    }
    var img = document.createElement("img");
    img.src = photos[0] || unitDefaultImage(String((unit && unit.type) || "room"));
    img.alt = unit.name || "Facility";
    img.loading = "lazy";
    img.decoding = "async";
    media.appendChild(img);
  }

  function unitPriceShort(unit) {
    var pu = String(unit.priceUnit || "night");
    if (String(unit.type) === "hall" || pu === "event") return fmtUnitPHP(unit.price) + " / event";
    if (pu === "day") return fmtUnitPHP(unit.price) + " / day";
    return fmtUnitPHP(unit.price) + " / night";
  }

  function unitPriceLabel(unit, nights) {
    return unitPriceShort(unit);
  }

  function buildFacilityCard(unit, opts) {
    opts = opts || {};
    var available = opts.available !== false;
    var selected = !!opts.selected;
    var selectable = !!opts.selectable;
    var card = selectable ? document.createElement("label") : document.createElement("div");
    card.className =
      "book-facility-card" +
      (selected ? " book-facility-card--selected" : "") +
      (!selectable ? " book-facility-card--readonly book-facility-card--booked" : "");

    if (selectable && opts.inputType) {
      var input = document.createElement("input");
      input.type = opts.inputType;
      input.className = "book-facility-card__input";
      input.value = opts.value != null ? String(opts.value) : String(unit.id);
      if (opts.inputName) input.name = opts.inputName;
      if (opts.facilityType) input.setAttribute("data-facility-type", opts.facilityType);
      input.checked = selected;
      card.appendChild(input);
    }

    var media = document.createElement("div");
    media.className = "book-facility-card__media";
    appendFacilityCardMedia(media, unit);
    if (!available && opts.status !== "pending") {
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
    name.textContent = unit.name || "Unit";
    var capacity = document.createElement("span");
    capacity.className = "book-facility-card__capacity";
    var UA = window.ElenestUnitAvailability;
    capacity.textContent =
      UA && typeof UA.formatCapacityLabel === "function"
        ? UA.formatCapacityLabel(unit)
        : "Capacity n/a";
    var price = document.createElement("span");
    price.className = "book-facility-card__price";
    price.textContent = unitPriceShort(unit);
    body.appendChild(name);
    body.appendChild(capacity);
    body.appendChild(price);
    if (!available && opts.status === "pending") {
      var pendingNote = document.createElement("span");
      pendingNote.className = "book-facility-card__pending";
      pendingNote.textContent = "Pending Admin Confirmation";
      body.appendChild(pendingNote);
    }
    if (String((unit && unit.type) || "") === "hall" || opts.facilityType === "hall") {
      var poolPerk = document.createElement("span");
      poolPerk.className = "book-facility-card__pool-perk";
      poolPerk.textContent =
        "FREE swimming pool access is included for only " +
        HALL_COMPLIMENTARY_POOL_GUESTS +
        " guests.";
      body.appendChild(poolPerk);
    }
    if (!available) {
      var ariaStatus = opts.status === "pending" ? "pending admin confirmation" : "booked";
      card.setAttribute("aria-disabled", "true");
      card.setAttribute("aria-label", (unit.name || "Unit") + " is " + ariaStatus + " and unavailable");
    }
    card.appendChild(body);
    return card;
  }

  function buildNoneOption(label, inputName, selected) {
    var chip = document.createElement("label");
    chip.className =
      "book-facility-card book-facility-card--none" + (selected ? " book-facility-card--selected" : "");
    var input = document.createElement("input");
    input.type = "radio";
    input.className = "book-facility-card__input";
    input.name = inputName;
    input.value = "";
    input.checked = selected;
    chip.appendChild(input);
    chip.appendChild(document.createTextNode(label));
    return chip;
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

  function getUnitSelection() {
    wizardState.unitSelection = cloneUnitSelection(wizardState.unitSelection);
    return wizardState.unitSelection;
  }

  function resetUnitSelection() {
    wizardState.unitSelection = emptyUnitSelection();
    wizardState.unitSelectionConfirmed = false;
    updateStep2ContinueButton();
  }

  function isDayTourBooking() {
    return getStayTypeValue() === "day_tour";
  }

  function countSelectedFacilities() {
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.countSelectedFacilities === "function") {
      return UA.countSelectedFacilities(getUnitSelection());
    }
    var sel = getUnitSelection();
    return (
      (sel.roomCatalogIds ? sel.roomCatalogIds.length : 0) +
      (sel.cottageCatalogIds ? sel.cottageCatalogIds.length : 0) +
      (sel.hallCatalogIds ? sel.hallCatalogIds.length : 0)
    );
  }

  function selectionMeetsGuestCapacity() {
    if (!hasSelectedFacilities()) return true;
    return runGuestCapacityCheck(getUnitSelection()).ok;
  }

  function canProceedToPayment() {
    if (!wizardState.checkIn || !wizardState.checkOut) return false;
    normalizeDatesForBookingRule();
    var rule = getBookingDateRule();
    if (isDayTourBooking() || isPoolOnlyBooking()) {
      applyDayTourFixedTimes();
    } else {
      var inS = document.getElementById("checkInTime");
      var outS = document.getElementById("checkOutTime");
      var tIn = wizardState.checkInTime || (inS && inS.value) || "";
      var tOut = wizardState.checkOutTime || (outS && outS.value) || "";
      if (!tIn || !tOut) return false;
    }
    if (rule.requiresFacility) {
      if (!wizardState.unitSelectionConfirmed) return false;
      if (isPoolOnlyBooking()) {
        var sel = getUnitSelection();
        return (
          (sel.cottageCatalogIds || []).length >= 1 &&
          !(sel.roomCatalogIds || []).length &&
          !(sel.hallCatalogIds || []).length &&
          selectionMeetsGuestCapacity()
        );
      }
      return countSelectedFacilities() >= 1 && selectionMeetsGuestCapacity();
    }
    if (!wizardState.unitSelectionConfirmed) return false;
    return countSelectedFacilities() >= 1 && selectionMeetsGuestCapacity();
  }

  function updateStep2ContinueButton() {
    var btn = document.getElementById("nextFromCal");
    if (!btn) return;
    updateGuestCapacityLiveUI();
    var enabled = canProceedToPayment();
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function updateUnitModalConfirmButton() {
    var btn = document.getElementById("bookUnitModalDone");
    if (!btn) return;
    var ok = false;
    if (isPoolOnlyBooking()) {
      var sel = getUnitSelection();
      ok =
        (sel.cottageCatalogIds || []).length >= 1 &&
        !(sel.roomCatalogIds || []).length &&
        !(sel.hallCatalogIds || []).length &&
        selectionMeetsGuestCapacity();
    } else {
      ok = countSelectedFacilities() >= 1 && selectionMeetsGuestCapacity();
    }
    btn.disabled = !ok;
    btn.setAttribute("aria-disabled", ok ? "false" : "true");
    updateModalCapacityHint();
    var modal = document.getElementById("bookUnitModal");
    if (modal && !modal.hasAttribute("hidden")) {
      if (hasSelectedFacilities() && !selectionMeetsGuestCapacity()) {
        showUnitModalCapacityMessage(capacityWarningForSelection());
      } else if (selectionMeetsGuestCapacity()) {
        showUnitModalCapacityMessage("");
      }
    }
  }

  function toggleUnitInSelection(type, id, checked) {
    var sel = getUnitSelection();
    id = String(id || "").trim();
    if (!id) return;

    function toggleIn(arr, value, on) {
      var i = arr.indexOf(value);
      if (on && i === -1) arr.push(value);
      if (!on && i !== -1) arr.splice(i, 1);
    }

    if (type === "room") {
      if (isPoolOnlyBooking()) return;
      toggleIn(sel.roomCatalogIds, id, checked);
      sel.roomCatalogId = sel.roomCatalogIds[0] || "";
    } else if (type === "hall") {
      if (isPoolOnlyBooking()) return;
      toggleIn(sel.hallCatalogIds, id, checked);
      sel.hallCatalogId = sel.hallCatalogIds[0] || "";
    } else if (type === "cottage") {
      toggleIn(sel.cottageCatalogIds, id, checked);
    }
    wizardState.unitSelection = cloneUnitSelection(sel);
    normalizeDatesForBookingRule();
    syncStep2BookingRuleUI();
    syncFacilityPoolNotes();
    updateUnitModalConfirmButton();
  }

  function hasSelectedFacilities() {
    return countSelectedFacilities() > 0;
  }

  function selectedFacilitiesConflictForRange(checkIn, checkOut) {
    if (!hasSelectedFacilities()) return false;
    var UA = window.ElenestUnitAvailability;
    if (!UA || !checkIn || !checkOut) return false;
    return !UA.validateSelection(getUnitSelection(), checkIn, checkOut, null, getStayTimeWindow()).ok;
  }

  function getUnitPickerHost() {
    return document.getElementById("bookUnitModalHost");
  }

  function openBookUnitModalImmediate() {
    var modal = document.getElementById("bookUnitModal");
    if (!modal || !wizardState.checkIn) return;
    if (wizardState.unitSelectionConfirmed) return;
    var rule = getBookingDateRule();
    if (!rule.requiresFacility) return;
    if (!hasDatesReadyForFacilityPicker(rule)) return;
    renderUnitPicker();
    syncBookUnitModalCopy();
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("book-unit-modal-open");
    updateUnitModalConfirmButton();
    showBookUnitInfoPopup();
  }

  function openBookUnitModal() {
    openBookUnitModalWithLoading();
  }

  function closeBookUnitModal() {
    var modal = document.getElementById("bookUnitModal");
    if (!modal) return;
    hideBookUnitInfoPopup();
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("book-unit-modal-open");
    renderUnitSelectionSummary();
    renderBookingDetailsSummary();
    updateStep2ContinueButton();
  }

  function confirmUnitSelection() {
    var errEl = document.getElementById("bookUnitModalError");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    var range = getAvailabilityRange();
    if (!range) return;

    normalizeDatesForBookingRule();
    var dateRule = getBookingDateRule();
    if (dateRule.mode === "range" && !wizardState.checkOut) {
      if (errEl) {
        errEl.textContent =
          "Please select a check-out date on the calendar before confirming your facility.";
        errEl.hidden = false;
      }
      return;
    }

    var selectionPayload = getUnitSelection();
    selectionPayload.allowNoFacility = false;
    var facilityCount = countSelectedFacilities();

    if (isPoolOnlyBooking()) {
      sanitizeSelectionForPoolOnly();
      selectionPayload = getUnitSelection();
      facilityCount = (selectionPayload.cottageCatalogIds || []).length;
      if (facilityCount < 1) {
        if (errEl) {
          errEl.textContent = "Please select at least one cottage for Swimming Pool Only.";
          errEl.hidden = false;
        }
        return;
      }
    } else if (facilityCount < 1) {
      if (errEl) {
        errEl.textContent = "Please select at least one room, cottage, or event hall.";
        errEl.hidden = false;
      }
      return;
    }

    var UA = window.ElenestUnitAvailability;
    var guests = getGuestCounts();
    if (UA && facilityCount > 0) {
      var unitCheck = UA.validateSelection(selectionPayload, range.checkIn, range.checkOut, null, {
        validateGuests: true,
        adults: guests.adults,
        children: guests.children,
        childrenUnder6: guests.childrenUnder6,
        checkInTime: range.checkInTime || getStayTimeWindow().checkInTime,
        checkOutTime: range.checkOutTime || getStayTimeWindow().checkOutTime
      });
      if (!unitCheck.ok) {
        if (errEl) {
          var blocked = (unitCheck.errors || []).some(function (msg) {
            return /unavailable/i.test(String(msg || ""));
          });
          var blockedMsg = (unitCheck.errors || []).filter(function (msg) {
            return /unavailable/i.test(String(msg || ""));
          })[0];
          errEl.textContent = blocked
            ? blockedMsg || ROOM_UNAVAILABLE_MSG
            : unitCheck.errors[0] ||
              "That facility selection is no longer available or does not fit your guest count.";
          errEl.hidden = false;
        }
        updateModalCapacityHint();
        return;
      }
    }

    wizardState.unitSelectionConfirmed = true;
    normalizeDatesForBookingRule();
    syncStep2BookingRuleUI();
    closeBookUnitModal();
    renderBookingDetailsSummary();
    updateStep2ContinueButton();
    saveBookingDraft();
  }

  function unlockUnitSelection() {
    wizardState.unitSelectionConfirmed = false;
    updateStep2ContinueButton();
    openBookUnitModalWithLoading({ forceChange: true });
  }

  function openBookUnitModalForChangeImmediate() {
    var modal = document.getElementById("bookUnitModal");
    if (!modal || !wizardState.checkIn) return;
    renderUnitPicker();
    syncBookUnitModalCopy();
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("book-unit-modal-open");
    updateUnitModalConfirmButton();
    showBookUnitInfoPopup();
  }

  function openBookUnitModalForChange() {
    openBookUnitModalWithLoading({ forceChange: true });
  }

  function renderUnitSelectionSummary() {
    var section = document.getElementById("bookUnitSummarySection");
    var host = document.getElementById("bookUnitSelectionSummary");
    var capEl = document.getElementById("bookUnitCapacitySummary");
    if (!section || !host) return;
    if (!wizardState.unitSelectionConfirmed || !hasSelectedFacilities() || !wizardState.checkIn) {
      section.hidden = true;
      syncEventHallPoolNote();
      return;
    }

    var sel = getUnitSelection();
    var UA = window.ElenestUnitAvailability;
    var catalog = UA ? UA.getCatalog() : [];
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    host.textContent = "";

    function addChip(unit, fallbackLabel) {
      var chip = document.createElement("span");
      chip.className = "book-unit-summary__chip";
      if (unit) {
        var img = document.createElement("img");
        img.src = unitImageSrc(unit);
        img.alt = "";
        chip.appendChild(img);
        var label =
          (unit.name || fallbackLabel) +
          (UA && typeof UA.formatCapacityLabel === "function"
            ? " · " + UA.formatCapacityLabel(unit)
            : "");
        chip.appendChild(document.createTextNode(label));
      } else {
        chip.className += " book-unit-summary__chip--plain";
        chip.textContent = fallbackLabel;
      }
      host.appendChild(chip);
    }

    (sel.roomCatalogIds || []).forEach(function (id) {
      if (byId[id]) addChip(byId[id], "Room");
    });
    (sel.cottageCatalogIds || []).forEach(function (id) {
      if (byId[id]) addChip(byId[id], "Cottage");
    });
    (sel.hallCatalogIds || []).forEach(function (id) {
      if (byId[id]) addChip(byId[id], "Hall");
    });

    if (capEl && UA) {
      var combined = UA.getCombinedCapacity(sel);
      var guestCheck = runGuestCapacityCheck(sel);
      var guestTotal = guestCheck.guests ? guestCheck.guests.total : 0;
      capEl.textContent =
        "Combined capacity: " +
        combined.totalMax +
        " pax · Guests counted (ages 6–12): " +
        guestTotal +
        " pax" +
        (guestCheck.ok ? "" : " — exceeds capacity; add facilities or reduce guests.");
      capEl.classList.toggle("book-unit-summary__capacity--warn", !guestCheck.ok);
    }

    section.hidden = !host.childNodes.length;
    syncEventHallPoolNote();
    updateGuestCapacityLiveUI();
  }

  function getSelectedFacilityLabel() {
    if (!hasSelectedFacilities()) return "";
    var sel = getUnitSelection();
    var UA = window.ElenestUnitAvailability;
    if (!UA) return "Selected facilities";
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
    return names.join(", ");
  }

  function renderBookingDetailsSummary() {
    var section = document.getElementById("bookDetailsSummarySection");
    var dl = document.getElementById("bookDetailsSummaryDl");
    if (!section || !dl) return;

    if (!wizardState.checkIn) {
      section.hidden = true;
      return;
    }

    var rule = getBookingDateRule();
    if (isDayTourBooking() || isPoolOnlyBooking()) applyDayTourFixedTimes();

    dl.textContent = "";
    addBookingDetailRow(dl, "Booking type", labelBookingType(getStayTypeValue()));
    addBookingDetailRow(dl, "Swimming", swimmingLabelForActiveSelection());

    if (rule.facilityKind === "day_tour") {
      addBookingDetailRow(dl, "Date", fmtDateLong(wizardState.checkIn));
      addBookingDetailRow(dl, "Schedule", formatDayTourScheduleLabel());
    } else if (rule.mode === "single") {
      addBookingDetailRow(dl, "Date", fmtDateLong(wizardState.checkIn));
      addBookingDetailRow(
        dl,
        "Times",
        wizardState.checkInTime && wizardState.checkOutTime
          ? formatStoredTimeHHmm(wizardState.checkInTime) +
              " – " +
              formatStoredTimeHHmm(wizardState.checkOutTime)
          : "Select below"
      );
    } else {
      addBookingDetailRow(
        dl,
        "Stay",
        wizardState.checkOut && wizardState.checkOut > wizardState.checkIn
          ? fmtDateLong(wizardState.checkIn) + " – " + fmtDateLong(wizardState.checkOut)
          : fmtDateLong(wizardState.checkIn) + " – select check-out"
      );
      addBookingDetailRow(
        dl,
        "Times",
        wizardState.checkInTime && wizardState.checkOutTime
          ? formatStoredTimeHHmm(wizardState.checkInTime) +
              " – " +
              formatStoredTimeHHmm(wizardState.checkOutTime)
          : "Select below"
      );
    }

    if (rule.requiresFacility) {
      addBookingDetailRow(
        dl,
        "Facilities",
        wizardState.unitSelectionConfirmed && hasSelectedFacilities()
          ? getSelectedFacilityLabel()
          : "Select on calendar"
      );
      if (wizardState.unitSelectionConfirmed && hasSelectedFacilities()) {
        var UACap = window.ElenestUnitAvailability;
        if (UACap) {
          var combinedCap = UACap.getCombinedCapacity(getUnitSelection());
          addBookingDetailRow(dl, "Capacity", combinedCap.totalMax + " pax combined");
        }
      }
    }

    var et = getEventTypeValue();
    if (et) {
      var otherEl = document.getElementById("eventOther");
      addBookingDetailRow(
        dl,
        "Activity",
        labelEventTypeCard(et, otherEl && otherEl.value ? otherEl.value.trim() : "")
      );
    }

    var adultsEl = document.getElementById("adults");
    var childrenEl = document.getElementById("children");
    var under6El = document.getElementById("childrenUnder6");
    if (adultsEl && adultsEl.value) {
      var guestBits = [adultsEl.value + (parseInt(adultsEl.value, 10) === 1 ? " adult" : " adults")];
      if (childrenEl && childrenEl.value && parseInt(childrenEl.value, 10) > 0) {
        var c6 = parseInt(childrenEl.value, 10);
        guestBits.push(c6 + (c6 === 1 ? " child (6+)" : " children (6+)"));
      }
      if (under6El && under6El.value && parseInt(under6El.value, 10) > 0) {
        var c0 = parseInt(under6El.value, 10);
        guestBits.push(c0 + (c0 === 1 ? " child (0–5)" : " children (0–5)"));
      }
      addBookingDetailRow(dl, "Guests", guestBits.join(" · "));
    }

    if (
      wizardState.unitSelectionConfirmed &&
      hasSelectedFacilities() &&
      wizardState.checkIn &&
      wizardState.checkOut
    ) {
      var pricingPreview = computePayment();
      if (pricingPreview.lines && pricingPreview.lines.length) {
        pricingPreview.lines.forEach(function (line) {
          addBookingDetailRow(dl, line.label, "₱" + line.amount.toLocaleString());
        });
      }
      addBookingDetailRow(dl, "Estimated total", "₱" + pricingPreview.subtotal.toLocaleString());
    }

    section.hidden = false;
  }

  function getStayTimeWindow() {
    return {
      checkInTime: wizardState.checkInTime || "",
      checkOutTime: wizardState.checkOutTime || ""
    };
  }

  function getAvailabilityRange() {
    if (!wizardState.checkIn) return null;
    var times = getStayTimeWindow();
    if (wizardState.checkOut) {
      return {
        checkIn: wizardState.checkIn,
        checkOut: wizardState.checkOut,
        isComplete: true,
        checkInTime: times.checkInTime,
        checkOutTime: times.checkOutTime
      };
    }
    return {
      checkIn: wizardState.checkIn,
      checkOut: addDaysIso(wizardState.checkIn, 1),
      isComplete: false,
      checkInTime: times.checkInTime,
      checkOutTime: times.checkOutTime
    };
  }

  function sanitizeUnitSelectionForRange(checkIn, checkOut, timeWindow) {
    var UA = window.ElenestUnitAvailability;
    if (!UA || !checkIn || !checkOut) return false;
    timeWindow = timeWindow || getStayTimeWindow();
    var catalog = UA.getCatalog();
    var byId = {};
    catalog.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    var sel = getUnitSelection();
    var before =
      (sel.roomCatalogIds || []).length +
      (sel.hallCatalogIds || []).length +
      (sel.cottageCatalogIds || []).length;
    sel.roomCatalogIds = (sel.roomCatalogIds || []).filter(function (rid) {
      return byId[rid] && UA.isUnitAvailable(byId[rid], checkIn, checkOut, null, timeWindow);
    });
    sel.roomCatalogId = sel.roomCatalogIds[0] || "";
    sel.hallCatalogIds = (sel.hallCatalogIds || []).filter(function (hid) {
      return byId[hid] && UA.isUnitAvailable(byId[hid], checkIn, checkOut, null, timeWindow);
    });
    sel.hallCatalogId = sel.hallCatalogIds[0] || "";
    sel.cottageCatalogIds = (sel.cottageCatalogIds || []).filter(function (cid) {
      return byId[cid] && UA.isUnitAvailable(byId[cid], checkIn, checkOut, null, timeWindow);
    });
    wizardState.unitSelection = cloneUnitSelection(sel);
    var after =
      (sel.roomCatalogIds || []).length +
      (sel.hallCatalogIds || []).length +
      (sel.cottageCatalogIds || []).length;
    if (!hasSelectedFacilities()) {
      wizardState.unitSelectionConfirmed = false;
    }
    updateStep2ContinueButton();
    return before > after;
  }

  var ROOM_UNAVAILABLE_MSG =
    "This room is unavailable for your selected date and time. Please select another available room.";

  function unavailableFacilityMessage(unit) {
    var type = String((unit && unit.type) || "room");
    if (type === "cottage") {
      return "This cottage is unavailable for your selected date and time. Please select another available cottage.";
    }
    if (type === "hall") {
      return "This event hall is unavailable for your selected date and time. Please select another available event hall.";
    }
    return ROOM_UNAVAILABLE_MSG;
  }

  function showRoomUnavailableMessage(message) {
    var text = message || ROOM_UNAVAILABLE_MSG;
    var errEl = document.getElementById("bookUnitModalError");
    if (errEl) {
      errEl.textContent = text;
      errEl.hidden = false;
      try {
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (e) {}
    }
    var stepErr = document.getElementById("bookStepError");
    if (stepErr && document.getElementById("bookUnitModal") && document.getElementById("bookUnitModal").hasAttribute("hidden")) {
      stepErr.textContent = text;
      stepErr.hidden = false;
    }
  }

  function catalogUnitById(id) {
    var UA = window.ElenestUnitAvailability;
    if (!id || !UA || typeof UA.getCatalog !== "function") return null;
    var list = UA.getCatalog() || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function selectedFacilityItems() {
    var sel = getUnitSelection();
    var items = [];
    function push(ids, type) {
      (ids || []).forEach(function (id) {
        var key = String(id || "").trim();
        if (!key) return;
        var unit = catalogUnitById(key);
        items.push({
          id: key,
          type: (unit && unit.type) || type,
          name: (unit && unit.name) || catalogNameForId(key) || "Facility",
          unit: unit
        });
      });
    }
    push(sel.roomCatalogIds, "room");
    push(sel.cottageCatalogIds, "cottage");
    push(sel.hallCatalogIds, "hall");
    return items;
  }

  function facilityRemoveIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
      '<path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>' +
      "</svg>"
    );
  }

  function renderFacilityConfirmation() {
    var section = document.getElementById("bookUnitConfirmSection");
    var body = document.getElementById("bookUnitConfirmBody");
    if (!section || !body) return;
    body.textContent = "";
    var items = selectedFacilityItems();
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    var box = document.createElement("div");
    box.className = "book-unit-confirm__box";
    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "book-unit-confirm__facility";
      var photo = document.createElement("span");
      photo.className = "book-unit-confirm__photo";
      var img = document.createElement("img");
      img.src = unitImageSrc(item.unit || { id: item.id, type: item.type, name: item.name });
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      photo.appendChild(img);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "book-unit-confirm__cancel";
      btn.setAttribute("data-remove-facility-id", item.id);
      btn.setAttribute("data-remove-facility-type", item.type);
      btn.setAttribute("aria-label", "Remove " + item.name);
      btn.title = "Remove " + item.name;
      btn.innerHTML = facilityRemoveIconSvg();
      photo.appendChild(btn);
      var name = document.createElement("span");
      name.className = "book-unit-confirm__name";
      name.textContent = item.name;
      row.appendChild(photo);
      row.appendChild(name);
      box.appendChild(row);
    });
    var scheduleText = facilityConfirmScheduleLine();
    if (scheduleText) {
      var schedule = document.createElement("p");
      schedule.className = "book-unit-confirm__schedule";
      schedule.textContent = scheduleText;
      box.appendChild(schedule);
    }
    body.appendChild(box);
  }

  function facilityConfirmScheduleLine() {
    if (!wizardState.checkIn) return "";
    var rule = getBookingDateRule();
    if (rule.mode === "single" || isDayTourBooking()) {
      return fmtDateLong(wizardState.checkIn) + " · " + formatDayTourHours();
    }
    if (wizardState.checkOut && wizardState.checkOut > wizardState.checkIn) {
      var line = fmtDateLong(wizardState.checkIn) + " – " + fmtDateLong(wizardState.checkOut);
      var tIn = wizardState.checkInTime ? formatTimeLabel(wizardState.checkInTime) : "";
      var tOut = wizardState.checkOutTime ? formatTimeLabel(wizardState.checkOutTime) : "";
      if (tIn && tIn !== "not selected") line += " · " + tIn;
      if (tOut && tOut !== "not selected") line += " – " + tOut;
      return line;
    }
    return fmtDateLong(wizardState.checkIn);
  }

  function syncFacilityCardChecked(id, checked) {
    var host = getUnitPickerHost();
    if (!host) return;
    var inputs = host.querySelectorAll('input.book-facility-card__input[name="bookFacilityUnit"]');
    for (var i = 0; i < inputs.length; i++) {
      if (String(inputs[i].value) !== String(id)) continue;
      inputs[i].checked = !!checked;
      inputs[i].removeAttribute("aria-invalid");
      var card = inputs[i].closest ? inputs[i].closest(".book-facility-card") : null;
      if (card && card.classList) card.classList.toggle("book-facility-card--selected", !!checked);
      break;
    }
  }

  function removeSelectedFacility(type, id) {
    toggleUnitInSelection(type, id, false);
    syncFacilityCardChecked(id, false);
    updateGuestCapacityLiveUI();
    updateStep2ContinueButton();
    renderUnitSelectionSummary();
    renderBookingDetailsSummary();
    renderFacilityConfirmation();
  }

  function appendReadonlyUnitCard(listEl, unit, status) {
    var card = buildFacilityCard(unit, {
      available: false,
      selectable: false,
      selected: false,
      status: status || "booked"
    });
    card.classList.add("book-facility-card--unavailable");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-disabled", "true");
    card.setAttribute(
      "aria-label",
      (unit.name || "Room") + " is unavailable for your selected date and time"
    );
    function reject(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      showRoomUnavailableMessage(unavailableFacilityMessage(unit));
    }
    card.addEventListener("click", reject);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") reject(e);
    });
    listEl.appendChild(card);
  }

  function renderUnitPicker() {
    var host = getUnitPickerHost();
    var emptyEl = document.getElementById("bookUnitModalEmpty");
    var datesEl = document.getElementById("bookUnitModalDates");
    if (!host) return;

    var range = getAvailabilityRange();
    if (!range) {
      host.textContent = "";
      if (emptyEl) emptyEl.hidden = true;
      return;
    }

    var UA = window.ElenestUnitAvailability;
    if (!UA) return;

    var droppedUnavailable = sanitizeUnitSelectionForRange(range.checkIn, range.checkOut, range);
    if (droppedUnavailable) showRoomUnavailableMessage();

    var list = UA.listUnitsWithAvailability(range.checkIn, range.checkOut, null, range);
    var sel = getUnitSelection();
    host.textContent = "";

    var groups = { roomSmall: [], roomBig: [], cottage: [], hall: [] };
    list.forEach(function (item) {
      var t = String(item.unit.type || "room");
      if (t === "cottage") groups.cottage.push(item);
      else if (t === "hall") groups.hall.push(item);
      else if (isBigRoomUnit(item.unit)) groups.roomBig.push(item);
      else groups.roomSmall.push(item);
    });
    groups.roomSmall.sort(function (a, b) {
      return sortUnitsByNumber(a.unit, b.unit);
    });
    groups.roomBig.sort(function (a, b) {
      return sortUnitsByNumber(a.unit, b.unit);
    });
    groups.cottage.sort(function (a, b) {
      return sortUnitsByNumber(a.unit, b.unit);
    });
    groups.hall.sort(function (a, b) {
      return sortUnitsByNumber(a.unit, b.unit);
    });

    function appendUnitCards(listEl, items, type) {
      items.forEach(function (item) {
        var unit = item.unit;
        var id = String(unit.id);
        var isSelected =
          type === "room"
            ? (sel.roomCatalogIds || []).indexOf(id) !== -1
            : type === "hall"
              ? (sel.hallCatalogIds || []).indexOf(id) !== -1
              : (sel.cottageCatalogIds || []).indexOf(id) !== -1;

        if (item.available) {
          listEl.appendChild(
            buildFacilityCard(unit, {
              available: true,
              selectable: true,
              selected: isSelected,
              inputType: "checkbox",
              inputName: "bookFacilityUnit",
              facilityType: type,
              value: id
            })
          );
        } else {
          appendReadonlyUnitCard(listEl, unit, item.status);
        }
      });
    }

    function makePanel(type) {
      var panel = document.createElement("div");
      panel.className = "book-unit-tab-panel";
      panel.setAttribute("data-book-unit-panel", type);
      panel.setAttribute("role", "tabpanel");
      panel.hidden = type !== unitPickerTab;
      return panel;
    }

    function appendEmpty(panel, text) {
      var empty = document.createElement("p");
      empty.className = "book-unit-modal__empty";
      empty.hidden = false;
      empty.textContent = text;
      panel.appendChild(empty);
    }

    function buildGroup(panel, title, type, items) {
      var allItems = items || [];
      var wrap = document.createElement("div");
      wrap.className = "book-unit-picker__group";
      wrap.setAttribute("data-unit-group", type);

      if (type === "room") {
        if (!groups.roomSmall.length && !groups.roomBig.length) {
          appendEmpty(panel, "No rooms available for these dates.");
          return;
        }
        if (groups.roomSmall.length) {
          var smallTitle = document.createElement("p");
          smallTitle.className = "book-step2-facilities__subtype";
          smallTitle.textContent = "Small Rooms";
          wrap.appendChild(smallTitle);
          var smallList = document.createElement("div");
          smallList.className = "book-unit-picker__list";
          appendUnitCards(smallList, groups.roomSmall, "room");
          wrap.appendChild(smallList);
        }
        if (groups.roomBig.length) {
          var bigTitle = document.createElement("p");
          bigTitle.className = "book-step2-facilities__subtype";
          bigTitle.textContent = "Family Rooms";
          wrap.appendChild(bigTitle);
          var bigList = document.createElement("div");
          bigList.className = "book-unit-picker__list";
          appendUnitCards(bigList, groups.roomBig, "room");
          wrap.appendChild(bigList);
        }
      } else if (!allItems.length) {
        appendEmpty(panel, "No " + title.toLowerCase() + " available for these dates.");
        return;
      } else {
        var listEl = document.createElement("div");
        listEl.className = "book-unit-picker__list";
        appendUnitCards(listEl, allItems, type);
        wrap.appendChild(listEl);
      }

      panel.appendChild(wrap);
    }

    var roomPanel = makePanel("room");
    var cottagePanel = makePanel("cottage");
    var hallPanel = makePanel("hall");
    buildGroup(roomPanel, "Rooms", "room");
    buildGroup(cottagePanel, "Cottages", "cottage", groups.cottage);
    buildGroup(hallPanel, "Event Halls", "hall", groups.hall);
    host.appendChild(roomPanel);
    host.appendChild(cottagePanel);
    host.appendChild(hallPanel);
    var S = window.ElenestContentStore;
    if (S && typeof S.bindFacilitySwipeGalleries === "function") {
      S.bindFacilitySwipeGalleries(host);
    }

    if (datesEl) {
      if (isDayTourBooking()) {
        datesEl.textContent = formatDayTourDateLine();
      } else if (isPoolOnlyBooking()) {
        datesEl.textContent =
          fmtDateLong(range.checkIn) +
          " · " +
          POOL_ONLY_ARRIVAL_TIME +
          " – " +
          POOL_ONLY_DEPARTURE_TIME +
          " (fixed)";
      } else if (getBookingDateRule().mode === "single") {
        datesEl.textContent = fmtDateLong(range.checkIn);
      } else {
        datesEl.textContent =
          range.isComplete && wizardState.checkOut && wizardState.checkOut > wizardState.checkIn
            ? fmtDateLong(range.checkIn) + " – " + fmtDateLong(range.checkOut)
            : fmtDateLong(range.checkIn) + " · pick check-out on the calendar";
      }
    }
    sanitizeSelectionForPoolOnly();
    setUnitPickerTab(isPoolOnlyBooking() ? "cottage" : unitPickerTab);
    syncBookUnitModalCopy();
    if (emptyEl) emptyEl.hidden = true;

    renderUnitSelectionSummary();
    updateUnitModalConfirmButton();
    renderFacilityConfirmation();
  }

  function showUnitModalCapacityMessage(msg) {
    var warnEl = document.getElementById("bookUnitModalCapacityWarn");
    var errEl = document.getElementById("bookUnitModalError");
    var alertEl = document.getElementById("bookUnitModalCapacityAlert");
    [warnEl, errEl, alertEl].forEach(function (el) {
      if (!el) return;
      if (!msg) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.textContent = msg;
      el.hidden = false;
    });
    if (msg && warnEl && typeof warnEl.scrollIntoView === "function") {
      try {
        warnEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (e) {}
    }
  }

  function capacityWarningForSelection() {
    if (!hasSelectedFacilities()) return "";
    var check = runGuestCapacityCheck(getUnitSelection());
    if (check.ok) return "";
    return (
      (check.errors && check.errors[0]) ||
      "Please select another facility or reduce the number of guests."
    );
  }

  function handleUnitPickerChange(e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || t.name !== "bookFacilityUnit") return;
    var pickerHost = getUnitPickerHost();
    if (!pickerHost || !pickerHost.contains(t)) return;

    var facilityType = t.getAttribute("data-facility-type") || "";
    var wantChecked = !!t.checked;
    var card = t.closest ? t.closest(".book-facility-card") : t.parentElement;
    if (card && card.classList) {
      card.classList.toggle("book-facility-card--selected", wantChecked);
    }
    toggleUnitInSelection(facilityType, t.value || "", wantChecked);

    // Real-time capacity check as soon as a facility is selected.
    var check = runGuestCapacityCheck(getUnitSelection());
    updateModalCapacityHint();
    updateGuestCapacityLiveUI();
    updateStep2ContinueButton();
    if (wantChecked && !check.ok) {
      var msg =
        (check.errors && check.errors[0]) ||
        "This facility can only accommodate fewer guests than you selected. Please select another facility or reduce the number of guests.";
      showUnitModalCapacityMessage(msg);
      // Keep Confirm locked until guests fit combined capacity.
      var btn = document.getElementById("bookUnitModalDone");
      if (btn) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
      }
      try {
        t.setAttribute("aria-invalid", "true");
      } catch (err) {}
    } else if (t) {
      t.removeAttribute("aria-invalid");
    }
    renderFacilityConfirmation();
  }

  function bindGuestCapacityLiveValidation() {
    ["adults", "children", "childrenUnder6"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.dataset.capacityLiveBound === "1") return;
      el.dataset.capacityLiveBound = "1";
      function onGuestCountChange() {
        updateGuestCapacityLiveUI();
        updateModalCapacityHint();
        updateUnitModalConfirmButton();
        updateStep2ContinueButton();
        if (wizardState.unitSelectionConfirmed) {
          renderUnitSelectionSummary();
          renderBookingDetailsSummary();
        }
        if (currentFlowStep === 4 && !wizardState.paymentProofSubmitted) {
          renderPaymentPanel();
        }
        var modal = document.getElementById("bookUnitModal");
        if (modal && !modal.hasAttribute("hidden")) {
          if (hasSelectedFacilities() && !selectionMeetsGuestCapacity()) {
            showUnitModalCapacityMessage(capacityWarningForSelection());
          } else {
            showUnitModalCapacityMessage("");
          }
        }
      }
      el.addEventListener("input", onGuestCountChange);
      el.addEventListener("change", onGuestCountChange);
    });
  }

  function normStatus(s) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.normalizeBookingStatus === "function") {
      return PF.normalizeBookingStatus(s);
    }
    s = String(s || "Pending").trim();
    var lower = s.toLowerCase();
    if (lower === "for verification" || lower === "pending payment verification") return "For Verification";
    if (lower === "confirmed" || lower === "approved" || lower === "active") return "Confirmed";
    if (lower === "reserved") return "Reserved";
    if (lower === "checked in" || lower === "checked_in" || lower === "checked-in") return "Checked In";
    if (lower === "checked out" || lower === "checked_out" || lower === "checked-out" || lower === "completed") {
      return "Checked Out";
    }
    if (lower === "rejected") return "Rejected";
    if (lower === "no show" || lower === "no_show" || lower === "noshow") return "No Show";
    if (lower === "cancelled" || lower === "canceled") return "Cancelled";
    return "Pending";
  }

  function customerCanCancelBooking(booking) {
    var PF = window.ElenestPaymentFlow;
    return !!(
      booking &&
      booking.id &&
      PF &&
      typeof PF.canCustomerCancelBooking === "function" &&
      PF.canCustomerCancelBooking(booking)
    );
  }

  function cancelCustomerBooking(booking) {
    if (!customerCanCancelBooking(booking)) return Promise.resolve(false);
    if (
      !window.confirm(
        "Cancel this booking? It has not been confirmed by the admin yet. The reserved schedule will be released."
      )
    ) {
      return Promise.resolve(false);
    }
    var PF = window.ElenestPaymentFlow;
    var patch =
      PF && typeof PF.buildCustomerCancelPatch === "function"
        ? PF.buildCustomerCancelPatch()
        : {
            status: "Cancelled",
            paymentStatus: "Cancelled by customer — booking was not confirmed yet",
            slotLocked: false,
            workflow: "cancelled",
            verificationStage: "cancelled",
            cancelledAt: new Date().toISOString(),
            cancelledBy: "customer"
          };
    if (!window.ElenestBookings || typeof window.ElenestBookings.updateById !== "function") {
      return Promise.resolve(false);
    }
    return Promise.resolve(window.ElenestBookings.updateById(booking.id, patch)).then(function (ok) {
      if (!ok) {
        window.alert("Could not cancel this booking. Please try again.");
        return false;
      }
      if (wizardState.reviewBookingId && String(wizardState.reviewBookingId) === String(booking.id)) {
        wizardState.skipResume = true;
        didResumeOpenBooking = true;
        wizardState.reviewBookingId = null;
        wizardState.payableBooking = null;
        wizardState.paymentProofSubmitted = false;
        goStep(1);
      }
      return true;
    });
  }

  function isPendingLikeStatus(st, booking) {
    var PF = window.ElenestPaymentFlow;
    if (booking && PF && typeof PF.isPaymentApproved === "function" && PF.isPaymentApproved(booking)) {
      return false;
    }
    var s = normStatus(st);
    return s === "Pending" || s === "For Verification";
  }

  function statusDisplayLabel(st, booking) {
    var b = booking || null;
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingDisplayStatus === "function" && b) {
      var display = PF.bookingDisplayStatus(b);
      if (PF.isFutureBooking && PF.isFutureBooking(b) && display === "Confirmed") {
        return display + " · " + PF.futureBookingLabel(b);
      }
      return display;
    }
    var s = normStatus(st);
    if (s === "For Verification") return "Pending";
    if (s === "Rejected" || s === "No Show" || s === "Cancelled") return "Cancelled";
    if (s === "Reserved" || s === "Confirmed" || s === "Checked In") return "Confirmed";
    if (s === "Checked Out") return "Completed";
    return s;
  }

  function paymentLabel(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.paymentDisplayLabel === "function") {
      return PF.paymentDisplayLabel(b);
    }
    if (PF && typeof PF.isPaymentApproved === "function" && PF.isPaymentApproved(b)) {
      var approvedPay = String((b && b.paymentStatus) || "").toLowerCase();
      if (approvedPay && approvedPay.indexOf("for verification") === -1) {
        return b.paymentStatus;
      }
      return b && b.paymentType === "full" ? "Fully Paid" : "Down Payment Received";
    }
    if (b && b.paymentStatus) return b.paymentStatus;
    var s = normStatus(b && b.status);
    if (s === "For Verification") return "For Verification";
    if (s === "Rejected") return "Rejected";
    if (s === "Reserved") return "Down Payment Received";
    if (s === "No Show") return "No Show — reservation cancelled";
    if (s === "Confirmed" && b && b.nonRefundable) return "Fully Paid — non-refundable";
    if (s === "Confirmed" && b && b.paymentVerifiedAt) {
      return b.paymentType === "down" ? "Active booking — checked in" : "Fully Paid";
    }
    return "Payment to be settled via QR code";
  }

  function getSelectedPaymentType() {
    var PF = window.ElenestPaymentFlow;
    var fullEl = document.getElementById("paymentTypeFull");
    if (fullEl && fullEl.checked) return PF ? PF.normalizePaymentType("full") : "full";
    return PF ? PF.normalizePaymentType("down") : "down";
  }

  function selectFullPaymentOption() {
    var fullEl = document.getElementById("paymentTypeFull");
    var downEl = document.getElementById("paymentTypeDown");
    if (fullEl) fullEl.checked = true;
    if (downEl) downEl.checked = false;
    wizardState.paymentType = "full";
    wizardState.downPaymentAgreed = false;
    renderPaymentSummary();
  }

  function setDownPaymentRulesAgreeEnabled(enabled) {
    var agreeBtn = document.getElementById("downPaymentRulesAgreeBtn");
    if (!agreeBtn) return;
    agreeBtn.disabled = !enabled;
    agreeBtn.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function openDownPaymentRulesModal(opts) {
    opts = opts || {};
    var overlay = document.getElementById("downPaymentRulesOverlay");
    var agreeBtn = document.getElementById("downPaymentRulesAgreeBtn");
    var cancelBtn = document.getElementById("downPaymentRulesCancelBtn");
    var checkbox = document.getElementById("downPaymentRulesAgree");
    if (!overlay || !agreeBtn || !cancelBtn || !checkbox) {
      if (typeof opts.onAgree === "function") opts.onAgree();
      return;
    }
    if (!overlay.hasAttribute("hidden")) return;

    checkbox.checked = false;
    setDownPaymentRulesAgreeEnabled(false);
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    try {
      checkbox.focus();
    } catch (e) {}

    function closeModal() {
      overlay.setAttribute("hidden", "");
      overlay.setAttribute("aria-hidden", "true");
      checkbox.checked = false;
      setDownPaymentRulesAgreeEnabled(false);
      agreeBtn.removeEventListener("click", onAgreeClick);
      cancelBtn.removeEventListener("click", onCancelClick);
      checkbox.removeEventListener("change", onCheckboxChange);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
    }

    function onCheckboxChange() {
      setDownPaymentRulesAgreeEnabled(!!checkbox.checked);
    }

    function onAgreeClick() {
      if (!checkbox.checked) {
        setDownPaymentRulesAgreeEnabled(false);
        return;
      }
      wizardState.downPaymentAgreed = true;
      wizardState.paymentType = "down";
      closeModal();
      renderPaymentSummary();
      if (typeof opts.onAgree === "function") opts.onAgree();
    }

    function onCancelClick() {
      closeModal();
      if (typeof opts.onCancel === "function") {
        opts.onCancel();
      } else {
        selectFullPaymentOption();
      }
    }

    function onOverlayClick(e) {
      if (e.target === overlay) onCancelClick();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelClick();
      }
    }

    agreeBtn.addEventListener("click", onAgreeClick);
    cancelBtn.addEventListener("click", onCancelClick);
    checkbox.addEventListener("change", onCheckboxChange);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  }

  function promptDownPaymentRules(onAgree) {
    openDownPaymentRulesModal({
      onAgree: onAgree,
      onCancel: function () {
        selectFullPaymentOption();
      }
    });
  }

  function setBookingTermsAgreeEnabled(enabled) {
    var agreeBtn = document.getElementById("bookingTermsAgreeBtn");
    if (!agreeBtn) return;
    agreeBtn.disabled = !enabled;
    agreeBtn.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function openBookingTermsModal(opts) {
    opts = opts || {};
    var overlay = document.getElementById("bookingTermsOverlay");
    var agreeBtn = document.getElementById("bookingTermsAgreeBtn");
    var cancelBtn = document.getElementById("bookingTermsCancelBtn");
    var checkbox = document.getElementById("bookingTermsAgree");
    if (!overlay || !agreeBtn || !cancelBtn || !checkbox) {
      if (typeof opts.onAgree === "function") opts.onAgree();
      return;
    }
    if (!overlay.hasAttribute("hidden")) return;

    checkbox.checked = false;
    setBookingTermsAgreeEnabled(false);
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    try {
      checkbox.focus();
    } catch (e) {}

    function closeModal() {
      overlay.setAttribute("hidden", "");
      overlay.setAttribute("aria-hidden", "true");
      checkbox.checked = false;
      setBookingTermsAgreeEnabled(false);
      agreeBtn.removeEventListener("click", onAgreeClick);
      cancelBtn.removeEventListener("click", onCancelClick);
      checkbox.removeEventListener("change", onCheckboxChange);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
    }

    function onCheckboxChange() {
      setBookingTermsAgreeEnabled(!!checkbox.checked);
    }

    function onAgreeClick() {
      if (!checkbox.checked) {
        setBookingTermsAgreeEnabled(false);
        return;
      }
      closeModal();
      if (typeof opts.onAgree === "function") opts.onAgree();
    }

    function onCancelClick() {
      closeModal();
      if (typeof opts.onCancel === "function") opts.onCancel();
    }

    function onOverlayClick(e) {
      if (e.target === overlay) onCancelClick();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelClick();
      }
    }

    agreeBtn.addEventListener("click", onAgreeClick);
    cancelBtn.addEventListener("click", onCancelClick);
    checkbox.addEventListener("change", onCheckboxChange);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  }

  function promptBookingTerms(onAgree, onCancel) {
    openBookingTermsModal({
      onAgree: onAgree,
      onCancel: onCancel
    });
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

  function fmtRange(ci, co) {
    if (!ci || !co) return "—";
    return fmtDateLong(ci) + " → " + fmtDateLong(co);
  }

  function statusBadgeClass(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getStatusPresentation === "function") {
      return PF.getStatusPresentation(st).badgeClass;
    }
    var label = normStatus(st);
    if (label === "Confirmed" || label === "Checked In" || label === "Checked Out") {
      return "booking-status--confirmed";
    }
    if (label === "Cancelled") return "booking-status--cancelled";
    if (label === "For Verification") return "booking-status--pending";
    if (label === "Rejected" || label === "No Show") return "booking-status--cancelled";
    return "booking-status--pending";
  }

  function applyStatusBadge(el, booking, label) {
    var PF = window.ElenestPaymentFlow;
    var text = label != null ? label : statusDisplayLabel(booking && booking.status, booking);
    if (PF && typeof PF.getStatusPresentation === "function" && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(el, PF.getStatusPresentation(booking, { label: text }));
      return el;
    }
    el.className = "booking-status " + statusBadgeClass(booking && booking.status);
    el.textContent = text;
    return el;
  }

  function fmtSubmittedShort(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return "";
    }
  }

  function fmtBookingDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (e) {
      return "—";
    }
  }

  function hideBookLoading() {
    var el = document.getElementById("bookLoadingOverlay");
    if (!el) return;
    el.classList.remove("book-loading-overlay--active");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("aria-busy", "false");
    setTimeout(function () {
      el.setAttribute("hidden", "");
    }, 420);
  }

  // Never leave guests stuck on "Preparing your reservation..."
  setTimeout(hideBookLoading, 8000);

  function isAppointmentsOverlayOpen() {
    var overlay = document.getElementById("appointmentsOverlay");
    return !!(overlay && !overlay.hasAttribute("hidden"));
  }

  /** Keeps "View full details" + carousel slide across live refreshes. */
  var appointmentsUiState = {
    openDetailIds: Object.create(null),
    carouselIndex: 0,
    lastFingerprint: ""
  };

  function appointmentsBoardFingerprint(rows) {
    return (rows || [])
      .map(function (b) {
        if (!b) return "";
        return [
          b.id || "",
          b.status || "",
          b.paymentStatus || "",
          b.paymentVerifiedAt || "",
          b.holdExpiresAt || "",
          b.paymentDeadlineAt || "",
          b.bookingConfirmedAt || "",
          b.workflow || "",
          b.submittedAt || "",
          b.checkIn || "",
          b.checkOut || "",
          b.totalEstimate != null ? b.totalEstimate : "",
          b.paymentProofUrl || b.paymentProof || "",
          b.hasPaymentProof ? "1" : "0",
          b.fullName || "",
          b.requestedAt || "",
          b.queueRole || "",
          b.queueMessage || ""
        ].join("\t");
      })
      .join("\n");
  }

  function setAppointmentsTriggerState(open) {
    document.querySelectorAll(".book-nav-appointments").forEach(function (btn) {
      btn.classList.toggle("is-active", !!open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function closeAppointmentsModal() {
    var overlay = document.getElementById("appointmentsOverlay");
    if (!overlay) return;
    overlay.setAttribute("hidden", "");
    overlay.setAttribute("aria-hidden", "true");
    setAppointmentsTriggerState(false);
    document.body.style.overflow = "";
  }

  function openAppointmentsModal() {
    var overlay = document.getElementById("appointmentsOverlay");
    if (!overlay) return;
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    setAppointmentsTriggerState(true);
    document.body.style.overflow = "hidden";
    var closeBtn = document.getElementById("appointmentsCloseBtn");
    if (closeBtn) closeBtn.focus();
    renderAppointmentsBoard();
    if (window.ElenestBookings && typeof window.ElenestBookings.syncLivePaymentStatuses === "function") {
      Promise.resolve(window.ElenestBookings.syncLivePaymentStatuses()).catch(function () {
        return null;
      });
    }
    if (window.ElenestBookings && typeof window.ElenestBookings.refresh === "function") {
      Promise.resolve(window.ElenestBookings.refresh())
        .catch(function () {
          return null;
        })
        .then(function () {
          if (isAppointmentsOverlayOpen()) renderAppointmentsBoard();
        });
    }
  }

  function labelBookingType(v) {
    var m = {
      day_tour: "Day Tour",
      overnight: "Overnight",
      pool_only: "Swimming Pool Only",
      none: "Overnight"
    };
    return m[v] || (v ? String(v) : "—");
  }

  function labelPoolUse(v) {
    var m = {
      none: "Swimming Included",
      swimming_overnight: "Swimming Included (legacy overnight)",
      day_tour: "Swimming Included",
      pool_only: "Swimming Pool Only",
      day: "Day use (legacy)",
      overnight: "Overnight (legacy)",
      swimming: "Swimming (legacy)"
    };
    return m[v] || (v ? String(v) : "—");
  }

  function addBookingDetailRow(dl, term, val, extraClass) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    var text = val === undefined || val === null || val === "" ? "—" : String(val);
    dd.textContent = text;
    if (
      dl &&
      dl.classList &&
      dl.classList.contains("book-details-summary__list") &&
      (/^Select\b/i.test(text) || /select check-out/i.test(text) || text === "—")
    ) {
      dd.classList.add("is-pending");
    }
    if (extraClass) {
      dt.classList.add(extraClass);
      dd.classList.add(extraClass);
    }
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function paymentPresentation(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getPaymentPresentation === "function") {
      return PF.getPaymentPresentation(b, { label: paymentLabel(b) });
    }
    return { kind: "pending", icon: "⏱", label: paymentLabel(b) };
  }

  function reservationPresentation(b, label) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getStatusPresentation === "function") {
      return PF.getStatusPresentation(b, { label: label });
    }
    return { kind: "pending", icon: "⏱", label: label };
  }

  function addBookingStatusDetailRow(dl, term, presentation) {
    var pres = presentation || { kind: "pending", icon: "⏱", label: "—" };
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.className = "booking-dl__status booking-dl__status--" + (pres.kind || "pending");
    var icon = document.createElement("span");
    icon.className = "booking-status-inline-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = pres.icon || "⏱";
    var text = document.createElement("span");
    text.textContent = pres.label || "—";
    dd.appendChild(icon);
    dd.appendChild(text);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function buildReservationCard(b, onDeleted) {
    var article = document.createElement("article");
    article.className = "booking-card reservation-card";
    if (b.id) article.setAttribute("data-booking-id", b.id);

    var top = document.createElement("div");
    top.className = "booking-card__top";
    var normalizedStatus = normStatus(b.status);
    var badge = document.createElement("span");
    applyStatusBadge(badge, b, statusDisplayLabel(normalizedStatus, b));
    top.appendChild(badge);
    function createCancelButton() {
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "booking-card__delete";
      cancelBtn.setAttribute("aria-label", "Cancel this booking");
      cancelBtn.textContent = "Cancel booking";
      cancelBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        cancelCustomerBooking(b).then(function (ok) {
          if (ok && typeof onDeleted === "function") onDeleted();
        });
      });
      return cancelBtn;
    }

    article.appendChild(top);
    article.appendChild(renderBookingProgressStepper(b));
    appendPaymentDeadlineBanner(article, b);

    var name = document.createElement("h4");
    name.className = "booking-card__name";
    name.textContent = b.fullName || "Guest";
    if (b.id && isPendingLikeStatus(normalizedStatus, b)) {
      var nameRow = document.createElement("div");
      nameRow.className = "booking-card__name-row";
      if (window.ElenestGuestAvatar && typeof window.ElenestGuestAvatar.create === "function") {
        nameRow.appendChild(
          window.ElenestGuestAvatar.create(b.guestGender || (window.ElenestAuth.getCurrentUser() || {}), {
            size: "sm"
          })
        );
      }
      nameRow.appendChild(name);
      if (customerCanCancelBooking(b)) nameRow.appendChild(createCancelButton());
      article.appendChild(nameRow);
    } else {
      var nameWrap = document.createElement("div");
      nameWrap.className = "booking-card__name-row";
      if (window.ElenestGuestAvatar && typeof window.ElenestGuestAvatar.create === "function") {
        nameWrap.appendChild(
          window.ElenestGuestAvatar.create(b.guestGender || (window.ElenestAuth.getCurrentUser() || {}), {
            size: "sm"
          })
        );
      }
      nameWrap.appendChild(name);
      article.appendChild(nameWrap);
    }

    var rowBooked = document.createElement("div");
    rowBooked.className = "booking-card__row";
    var labBooked = document.createElement("span");
    labBooked.className = "booking-card__label";
    labBooked.textContent = "Booking date";
    var valBooked = document.createElement("span");
    valBooked.className = "booking-card__value";
    valBooked.textContent = fmtBookingDate(b.submittedAt);
    rowBooked.appendChild(labBooked);
    rowBooked.appendChild(valBooked);

    var rowStay = document.createElement("div");
    rowStay.className = "booking-card__row";
    var labStay = document.createElement("span");
    labStay.className = "booking-card__label";
    labStay.textContent = "Stay dates";
    var valStay = document.createElement("span");
    valStay.className = "booking-card__value";
    valStay.textContent = fmtRange(b.checkIn, b.checkOut);
    rowStay.appendChild(labStay);
    rowStay.appendChild(valStay);
    var rowRoom = document.createElement("div");
    rowRoom.className = "booking-card__row";
    var labRoom = document.createElement("span");
    labRoom.className = "booking-card__label";
    labRoom.textContent = "Stay";
    var valRoom = document.createElement("span");
    valRoom.className = "booking-card__value";
    valRoom.textContent = appointmentStayLabel(b);
    rowRoom.appendChild(labRoom);
    rowRoom.appendChild(valRoom);
    var PFTimer = window.ElenestPaymentFlow;
    var holdRow = null;
    var timerDeadline =
      PFTimer && typeof PFTimer.customerTimerDeadline === "function"
        ? PFTimer.customerTimerDeadline(b)
        : null;
    if (PFTimer && PFTimer.showCustomerTimer && PFTimer.showCustomerTimer(b) && timerDeadline) {
      holdRow = document.createElement("div");
      holdRow.className = "booking-card__row";
      holdRow.setAttribute("data-hold-timer-for", b.id);
      var labHold = document.createElement("span");
      labHold.className = "booking-card__label";
      labHold.textContent =
        PFTimer && typeof PFTimer.customerTimerLabel === "function"
          ? PFTimer.customerTimerLabel(b)
          : "Time remaining";
      var valHold = document.createElement("span");
      valHold.className = "booking-card__value admin-arrival-timer";
      valHold.setAttribute("data-hold-expires", timerDeadline);
      valHold.textContent = "🕒 " + PFTimer.formatTimerRemaining(timerDeadline);
      holdRow.appendChild(labHold);
      holdRow.appendChild(valHold);
    }
    var sub = document.createElement("p");
    sub.className = "booking-card__sub";
    sub.textContent = b.submittedAt
      ? "Submitted " + fmtSubmittedShort(b.submittedAt)
      : "";

    var details = document.createElement("details");
    details.className = "booking-card__details";
    if (b.id && appointmentsUiState.openDetailIds[String(b.id)]) {
      details.open = true;
    }
    var summ = document.createElement("summary");
    summ.textContent = "View full details";
    details.addEventListener("toggle", function () {
      if (!b.id) return;
      var key = String(b.id);
      if (details.open) {
        appointmentsUiState.openDetailIds[key] = true;
        requestAnimationFrame(function () {
          var board = document.getElementById("appointmentsBoard");
          if (board && typeof details.scrollIntoView === "function") {
            details.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        });
      } else {
        delete appointmentsUiState.openDetailIds[key];
      }
    });
    var dl = document.createElement("dl");
    dl.className = "booking-dl booking-dl--compact";

    if (b.id) addBookingDetailRow(dl, "Booking reference", b.id);
    if (b.requestedAt) {
      var requestWhen = new Date(b.requestedAt);
      addBookingDetailRow(
        dl,
        "Request time",
        isNaN(requestWhen.getTime())
          ? b.requestedAt
          : requestWhen.toLocaleString("en-US", {
              timeZone: "Asia/Manila",
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              hour12: true
            })
      );
    }
    addBookingDetailRow(dl, "Booking date", fmtBookingDate(b.submittedAt));
    addBookingDetailRow(dl, "Adults", b.adults);
    addBookingDetailRow(dl, "Children", b.children);
    addBookingDetailRow(dl, "Stay", appointmentStayLabel(b));
    if (Array.isArray(b.cottageCatalogNames) && b.cottageCatalogNames.length) {
      addBookingDetailRow(dl, "Cottages", b.cottageCatalogNames.join(", "));
    } else {
      var cot = b.cottageQty != null && b.cottageQty !== "" ? parseInt(b.cottageQty, 10) : 0;
      addBookingDetailRow(
        dl,
        "Cottages",
        cot > 0 ? String(cot) + " cottage(s)" : "—"
      );
    }
    addBookingDetailRow(dl, "Event hall", b.hallCatalogName || labelHall(b.eventHall, b));
    if (b.poolUse === "pool_only") {
      addBookingDetailRow(dl, "Booking type", "Swimming Pool Only (legacy)");
    } else {
      addBookingDetailRow(
        dl,
        "Booking type",
        b.poolUse === "day_tour" ? "Day Tour" : "Overnight"
      );
    }
    var swimUA = window.ElenestUnitAvailability;
    addBookingDetailRow(
      dl,
      "Swimming",
      swimUA && typeof swimUA.swimmingPoolLabelForBooking === "function"
        ? swimUA.swimmingPoolLabelForBooking(b)
        : swimmingIncludedLabelForBooking(b)
    );
    addBookingDetailRow(dl, "Activity", labelEventTypeCard(b.eventType, b.eventOther));
    if (b.poolUse === "day_tour" || b.poolUse === "pool_only") {
      addBookingDetailRow(
        dl,
        "Schedule",
        b.poolUse === "pool_only"
          ? POOL_ONLY_ARRIVAL_TIME + " – " + POOL_ONLY_DEPARTURE_TIME
          : formatDayTourHours()
      );
    } else {
      addBookingDetailRow(
        dl,
        "Arrival time",
        b.checkInTime ? formatStoredTimeHHmm(b.checkInTime) : "—"
      );
      addBookingDetailRow(
        dl,
        "Departure time",
        b.checkOutTime ? formatStoredTimeHHmm(b.checkOutTime) : "—"
      );
    }
    addBookingDetailRow(dl, "Stay dates", fmtRange(b.checkIn, b.checkOut));
    if (b.totalEstimate != null && b.totalEstimate !== "") {
      addBookingDetailRow(
        dl,
        "Estimated total",
        "₱" + Number(b.totalEstimate).toLocaleString()
      );
    }
    addBookingDetailRow(dl, "Payment type", b.paymentType === "full" ? "Full Payment" : "Down Payment");
    addBookingStatusDetailRow(dl, "Payment status", paymentPresentation(b));
    addBookingStatusDetailRow(
      dl,
      "Booking status",
      reservationPresentation(b, statusDisplayLabel(b.status, b))
    );
    var PFArrive = window.ElenestPaymentFlow;
    var arrivalLabel =
      PFArrive && typeof PFArrive.arrivalDisplayLabel === "function"
        ? PFArrive.arrivalDisplayLabel(b)
        : "Not Arrived";
    addBookingStatusDetailRow(dl, "Arrival status", {
      kind: arrivalLabel === "Arrived" ? "success" : "pending",
      icon: arrivalLabel === "Arrived" ? "✓" : "⏱",
      label: arrivalLabel
    });
    addBookingDetailRow(dl, "Payment method", b.paymentMethod || "—");
    if (b.paymentProof || b.paymentProofUrl || b.hasPaymentProof || b.paymentSubmittedAt) {
      var dt = document.createElement("dt");
      dt.textContent = "Proof of payment";
      var dd = document.createElement("dd");
      dl.appendChild(dt);
      dl.appendChild(dd);
      var PP = window.ElenestPaymentProofs;
      function renderProofImage(src) {
        dd.textContent = "";
        if (!src) {
          dd.textContent = "Uploaded";
          return;
        }
        var img = document.createElement("img");
        img.className = "payment-proof-preview__thumb";
        img.alt = "Payment proof";
        img.src = src;
        img.addEventListener("error", function () {
          if (PP && PP.resolveProofSrc) {
            PP.resolveProofSrc(b).then(function (fresh) {
              if (fresh && fresh !== img.src) img.src = fresh;
              else if (!fresh) dd.textContent = "Uploaded";
            });
          }
        });
        dd.appendChild(img);
      }
      var syncSrc =
        PP && PP.getProofSrc ? PP.getProofSrc(b) : b.paymentProofUrl || b.paymentProof || "";
      if (syncSrc) {
        renderProofImage(syncSrc);
      } else {
        dd.textContent = "Loading…";
        if (PP && PP.resolveProofSrc) {
          PP.resolveProofSrc(b).then(renderProofImage);
        } else {
          renderProofImage("");
        }
      }
    }
    var PF = window.ElenestPaymentFlow;
    var statusNote =
      PF && typeof PF.customerStatusNote === "function" ? PF.customerStatusNote(b) : null;
    if (statusNote && statusNote.label && statusNote.value) {
      var noteRow = document.createElement("div");
      noteRow.className = "booking-card__row booking-card__note-row";
      var noteLab = document.createElement("span");
      noteLab.className = "booking-card__label";
      noteLab.textContent = statusNote.label;
      var noteVal = document.createElement("span");
      noteVal.className = "booking-card__value booking-card__value--note";
      noteVal.textContent = statusNote.value;
      noteRow.appendChild(noteLab);
      noteRow.appendChild(noteVal);
      article.appendChild(noteRow);
    }
    addBookingDetailRow(dl, "Special requests", b.request || "—");

    details.appendChild(summ);
    details.appendChild(dl);
    var queueRole = String(b.queueRole || "").toLowerCase();
    if (
      b.queueMessage &&
      (queueRole === "queued" || queueRole === "unavailable" || queueRole === "next")
    ) {
      var queueNote = document.createElement("p");
      queueNote.className = "reservation-queue-note reservation-queue-note--" + queueRole;
      queueNote.textContent = b.queueMessage;
      article.appendChild(queueNote);
    }
    article.appendChild(rowBooked);
    article.appendChild(rowStay);
    article.appendChild(rowRoom);
    if (holdRow) article.appendChild(holdRow);
    if (sub.textContent) article.appendChild(sub);
    article.appendChild(details);

    var PFPay = window.ElenestPaymentFlow;
    if (PFPay && PFPay.isAwaitingBookingReview && PFPay.isAwaitingBookingReview(b)) {
      var confirmActions = document.createElement("div");
      confirmActions.className = "booking-card__receipt-actions";
      var confirmViewBtn = document.createElement("button");
      confirmViewBtn.type = "button";
      confirmViewBtn.className = "booking-card__receipt-btn";
      confirmViewBtn.textContent = "View booking confirmation";
      confirmViewBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openConfirmationForBooking(b);
      });
      confirmActions.appendChild(confirmViewBtn);
      article.appendChild(confirmActions);
    }
    if (PFPay && PFPay.isAwaitingCustomerPayment && PFPay.isAwaitingCustomerPayment(b) && !PFPay.isPaymentWindowExpired(b)) {
      var payActions = document.createElement("div");
      payActions.className = "booking-card__receipt-actions";
      var payBtn = document.createElement("button");
      payBtn.type = "button";
      payBtn.className = "booking-card__receipt-btn";
      payBtn.textContent = "Pay now";
      payBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPaymentForBooking(b);
      });
      payActions.appendChild(payBtn);
      article.appendChild(payActions);
    }
    if (bookingHasCustomerReceipt(b)) {
      var receiptActions = document.createElement("div");
      receiptActions.className = "booking-card__receipt-actions";
      var viewReceiptBtn = document.createElement("button");
      viewReceiptBtn.type = "button";
      viewReceiptBtn.className = "booking-card__receipt-btn";
      viewReceiptBtn.textContent = "View / download receipt";
      viewReceiptBtn.setAttribute(
        "aria-label",
        "View and download receipt for " + (b.fullName || "this reservation")
      );
      viewReceiptBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openGuestReceiptModal(b);
      });
      receiptActions.appendChild(viewReceiptBtn);
      article.appendChild(receiptActions);
    }
    return article;
  }

  function mountReservationCarousel(host, rows, onDeleted, startIndex) {
    var wrap = document.createElement("div");
    wrap.className = "booking-carousel reservation-carousel";
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-roledescription", "carousel");
    wrap.setAttribute("aria-label", "Your reservations");

    var shell = document.createElement("div");
    shell.className = "booking-carousel__shell";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "booking-carousel__arrow booking-carousel__arrow--prev";
    prevBtn.setAttribute("aria-label", "Previous reservation");
    prevBtn.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';

    var viewport = document.createElement("div");
    viewport.className = "booking-carousel__viewport";

    var track = document.createElement("div");
    track.className = "booking-carousel__track";

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "booking-carousel__arrow booking-carousel__arrow--next";
    nextBtn.setAttribute("aria-label", "Next reservation");
    nextBtn.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

    rows.forEach(function (b) {
      var slide = document.createElement("div");
      slide.className = "booking-carousel__slide";
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.appendChild(buildReservationCard(b, onDeleted));
      track.appendChild(slide);
    });

    viewport.appendChild(track);
    shell.appendChild(prevBtn);
    shell.appendChild(viewport);
    shell.appendChild(nextBtn);

    var n = rows.length;
    var index = Math.max(0, Math.min(n - 1, startIndex | 0));
    var touchStartX = null;

    var footer = document.createElement("div");
    footer.className = "booking-carousel__footer";
    var counter = document.createElement("span");
    counter.className = "booking-carousel__counter";
    var dots = document.createElement("div");
    dots.className = "booking-carousel__dots";
    var dotButtons = [];
    rows.forEach(function (_, di) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "booking-carousel__dot";
      dot.setAttribute("aria-label", "Go to reservation " + (di + 1));
      (function (idx) {
        dot.addEventListener("click", function () {
          index = idx;
          updateCarousel();
        });
      })(di);
      dots.appendChild(dot);
      dotButtons.push(dot);
    });

    footer.appendChild(counter);
    if (rows.length > 1) footer.appendChild(dots);

    wrap.appendChild(shell);
    wrap.appendChild(footer);
    host.appendChild(wrap);

    function updateCarousel() {
      var w = viewport.offsetWidth;
      if (w < 1) return;
      var slides = track.querySelectorAll(".booking-carousel__slide");
      slides.forEach(function (slide) {
        slide.style.flex = "0 0 " + w + "px";
      });
      track.style.transform = "translate3d(" + -index * w + "px,0,0)";
      appointmentsUiState.carouselIndex = index;
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= n - 1;
      prevBtn.setAttribute("aria-disabled", prevBtn.disabled ? "true" : "false");
      nextBtn.setAttribute("aria-disabled", nextBtn.disabled ? "true" : "false");
      counter.textContent = n > 1 ? index + 1 + " / " + n : "1 reservation";
      dotButtons.forEach(function (d, i) {
        d.classList.toggle("booking-carousel__dot--active", i === index);
        if (i === index) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
    }

    function goPrev() {
      if (index > 0) {
        index--;
        updateCarousel();
      }
    }
    function goNext() {
      if (index < n - 1) {
        index++;
        updateCarousel();
      }
    }

    prevBtn.addEventListener("click", goPrev);
    nextBtn.addEventListener("click", goNext);

    wrap.addEventListener("keydown", function (e) {
      if (n < 2) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    });

    viewport.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );
    viewport.addEventListener(
      "touchend",
      function (e) {
        if (touchStartX === null) return;
        var x = e.changedTouches[0].clientX;
        var dx = x - touchStartX;
        touchStartX = null;
        if (dx > 56) goPrev();
        else if (dx < -56) goNext();
      },
      { passive: true }
    );

    var resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateCarousel, 100);
    }
    window.addEventListener("resize", onResize);
    var ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(function () {
            updateCarousel();
          })
        : null;
    if (ro) ro.observe(viewport);

    requestAnimationFrame(function () {
      requestAnimationFrame(updateCarousel);
    });

    return function cleanup() {
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
    };
  }

  function appointmentSortTime(b) {
    if (!b) return 0;
    var raw = b.submittedAt || b.createdAt || b.created_at || b.checkIn || "";
    var t = Date.parse(raw);
    return isNaN(t) ? 0 : t;
  }

  function sortAppointmentsLatestFirst(list) {
    return (list || []).slice().sort(function (a, b) {
      return appointmentSortTime(b) - appointmentSortTime(a);
    });
  }

  function renderAppointmentsBoard() {
    var host = document.getElementById("appointmentsBoard");
    if (!host) return;
    var user = window.ElenestAuth.getCurrentUser();
    if (!user) {
      if (host._reservationCleanup) {
        host._reservationCleanup();
        host._reservationCleanup = null;
      }
      appointmentsUiState.lastFingerprint = "";
      appointmentsUiState.carouselIndex = 0;
      appointmentsUiState.openDetailIds = Object.create(null);
      host.textContent = "";
      var guestEmpty = document.createElement("p");
      guestEmpty.className = "reservation-empty";
      guestEmpty.textContent = "No reservations yet. Complete a booking to see it here.";
      host.appendChild(guestEmpty);
      return;
    }
    var rows = sortAppointmentsLatestFirst(window.ElenestBookings.listForUser(user.email));
    if (window.ElenestBookings.applyRememberedVerification) {
      rows.forEach(function (b) {
        window.ElenestBookings.applyRememberedVerification(b, user.email);
      });
    }
    var fingerprint = appointmentsBoardFingerprint(rows);
    var hasBoard = !!(
      host.querySelector(".booking-carousel") || host.querySelector(".reservation-board--single")
    );
    // Live refresh/sync used to rebuild the whole board every few seconds and
    // immediately collapse open "View full details" panels.
    if (hasBoard && fingerprint === appointmentsUiState.lastFingerprint) {
      return;
    }
    appointmentsUiState.lastFingerprint = fingerprint;

    if (host._reservationCleanup) {
      host._reservationCleanup();
      host._reservationCleanup = null;
    }
    host.textContent = "";
    function rerender() {
      appointmentsUiState.lastFingerprint = "";
      renderAppointmentsBoard();
    }
    if (!rows.length) {
      appointmentsUiState.carouselIndex = 0;
      appointmentsUiState.openDetailIds = Object.create(null);
      var empty = document.createElement("p");
      empty.className = "reservation-empty";
      empty.textContent = "No reservations yet. Complete a booking to see it here.";
      host.appendChild(empty);
      return;
    }
    if (rows.length === 1) {
      appointmentsUiState.carouselIndex = 0;
      var single = document.createElement("div");
      single.className = "reservation-board reservation-board--single";
      single.appendChild(buildReservationCard(rows[0], rerender));
      host.appendChild(single);
      return;
    }
    host._reservationCleanup = mountReservationCarousel(
      host,
      rows,
      rerender,
      appointmentsUiState.carouselIndex
    );
  }

  function goStep(n) {
    currentFlowStep = n;
    try {
      localStorage.setItem(BOOK_FLOW_STEP_KEY, String(n));
    } catch (e) {}
    var panels = document.querySelectorAll(".book-flow__panel");
    var stepper = document.getElementById("bookFlowStepper");
    var steps = stepper ? stepper.querySelectorAll(".book-flow__step") : [];
    panels.forEach(function (p) {
      var s = parseInt(p.getAttribute("data-step"), 10);
      var on = s === n;
      p.classList.toggle("is-active", on);
      p.hidden = !on;
      p.setAttribute("aria-hidden", on ? "false" : "true");
    });
    steps.forEach(function (li) {
      var s = parseInt(li.getAttribute("data-step"), 10);
      var marker = li.querySelector(".book-flow-stepper__marker");
      li.classList.toggle("is-active", s === n);
      li.classList.toggle("is-done", s < n);
      if (marker) marker.textContent = s < n ? "✓" : String(s);
    });
    if (stepper) {
      stepper.querySelectorAll(".book-flow-stepper__connector").forEach(function (line) {
        var after = parseInt(line.getAttribute("data-after"), 10);
        line.classList.toggle("is-done", after < n);
      });
    }
    if (n === 1) {
      closeBookUnitModal();
      normalizeDatesForBookingRule();
      syncStep2BookingRuleUI();
      renderCalendar();
      renderUnitSelectionSummary();
      renderBookingDetailsSummary();
      updateStep2ContinueButton();
      ensureStep2LiveAvailability(true);
    }
    if (n === 3 && typeof renderBookingConfirmationPanel === "function") renderBookingConfirmationPanel();
    if (n === 4) {
      if (wizardState.paymentProofSubmitted && typeof renderPaymentSubmittedState === "function") {
        renderPaymentSubmittedState();
      } else renderPaymentPanel();
    }
    saveBookingDraft();
  }

  function buildPendingBookingRecord() {
    var user = window.ElenestAuth.getCurrentUser();
    var phoneVal = document.getElementById("phone").value.trim();
    var emailVal = document.getElementById("email").value.trim();
    var p = computePayment();
    var et = document.getElementById("eventType");
    var selection = getUnitSelection();
    var legacy = window.ElenestUnitAvailability
      ? window.ElenestUnitAvailability.deriveLegacyFields(selection)
      : {};
    var record = {
      fullName: document.getElementById("fullName").value.trim(),
      phone: phoneVal,
      email: emailVal,
      guestGender: user && user.gender ? user.gender : "",
      roomType: legacy.roomType || "none",
      roomCatalogId: legacy.roomCatalogId || "",
      roomCatalogIds: legacy.roomCatalogIds || [],
      roomCatalogName: legacy.roomCatalogName || "",
      roomCatalogNames: legacy.roomCatalogNames || [],
      // Mobile / public RPC resolve facility via payload.room_id / room_ids
      room_id:
        legacy.roomCatalogId ||
        (legacy.cottageCatalogIds && legacy.cottageCatalogIds[0]) ||
        legacy.hallCatalogId ||
        "",
      room_ids: legacy.room_ids || legacy.facilityIds || [],
      facilityIds: legacy.facilityIds || legacy.room_ids || [],
      capacityTotal: legacy.capacityTotal || 0,
      capacityLabel: legacy.capacityLabel || "",
      workflow: "pending_payment",
      adults: document.getElementById("adults").value,
      children: (function () {
        var el = document.getElementById("children");
        return el && el.value !== "" ? el.value : "0";
      })(),
      childrenUnder6: (function () {
        var el = document.getElementById("childrenUnder6");
        return el && el.value !== "" ? el.value : "0";
      })(),
      eventHall: legacy.eventHall || "none",
      hallCatalogId: legacy.hallCatalogId || "",
      hallCatalogIds: legacy.hallCatalogIds || [],
      hallCatalogName: legacy.hallCatalogName || "",
      hallCatalogNames: legacy.hallCatalogNames || [],
      poolUse: document.getElementById("poolUse").value,
      cottageQty: legacy.cottageQty || "0",
      cottageCatalogIds: legacy.cottageCatalogIds || [],
      cottageCatalogNames: legacy.cottageCatalogNames || [],
      acHallHours: "",
      eventType: et ? et.value : "",
      eventOther:
        et && et.value === "other"
          ? document.getElementById("eventOther").value.trim()
          : "",
      request: document.getElementById("request").value.trim(),
      checkIn: wizardState.checkIn,
      checkOut: wizardState.checkOut,
      checkInTime: wizardState.checkInTime || document.getElementById("checkInTime").value,
      checkOutTime: wizardState.checkOutTime || document.getElementById("checkOutTime").value,
      totalEstimate: p.subtotal,
      poolFee: p.poolFee,
      amountDown: p.down,
      paymentType: getSelectedPaymentType()
    };
    return record;
  }

  function paymentFigures() {
    if (wizardState.payableBooking) {
      var saved = wizardState.payableBooking;
      var subtotal = Number(saved.totalEstimate);
      if (!isFinite(subtotal)) subtotal = 0;
      var down =
        saved.amountDown != null && saved.amountDown !== ""
          ? Number(saved.amountDown)
          : Math.round(subtotal * 0.2);
      return {
        subtotal: subtotal,
        down: down,
        nights: 1,
        lines: [],
        poolFee: Number(saved.poolFee) || 0,
        roomSub: 0,
        cottageSub: 0,
        hallFee: 0
      };
    }
    return computePayment();
  }

  function renderBookingProgressStepper(booking, host) {
    var root = host || document.createElement("nav");
    root.className = "book-status-stepper";
    root.setAttribute("aria-label", "Booking progress");
    root.textContent = "";
    var PF = window.ElenestPaymentFlow;
    var approved = !!(PF && PF.isPaymentApproved && PF.isPaymentApproved(booking));
    var proof = !!(PF && PF.hasSubmittedReceipt && PF.hasSubmittedReceipt(booking));
    var confirmed = !!(
      booking &&
      (booking.bookingConfirmedAt ||
        booking.paymentDeadlineAt ||
        proof ||
        approved ||
        (PF && PF.isAwaitingCustomerPayment && PF.isAwaitingCustomerPayment(booking)))
    );
    var steps = [
      { label: "Submitted", done: !!booking },
      { label: "Booking confirmation", done: confirmed },
      { label: "Payment", done: proof || approved },
      { label: "Payment confirmed", done: approved }
    ];
    var current = 0;
    for (var i = 0; i < steps.length; i++) {
      if (!steps[i].done) {
        current = i;
        break;
      }
      current = i;
    }
    var list = document.createElement("ol");
    list.className = "book-status-stepper__list";
    steps.forEach(function (step, index) {
      var li = document.createElement("li");
      li.className = "book-status-stepper__step";
      if (step.done && index < 3) li.classList.add("is-done");
      if (step.done && index === 3) li.classList.add("is-done");
      if (!step.done && index === current) li.classList.add("is-current");
      var mark = document.createElement("span");
      mark.className = "book-status-stepper__index";
      mark.textContent = step.done ? "✓" : String(index + 1);
      var lab = document.createElement("span");
      lab.textContent = step.label;
      li.appendChild(mark);
      li.appendChild(lab);
      list.appendChild(li);
    });
    root.appendChild(list);
    return root;
  }

  function renderPaymentSummary() {
    var host = document.getElementById("paymentSummaryHost");
    if (!host) return;
    var p = paymentFigures();
    var PF = window.ElenestPaymentFlow;
    var paymentType = getSelectedPaymentType();
    var dueNow = PF && PF.amountDueNow ? PF.amountDueNow(paymentType, p) : paymentType === "full" ? p.subtotal : p.down;
    host.textContent = "";
    var card = document.createElement("div");
    card.className = "payment-summary__card";
    function row(label, val, strong) {
      var r = document.createElement("div");
      r.className = "payment-summary__row" + (strong ? " payment-summary__row--total" : "");
      var lab = document.createElement("span");
      lab.className = "payment-summary__label";
      lab.textContent = label;
      var v = document.createElement("span");
      v.className = "payment-summary__value";
      v.textContent = val;
      r.appendChild(lab);
      r.appendChild(v);
      return r;
    }
    card.appendChild(row("Payment option", paymentType === "full" ? "Full Payment" : "Down Payment (20%)"));
    card.appendChild(row("Nights of stay", String(p.nights)));
    if (p.lines && p.lines.length) {
      p.lines.forEach(function (line) {
        card.appendChild(row(line.label, "₱" + line.amount.toLocaleString()));
      });
    } else {
      if (p.roomSub > 0) card.appendChild(row("Room subtotal", "₱" + p.roomSub.toLocaleString()));
      if (p.cottageSub > 0) card.appendChild(row("Cottages", "₱" + p.cottageSub.toLocaleString()));
      if (p.poolFee > 0) card.appendChild(row("Swimming", "₱" + p.poolFee.toLocaleString()));
      if (p.hallFee > 0) card.appendChild(row("Event hall", "₱" + p.hallFee.toLocaleString()));
    }
    card.appendChild(row("Estimated total", "₱" + p.subtotal.toLocaleString(), true));
    card.appendChild(
      row(
        paymentType === "full" ? "Pay now (full amount)" : "Pay now (20% down payment)",
        "₱" + dueNow.toLocaleString(),
        true
      )
    );
    if (wizardState.payableBooking && wizardState.payableBooking.paymentDeadlineAt) {
      card.appendChild(
        row(
          "Payment deadline",
          new Date(wizardState.payableBooking.paymentDeadlineAt).toLocaleString("en-US", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
          })
        )
      );
    }
    card.appendChild(row("After you upload proof", "For verification — not marked paid yet"));
    if (paymentType === "full") {
      card.appendChild(row("After admin verifies payment", "Booking confirmed · Fully paid"));
    } else {
      card.appendChild(row("After admin verifies payment", "Booking confirmed · Down payment received"));
    }
    host.appendChild(card);
  }

  function closePaymentQrLightbox() {
    var box = document.getElementById("paymentQrLightbox");
    if (!box) return;
    box.hidden = true;
    box.setAttribute("aria-hidden", "true");
    document.body.classList.remove("payment-qr-lightbox-open");
  }

  function openPaymentQrLightbox(src, provider) {
    var box = document.getElementById("paymentQrLightbox");
    var img = document.getElementById("paymentQrLightboxImg");
    var title = document.getElementById("paymentQrLightboxTitle");
    if (!box || !img || !src) return;
    img.src = src;
    img.alt = (provider || "Payment") + " QR code";
    if (title) title.textContent = (provider || "Payment") + " QR code";
    box.hidden = false;
    box.setAttribute("aria-hidden", "false");
    document.body.classList.add("payment-qr-lightbox-open");
    var closeBtn = box.querySelector("[data-payment-qr-close]");
    if (closeBtn && typeof closeBtn.focus === "function") closeBtn.focus();
  }

  function renderPaymentMethods() {
    var host = document.getElementById("paymentMethodsHost");
    if (!host) return;
    host.textContent = "";
    var methods =
      window.ElenestPaymentMethods && typeof window.ElenestPaymentMethods.listActive === "function"
        ? window.ElenestPaymentMethods.listActive()
        : [];
    if (!methods.length) {
      var empty = document.createElement("p");
      empty.className = "payment-methods-empty";
      empty.textContent = "No payment methods are available right now. Please contact the resort.";
      host.appendChild(empty);
      return;
    }
    if (!wizardState.selectedPaymentMethodId) {
      wizardState.selectedPaymentMethodId = methods[0].id;
    }
    methods.forEach(function (m) {
      var card = document.createElement("label");
      card.className = "payment-method-card";
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "paymentMethodChoice";
      radio.value = m.id;
      radio.className = "payment-method-card__radio";
      radio.checked = m.id === wizardState.selectedPaymentMethodId;
      radio.addEventListener("change", function () {
        if (radio.checked) wizardState.selectedPaymentMethodId = m.id;
      });
      var inner = document.createElement("div");
      inner.className = "payment-method-card__body";
      var head = document.createElement("div");
      head.className = "payment-method-card__head";
      var title = document.createElement("strong");
      title.className = "payment-method-card__provider";
      title.textContent = m.provider || "Payment";
      head.appendChild(title);
      inner.appendChild(head);
      if (m.qrImage) {
        var qrWrap = document.createElement("div");
        qrWrap.className = "payment-method-card__qr";
        var qrBtn = document.createElement("button");
        qrBtn.type = "button";
        qrBtn.className = "payment-method-card__qr-btn";
        qrBtn.setAttribute("aria-label", "View " + (m.provider || "payment") + " QR code larger");
        qrBtn.title = "Tap to enlarge QR";
        var img = document.createElement("img");
        img.src = m.qrImage;
        img.alt = (m.provider || "Payment") + " QR code";
        img.loading = "lazy";
        qrBtn.appendChild(img);
        qrBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          wizardState.selectedPaymentMethodId = m.id;
          radio.checked = true;
          openPaymentQrLightbox(m.qrImage, m.provider);
        });
        var qrHint = document.createElement("p");
        qrHint.className = "payment-method-card__qr-hint";
        qrHint.textContent = "Tap QR to enlarge";
        qrWrap.appendChild(qrBtn);
        qrWrap.appendChild(qrHint);
        inner.appendChild(qrWrap);
      }
      var meta = document.createElement("dl");
      meta.className = "payment-method-card__meta";
      function metaRow(term, val) {
        var dt = document.createElement("dt");
        dt.textContent = term;
        var dd = document.createElement("dd");
        dd.textContent = val || "—";
        meta.appendChild(dt);
        meta.appendChild(dd);
      }
      metaRow("Account name", m.accountName);
      metaRow("Account number", m.accountNumber);
      inner.appendChild(meta);
      if (m.instructions) {
        var inst = document.createElement("p");
        inst.className = "payment-method-card__instructions";
        inst.textContent = m.instructions;
        inner.appendChild(inst);
      }
      card.appendChild(radio);
      card.appendChild(inner);
      host.appendChild(card);
    });
  }

  function openConfirmationForBooking(booking) {
    if (!booking || !booking.id) return;
    wizardState.skipResume = false;
    wizardState.reviewBookingId = booking.id;
    wizardState.payableBooking = booking;
    wizardState.paymentProofSubmitted = false;
    closeAppointmentsModal();
    goStep(3);
    var section = document.getElementById("bookingSection");
    if (section && section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pickOpenBooking() {
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (!user || !window.ElenestBookings || typeof window.ElenestBookings.listForUser !== "function") return null;
    var list = window.ElenestBookings.listForUser(user.email) || [];
    var PF = window.ElenestPaymentFlow;
    var best = null;
    var bestRank = 0;
    list.forEach(function (b) {
      if (!b || !b.id || String(b.id).indexOf("__") !== -1) return;
      if (b.linkedFacilityBooking || b.parentBookingId) return;
      var rank = 0;
      if (PF && PF.hasSubmittedReceipt && PF.hasSubmittedReceipt(b) && PF.isPaymentApproved && !PF.isPaymentApproved(b)) {
        rank = 2;
      } else if (PF && PF.isAwaitingBookingReview && PF.isAwaitingBookingReview(b)) {
        rank = 3;
      } else if (
        PF &&
        PF.isAwaitingCustomerPayment &&
        PF.isAwaitingCustomerPayment(b) &&
        PF.isPaymentWindowExpired &&
        !PF.isPaymentWindowExpired(b)
      ) {
        rank = 4;
      }
      if (rank > bestRank) {
        best = b;
        bestRank = rank;
      }
    });
    return best;
  }

  var didResumeOpenBooking = false;
  function tryResumeOpenBooking() {
    if (didResumeOpenBooking || wizardState.skipResume) return;
    if (!window.ElenestAuth || !window.ElenestAuth.getCurrentUser || !window.ElenestAuth.getCurrentUser()) return;
    if (!window.ElenestBookings || typeof window.ElenestBookings.listForUser !== "function") return;
    var open = pickOpenBooking();
    if (!open) {
      var ready = window.ElenestBookings.ready;
      if (ready && ready.then) return;
      didResumeOpenBooking = true;
      return;
    }
    didResumeOpenBooking = true;
    if (window.ElenestPaymentFlow && window.ElenestPaymentFlow.hasSubmittedReceipt && window.ElenestPaymentFlow.hasSubmittedReceipt(open) && !window.ElenestPaymentFlow.isPaymentApproved(open)) {
      wizardState.reviewBookingId = open.id;
      wizardState.payableBooking = open;
      wizardState.paymentProofSubmitted = true;
      goStep(4);
      return;
    }
    openConfirmationForBooking(open);
  }

  function findReviewBooking() {
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (!user || !window.ElenestBookings || typeof window.ElenestBookings.listForUser !== "function") {
      return wizardState.payableBooking || null;
    }
    var list = window.ElenestBookings.listForUser(user.email) || [];
    var i;
    if (wizardState.reviewBookingId) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(wizardState.reviewBookingId)) return list[i];
      }
    }
    if (wizardState.payableBooking && wizardState.payableBooking.id) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(wizardState.payableBooking.id)) return list[i];
      }
    }
    return wizardState.payableBooking || null;
  }

  function isMarkedPaymentExpired(booking) {
    if (!booking) return false;
    var stage = String(booking.verificationStage || booking.verification_stage || "").toLowerCase();
    var pay = String(booking.paymentStatus || "").toLowerCase();
    return stage === "payment_expired" || pay.indexOf("payment deadline expired") !== -1;
  }

  function paymentDeadlineIso(booking) {
    if (!booking) return "";
    return booking.paymentDeadlineAt || booking.payment_deadline_at || "";
  }

  function paintPaymentDeadlineAlert(host, booking) {
    if (!host) return;
    var PF = window.ElenestPaymentFlow;
    var deadline = paymentDeadlineIso(booking);
    var open = !!(
      booking &&
      deadline &&
      PF &&
      PF.isAwaitingCustomerPayment &&
      PF.isAwaitingCustomerPayment(booking)
    );
    var expired =
      isMarkedPaymentExpired(booking) ||
      !!(open && PF.isPaymentWindowExpired && PF.isPaymentWindowExpired(booking));
    if (!open && !expired) {
      host.hidden = true;
      host.removeAttribute("data-pay-state");
      host.textContent = "";
      return;
    }
    host.hidden = false;
    if (expired) {
      host.classList.add("is-expired");
      if (host.getAttribute("data-pay-state") !== "expired") {
        host.setAttribute("data-pay-state", "expired");
        host.innerHTML =
          '<p class="pay-deadline-alert__title">Payment window ended</p>' +
          '<p class="pay-deadline-alert__note">The 3-hour payment deadline has passed. This booking is expired and the reserved facility has been released.</p>';
      }
      return;
    }
    host.classList.remove("is-expired");
    var clock = host.querySelector("[data-pay-clock]");
    if (host.getAttribute("data-pay-state") !== "open" || !clock) {
      host.setAttribute("data-pay-state", "open");
      host.innerHTML =
        '<p class="pay-deadline-alert__title">Complete payment within 3 hours</p>' +
        '<p class="pay-deadline-alert__clock" data-pay-clock="1"></p>' +
        '<p class="pay-deadline-alert__note">Pay the amount due and upload your receipt before this timer ends.</p>';
      clock = host.querySelector("[data-pay-clock]");
    }
    if (clock) {
      clock.setAttribute("data-deadline", deadline);
      clock.textContent = PF.formatTimerRemaining ? PF.formatTimerRemaining(deadline) : "";
    }
  }

  function appendPaymentDeadlineBanner(article, booking) {
    var PF = window.ElenestPaymentFlow;
    var deadline = paymentDeadlineIso(booking);
    if (!article || !deadline || !PF || !PF.isAwaitingCustomerPayment || !PF.isAwaitingCustomerPayment(booking)) return;
    if (PF.isPaymentWindowExpired && PF.isPaymentWindowExpired(booking)) return;
    var banner = document.createElement("div");
    banner.className = "pay-deadline-alert";
    banner.setAttribute("role", "status");
    var title = document.createElement("p");
    title.className = "pay-deadline-alert__title";
    title.textContent = "Complete payment within 3 hours";
    var clock = document.createElement("p");
    clock.className = "pay-deadline-alert__clock";
    clock.setAttribute("data-pay-clock", "1");
    clock.setAttribute("data-deadline", deadline);
    clock.textContent = PF.formatTimerRemaining ? PF.formatTimerRemaining(deadline) : "";
    var note = document.createElement("p");
    note.className = "pay-deadline-alert__note";
    note.textContent = "Pay and upload your receipt before this timer ends.";
    banner.appendChild(title);
    banner.appendChild(clock);
    banner.appendChild(note);
    article.appendChild(banner);
  }

  var paymentExpireSweepAt = 0;
  function sweepExpiredPaymentWindows() {
    var PF = window.ElenestPaymentFlow;
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (!user || !user.email || !window.ElenestBookings || !PF || !PF.shouldAutoExpireUnpaidBooking) return;
    var list = window.ElenestBookings.listForUser(user.email) || [];
    var needs = false;
    for (var i = 0; i < list.length; i++) {
      if (PF.shouldAutoExpireUnpaidBooking(list[i])) {
        needs = true;
        break;
      }
    }
    if (!needs) return;
    var now = Date.now();
    if (now - paymentExpireSweepAt < 4000) return;
    paymentExpireSweepAt = now;
    if (window.ElenestBookings.processAutoNoShows) window.ElenestBookings.processAutoNoShows();
  }

  function renderBookingConfirmationPanel() {
    var lead = document.getElementById("bookingConfirmLead");
    var statusEl = document.getElementById("bookingConfirmStatus");
    var summary = document.getElementById("bookingConfirmSummary");
    var payBtn = document.getElementById("continueToPaymentBtn");
    var booking = findReviewBooking();
    var PF = window.ElenestPaymentFlow;
    if (summary) {
      summary.textContent = "";
      if (!booking) {
        summary.hidden = true;
      } else {
        summary.hidden = false;
        var adults = parseInt(booking.adults, 10) || 0;
        var children = parseInt(booking.children, 10) || 0;
        var under = parseInt(booking.childrenUnder6, 10) || 0;
        var guestBits = [];
        if (adults) guestBits.push(adults + (adults === 1 ? " adult" : " adults"));
        if (children) guestBits.push(children + (children === 1 ? " child (6–12)" : " children (6–12)"));
        if (under) guestBits.push(under + (under === 1 ? " child (0–5)" : " children (0–5)"));
        var rows = [
          ["Facility", appointmentStayLabel(booking)],
          ["Date", bookingReceiptDateLabel(booking)],
          ["Schedule", bookingReceiptTimeLabel(booking)],
          ["Guests", guestBits.join(", ") || "—"],
          ["Total", formatMoneyPeso(booking.totalEstimate)]
        ];
        rows.forEach(function (pair) {
          var row = document.createElement("div");
          row.className = "book-confirm-summary__row";
          var lab = document.createElement("span");
          lab.textContent = pair[0];
          var val = document.createElement("strong");
          val.textContent = pair[1] || "—";
          row.appendChild(lab);
          row.appendChild(val);
          summary.appendChild(row);
        });
      }
    }
    var awaitingPay = !!(booking && PF && PF.isAwaitingCustomerPayment && PF.isAwaitingCustomerPayment(booking));
    var expired =
      isMarkedPaymentExpired(booking) ||
      !!(awaitingPay && PF.isPaymentWindowExpired && PF.isPaymentWindowExpired(booking));
    var proof = !!(booking && PF && PF.hasSubmittedReceipt && PF.hasSubmittedReceipt(booking));
    if (statusEl) {
      statusEl.className = "book-confirm-status";
      if (expired) {
        statusEl.textContent = "Payment window ended";
        statusEl.classList.add("is-expired");
      } else if (proof) {
        statusEl.textContent = "Receipt submitted";
        statusEl.classList.add("is-ready");
      } else if (awaitingPay) {
        statusEl.textContent = "Confirmed — pay within 3 hours";
        statusEl.classList.add("is-pay");
      } else {
        statusEl.textContent = "Waiting for admin";
        statusEl.classList.add("is-waiting");
      }
    }
    if (lead) {
      if (!booking) {
        lead.textContent = "Submit your booking details first. This step stays here until an admin confirms them.";
      } else if (expired) {
        lead.textContent =
          "The 3-hour payment window ended before a receipt was uploaded. This booking is expired and the reserved facility has been released.";
      } else if (proof) {
        lead.textContent =
          "Proof of payment submitted successfully. An admin will verify it in Reservation Management. This booking is not marked paid yet.";
      } else if (awaitingPay) {
        lead.textContent =
          "Your booking is confirmed. Pay the amount due and upload your receipt before the timer reaches zero.";
      } else {
        lead.textContent =
          "Your request is with the admin. You can cancel it until the admin confirms the facility, date, and schedule. After confirmation, payment opens for 3 hours and cancellation is closed.";
      }
    }
    paintPaymentDeadlineAlert(document.getElementById("bookingPaymentDeadlineAlert"), booking);
    var cancelConfirmBtn = document.getElementById("cancelBookingFromConfirmBtn");
    if (cancelConfirmBtn) cancelConfirmBtn.hidden = !customerCanCancelBooking(booking);
    if (payBtn) {
      var canPay = awaitingPay && !expired;
      payBtn.disabled = !canPay;
      payBtn.hidden = !!proof;
      payBtn.textContent = canPay ? "Continue to payment" : "Waiting for admin confirmation";
    }
  }

  function setPaymentFormVisible(visible) {
    ["paymentTypeFieldset", "paymentSummaryHost", "paymentMethodsHost", "paymentProofSection", "paymentStepActions"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = !visible;
    });
    var submitted = document.getElementById("paymentSubmittedState");
    if (submitted) submitted.hidden = visible;
  }

  function renderPaymentSubmittedState() {
    setPaymentFormVisible(false);
    var booking = wizardState.payableBooking || (typeof getCompletedBookingForReceipt === "function" ? getCompletedBookingForReceipt() : null);
    var lead = document.getElementById("paymentStepLead");
    var submittedLead = document.getElementById("paymentSubmittedLead");
    if (lead) lead.textContent = "Proof of payment submitted successfully.";
    if (submittedLead) {
      submittedLead.textContent =
        "Your proof of payment was submitted successfully. An admin will verify it in Reservation Management. This booking is not marked paid yet.";
    }
    if (typeof setPaymentStepError === "function") setPaymentStepError("");
    if (booking && typeof renderCompletedBookingReceipt === "function") renderCompletedBookingReceipt(booking);
  }

  function renderPaymentPanel() {
    wizardState.paymentProofSubmitted = false;
    setPaymentFormVisible(true);
    wizardState.paymentType = getSelectedPaymentType();
    var lead = document.getElementById("paymentStepLead");
    var payable = wizardState.payableBooking;
    var PF = window.ElenestPaymentFlow;
    var stepperHost = document.getElementById("paymentFlowStepper");
    if (stepperHost) {
      if (payable) renderBookingProgressStepper(payable, stepperHost);
      else stepperHost.textContent = "";
    }
    paintPaymentDeadlineAlert(document.getElementById("paymentDeadlineAlert"), payable);
    if (lead) {
      if (!payable || !PF || !PF.isAwaitingCustomerPayment(payable)) {
        lead.textContent = "Online payment opens after an admin confirms your booking details.";
      } else if (PF.isPaymentWindowExpired && PF.isPaymentWindowExpired(payable)) {
        lead.textContent =
          "The 3-hour payment window has ended. This booking is expired and the reserved facility has been released.";
      } else {
        lead.textContent =
          "Your booking details are confirmed. Pay the amount due and upload a photo of your receipt before the timer reaches zero. Uploading proof does not mark the booking as paid until an admin verifies it.";
      }
    }
    renderPaymentSummary();
    renderPaymentMethods();
    var typeRadios = document.querySelectorAll('input[name="paymentTypeChoice"]');
    typeRadios.forEach(function (radio) {
      radio.checked = radio.value === wizardState.paymentType;
      if (!radio._paymentTypeBound) {
        radio._paymentTypeBound = true;
        radio.addEventListener("change", function () {
          if (!radio.checked) return;
          if (radio.value === "down") {
            wizardState.downPaymentAgreed = false;
            wizardState.paymentType = "down";
            renderPaymentSummary();
            promptDownPaymentRules();
          } else {
            wizardState.paymentType = "full";
            wizardState.downPaymentAgreed = false;
            renderPaymentSummary();
          }
        });
      }
    });
    var proofInput = document.getElementById("paymentProofFile");
    var preview = document.getElementById("paymentProofPreview");
    var err = document.getElementById("paymentStepError");
    if (proofInput) proofInput.value = "";
    if (preview) {
      preview.hidden = true;
      preview.textContent = "";
    }
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function setPaymentStepError(msg) {
    var err = document.getElementById("paymentStepError");
    if (!err) return;
    if (!msg) {
      err.hidden = true;
      err.textContent = "";
      return;
    }
    err.hidden = false;
    err.textContent = msg;
  }

  function readPaymentProofAsDataUrl() {
    return new Promise(function (resolve) {
      var input = document.getElementById("paymentProofFile");
      if (!input || !input.files || !input.files[0]) {
        resolve("");
        return;
      }
      var file = input.files[0];
      if (!file.type || file.type.indexOf("image/") !== 0) {
        setPaymentStepError("Proof of payment must be an image file.");
        resolve(null);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        setPaymentStepError("Could not read the uploaded image. Please try again.");
        resolve(null);
      };
      reader.readAsDataURL(file);
    });
  }

  function bookingReceiptId(booking) {
    var id = String(booking && booking.id ? booking.id : "").replace(/[^a-zA-Z0-9]/g, "");
    return id ? "RCP-" + id.toUpperCase() : "";
  }

  function formatMoneyPeso(n) {
    var num = Number(n);
    if (!isFinite(num)) return "—";
    return "₱" + num.toLocaleString();
  }

  function bookingReceiptDateLabel(b) {
    if (!b) return "—";
    if (
      b.poolUse === "day_tour" ||
      b.poolUse === "pool_only" ||
      !b.checkOut ||
      b.checkOut === b.checkIn
    ) {
      return fmtDateLong(b.checkIn);
    }
    return fmtRange(b.checkIn, b.checkOut);
  }

  function bookingReceiptTimeLabel(b) {
    if (!b) return "—";
    if (b.poolUse === "day_tour") return formatDayTourHours();
    if (b.poolUse === "pool_only") {
      return POOL_ONLY_ARRIVAL_TIME + " – " + POOL_ONLY_DEPARTURE_TIME;
    }
    var tIn = b.checkInTime ? formatStoredTimeHHmm(b.checkInTime) : "";
    var tOut = b.checkOutTime ? formatStoredTimeHHmm(b.checkOutTime) : "";
    if (tIn && tOut) return tIn + " – " + tOut;
    return tIn || tOut || "—";
  }

  function bookingReceiptStatusLabel(b) {
    var pay = paymentLabel(b);
    var book = statusDisplayLabel(b && b.status, b);
    if (pay && book && String(pay) !== String(book)) return pay + " · " + book;
    return pay || book || "—";
  }

  function bookingReceiptAmount(booking) {
    if (!booking) return null;
    if (booking.amountPaid != null && booking.amountPaid !== "") return booking.amountPaid;
    if (booking.totalEstimate != null && booking.totalEstimate !== "") return booking.totalEstimate;
    return null;
  }

  function bookingHasCustomerReceipt(booking) {
    if (!booking || !booking.id) return false;
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.hasSubmittedReceipt === "function" && PF.hasSubmittedReceipt(booking)) {
      return true;
    }
    if (booking.paymentVerifiedAt || booking.paymentSubmittedAt || booking.checkedInAt) return true;
    if (String(booking.arrivalStatus || "").toLowerCase() === "arrived") return true;
    if (PF && typeof PF.isPaymentApproved === "function" && PF.isPaymentApproved(booking)) {
      return true;
    }
    var st = String((booking && booking.status) || "").toLowerCase();
    return (
      st.indexOf("confirm") >= 0 ||
      st.indexOf("reserv") >= 0 ||
      st.indexOf("arriv") >= 0 ||
      st.indexOf("check") >= 0 ||
      st.indexOf("verif") >= 0 ||
      st.indexOf("paid") >= 0 ||
      st.indexOf("hold") >= 0
    );
  }

  function escapeReceiptHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function guestReceiptLogoUrl() {
    try {
      return new URL("../Images/elenest_logo_pink.png", window.location.href).href;
    } catch (e) {
      return "../Images/elenest_logo_pink.png";
    }
  }

  function getReceiptFieldGroups(booking) {
    var user =
      window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
    var amount = bookingReceiptAmount(booking);
    var issued =
      booking && (booking.paymentSubmittedAt || booking.submittedAt || booking.createdAt)
        ? fmtSubmittedShort(booking.paymentSubmittedAt || booking.submittedAt || booking.createdAt)
        : fmtSubmittedShort(new Date().toISOString());
    return {
      receiptId: bookingReceiptId(booking) || "—",
      bookingRef: booking && booking.id ? String(booking.id) : "—",
      issued: issued || "—",
      guest: [
        { label: "Guest name", value: (booking && booking.fullName) || "—" },
        { label: "Email", value: (user && user.email) || (booking && booking.email) || "—" },
        {
          label: "Phone",
          value: (booking && (booking.phone || booking.contactNumber)) || (user && user.phone) || "—"
        }
      ],
      stay: [
        { label: "Facility", value: appointmentStayLabel(booking) },
        { label: "Stay dates", value: bookingReceiptDateLabel(booking) },
        { label: "Schedule", value: bookingReceiptTimeLabel(booking) }
      ],
      payment: [
        {
          label: "Payment type",
          value: booking && booking.paymentType === "full" ? "Full Payment" : "Down Payment"
        },
        { label: "Payment method", value: (booking && booking.paymentMethod) || "—" },
        { label: "Status", value: bookingReceiptStatusLabel(booking) }
      ],
      amountLabel: amount != null ? formatMoneyPeso(amount) : "—",
      amountNote:
        booking && booking.paymentType === "full" ? "Total amount paid" : "Down payment amount"
    };
  }

  function getReceiptFieldRows(booking) {
    var g = getReceiptFieldGroups(booking);
    return [
      { label: "Receipt ID", value: g.receiptId },
      { label: "Booking reference", value: g.bookingRef },
      { label: "Guest name", value: g.guest[0].value },
      { label: "Email", value: g.guest[1].value },
      { label: "Phone", value: g.guest[2].value },
      { label: "Stay / facility", value: g.stay[0].value },
      { label: "Stay dates", value: g.stay[1].value },
      { label: "Schedule", value: g.stay[2].value },
      { label: "Payment type", value: g.payment[0].value },
      { label: "Payment method", value: g.payment[1].value },
      { label: "Amount", value: g.amountLabel, strong: true },
      { label: "Status", value: g.payment[2].value },
      { label: "Issued", value: g.issued }
    ];
  }

  function appendReceiptRows(host, rows) {
    rows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "guest-receipt-row";
      var lab = document.createElement("span");
      lab.className = "guest-receipt-row__label";
      lab.textContent = row.label;
      var val = document.createElement("span");
      val.className = "guest-receipt-row__value";
      val.textContent = row.value;
      item.appendChild(lab);
      item.appendChild(val);
      host.appendChild(item);
    });
  }

  function fillProfessionalReceiptHost(host, booking) {
    if (!host) return;
    if (!booking || !booking.id) {
      host.hidden = true;
      host.textContent = "";
      return;
    }
    host.hidden = false;
    host.textContent = "";
    var g = getReceiptFieldGroups(booking);

    var sheet = document.createElement("article");
    sheet.className = "guest-receipt-sheet";
    sheet.setAttribute("data-receipt-id", g.receiptId);

    var letterhead = document.createElement("header");
    letterhead.className = "guest-receipt-sheet__letterhead";

    var logoWrap = document.createElement("div");
    logoWrap.className = "guest-receipt-sheet__logo-wrap";
    var logo = document.createElement("img");
    logo.className = "guest-receipt-sheet__logo";
    logo.src = guestReceiptLogoUrl();
    logo.alt = "Elenest Resort";
    logoWrap.appendChild(logo);

    var brandCopy = document.createElement("div");
    brandCopy.className = "guest-receipt-sheet__brand-copy";
    var brandName = document.createElement("p");
    brandName.className = "guest-receipt-sheet__brand-name";
    brandName.textContent = "Elenest Resort";
    var brandDoc = document.createElement("p");
    brandDoc.className = "guest-receipt-sheet__doc-type";
    brandDoc.textContent = "Official Booking Receipt";
    var brandSub = document.createElement("p");
    brandSub.className = "guest-receipt-sheet__brand-sub";
    brandSub.textContent = "Reservation & payment confirmation";
    brandCopy.appendChild(brandName);
    brandCopy.appendChild(brandDoc);
    brandCopy.appendChild(brandSub);

    letterhead.appendChild(logoWrap);
    letterhead.appendChild(brandCopy);

    var docMeta = document.createElement("div");
    docMeta.className = "guest-receipt-sheet__docmeta";
    [
      { label: "Receipt No.", value: g.receiptId },
      { label: "Booking Ref.", value: g.bookingRef },
      { label: "Date issued", value: g.issued }
    ].forEach(function (m) {
      var cell = document.createElement("div");
      cell.className = "guest-receipt-sheet__docmeta-item";
      var lab = document.createElement("span");
      lab.className = "guest-receipt-sheet__docmeta-label";
      lab.textContent = m.label;
      var val = document.createElement("strong");
      val.className = "guest-receipt-sheet__docmeta-value";
      val.textContent = m.value;
      cell.appendChild(lab);
      cell.appendChild(val);
      docMeta.appendChild(cell);
    });

    var grid = document.createElement("div");
    grid.className = "guest-receipt-sheet__grid";

    var guestSec = document.createElement("section");
    guestSec.className = "guest-receipt-section";
    var guestTitle = document.createElement("h4");
    guestTitle.className = "guest-receipt-section__title";
    guestTitle.textContent = "Billed to";
    guestSec.appendChild(guestTitle);
    appendReceiptRows(guestSec, g.guest);

    var staySec = document.createElement("section");
    staySec.className = "guest-receipt-section";
    var stayTitle = document.createElement("h4");
    stayTitle.className = "guest-receipt-section__title";
    stayTitle.textContent = "Reservation";
    staySec.appendChild(stayTitle);
    appendReceiptRows(staySec, g.stay);

    grid.appendChild(guestSec);
    grid.appendChild(staySec);

    var paySec = document.createElement("section");
    paySec.className = "guest-receipt-section guest-receipt-section--full";
    var payTitle = document.createElement("h4");
    payTitle.className = "guest-receipt-section__title";
    payTitle.textContent = "Payment details";
    paySec.appendChild(payTitle);
    appendReceiptRows(paySec, g.payment);

    var total = document.createElement("div");
    total.className = "guest-receipt-total";
    var totalNote = document.createElement("span");
    totalNote.className = "guest-receipt-total__note";
    totalNote.textContent = g.amountNote;
    var totalAmt = document.createElement("strong");
    totalAmt.className = "guest-receipt-total__amount";
    totalAmt.textContent = g.amountLabel;
    total.appendChild(totalNote);
    total.appendChild(totalAmt);

    var footer = document.createElement("footer");
    footer.className = "guest-receipt-sheet__footer";
    var thanks = document.createElement("p");
    thanks.className = "guest-receipt-sheet__thanks";
    thanks.textContent = "Thank you for choosing Elenest Resort.";
    var note = document.createElement("p");
    note.className = "guest-receipt-sheet__note";
    note.textContent =
      "This document is your official backup copy. Please present it at the resort if requested.";
    footer.appendChild(thanks);
    footer.appendChild(note);

    sheet.appendChild(letterhead);
    sheet.appendChild(docMeta);
    sheet.appendChild(grid);
    sheet.appendChild(paySec);
    sheet.appendChild(total);
    sheet.appendChild(footer);
    host.appendChild(sheet);
  }

  function buildReceiptPrintHtml(booking) {
    var g = getReceiptFieldGroups(booking);
    function rowsHtml(rows) {
      return rows
        .map(function (row) {
          return (
            "<div class='row'><span>" +
            escapeReceiptHtml(row.label) +
            "</span><strong>" +
            escapeReceiptHtml(row.value) +
            "</strong></div>"
          );
        })
        .join("");
    }
    var rid = escapeReceiptHtml(g.receiptId || "receipt");
    return (
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" +
      rid +
      " · Elenest Resort</title><style>" +
      "@page{margin:16mm}" +
      "body{margin:0;padding:24px;background:#ece8e4;color:#24191a;font-family:'Segoe UI',Calibri,Arial,sans-serif;}" +
      ".sheet{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d9cfd0;padding:34px 36px 28px;box-shadow:0 10px 30px rgba(36,25,26,.08);}" +
      ".letterhead{display:flex;align-items:center;gap:16px;padding-bottom:18px;border-bottom:3px solid #b85c68;}" +
      ".logo{width:64px;height:64px;object-fit:contain;}" +
      ".brand{font-family:Georgia,'Times New Roman',serif;font-size:28px;margin:0;letter-spacing:.02em;}" +
      ".doc{margin:4px 0 0;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#b85c68;}" +
      ".sub{margin:4px 0 0;font-size:12px;color:#6b5f60;}" +
      ".meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 20px;padding:14px 16px;background:#faf7f6;border:1px solid #eadfe0;}" +
      ".meta span{display:block;font-size:11px;color:#7a6c6d;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;}" +
      ".meta strong{font-size:13px;word-break:break-all;}" +
      ".grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:16px;}" +
      ".sec{border:1px solid #eadfe0;padding:14px 16px;}" +
      ".sec h4{margin:0 0 10px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#b85c68;}" +
      ".row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #f1eaeb;font-size:13px;}" +
      ".row:last-child{border-bottom:none;}" +
      ".row span{color:#6b5f60;}" +
      ".row strong{text-align:right;font-weight:600;}" +
      ".full{margin-bottom:16px;}" +
      ".total{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;background:linear-gradient(90deg,#fff7f8,#f8eef0);border:1px solid #e4c8cc;}" +
      ".total span{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a6c6d;}" +
      ".total strong{font-size:26px;color:#8f3d4a;}" +
      ".foot{margin-top:22px;padding-top:14px;border-top:1px solid #eadfe0;}" +
      ".thanks{margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:15px;}" +
      ".note{margin:0;font-size:12px;color:#6b5f60;line-height:1.5;}" +
      "@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border:none;max-width:none}}" +
      "@media(max-width:640px){.grid,.meta{grid-template-columns:1fr}.letterhead{align-items:flex-start}}" +
      "</style></head><body><div class='sheet'>" +
      "<div class='letterhead'>" +
      "<img class='logo' src='" +
      escapeReceiptHtml(guestReceiptLogoUrl()) +
      "' alt='Elenest Resort'>" +
      "<div><p class='brand'>Elenest Resort</p><p class='doc'>Official Booking Receipt</p>" +
      "<p class='sub'>Reservation &amp; payment confirmation</p></div></div>" +
      "<div class='meta'>" +
      "<div><span>Receipt No.</span><strong>" +
      rid +
      "</strong></div>" +
      "<div><span>Booking Ref.</span><strong>" +
      escapeReceiptHtml(g.bookingRef) +
      "</strong></div>" +
      "<div><span>Date issued</span><strong>" +
      escapeReceiptHtml(g.issued) +
      "</strong></div></div>" +
      "<div class='grid'>" +
      "<section class='sec'><h4>Billed to</h4>" +
      rowsHtml(g.guest) +
      "</section>" +
      "<section class='sec'><h4>Reservation</h4>" +
      rowsHtml(g.stay) +
      "</section></div>" +
      "<section class='sec full'><h4>Payment details</h4>" +
      rowsHtml(g.payment) +
      "</section>" +
      "<div class='total'><span>" +
      escapeReceiptHtml(g.amountNote) +
      "</span><strong>" +
      escapeReceiptHtml(g.amountLabel) +
      "</strong></div>" +
      "<footer class='foot'><p class='thanks'>Thank you for choosing Elenest Resort.</p>" +
      "<p class='note'>This document is your official backup copy. Please present it at the resort if requested.</p></footer>" +
      "</div></body></html>"
    );
  }

  var guestReceiptBooking = null;

  function isGuestReceiptOverlayOpen() {
    var overlay = document.getElementById("guestReceiptOverlay");
    return !!(overlay && !overlay.hasAttribute("hidden"));
  }

  function closeGuestReceiptModal() {
    var overlay = document.getElementById("guestReceiptOverlay");
    if (!overlay) return;
    overlay.setAttribute("hidden", "");
    overlay.setAttribute("aria-hidden", "true");
    guestReceiptBooking = null;
    var body = document.getElementById("guestReceiptBody");
    if (body) body.textContent = "";
    if (!isAppointmentsOverlayOpen()) document.body.style.overflow = "";
  }

  function openGuestReceiptModal(booking) {
    if (!booking || !booking.id) return;
    var overlay = document.getElementById("guestReceiptOverlay");
    var body = document.getElementById("guestReceiptBody");
    if (!overlay || !body) return;
    guestReceiptBooking = booking;
    fillProfessionalReceiptHost(body, booking);
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    var closeBtn = document.getElementById("guestReceiptCloseBtn");
    if (closeBtn) closeBtn.focus();
  }

  function receiptDownloadStamp(booking) {
    return String(bookingReceiptId(booking) || booking.id || "receipt").replace(
      /[^a-zA-Z0-9_-]+/g,
      "-"
    );
  }

  function loadReceiptLogoImage() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = guestReceiptLogoUrl();
    });
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    var words = String(text || "").split(/\s+/);
    var lines = [];
    var line = "";
    words.forEach(function (word) {
      var test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function drawWrappedCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    var lines = wrapCanvasText(ctx, text, maxWidth);
    lines.forEach(function (line, i) {
      ctx.fillText(line, x, y + i * lineHeight);
    });
    return lines.length * lineHeight;
  }

  function renderGuestReceiptCanvas(booking) {
    return loadReceiptLogoImage().then(function (logoImg) {
      var g = getReceiptFieldGroups(booking);
      var width = 900;
      var pad = 42;
      var contentW = width - pad * 2;
      var canvas = document.createElement("canvas");
      var ctx = canvas.getContext("2d");
      var y = pad;
      var rose = "#b85c68";
      var ink = "#24191a";
      var muted = "#6b5f60";
      var line = "#eadfe0";
      var soft = "#faf7f6";

      // Measure height first with a dry-run style pass using a temp canvas context sizing.
      function measureRows(rows, rowW) {
        var h = 0;
        rows.forEach(function (row) {
          ctx.font = "600 15px Segoe UI, Arial, sans-serif";
          var labelH = wrapCanvasText(ctx, row.label, Math.floor(rowW * 0.42)).length * 18;
          var valueH = wrapCanvasText(ctx, row.value, Math.floor(rowW * 0.5)).length * 18;
          h += Math.max(labelH, valueH) + 14;
        });
        return h;
      }

      ctx.font = "15px Segoe UI, Arial, sans-serif";
      var colGap = 18;
      var colW = (contentW - colGap) / 2;
      var guestH = 34 + measureRows(g.guest, colW - 28);
      var stayH = 34 + measureRows(g.stay, colW - 28);
      var gridH = Math.max(guestH, stayH) + 28;
      var payH = 34 + measureRows(g.payment, contentW - 28) + 28;
      var height =
        pad +
        78 +
        18 +
        86 +
        20 +
        gridH +
        16 +
        payH +
        16 +
        72 +
        18 +
        70 +
        pad;

      canvas.width = width;
      canvas.height = Math.ceil(height);

      // Background
      ctx.fillStyle = "#ece8e4";
      ctx.fillRect(0, 0, width, canvas.height);
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, 18, 18, width - 36, canvas.height - 36, 10);
      ctx.fill();
      ctx.strokeStyle = "#d9cfd0";
      ctx.lineWidth = 1;
      ctx.stroke();

      var x = pad;
      y = pad + 8;

      // Letterhead
      if (logoImg) {
        ctx.drawImage(logoImg, x, y, 64, 64);
      } else {
        ctx.fillStyle = "#f8e1e7";
        roundRect(ctx, x, y, 64, 64, 12);
        ctx.fill();
      }
      ctx.fillStyle = ink;
      ctx.font = "700 30px Georgia, Times New Roman, serif";
      ctx.fillText("Elenest Resort", x + 80, y + 28);
      ctx.fillStyle = rose;
      ctx.font = "700 12px Segoe UI, Arial, sans-serif";
      ctx.fillText("OFFICIAL BOOKING RECEIPT", x + 80, y + 48);
      ctx.fillStyle = muted;
      ctx.font = "12px Segoe UI, Arial, sans-serif";
      ctx.fillText("Reservation & payment confirmation", x + 80, y + 66);

      y += 86;
      ctx.strokeStyle = rose;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + contentW, y);
      ctx.stroke();
      y += 18;

      // Meta strip
      ctx.fillStyle = soft;
      roundRect(ctx, x, y, contentW, 74, 8);
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.stroke();
      var metas = [
        { label: "Receipt No.", value: g.receiptId },
        { label: "Booking Ref.", value: g.bookingRef },
        { label: "Date issued", value: g.issued }
      ];
      var metaW = contentW / 3;
      metas.forEach(function (m, i) {
        var mx = x + 14 + i * metaW;
        ctx.fillStyle = muted;
        ctx.font = "600 11px Segoe UI, Arial, sans-serif";
        ctx.fillText(m.label.toUpperCase(), mx, y + 24);
        ctx.fillStyle = ink;
        ctx.font = "700 14px Segoe UI, Arial, sans-serif";
        drawWrappedCanvasText(ctx, m.value, mx, y + 46, metaW - 28, 16);
      });
      y += 94;

      function drawSection(sx, sy, sw, sh, title, rows) {
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, sx, sy, sw, sh, 8);
        ctx.fill();
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rose;
        ctx.font = "700 11px Segoe UI, Arial, sans-serif";
        ctx.fillText(title.toUpperCase(), sx + 14, sy + 24);
        var ry = sy + 40;
        rows.forEach(function (row) {
          ctx.fillStyle = muted;
          ctx.font = "12px Segoe UI, Arial, sans-serif";
          var lh = drawWrappedCanvasText(ctx, row.label, sx + 14, ry, Math.floor(sw * 0.4), 16);
          ctx.fillStyle = ink;
          ctx.font = "600 13px Segoe UI, Arial, sans-serif";
          ctx.textAlign = "right";
          var vh = drawWrappedCanvasText(
            ctx,
            row.value,
            sx + sw - 14,
            ry,
            Math.floor(sw * 0.48),
            16
          );
          ctx.textAlign = "left";
          ry += Math.max(lh, vh) + 10;
          ctx.strokeStyle = "#f1eaeb";
          ctx.beginPath();
          ctx.moveTo(sx + 14, ry - 6);
          ctx.lineTo(sx + sw - 14, ry - 6);
          ctx.stroke();
        });
      }

      var sectionH = Math.max(guestH, stayH) + 8;
      drawSection(x, y, colW, sectionH, "Billed to", g.guest);
      drawSection(x + colW + colGap, y, colW, sectionH, "Reservation", g.stay);
      y += sectionH + 16;

      var paySectionH = payH;
      drawSection(x, y, contentW, paySectionH, "Payment details", g.payment);
      y += paySectionH + 16;

      // Total bar
      var grad = ctx.createLinearGradient(x, y, x + contentW, y);
      grad.addColorStop(0, "#fff7f8");
      grad.addColorStop(1, "#f8eef0");
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, contentW, 64, 8);
      ctx.fill();
      ctx.strokeStyle = "#e4c8cc";
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "600 12px Segoe UI, Arial, sans-serif";
      ctx.fillText(String(g.amountNote || "").toUpperCase(), x + 18, y + 38);
      ctx.fillStyle = "#8f3d4a";
      ctx.font = "700 28px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(g.amountLabel, x + contentW - 18, y + 42);
      ctx.textAlign = "left";
      y += 82;

      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + contentW, y);
      ctx.stroke();
      y += 22;
      ctx.fillStyle = ink;
      ctx.font = "italic 16px Georgia, Times New Roman, serif";
      ctx.fillText("Thank you for choosing Elenest Resort.", x, y);
      y += 24;
      ctx.fillStyle = muted;
      ctx.font = "12px Segoe UI, Arial, sans-serif";
      drawWrappedCanvasText(
        ctx,
        "This document is your official backup copy. Please present it at the resort if requested.",
        x,
        y,
        contentW,
        16
      );

      return canvas;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function downloadGuestReceiptFile(booking) {
    if (!booking || !booking.id) return;
    var stamp = receiptDownloadStamp(booking);
    var filename = "Elenest-Receipt-" + stamp + ".jpg";
    renderGuestReceiptCanvas(booking)
      .then(function (canvas) {
        return new Promise(function (resolve, reject) {
          if (canvas.toBlob) {
            canvas.toBlob(
              function (blob) {
                if (blob) resolve(blob);
                else reject(new Error("Could not create JPG"));
              },
              "image/jpeg",
              0.92
            );
          } else {
            try {
              var dataUrl = canvas.toDataURL("image/jpeg", 0.92);
              var parts = dataUrl.split(",");
              var bin = atob(parts[1] || "");
              var arr = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              resolve(new Blob([arr], { type: "image/jpeg" }));
            } catch (err) {
              reject(err);
            }
          }
        });
      })
      .then(function (blob) {
        triggerBlobDownload(blob, filename);
      })
      .catch(function () {
        // Fallback: still give the guest a downloadable copy
        var html = buildReceiptPrintHtml(booking);
        triggerBlobDownload(
          new Blob([html], { type: "text/html;charset=utf-8" }),
          "Elenest-Receipt-" + stamp + ".html"
        );
      });
  }

  function printGuestReceipt(booking) {
    if (!booking || !booking.id) return;
    var html = buildReceiptPrintHtml(booking);
    var w = window.open("", "_blank");
    if (!w) {
      downloadGuestReceiptFile(booking);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () {
      try {
        w.print();
      } catch (e) {}
    }, 250);
  }

  function snapshotCompletedBooking(b) {
    if (!b || !b.id) return null;
    return {
      id: b.id,
      fullName: b.fullName || "",
      checkIn: b.checkIn || "",
      checkOut: b.checkOut || "",
      checkInTime: b.checkInTime || "",
      checkOutTime: b.checkOutTime || "",
      poolUse: b.poolUse || "",
      totalEstimate: b.totalEstimate,
      amountPaid: b.amountPaid,
      status: b.status || "",
      paymentStatus: b.paymentStatus || "",
      paymentType: b.paymentType || "",
      roomCatalogName: b.roomCatalogName || "",
      roomCatalogNames: b.roomCatalogNames || [],
      roomCatalogIds: b.roomCatalogIds || [],
      cottageCatalogNames: b.cottageCatalogNames || [],
      cottageCatalogIds: b.cottageCatalogIds || [],
      hallCatalogName: b.hallCatalogName || "",
      hallCatalogNames: b.hallCatalogNames || [],
      hallCatalogIds: b.hallCatalogIds || [],
      facilityIds: b.facilityIds || [],
      room_ids: b.room_ids || [],
      eventHall: b.eventHall || "",
      roomType: b.roomType || "",
      cottageQty: b.cottageQty || ""
    };
  }

  function rememberCompletedBooking(booking) {
    lastCompletedBooking = booking && booking.id ? booking : null;
    try {
      if (lastCompletedBooking) {
        sessionStorage.setItem(
          LAST_COMPLETED_RECEIPT_KEY,
          JSON.stringify(snapshotCompletedBooking(lastCompletedBooking))
        );
      } else {
        sessionStorage.removeItem(LAST_COMPLETED_RECEIPT_KEY);
      }
    } catch (e) {}
  }

  function readRememberedCompletedBooking() {
    if (lastCompletedBooking && lastCompletedBooking.id) return lastCompletedBooking;
    try {
      var raw = sessionStorage.getItem(LAST_COMPLETED_RECEIPT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        lastCompletedBooking = parsed;
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  function findCompletedBookingById(id) {
    if (!id || !window.ElenestBookings || typeof window.ElenestBookings.listForUser !== "function") {
      return null;
    }
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (!user || !user.email) return null;
    var rows = window.ElenestBookings.listForUser(user.email) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i].id) === String(id)) return rows[i];
    }
    return null;
  }

  function getCompletedBookingForReceipt() {
    var remembered = readRememberedCompletedBooking();
    if (!remembered || !remembered.id) return null;
    return findCompletedBookingById(remembered.id) || remembered;
  }

  function hideBookingReceipt() {
    ["bookFlowReceipt", "paymentSuccessReceipt"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.textContent = "";
    });
  }

  function fillReceiptHost(host, booking) {
    if (!host) return;
    if (!booking || !booking.id) {
      host.hidden = true;
      host.textContent = "";
      return;
    }
    host.hidden = false;
    host.textContent = "";
    var header = document.createElement("header");
    header.className = "book-flow-receipt__header";
    var title = document.createElement("h4");
    title.className = "book-flow-receipt__title";
    title.textContent = "Booking receipt";
    var idEl = document.createElement("span");
    idEl.className = "book-flow-receipt__id";
    idEl.textContent = bookingReceiptId(booking);
    header.appendChild(title);
    header.appendChild(idEl);
    var dl = document.createElement("dl");
    dl.className = "booking-dl booking-dl--compact book-flow-receipt__list";
    addBookingDetailRow(dl, "Receipt ID", bookingReceiptId(booking));
    addBookingDetailRow(dl, "Booking / reference number", booking.id);
    addBookingDetailRow(dl, "Customer name", booking.fullName || "—");
    addBookingDetailRow(dl, "Selected facility", appointmentStayLabel(booking));
    addBookingDetailRow(dl, "Booking date", bookingReceiptDateLabel(booking));
    addBookingDetailRow(dl, "Booking time", bookingReceiptTimeLabel(booking));
    var receiptUA = window.ElenestUnitAvailability;
    if (receiptUA && typeof receiptUA.computeBookingRecordPricing === "function") {
      var receiptPricing = receiptUA.computeBookingRecordPricing(booking);
      if (receiptPricing && receiptPricing.lines && receiptPricing.lines.length) {
        receiptPricing.lines.forEach(function (line) {
          addBookingDetailRow(dl, line.label, formatMoneyPeso(line.amount));
        });
      }
    }
    addBookingDetailRow(
      dl,
      "Total amount",
      formatMoneyPeso(booking.totalEstimate != null && booking.totalEstimate !== "" ? booking.totalEstimate : booking.amountPaid),
      "book-flow-receipt__row--total"
    );
    addBookingDetailRow(dl, "Payment / booking status", bookingReceiptStatusLabel(booking), "book-flow-receipt__row--status");
    host.appendChild(header);
    host.appendChild(dl);
  }

  function renderCompletedBookingReceipt(booking) {
    if (!booking || !booking.id) {
      hideBookingReceipt();
      var hideDl = document.getElementById("bookFlowReceiptDownloadBtn");
      if (hideDl) hideDl.hidden = true;
      return;
    }
    rememberCompletedBooking(booking);
    fillReceiptHost(document.getElementById("bookFlowReceipt"), booking);
    fillReceiptHost(document.getElementById("paymentSuccessReceipt"), booking);
    var downloadBtn = document.getElementById("bookFlowReceiptDownloadBtn");
    if (downloadBtn) {
      downloadBtn.hidden = false;
      downloadBtn.onclick = function () {
        downloadGuestReceiptFile(booking);
      };
    }
  }

  function showReceiptForCompletedBooking() {
    var booking = getCompletedBookingForReceipt();
    if (!booking) {
      hideBookingReceipt();
      var hideDl = document.getElementById("bookFlowReceiptDownloadBtn");
      if (hideDl) hideDl.hidden = true;
      return;
    }
    renderCompletedBookingReceipt(booking);
  }

  function clearCompletedBookingReceipt() {
    lastCompletedBooking = null;
    try {
      sessionStorage.removeItem(LAST_COMPLETED_RECEIPT_KEY);
    } catch (e) {}
    hideBookingReceipt();
    var hideDl = document.getElementById("bookFlowReceiptDownloadBtn");
    if (hideDl) {
      hideDl.hidden = true;
      hideDl.onclick = null;
    }
  }

  function openPaymentSuccessModal(booking) {
    var overlay = document.getElementById("paymentSuccessOverlay");
    if (!overlay) return;
    var iconEl = overlay.querySelector(".payment-success-icon");
    var titleEl = document.getElementById("paymentSuccessTitle");
    var leadEl = overlay.querySelector(".payment-success-lead");
    var downloadBtn = document.getElementById("paymentSuccessDownloadBtn");
    var PF = window.ElenestPaymentFlow;
    var pay = PF && typeof PF.getPaymentPresentation === "function"
      ? PF.getPaymentPresentation(booking)
      : { kind: "success" };
    var kind = "success";
    var title = "Proof of payment submitted";
    var lead =
      "Your proof of payment was submitted successfully. An admin will verify it in Reservation Management. This booking is not marked paid yet.";
    if (pay.kind === "cancelled") {
      kind = "cancelled";
      title = "Payment unsuccessful";
      lead = "This payment was rejected or the reservation was cancelled.";
    } else if (pay.kind === "success" && booking && booking.paymentVerifiedAt) {
      kind = "success";
      title = "Payment confirmed";
      lead = "Your payment was verified. Your booking status has been updated.";
    }
    if (iconEl) {
      iconEl.className = "payment-success-icon payment-success-icon--" + kind;
      iconEl.innerHTML =
        kind === "cancelled"
          ? '<svg class="status-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
          : '<svg class="status-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    }
    if (titleEl) titleEl.textContent = title;
    if (leadEl) {
      var queueRoleNow = booking ? String(booking.queueRole || "").toLowerCase() : "";
      var queueNoteNow = booking && booking.queueMessage ? String(booking.queueMessage) : "";
      if (
        queueNoteNow &&
        (queueRoleNow === "queued" || queueRoleNow === "unavailable" || queueRoleNow === "next")
      ) {
        leadEl.textContent = lead + " " + queueNoteNow;
      } else {
        leadEl.textContent = lead;
      }
    }
    if (downloadBtn) {
      downloadBtn.hidden = !(booking && booking.id && kind !== "cancelled");
    }
    overlay.removeAttribute("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("payment-success-overlay--open");
      });
    });
  }

  function closePaymentSuccessModal() {
    var overlay = document.getElementById("paymentSuccessOverlay");
    if (!overlay) return;
    overlay.classList.remove("payment-success-overlay--open");
    document.body.style.overflow = "";
    setTimeout(function () {
      overlay.setAttribute("hidden", "");
      overlay.setAttribute("aria-hidden", "true");
    }, 280);
  }

  function restoreReachedBookingStep(step, bookingId) {
    function showStepOne() {
      goStep(1);
      renderCalendar();
      updatePickedSummary();
      renderUnitSelectionSummary();
      renderBookingDetailsSummary();
      updateStep2ContinueButton();
    }
    function apply() {
      var user =
        window.ElenestAuth && window.ElenestAuth.getCurrentUser
          ? window.ElenestAuth.getCurrentUser()
          : null;
      var booking = null;
      if (user && window.ElenestBookings && typeof window.ElenestBookings.listForUser === "function") {
        var list = window.ElenestBookings.listForUser(user.email) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === String(bookingId)) booking = list[i];
        }
      }
      if (!booking) {
        showStepOne();
        return;
      }
      if (step === 4) openPaymentForBooking(booking);
      else openConfirmationForBooking(booking);
      if (currentFlowStep !== step) showStepOne();
    }
    var ready = window.ElenestBookings && window.ElenestBookings.ready;
    if (ready && typeof ready.then === "function") {
      Promise.resolve(ready).then(apply).catch(showStepOne);
      return;
    }
    apply();
  }

  function restoreFlowStep() {
    var step = 1;
    try {
      if (sessionStorage.getItem("elenest_booking_restart") === "1") {
        sessionStorage.removeItem("elenest_booking_restart");
        localStorage.removeItem(BOOK_FLOW_STEP_KEY);
        clearBookingDraft();
        clearCompletedBookingReceipt();
        goStep(1);
        return;
      }
      var s = localStorage.getItem(BOOK_FLOW_STEP_KEY);
      if (s) {
        var n = parseInt(s, 10);
        if (n >= 1 && n <= 4) step = n;
      }
    } catch (e) {}
    if (step === 3 || step === 4) {
      var savedBookingId =
        wizardState.reviewBookingId ||
        (wizardState.payableBooking && wizardState.payableBooking.id);
      if (!savedBookingId || wizardState.skipResume) {
        step = 1;
      } else {
        restoreReachedBookingStep(step, savedBookingId);
        return;
      }
    }
    goStep(step);
    if (step === 1) {
      renderCalendar();
      updatePickedSummary();
      renderUnitSelectionSummary();
      renderBookingDetailsSummary();
      updateStep2ContinueButton();
    }
  }


  function updatePickedSummary() {
    var el = document.getElementById("pickedDatesSummary");
    if (!el) return;
    var rule = getBookingDateRule();
    if (!wizardState.checkIn) {
      el.textContent =
        rule.mode === "single"
          ? "Next: select your date."
          : "Next: select your check-in date.";
      return;
    }
    if (rule.mode === "single") {
      if (rule.facilityKind === "day_tour") {
        var dayTourSummary = "Date: " + fmtDateLong(wizardState.checkIn) + " · 8:00 AM – 10:00 PM";
        if (wizardState.unitSelectionConfirmed && hasSelectedFacilities()) {
          dayTourSummary += " · " + getSelectedFacilityLabel();
        } else if (rule.requiresFacility && !wizardState.unitSelectionConfirmed) {
          dayTourSummary += " · Next: choose a facility";
        }
        el.textContent = dayTourSummary;
        return;
      }
      var tInSingle = formatTimeLabel(wizardState.checkInTime);
      var tOutSingle = formatTimeLabel(wizardState.checkOutTime);
      el.textContent =
        "Date: " +
        fmtDateLong(wizardState.checkIn) +
        " · " +
        tInSingle +
        " – " +
        tOutSingle;
      return;
    }
    if (!wizardState.checkOut) {
      el.textContent =
        "Check-in: " + fmtDateLong(wizardState.checkIn) + " · Next: select check-out date";
      return;
    }
    var tIn = formatTimeLabel(wizardState.checkInTime);
    var tOut = formatTimeLabel(wizardState.checkOutTime);
    var summary =
      "Stay: " +
      fmtDateLong(wizardState.checkIn) +
      " – " +
      fmtDateLong(wizardState.checkOut) +
      " · " +
      tIn +
      " – " +
      tOut;
    var ruleDone = getBookingDateRule();
    if (ruleDone.requiresFacility && !wizardState.unitSelectionConfirmed) {
      summary += " · Next: choose a facility";
    } else if (wizardState.unitSelectionConfirmed && hasSelectedFacilities()) {
      summary += " · " + getSelectedFacilityLabel();
    }
    el.textContent = summary;
  }

  function pickDate(iso) {
    // Ignore double-taps while facilities are loading.
    if (facilityPickerBusy) return;

    var rule = getBookingDateRule();

    if (rule.mode === "single") {
      if (isCalendarDateBlocked(iso)) {
        showCalendarDateMessage("This date is unavailable. Please choose another date.");
        return;
      }
      wizardState.checkIn = iso;
      wizardState.checkOut = singleDayCheckoutIso(iso);
      resetUnitSelection();
      showCalendarDateMessage("");
      afterBookingRuleOrDatesChanged();
      tryOpenFacilityPickerAfterDateClick();
      return;
    }

    if (!wizardState.checkIn || (wizardState.checkIn && wizardState.checkOut)) {
      if (isCalendarDateBlocked(iso)) {
        showCalendarDateMessage("This date is unavailable. Please choose another check-in date.");
        return;
      }
      wizardState.checkIn = iso;
      wizardState.checkOut = null;
      resetUnitSelection();
      showCalendarDateMessage("");
    } else {
      if (iso <= wizardState.checkIn) {
        if (isCalendarDateBlocked(iso)) {
          showCalendarDateMessage("This date is unavailable. Please choose another check-in date.");
          return;
        }
        wizardState.checkIn = iso;
        wizardState.checkOut = null;
        resetUnitSelection();
        showCalendarDateMessage("");
      } else {
        var rangeErr = overnightRangeDateError(wizardState.checkIn, iso);
        if (rangeErr) {
          wizardState.checkIn = null;
          wizardState.checkOut = null;
          resetUnitSelection();
          closeBookUnitModal();
          showCalendarDateMessage(rangeErr);
          renderCalendar();
          updatePickedSummary();
          syncStep2BookingRuleUI();
          renderBookingDetailsSummary();
          updateStep2ContinueButton();
          saveBookingDraft();
          return;
        }
        wizardState.checkOut = iso;
        var droppedOnDateChange = false;
        if (wizardState.unitSelectionConfirmed) {
          droppedOnDateChange = sanitizeUnitSelectionForRange(wizardState.checkIn, wizardState.checkOut);
          if (!hasSelectedFacilities()) {
            resetUnitSelection();
          }
        }
        if (droppedOnDateChange) {
          showRoomUnavailableMessage();
          openBookUnitModal();
        } else {
          showCalendarDateMessage("");
        }
      }
    }
    renderCalendar();
    updatePickedSummary();
    syncStep2BookingRuleUI();
    tryOpenFacilityPickerAfterDateClick();
    renderBookingDetailsSummary();
    updateStep2ContinueButton();
    saveBookingDraft();
  }

  function getCalendarWizardState() {
    var rule = getBookingDateRule();
    if (rule.mode === "single") {
      return { checkIn: wizardState.checkIn, checkOut: null };
    }
    return { checkIn: wizardState.checkIn, checkOut: wizardState.checkOut };
  }

  function renderCalendar() {
    var host = document.getElementById("calendarHost");
    var label = document.getElementById("calMonthLabel");
    if (!host || !label) return;
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") {
      return;
    }
    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: calView,
      wizardState: getCalendarWizardState(),
      // One-day stays pass check-out as null, so only the visit date is marked.
      highlightRange: true,
      showLiveOccupancy: true,
      hidePendingStatus: true,
      onDayClick: pickDate
    });
    var step2Layout = host.closest(".book-flow-cal-layout") || host.parentElement;
    var step2Legend = step2Layout && (
      step2Layout.querySelector(".book-flow-cal-notes") ||
      step2Layout.querySelector(".avail-legend")
    );
    if (step2Legend) {
      step2Legend.setAttribute("data-live", "true");
      var stamp = step2Legend.querySelector(".avail-legend__live");
      if (!stamp) {
        stamp = document.createElement("div");
        stamp.className = "avail-legend__live";
        var notesTitle = step2Legend.querySelector(".admin-dash-cal-notes__title");
        if (notesTitle && notesTitle.nextSibling) {
          notesTitle.parentNode.insertBefore(stamp, notesTitle.nextSibling);
        } else {
          step2Legend.insertBefore(stamp, step2Legend.firstChild);
        }
      }
      stamp.innerHTML =
        '<span class="avail-legend__live-dot" aria-hidden="true"></span>' +
        "<span>Live — updates when someone books</span>";
    }
    if (fixInvalidDateSelectionAfterAvailabilityLoad()) {
      renderCalendar();
      return;
    }
    updatePickedSummary();
    renderUnitSelectionSummary();
  }

  function fixInvalidDateSelectionAfterAvailabilityLoad() {
    var av = window.ElenestAvailability;
    if (!av || typeof av.getGoogleBusyLoaded !== "function" || !av.getGoogleBusyLoaded()) {
      return false;
    }
    var changed = false;
    var managerBlocked = false;
    if (wizardState.checkIn && isCalendarDateBlocked(wizardState.checkIn)) {
      managerBlocked = !!(av.getManagerBlocked && av.getManagerBlocked(wizardState.checkIn));
      wizardState.checkIn = null;
      wizardState.checkOut = null;
      changed = true;
    } else if (wizardState.checkIn && wizardState.checkOut) {
      var rangeErr = overnightRangeDateError(wizardState.checkIn, wizardState.checkOut);
      if (rangeErr) {
        managerBlocked = rangeErr === OVERNIGHT_BLOCKED_RANGE_MSG;
        wizardState.checkIn = null;
        wizardState.checkOut = null;
        changed = true;
      }
      if (
        !changed &&
        wizardState.checkOut &&
        selectedFacilitiesConflictForRange(wizardState.checkIn, wizardState.checkOut)
      ) {
        wizardState.checkOut = null;
        changed = true;
      }
    }
    if (changed) {
      resetUnitSelection();
      closeBookUnitModal();
      showCalendarDateMessage(
        managerBlocked
          ? OVERNIGHT_BLOCKED_RANGE_MSG
          : "Availability was updated. Please select your check-out date again (or your full stay if the dates are no longer available)."
      );
    }
    return changed;
  }

  function nightsBetween(a, b) {
    var d1 = new Date(a + "T12:00:00");
    var d2 = new Date(b + "T12:00:00");
    return Math.max(1, Math.round((d2 - d1) / 86400000));
  }

  function computePayment() {
    var poolKey = getPoolUseValue();
    var n = nightsBetween(wizardState.checkIn, wizardState.checkOut);
    var guests = getGuestCounts();
    var UA = window.ElenestUnitAvailability;
    if (UA && wizardState.checkIn && wizardState.checkOut) {
      var pricing = UA.computeSelectionPricing(getUnitSelection(), n, poolKey, guests);
      return {
        nights: pricing.nights,
        roomSub: pricing.roomSub,
        cottageSub: pricing.cottageSub,
        cottageQty: (getUnitSelection().cottageCatalogIds || []).length,
        poolKey: poolKey,
        poolFee: pricing.poolFee,
        hallKey: getUnitSelection().hallCatalogId ? "catalog" : "none",
        hallFee: pricing.hallFee,
        subtotal: pricing.subtotal,
        down: pricing.down,
        lines: pricing.lines
      };
    }
    var paidGuests = 0;
    var poolFee = 0;
    var lines = [];
    if (UA && typeof UA.selectionRequiresPoolEntranceFee === "function") {
      if (UA.selectionRequiresPoolEntranceFee(getUnitSelection(), poolKey)) {
        paidGuests =
          Math.max(0, parseInt(guests.adults, 10) || 0) +
          Math.max(0, parseInt(guests.children, 10) || 0);
        poolFee = paidGuests * POOL_FEE_PER_PAID_GUEST;
        if (poolFee > 0 && UA.formatPoolEntranceLineLabel) {
          lines.push({
            label: UA.formatPoolEntranceLineLabel(paidGuests),
            amount: poolFee
          });
        }
      }
    } else if (poolKey === "pool_only") {
      paidGuests =
        Math.max(0, parseInt(guests.adults, 10) || 0) +
        Math.max(0, parseInt(guests.children, 10) || 0);
      poolFee = paidGuests * POOL_FEE_PER_PAID_GUEST;
      if (poolFee > 0) {
        lines.push({
          label: "Swimming Pool Entrance: ₱250 × " + paidGuests + " guests",
          amount: poolFee
        });
      }
    }
    return {
      nights: n,
      roomSub: 0,
      cottageSub: 0,
      cottageQty: 0,
      poolKey: poolKey,
      poolFee: poolFee,
      hallKey: "none",
      hallFee: 0,
      subtotal: poolFee,
      down: Math.round(poolFee * 0.2),
      lines: lines
    };
  }

  function syncAcHallWrap() {}

  function submitBookingRequest() {
    if (!window.ElenestAuth.isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }
    var user = window.ElenestAuth.getCurrentUser();
    var btn = document.getElementById("submitBookingRequestBtn");
    var PF = window.ElenestPaymentFlow;
    var base = buildPendingBookingRecord();
    var patch = PF && PF.buildBookingRequestPatch ? PF.buildBookingRequestPatch() : {
      status: "Pending",
      paymentStatus: "Awaiting admin confirmation",
      workflow: "awaiting_booking_review",
      verificationStage: "awaiting_booking_review",
      slotLocked: true,
      arrivalStatus: "not_arrived"
    };
    var record = {};
    var key;
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) record[key] = base[key];
    }
    for (key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (patch[key] !== null) record[key] = patch[key];
    }
    record.status = patch.status || "Pending";
    record.paymentStatus = patch.paymentStatus || "Awaiting admin confirmation";
    record.workflow = patch.workflow || "awaiting_booking_review";
    record.verificationStage = patch.verificationStage || "awaiting_booking_review";
    record.slotLocked = true;
    record.arrivalStatus = "not_arrived";
    record.hasPaymentProof = false;
    delete record.paymentProof;
    delete record.paymentSubmittedAt;
    delete record.paymentVerifiedAt;
    delete record.amountPaid;
    var BL = window.ElenestButtonLoading;
    if (BL && btn) BL.set(btn, true);
    var saved = window.ElenestBookings.add(user.email, record);
    var done =
      window.ElenestBookings && typeof window.ElenestBookings.waitForSave === "function"
        ? window.ElenestBookings.waitForSave(saved)
        : Promise.resolve(saved);
    Promise.resolve(done).then(function (row) {
      if (BL && btn) BL.set(btn, false);
      if (!row) {
        alert("Could not submit your booking. Please try again.");
        return;
      }
      if (window.ElenestNotifications && window.ElenestNotifications.TYPES) {
        window.ElenestNotifications.addForUser(user.email, {
          type: window.ElenestNotifications.TYPES.BOOKING_UPDATED,
          title: "Booking request submitted",
          message:
            "Your booking details are waiting for admin confirmation. Online payment opens after the admin confirms the facility, date, and schedule.",
          bookingId: row.id,
          dedupKey: "booking_request:" + row.id,
          link: "book.html"
        });
      }
      clearBookingDraft();
      wizardState.pendingRecord = null;
      wizardState.reviewBookingId = row.id;
      wizardState.payableBooking = row;
      wizardState.paymentProofSubmitted = false;
      goStep(3);
    }).catch(function () {
      if (BL && btn) BL.set(btn, false);
      alert("Could not submit your booking. Please try again.");
    });
  }

  function openPaymentForBooking(booking) {
    var PF = window.ElenestPaymentFlow;
    if (!booking || !PF || typeof PF.isAwaitingCustomerPayment !== "function") return;
    if (!PF.isAwaitingCustomerPayment(booking)) return;
    if (PF.isPaymentWindowExpired(booking)) {
      alert("The 3-hour payment window has ended.");
      if (window.ElenestBookings && window.ElenestBookings.processAutoNoShows) {
        window.ElenestBookings.processAutoNoShows();
      }
      return;
    }
    wizardState.payableBooking = booking;
    wizardState.paymentType = booking.paymentType === "down" ? "down" : "full";
    closeAppointmentsModal();
    goStep(4);
    var section = document.getElementById("bookingSection");
    if (section && section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  var paymentHashOpened = false;
  function maybeOpenPaymentFromHash() {
    if (paymentHashOpened) return;
    var match = String(window.location.hash || "").match(/pay-([^&]+)/i);
    if (!match) return;
    var id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch (e) {}
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (!user || !window.ElenestBookings || !window.ElenestBookings.listForUser) return;
    var list = window.ElenestBookings.listForUser(user.email) || [];
    var booking = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) booking = list[i];
    }
    if (!booking) return;
    paymentHashOpened = true;
    openPaymentForBooking(booking);
  }

  var continueToPaymentBtn = document.getElementById("continueToPaymentBtn");
  if (continueToPaymentBtn) {
    continueToPaymentBtn.addEventListener("click", function () {
      var booking = findReviewBooking();
      if (booking) openPaymentForBooking(booking);
    });
  }
  var cancelBookingFromConfirmBtn = document.getElementById("cancelBookingFromConfirmBtn");
  if (cancelBookingFromConfirmBtn) {
    cancelBookingFromConfirmBtn.addEventListener("click", function () {
      var booking = findReviewBooking();
      if (booking) cancelCustomerBooking(booking);
    });
  }
  var viewBookingsFromConfirmBtn = document.getElementById("viewBookingsFromConfirmBtn");
  if (viewBookingsFromConfirmBtn) {
    viewBookingsFromConfirmBtn.addEventListener("click", function () {
      openAppointmentsModal();
    });
  }

  var step1Form = document.getElementById("step1Form");
  var eventTypeEl = document.getElementById("eventType");
  var eventOtherWrap = document.getElementById("eventOtherWrap");
  var eventOther = document.getElementById("eventOther");

  if (eventTypeEl && eventOtherWrap) {
    eventTypeEl.addEventListener("change", function () {
      var o = eventTypeEl.value === "other";
      eventOtherWrap.hidden = !o;
      if (eventOther) eventOther.required = o;
    });
  }

  var stepBookingForm = document.getElementById("stepBookingForm");
  if (stepBookingForm) {
    stepBookingForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var nextBtn = document.getElementById("nextFromCal");
      if (nextBtn && !nextBtn.disabled) nextBtn.click();
      else stepBookingForm.reportValidity();
    });
  }

  if (step1Form) {
    step1Form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!window.ElenestAuth.isLoggedIn()) {
        window.location.href = "login.html";
        return;
      }
      if (!step1Form.reportValidity()) return;
      var phoneVal = document.getElementById("phone").value.trim();
      var emailVal = document.getElementById("email").value.trim();
      if (digitsOnly(phoneVal).length !== 11) {
        alert("Phone number must be exactly 11 digits.");
        return;
      }
      if (!isValidEmail(emailVal)) {
        alert("Please enter a valid email address (must include @).");
        return;
      }
      if (eventTypeEl && eventTypeEl.value === "other" && (!eventOther || !eventOther.value.trim())) {
        alert("Please describe your activity.");
        return;
      }
      if (eventTypeEl && !eventTypeEl.value) {
        alert("Please select an activity type.");
        return;
      }
      if (!canProceedToPayment()) {
        goStep(1);
        updateStep2ContinueButton();
        return;
      }
      saveBookingDraft();
      submitBookingRequest();
    });
  }

  var backFromCal = document.getElementById("backFromCal");
  if (backFromCal) {
    backFromCal.addEventListener("click", function () {
      goStep(1);
    });
  }

  document.querySelectorAll('input[name="bookStayType"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      applyStayTypeToPoolUse(radio.value);
    });
  });

  var nextFromCal = document.getElementById("nextFromCal");
  if (nextFromCal) {
    nextFromCal.addEventListener("click", function () {
      var err = document.getElementById("calendarError");
      if (err) err.hidden = true;
      if (!window.ElenestAuth.isLoggedIn()) {
        window.location.href = "login.html";
        return;
      }
      if (stepBookingForm && !stepBookingForm.reportValidity()) return;
      if (!wizardState.checkIn) {
        if (err) {
          err.textContent =
            getBookingDateRule().mode === "single"
              ? "Please select your visit date on the calendar."
              : "Please select your check-in date on the calendar.";
          err.hidden = false;
        }
        return;
      }
      normalizeDatesForBookingRule();
      var dateRule = getBookingDateRule();
      if (!wizardState.checkOut) {
        if (dateRule.mode === "single") {
          wizardState.checkOut = singleDayCheckoutIso(wizardState.checkIn);
        } else {
        var defCo = findDefaultCheckoutIso(wizardState.checkIn);
        if (defCo) {
          wizardState.checkOut = defCo;
          if (!wizardState.unitSelectionConfirmed) {
            resetUnitSelection();
          } else {
            var droppedDefaultCheckout = sanitizeUnitSelectionForRange(wizardState.checkIn, wizardState.checkOut);
            if (!hasSelectedFacilities()) resetUnitSelection();
            if (droppedDefaultCheckout) showRoomUnavailableMessage();
          }
          renderCalendar();
          updatePickedSummary();
          renderBookingDetailsSummary();
          if (!wizardState.unitSelectionConfirmed && dateRule.requiresFacility) {
            openBookUnitModal();
            return;
          }
        } else {
          if (err) {
            err.textContent =
              "Could not find an available check-out day in the next 14 days. Please tap a check-out date on the calendar after your check-in date.";
            err.hidden = false;
          }
          return;
        }
        }
      }
      if (dateRule.mode !== "single") {
        var rangeErr = overnightRangeDateError(wizardState.checkIn, wizardState.checkOut);
        if (rangeErr) {
          wizardState.checkIn = null;
          wizardState.checkOut = null;
          resetUnitSelection();
          closeBookUnitModal();
          showCalendarDateMessage(rangeErr);
          renderCalendar();
          updatePickedSummary();
          renderBookingDetailsSummary();
          updateStep2ContinueButton();
          saveBookingDraft();
          return;
        }
      } else if (stayRangeHasUnavailableNight(wizardState.checkIn, wizardState.checkOut)) {
        if (err) {
          err.textContent =
            "The selected dates include unavailable days. Please choose different dates.";
          err.hidden = false;
        }
        return;
      }
      var checkInTimeEl = document.getElementById("checkInTime");
      var checkOutTimeEl = document.getElementById("checkOutTime");
      if (isDayTourBooking() || isPoolOnlyBooking()) {
        applyDayTourFixedTimes();
      } else {
      if (!checkInTimeEl || !checkInTimeEl.value) {
        if (err) {
          err.textContent = "Please select your arrival time.";
          err.hidden = false;
        }
        if (checkInTimeEl) checkInTimeEl.focus();
        return;
      }
      if (!checkOutTimeEl || !checkOutTimeEl.value) {
        if (err) {
          err.textContent = "Please select your departure time.";
          err.hidden = false;
        }
        if (checkOutTimeEl) checkOutTimeEl.focus();
        return;
      }
      wizardState.checkInTime = checkInTimeEl.value;
      wizardState.checkOutTime = checkOutTimeEl.value;
      }

      var poolKey = getPoolUseValue();
      var selectionPayload = getUnitSelection();
      selectionPayload.allowNoFacility = false;
      if (isPoolOnlyBooking()) {
        sanitizeSelectionForPoolOnly();
        selectionPayload = getUnitSelection();
        if (!(selectionPayload.cottageCatalogIds || []).length) {
          if (err) {
            err.textContent = "Please select a cottage for Swimming Pool Only before continuing.";
            err.hidden = false;
          }
          openBookUnitModal();
          return;
        }
      }
      if (!wizardState.unitSelectionConfirmed) {
        if (err) {
          err.textContent = dateRule.requiresFacility
            ? "Please confirm your facility selection before continuing."
            : "Please complete your date selection before continuing.";
          err.hidden = false;
        }
        if (dateRule.requiresFacility) {
          openBookUnitModal();
        }
        return;
      }
      var UA = window.ElenestUnitAvailability;
      var guestsForCheck = getGuestCounts();
      if (UA) {
        var unitCheck = UA.validateSelection(
          selectionPayload,
          wizardState.checkIn,
          wizardState.checkOut,
          null,
          {
            validateGuests: true,
            adults: guestsForCheck.adults,
            children: guestsForCheck.children,
            childrenUnder6: guestsForCheck.childrenUnder6,
            checkInTime: getStayTimeWindow().checkInTime,
            checkOutTime: getStayTimeWindow().checkOutTime
          }
        );
        if (!unitCheck.ok) {
          if (err) {
            err.textContent =
              unitCheck.errors[0] ||
              "Your selected facilities are unavailable or do not fit your guest count. Use Change selection to adjust.";
            err.hidden = false;
          }
          return;
        }
      } else {
        var guestCheckFallback = runGuestCapacityCheck(selectionPayload);
        if (guestCheckFallback && guestCheckFallback.ok === false) {
          if (err) {
            err.textContent =
              (guestCheckFallback.errors && guestCheckFallback.errors[0]) ||
              "Your guest count exceeds the selected facility capacity. Reduce counted guests or add another facility.";
            err.hidden = false;
          }
          return;
        }
      }

      promptBookingTerms(function () {
        saveBookingDraft();
        goStep(2);
      });
    });
  }

  var backFromPayment = document.getElementById("backFromPayment");
  if (backFromPayment) {
    backFromPayment.addEventListener("click", function () {
      if (wizardState.payableBooking) {
        wizardState.payableBooking = null;
        goStep(1);
        openAppointmentsModal();
        return;
      }
      goStep(2);
    });
  }

  var paymentProofFile = document.getElementById("paymentProofFile");
  if (paymentProofFile) {
    paymentProofFile.addEventListener("change", function () {
      var preview = document.getElementById("paymentProofPreview");
      if (!preview) return;
      if (!paymentProofFile.files || !paymentProofFile.files[0]) {
        preview.hidden = true;
        preview.textContent = "";
        return;
      }
      var file = paymentProofFile.files[0];
      preview.hidden = false;
      preview.textContent = "";
      var name = document.createElement("span");
      name.className = "payment-proof-preview__name";
      name.textContent = "Selected: " + file.name;
      var thumb = document.createElement("img");
      thumb.className = "payment-proof-preview__thumb";
      thumb.alt = "Payment proof preview";
      var reader = new FileReader();
      reader.onload = function () {
        thumb.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
      preview.appendChild(name);
      preview.appendChild(thumb);
      setPaymentStepError("");
    });
  }

  var submitPaymentBtn = document.getElementById("submitPaymentBtn");
  if (submitPaymentBtn) {
    submitPaymentBtn.addEventListener("click", function () {
      if (!window.ElenestAuth.isLoggedIn()) {
        window.location.href = "login.html";
        return;
      }
      setPaymentStepError("");
      var payable = wizardState.payableBooking;
      var PFGate = window.ElenestPaymentFlow;
      if (!payable || !payable.id || !PFGate || !PFGate.isAwaitingCustomerPayment(payable)) {
        setPaymentStepError("Online payment opens after an admin confirms your booking details.");
        return;
      }
      if (PFGate.isPaymentWindowExpired(payable)) {
        setPaymentStepError("The 3-hour payment window has ended. This booking will be released.");
        if (window.ElenestBookings && window.ElenestBookings.processAutoNoShows) {
          window.ElenestBookings.processAutoNoShows();
        }
        return;
      }
      if (getSelectedPaymentType() === "down" && !wizardState.downPaymentAgreed) {
        promptDownPaymentRules();
        setPaymentStepError("Please agree to the down payment rules to continue.");
        return;
      }
      var methods =
        window.ElenestPaymentMethods && typeof window.ElenestPaymentMethods.listActive === "function"
          ? window.ElenestPaymentMethods.listActive()
          : [];
      if (!methods.length) {
        setPaymentStepError("No payment methods are configured. Please contact the resort.");
        return;
      }
      var methodId = wizardState.selectedPaymentMethodId;
      var method = methodId && window.ElenestPaymentMethods.getById
        ? window.ElenestPaymentMethods.getById(methodId)
        : methods[0];
      if (!method) {
        setPaymentStepError("Please select a payment method.");
        return;
      }
      var proofInput = document.getElementById("paymentProofFile");
      if (!proofInput || !proofInput.files || !proofInput.files[0]) {
        setPaymentStepError("Please upload proof of payment before continuing.");
        if (proofInput) proofInput.focus();
        return;
      }
      var user = window.ElenestAuth.getCurrentUser();
      var BL = window.ElenestButtonLoading;
      if (BL) BL.set(submitPaymentBtn, true);
      readPaymentProofAsDataUrl().then(function (proofDataUrl) {
        if (proofDataUrl === null) {
          if (BL) BL.set(submitPaymentBtn, false);
          return;
        }
        if (!proofDataUrl) {
          if (BL) BL.set(submitPaymentBtn, false);
          setPaymentStepError("Please upload proof of payment before continuing.");
          return;
        }
        var p = paymentFigures();
        var paymentType = getSelectedPaymentType();
        var PF = window.ElenestPaymentFlow;
        var dueNow = PF && PF.amountDueNow ? PF.amountDueNow(paymentType, p) : paymentType === "full" ? p.subtotal : p.down;
        var submittedAt = new Date().toISOString();
        var deadlineAt = payable.paymentDeadlineAt || payable.payment_deadline_at;
        if (deadlineAt && new Date(submittedAt).getTime() > new Date(deadlineAt).getTime()) {
          if (BL) BL.set(submitPaymentBtn, false);
          setPaymentStepError("The 3-hour payment window has ended.");
          if (window.ElenestBookings && window.ElenestBookings.processAutoNoShows) {
            window.ElenestBookings.processAutoNoShows();
          }
          return;
        }
        var submitPatch = PF
          ? PF.buildCustomerSubmitPatch(paymentType, submittedAt)
          : {
              status: "For Verification",
              paymentStatus: "For Verification",
              paymentSubmittedAt: submittedAt,
              slotLocked: true
            };
        var patch = {};
        for (var sk in submitPatch) {
          if (Object.prototype.hasOwnProperty.call(submitPatch, sk)) patch[sk] = submitPatch[sk];
        }
        delete patch.paymentVerifiedAt;
        delete patch.paymentVerifiedBy;
        delete patch.holdExpiresAt;
        delete patch.arrivalStatus;
        patch.amountDown = p.down;
        patch.paymentType = paymentType;
        patch.amountPaid = dueNow;
        patch.balanceDue = paymentType === "full" ? 0 : Math.max(0, p.subtotal - dueNow);
        patch.nonRefundable = false;
        patch.paymentMethodId = method.id;
        patch.paymentMethod = method.provider || "QR payment";
        patch.paymentAccountName = method.accountName || "";
        patch.paymentAccountNumber = method.accountNumber || "";
        patch.paymentProof = proofDataUrl;
        patch.hasPaymentProof = !!proofDataUrl;
        var saveDone = window.ElenestBookings.updateById(payable.id, patch);
        return Promise.resolve(saveDone).then(function (savedOk) {
          if (!savedOk) {
            if (BL) BL.set(submitPaymentBtn, false);
            setPaymentStepError("Could not save your payment. Please try again.");
            return;
          }
          var savedRow = {};
          for (var rk in payable) {
            if (Object.prototype.hasOwnProperty.call(payable, rk)) savedRow[rk] = payable[rk];
          }
          for (var pk in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, pk)) savedRow[pk] = patch[pk];
          }
          if (window.ElenestNotifications) {
            window.ElenestNotifications.addForUser(user.email, {
              type: window.ElenestNotifications.TYPES.BOOKING_UPDATED,
              title: "Payment Submitted",
              message:
                "We received your proof of payment. It is waiting for admin verification and is not marked paid yet. Booking confirmation appears after the payment is verified.",
              bookingId: savedRow.id || "",
              dedupKey: "payment_pending:" + (savedRow.id || ""),
              link: "book.html"
            });
            if (window.ElenestCustomerNotifications) {
              window.ElenestCustomerNotifications.refresh(user.email);
            }
          }
          wizardState.pendingRecord = null;
          wizardState.payableBooking = savedRow;
          wizardState.reviewBookingId = savedRow.id || wizardState.reviewBookingId;
          wizardState.paymentProofSubmitted = true;
          wizardState.selectedPaymentMethodId = null;
          wizardState.downPaymentAgreed = false;
          clearBookingDraft();
          renderCompletedBookingReceipt(savedRow);
          goStep(4);
          openPaymentSuccessModal(savedRow);
          if (BL) BL.set(submitPaymentBtn, false);
        });
      }).catch(function () {
        if (BL) BL.set(submitPaymentBtn, false);
        setPaymentStepError("Could not submit payment. Please try again.");
      });
    });
  }

  var paymentSuccessOk = document.getElementById("paymentSuccessOk");
  if (paymentSuccessOk) {
    paymentSuccessOk.addEventListener("click", closePaymentSuccessModal);
  }
  var paymentSuccessDownloadBtn = document.getElementById("paymentSuccessDownloadBtn");
  if (paymentSuccessDownloadBtn) {
    paymentSuccessDownloadBtn.addEventListener("click", function () {
      var booking = getCompletedBookingForReceipt();
      if (booking) downloadGuestReceiptFile(booking);
    });
  }
  var bookFlowReceiptDownloadBtn = document.getElementById("bookFlowReceiptDownloadBtn");
  if (bookFlowReceiptDownloadBtn) {
    bookFlowReceiptDownloadBtn.addEventListener("click", function () {
      var booking = getCompletedBookingForReceipt();
      if (booking) downloadGuestReceiptFile(booking);
    });
  }
  var paymentSuccessOverlay = document.getElementById("paymentSuccessOverlay");
  if (paymentSuccessOverlay) {
    paymentSuccessOverlay.addEventListener("click", function (e) {
      if (e.target === paymentSuccessOverlay) closePaymentSuccessModal();
    });
  }

  var scrollToAppointmentsBtn = document.getElementById("scrollToAppointmentsBtn");
  if (scrollToAppointmentsBtn) {
    scrollToAppointmentsBtn.addEventListener("click", function (e) {
      e.preventDefault();
      openAppointmentsModal();
    });
  }

  var appointmentsOverlay = document.getElementById("appointmentsOverlay");
  if (appointmentsOverlay) {
    appointmentsOverlay.addEventListener("click", function (e) {
      if (e.target === appointmentsOverlay) closeAppointmentsModal();
    });
  }
  var appointmentsCloseBtn = document.getElementById("appointmentsCloseBtn");
  if (appointmentsCloseBtn) {
    appointmentsCloseBtn.addEventListener("click", function () {
      closeAppointmentsModal();
    });
  }
  window.addEventListener("elenest-open-appointments", function () {
    openAppointmentsModal();
  });

  var guestReceiptOverlay = document.getElementById("guestReceiptOverlay");
  if (guestReceiptOverlay) {
    guestReceiptOverlay.addEventListener("click", function (e) {
      if (e.target === guestReceiptOverlay) closeGuestReceiptModal();
    });
  }
  var guestReceiptCloseBtn = document.getElementById("guestReceiptCloseBtn");
  if (guestReceiptCloseBtn) {
    guestReceiptCloseBtn.addEventListener("click", closeGuestReceiptModal);
  }
  var guestReceiptDownloadBtn = document.getElementById("guestReceiptDownloadBtn");
  if (guestReceiptDownloadBtn) {
    guestReceiptDownloadBtn.addEventListener("click", function () {
      if (guestReceiptBooking) downloadGuestReceiptFile(guestReceiptBooking);
    });
  }
  var guestReceiptPrintBtn = document.getElementById("guestReceiptPrintBtn");
  if (guestReceiptPrintBtn) {
    guestReceiptPrintBtn.addEventListener("click", function () {
      if (guestReceiptBooking) printGuestReceipt(guestReceiptBooking);
    });
  }

  var newBookingFlowBtn = document.getElementById("newBookingFlowBtn");
  if (newBookingFlowBtn) {
    newBookingFlowBtn.addEventListener("click", function () {
      wizardState.skipResume = true;
      didResumeOpenBooking = true;
      wizardState.reviewBookingId = null;
      wizardState.payableBooking = null;
      wizardState.paymentProofSubmitted = false;
      wizardState.checkIn = null;
      wizardState.checkOut = null;
      wizardState.checkInTime = null;
      wizardState.checkOutTime = null;
      wizardState.pendingRecord = null;
      wizardState.selectedPaymentMethodId = null;
      resetUnitSelection();
      closeBookUnitModal();
      clearBookingDraft();
      if (step1Form) step1Form.reset();
      if (stepBookingForm) stepBookingForm.reset();
      var dayTourStay = document.querySelector('input[name="bookStayType"][value="day_tour"]');
      if (dayTourStay) dayTourStay.checked = true;
      var poolUseReset = document.getElementById("poolUse");
      if (poolUseReset) poolUseReset.value = "day_tour";
      ensureDefaultDayTourStayType();
      syncAcHallWrap();
      if (eventOtherWrap) eventOtherWrap.hidden = true;
      if (eventOther) {
        eventOther.value = "";
        eventOther.required = false;
      }
      var u = window.ElenestAuth.getCurrentUser();
      if (u) fillGuestDetailsFromUser(u);
      fillTimeSelects();
      clearCompletedBookingReceipt();
      goStep(1);
    });
  }

  var startNewFromConfirmBtn = document.getElementById("startNewFromConfirmBtn");
  if (startNewFromConfirmBtn && newBookingFlowBtn) {
    startNewFromConfirmBtn.addEventListener("click", function () {
      newBookingFlowBtn.click();
    });
  }

  var bookingSectionEl = document.getElementById("bookingSection");
  if (bookingSectionEl) {
    bookingSectionEl.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === "checkInTime") {
        wizardState.checkInTime = t.value;
        updatePickedSummary();
        renderBookingDetailsSummary();
        var rangeIn = getAvailabilityRange();
        var droppedIn = rangeIn
          ? sanitizeUnitSelectionForRange(rangeIn.checkIn, rangeIn.checkOut, rangeIn)
          : false;
        if (
          document.getElementById("bookUnitModal") &&
          !document.getElementById("bookUnitModal").hasAttribute("hidden")
        ) {
          renderUnitPicker();
        } else {
          renderUnitSelectionSummary();
        }
        if (droppedIn) {
          showRoomUnavailableMessage();
          openBookUnitModal();
        }
        updateStep2ContinueButton();
      }
      if (t.id === "checkOutTime") {
        wizardState.checkOutTime = t.value;
        updatePickedSummary();
        renderBookingDetailsSummary();
        var rangeOut = getAvailabilityRange();
        var droppedOut = rangeOut
          ? sanitizeUnitSelectionForRange(rangeOut.checkIn, rangeOut.checkOut, rangeOut)
          : false;
        if (
          document.getElementById("bookUnitModal") &&
          !document.getElementById("bookUnitModal").hasAttribute("hidden")
        ) {
          renderUnitPicker();
        } else {
          renderUnitSelectionSummary();
        }
        if (droppedOut) {
          showRoomUnavailableMessage();
          openBookUnitModal();
        }
        updateStep2ContinueButton();
      }
      if (t.id === "poolUse") {
        syncStayTypeFromPoolUse();
        afterBookingRuleOrDatesChanged();
      }
      if (
        t.id === "fullName" ||
        t.id === "phone" ||
        t.id === "email" ||
        t.id === "adults" ||
        t.id === "children" ||
        t.id === "childrenUnder6" ||
        t.id === "poolUse" ||
        t.id === "eventType" ||
        t.id === "eventOther" ||
        t.id === "request" ||
        t.id === "checkInTime" ||
        t.id === "checkOutTime"
      ) {
        saveBookingDraft();
      }
    });
    bookingSectionEl.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (
        t.id === "fullName" ||
        t.id === "phone" ||
        t.id === "email" ||
        t.id === "adults" ||
        t.id === "children" ||
        t.id === "childrenUnder6" ||
        t.id === "eventOther" ||
        t.id === "request"
      ) {
        saveBookingDraft();
      }
      if (t.id === "adults" || t.id === "children" || t.id === "childrenUnder6") {
        updateGuestCapacityLiveUI();
        updateModalCapacityHint();
        updateUnitModalConfirmButton();
        if (wizardState.unitSelectionConfirmed) {
          renderUnitSelectionSummary();
          renderBookingDetailsSummary();
        }
        if (currentFlowStep === 3 && typeof renderBookingConfirmationPanel === "function") {
          renderBookingConfirmationPanel();
        }
        if (currentFlowStep === 4 && !wizardState.paymentProofSubmitted) {
          renderPaymentPanel();
        }
        updateStep2ContinueButton();
      }
    });
  }

  var step2RefreshTimer = null;
  function refreshStep2Availability() {
    if (currentFlowStep !== 1) return;
    if (step2RefreshTimer) return;
    step2RefreshTimer = requestAnimationFrame(function () {
      step2RefreshTimer = null;
      if (currentFlowStep !== 1) return;
      renderCalendar();
      var unitModal = document.getElementById("bookUnitModal");
      var unitModalOpen = !!(unitModal && !unitModal.hasAttribute("hidden"));
      if (unitModalOpen && !wizardState.unitSelectionConfirmed) {
        renderUnitPicker();
      } else {
        renderUnitSelectionSummary();
        if (unitModalOpen) renderFacilityConfirmation();
      }
      renderBookingDetailsSummary();
      updateStep2ContinueButton();
    });
  }

  window.addEventListener("elenest-bookings-updated", refreshStep2Availability);
  window.addEventListener("elenest-manager-blocks-updated", refreshStep2Availability);

  function ensureStep2LiveAvailability(forceNetwork) {
    var tasks = [];
    if (window.ElenestContentStore && window.ElenestContentStore.ready) {
      tasks.push(window.ElenestContentStore.ready);
    }
    if (window.ElenestBookings && window.ElenestBookings.ready) {
      tasks.push(window.ElenestBookings.ready);
    }
    if (window.ElenestAvailability && window.ElenestAvailability.ready) {
      tasks.push(window.ElenestAvailability.ready);
    }
    // Only hit the network when Booking details is active or the tab becomes visible again.
    if (forceNetwork && currentFlowStep === 1) {
      if (window.ElenestBookings && typeof window.ElenestBookings.refreshAvailability === "function") {
        tasks.push(window.ElenestBookings.refreshAvailability());
      }
      if (
        window.ElenestAvailability &&
        typeof window.ElenestAvailability.refreshManagerBlocks === "function"
      ) {
        tasks.push(window.ElenestAvailability.refreshManagerBlocks());
      }
    }
    return Promise.all(tasks)
      .catch(function () {
        return null;
      })
      .then(refreshStep2Availability);
  }

  // Wait for cached data only — no aggressive poll (realtime + visibility refresh).
  ensureStep2LiveAvailability(false);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || currentFlowStep !== 1) return;
    ensureStep2LiveAvailability(true);
  });

  bindGuestCapacityLiveValidation();

  var bookUnitModal = document.getElementById("bookUnitModal");
  if (bookUnitModal) {
    bookUnitModal.addEventListener("change", handleUnitPickerChange);
    bookUnitModal.addEventListener("click", function (e) {
      var card = e.target && e.target.closest ? e.target.closest("label.book-facility-card") : null;
      if (!card || !bookUnitModal.contains(card)) return;
      var input = card.querySelector('input.book-facility-card__input[name="bookFacilityUnit"]');
      if (!input) return;
      window.setTimeout(function () {
        card.classList.toggle("book-facility-card--selected", !!input.checked);
      }, 0);
    });
    bookUnitModal.querySelectorAll("[data-book-unit-close]").forEach(function (el) {
      el.addEventListener("click", closeBookUnitModal);
    });
    var bookUnitModalDone = document.getElementById("bookUnitModalDone");
    if (bookUnitModalDone) bookUnitModalDone.addEventListener("click", confirmUnitSelection);
    var bookUnitConfirmBody = document.getElementById("bookUnitConfirmBody");
    if (bookUnitConfirmBody) {
      bookUnitConfirmBody.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-remove-facility-id]") : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        removeSelectedFacility(
          btn.getAttribute("data-remove-facility-type") || "",
          btn.getAttribute("data-remove-facility-id") || ""
        );
      });
    }
    bookUnitModal.querySelectorAll("[data-book-unit-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setUnitPickerTab(btn.getAttribute("data-book-unit-tab"));
      });
    });
    var infoOk = document.getElementById("bookUnitInfoOk");
    if (infoOk) infoOk.addEventListener("click", hideBookUnitInfoPopup);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !bookUnitModal || bookUnitModal.hasAttribute("hidden")) return;
      if (isBookUnitInfoOpen()) {
        hideBookUnitInfoPopup();
        return;
      }
      closeBookUnitModal();
    });
  }

  var paymentQrLightbox = document.getElementById("paymentQrLightbox");
  if (paymentQrLightbox) {
    paymentQrLightbox.querySelectorAll("[data-payment-qr-close]").forEach(function (el) {
      el.addEventListener("click", closePaymentQrLightbox);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!paymentQrLightbox || paymentQrLightbox.hasAttribute("hidden")) return;
      closePaymentQrLightbox();
    });
  }

  var bookUnitReopenBtn = document.getElementById("bookUnitReopenBtn");
  if (bookUnitReopenBtn) {
    bookUnitReopenBtn.addEventListener("click", unlockUnitSelection);
  }

  var calPrev = document.getElementById("calPrev");
  var calNext = document.getElementById("calNext");
  if (calPrev) {
    calPrev.addEventListener("click", function () {
      calView.m--;
      if (calView.m < 0) {
        calView.m = 11;
        calView.y--;
      }
      renderCalendar();
    });
  }
  if (calNext) {
    calNext.addEventListener("click", function () {
      calView.m++;
      if (calView.m > 11) {
        calView.m = 0;
        calView.y++;
      }
      renderCalendar();
    });
  }

  /** Prefill Step 1 from account only when a field is still empty (draft stays editable & preferred). */
  function fillGuestDetailsFromUser(user) {
    if (!user) return;
    var fn = document.getElementById("fullName");
    var ph = document.getElementById("phone");
    var em = document.getElementById("email");
    if (fn && !String(fn.value || "").trim()) fn.value = user.name || "";
    if (ph && !String(ph.value || "").trim()) ph.value = user.phone || "";
    if (em && !String(em.value || "").trim()) em.value = user.email || "";
  }

  function readPrefillFacilityIds() {
    var ids = [];
    try {
      var raw = sessionStorage.getItem("elenest_prefill_unit_ids");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) ids = parsed;
      }
    } catch (e) {
      ids = [];
    }
    if (!ids.length) {
      try {
        var one = sessionStorage.getItem("elenest_prefill_unit_id") || "";
        if (one) ids = [one];
      } catch (e2) {}
    }
    var seen = {};
    return ids
      .map(function (id) {
        return String(id || "").trim();
      })
      .filter(function (id) {
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
  }

  function applyPrefillStayMode(mode) {
    var overnight = document.querySelector('input[name="bookStayType"][value="overnight"]');
    var dayTour = document.querySelector('input[name="bookStayType"][value="day_tour"]');
    var poolEl = document.getElementById("poolUse");
    if (mode === "single") {
      if (dayTour) dayTour.checked = true;
      if (overnight) overnight.checked = false;
      if (poolEl) poolEl.value = "day_tour";
      return;
    }
    if (mode === "range") {
      if (overnight) overnight.checked = true;
      if (dayTour) dayTour.checked = false;
      if (poolEl) poolEl.value = "none";
    }
  }

  var pendingPrefillFacilityIds = null;

  function applyPrefillFacilityIds(unitIds) {
    if (!unitIds || !unitIds.length || !wizardState.checkIn || !wizardState.checkOut) return 0;
    var UA = window.ElenestUnitAvailability;
    var catalog = UA && typeof UA.getCatalog === "function" ? UA.getCatalog() : [];
    var byId = {};
    catalog.forEach(function (unit) {
      if (unit && unit.id != null) byId[String(unit.id)] = unit;
    });
    resetUnitSelection();
    var matched = 0;
    unitIds.forEach(function (unitId) {
      var unit = byId[String(unitId)];
      if (!unit) return;
      matched += 1;
      var t = String(unit.type || "room").toLowerCase();
      var id = String(unit.id);
      if (t === "cottage") {
        if (wizardState.unitSelection.cottageCatalogIds.indexOf(id) === -1) {
          wizardState.unitSelection.cottageCatalogIds.push(id);
        }
      } else if (t === "hall") {
        if (wizardState.unitSelection.hallCatalogIds.indexOf(id) === -1) {
          wizardState.unitSelection.hallCatalogIds.push(id);
        }
      } else if (wizardState.unitSelection.roomCatalogIds.indexOf(id) === -1) {
        wizardState.unitSelection.roomCatalogIds.push(id);
      }
    });
    getUnitSelection();
    wizardState.unitSelectionConfirmed = hasSelectedFacilities();
    return matched;
  }

  function paintPrefillOnStep1() {
    try {
      localStorage.setItem(BOOK_FLOW_STEP_KEY, "1");
    } catch (e2) {}
    goStep(1);
  }

  function readPublicCalendarDraft() {
    try {
      var raw = localStorage.getItem("elenest_public_calendar_draft_v1");
      if (!raw) return null;
      var draft = JSON.parse(raw);
      return draft && typeof draft === "object" ? draft : null;
    } catch (e) {
      return null;
    }
  }

  function readReservedFacilityRecord() {
    try {
      var raw = localStorage.getItem("elenest_reserved_facilities_v1");
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      if (!Array.isArray(data.unitIds) || !data.unitIds.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearPrefillHandoff() {
    try {
      sessionStorage.removeItem("elenest_avail_proceed");
      sessionStorage.removeItem("elenest_prefill_checkin");
      sessionStorage.removeItem("elenest_prefill_checkout");
      sessionStorage.removeItem("elenest_prefill_unit_id");
      sessionStorage.removeItem("elenest_prefill_unit_ids");
      sessionStorage.removeItem("elenest_prefill_stay_mode");
      sessionStorage.removeItem("elenest_prefill_adults");
      sessionStorage.removeItem("elenest_prefill_children");
      sessionStorage.removeItem("elenest_prefill_children_under6");
      sessionStorage.removeItem("elenest_prefill_arrival_time");
      sessionStorage.removeItem("elenest_prefill_departure_time");
      localStorage.removeItem("elenest_reserved_facilities_v1");
    } catch (e) {}
  }

  /** Apply dates + facilities chosen in the public availability modal. */
  function applyAvailabilityPrefill() {
    var ci = null;
    var co = null;
    var stayMode = "";
    var unitIds = [];
    var hasProceed = false;
    var adultsPrefill = null;
    var childrenPrefill = null;
    var under6Prefill = null;
    var arrivalPrefill = null;
    var departurePrefill = null;
    var publicDraft = readPublicCalendarDraft();
    try {
      hasProceed = sessionStorage.getItem("elenest_avail_proceed") === "1";
      var bookDraftRaw = null;
      try {
        bookDraftRaw = localStorage.getItem(BOOK_FLOW_DRAFT_KEY);
      } catch (eDraft) {}
      var bookSavedAt = 0;
      if (bookDraftRaw) {
        try {
          bookSavedAt = Number(JSON.parse(bookDraftRaw).savedAt) || 0;
        } catch (eParse) {}
      }
      var publicIsNewer = publicDraft && (!bookSavedAt || Number(publicDraft.savedAt) > bookSavedAt);
      if (!hasProceed && publicIsNewer && publicDraft.checkIn) hasProceed = true;
      if (!sessionStorage.getItem("elenest_prefill_checkin") && publicIsNewer) {
        ci = publicDraft.checkIn || null;
        co = publicDraft.checkOut || null;
        stayMode = publicDraft.stayMode || "";
        unitIds = Array.isArray(publicDraft.unitIds) ? publicDraft.unitIds.slice() : [];
        adultsPrefill = publicDraft.adults != null ? String(publicDraft.adults) : null;
        childrenPrefill = publicDraft.children != null ? String(publicDraft.children) : null;
        under6Prefill = publicDraft.childrenUnder6 != null ? String(publicDraft.childrenUnder6) : null;
        arrivalPrefill = publicDraft.arrivalTime || null;
        departurePrefill = publicDraft.departureTime || null;
      } else if (hasProceed) {
        ci = sessionStorage.getItem("elenest_prefill_checkin");
        co = sessionStorage.getItem("elenest_prefill_checkout");
        stayMode = sessionStorage.getItem("elenest_prefill_stay_mode") || "";
        unitIds = readPrefillFacilityIds();
        adultsPrefill = sessionStorage.getItem("elenest_prefill_adults");
        childrenPrefill = sessionStorage.getItem("elenest_prefill_children");
        under6Prefill = sessionStorage.getItem("elenest_prefill_children_under6");
        arrivalPrefill = sessionStorage.getItem("elenest_prefill_arrival_time");
        departurePrefill = sessionStorage.getItem("elenest_prefill_departure_time");
      }
    } catch (e) {
      return false;
    }
    var reserved = readReservedFacilityRecord();
    if (reserved && (!unitIds.length || !ci)) {
      var reservedAt = Number(reserved.savedAt) || 0;
      var bookSavedAtForReserved = 0;
      try {
        var existingDraft = localStorage.getItem(BOOK_FLOW_DRAFT_KEY);
        if (existingDraft) bookSavedAtForReserved = Number(JSON.parse(existingDraft).savedAt) || 0;
      } catch (eReserved) {}
      if (!unitIds.length && (hasProceed || !bookSavedAtForReserved || reservedAt >= bookSavedAtForReserved)) {
        hasProceed = true;
        ci = ci || reserved.checkIn || null;
        co = co || reserved.checkOut || null;
        stayMode = stayMode || reserved.stayMode || "";
        unitIds = reserved.unitIds.slice();
        if (adultsPrefill == null && reserved.adults != null) adultsPrefill = String(reserved.adults);
        if (childrenPrefill == null && reserved.children != null) childrenPrefill = String(reserved.children);
        if (under6Prefill == null && reserved.childrenUnder6 != null) {
          under6Prefill = String(reserved.childrenUnder6);
        }
        if (!arrivalPrefill && reserved.arrivalTime) arrivalPrefill = reserved.arrivalTime;
        if (!departurePrefill && reserved.departureTime) departurePrefill = reserved.departureTime;
      }
    }
    if (adultsPrefill != null || childrenPrefill != null || under6Prefill != null) {
      var adultsField = document.getElementById("adults");
      var childrenField = document.getElementById("children");
      var under6Field = document.getElementById("childrenUnder6");
      if (adultsField && adultsPrefill != null && adultsPrefill !== "") {
        adultsField.value = String(Math.max(1, parseInt(adultsPrefill, 10) || 1));
      }
      if (childrenField && childrenPrefill != null && childrenPrefill !== "") {
        childrenField.value = String(Math.max(0, parseInt(childrenPrefill, 10) || 0));
      }
      if (under6Field && under6Prefill != null && under6Prefill !== "") {
        under6Field.value = String(Math.max(0, parseInt(under6Prefill, 10) || 0));
      }
      if (adultsField) adultsField.dispatchEvent(new Event("input", { bubbles: true }));
      if (childrenField) childrenField.dispatchEvent(new Event("input", { bubbles: true }));
      if (under6Field) under6Field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (!hasProceed) return false;
    if (!ci || !/^\d{4}-\d{2}-\d{2}$/.test(ci)) return false;
    wizardState.checkIn = ci;
    wizardState.checkOut =
      co && /^\d{4}-\d{2}-\d{2}$/.test(co) && co > ci ? co : null;
    // One-day stay stores checkout as the next calendar day.
    if (!wizardState.checkOut) {
      wizardState.checkOut = addDaysIso(ci, 1);
    }
    if (stayMode !== "single" && stayMode !== "range") {
      stayMode = wizardState.checkOut > addDaysIso(ci, 1) ? "range" : "single";
    }
    if (stayMode === "single" || stayMode === "range") applyPrefillStayMode(stayMode);
    if (stayMode === "range") {
      var prefillRangeErr = overnightRangeDateError(wizardState.checkIn, wizardState.checkOut);
      if (prefillRangeErr) {
        wizardState.checkIn = null;
        wizardState.checkOut = null;
        resetUnitSelection();
        pendingPrefillFacilityIds = null;
        paintPrefillOnStep1();
        showCalendarDateMessage(prefillRangeErr);
        return true;
      }
    }
    var parsed = new Date(ci + "T12:00:00");
    if (!isNaN(parsed.getTime())) {
      calView.y = parsed.getFullYear();
      calView.m = parsed.getMonth();
    }
    pendingPrefillFacilityIds = unitIds.slice();

    // Keep this visit on Step 1 even if an older open booking would normally resume.
    wizardState.skipResume = true;

    var matched = 0;
    if (pendingPrefillFacilityIds.length) {
      matched = applyPrefillFacilityIds(pendingPrefillFacilityIds);
    } else {
      resetUnitSelection();
    }

    if (stayMode === "range") {
      if (arrivalPrefill) wizardState.checkInTime = arrivalPrefill;
      if (departurePrefill) wizardState.checkOutTime = departurePrefill;
      fillTimeSelects();
    }
    paintPrefillOnStep1();

    if (pendingPrefillFacilityIds.length && matched < pendingPrefillFacilityIds.length) {
      var retryIds = pendingPrefillFacilityIds.slice();
      pendingPrefillFacilityIds = null;
      var storeReady = window.ElenestContentStore && window.ElenestContentStore.ready;
      if (storeReady && typeof storeReady.then === "function") {
        Promise.resolve(storeReady).then(function () {
          if (currentFlowStep !== 1) return;
          var retryMatched = applyPrefillFacilityIds(retryIds);
          paintPrefillOnStep1();
          if (retryMatched > 0) clearPrefillHandoff();
        });
      }
    } else {
      pendingPrefillFacilityIds = null;
      if (!unitIds.length || matched > 0) clearPrefillHandoff();
    }
    return true;
  }

  function scrollToAuthFromAvailability() {
    try {
      if (sessionStorage.getItem("elenest_avail_proceed") !== "1") return;
      if (gate && !gate.hidden) {
        gate.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  window.ElenestBookFlow = {
    applyAvailabilityPrefill: applyAvailabilityPrefill,
    renderAppointmentsBoard: renderAppointmentsBoard,
    openAppointmentsModal: openAppointmentsModal
  };

  function setCustomerLoggedInHeader(isLoggedIn) {
    // Customer booking page only — staff portals keep their own headers.
    if (!document.body || !document.body.classList.contains("book-page")) return;
    document.body.classList.toggle("customer-logged-in", !!isLoggedIn);
    document.querySelectorAll("[data-customer-extra='1']").forEach(function (el) {
      el.hidden = !!isLoggedIn;
      if (isLoggedIn) el.setAttribute("hidden", "");
      else el.removeAttribute("hidden");
    });
    var roleLogin = document.getElementById("roleLoginNav");
    if (roleLogin) {
      roleLogin.hidden = !!isLoggedIn;
      if (isLoggedIn) roleLogin.setAttribute("hidden", "");
      else roleLogin.removeAttribute("hidden");
    }
    var trigger = document.getElementById("roleLoginTrigger");
    if (trigger && isLoggedIn) {
      trigger.hidden = true;
      trigger.setAttribute("hidden", "");
    } else if (trigger) {
      trigger.hidden = false;
      trigger.removeAttribute("hidden");
    }
  }

  function openGuestProfileModal() {
    var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
    if (window.ElenestGuestProfile && typeof window.ElenestGuestProfile.open === "function") {
      window.ElenestGuestProfile.open(user);
    }
  }

  function appendFallbackAppointmentsLink(host) {
    if (!host) return;
    var appt = document.createElement("button");
    appt.type = "button";
    appt.className = "book-nav-appointments book-nav-icon-btn";
    appt.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '<path d="M16 3v4M8 3v4M3 11h18"/>' +
      "</svg>";
    appt.setAttribute("aria-label", "Appointments");
    appt.title = "Appointments";
    appt.setAttribute("aria-haspopup", "dialog");
    appt.setAttribute("aria-controls", "appointmentsOverlay");
    appt.setAttribute("aria-expanded", "false");
    appt.addEventListener("click", function (e) {
      e.preventDefault();
      openAppointmentsModal();
    });
    host.appendChild(appt);
  }

  function paintLoggedInGuestNav(user) {
    if (!navUser) return;
    navUser.hidden = false;
    setCustomerLoggedInHeader(true);
    if (window.ElenestGuestAvatar && typeof window.ElenestGuestAvatar.renderUserNav === "function") {
      window.ElenestGuestAvatar.renderUserNav(
        navUser,
        user,
        openLogoutConfirmOverlay,
        openGuestProfileModal,
        openAppointmentsModal
      );
      return;
    }
    navUser.textContent = "";
    var identity = document.createElement("div");
    identity.className = "book-nav-identity";
    var profileBtn = document.createElement("button");
    profileBtn.type = "button";
    profileBtn.className = "book-nav-profile";
    profileBtn.setAttribute("data-guest-profile-trigger", "1");
    profileBtn.setAttribute("aria-label", "Edit profile");
    profileBtn.title = "Edit profile";
    if (window.ElenestGuestAvatar && typeof window.ElenestGuestAvatar.create === "function") {
      profileBtn.appendChild(window.ElenestGuestAvatar.create(user, { size: "sm" }));
    }
    var greet = document.createElement("span");
    greet.className = "book-nav-greet";
    greet.textContent = user.name;
    profileBtn.appendChild(greet);
    profileBtn.addEventListener("click", openGuestProfileModal);
    identity.appendChild(profileBtn);
    navUser.appendChild(identity);
    var actions = document.createElement("div");
    actions.className = "book-nav-actions";
    appendFallbackAppointmentsLink(actions);
    if (window.ElenestCustomerNotifications && typeof window.ElenestCustomerNotifications.createBell === "function") {
      actions.appendChild(window.ElenestCustomerNotifications.createBell(user));
    }
    var logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "book-nav-logout book-nav-icon-btn";
    logoutBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>' +
      '<path d="M15 12H8"/>' +
      '<path d="M12 8l4 4-4 4"/>' +
      "</svg>";
    logoutBtn.setAttribute("aria-label", "Log out");
    logoutBtn.title = "Log out";
    logoutBtn.addEventListener("click", openLogoutConfirmOverlay);
    actions.appendChild(logoutBtn);
    navUser.appendChild(actions);
  }

  function initGuestBookingShell() {
    if (reserveBanner) reserveBanner.hidden = true;
    if (gate) gate.hidden = true;
    if (booking) booking.hidden = false;
    setCustomerLoggedInHeader(false);
    if (navUser) {
      navUser.hidden = true;
      navUser.innerHTML = "";
    }
    if (window.ElenestWeather && typeof window.ElenestWeather.setLoggedIn === "function") {
      window.ElenestWeather.setLoggedIn(true);
    }
    fillTimeSelects();
    if (!restoreBookingDraft()) {
      ensureDefaultDayTourStayType();
    } else {
      syncStayTypeFromPoolUse();
      afterBookingRuleOrDatesChanged();
    }
    restoreFlowStep();
    renderAppointmentsBoard();
    applyAvailabilityPrefill();
  }

  function applySession() {
    try {
      var user = window.ElenestAuth.getCurrentUser();
      if (!user) {
        initGuestBookingShell();
        return;
      }
      // Booking is customer-only; show a clear message for staff accounts.
      var Auth = window.ElenestAuth;
      var role = Auth && typeof Auth.normalizeRole === "function" ? Auth.normalizeRole(user.role) : user.role;
      var staff =
        Auth && typeof Auth.isStaffRole === "function"
          ? Auth.isStaffRole(role)
          : role === "admin" || role === "manager" || role === "receptionist";
      if (staff) {
        var staffHome =
          Auth && typeof Auth.getHomePathForRole === "function"
            ? Auth.getHomePathForRole(role)
            : role === "admin"
              ? "admin.html"
              : role === "manager"
                ? "manager.html"
                : "reception.html";
        // Break admin ↔ book redirect loops that crash the tab (Edge Out of Memory).
        var hop = 0;
        try {
          var denyAt = Number(sessionStorage.getItem("elenest_staff_gate_deny") || 0);
          hop = Number(sessionStorage.getItem("elenest_role_hop") || 0);
          if (denyAt && Date.now() - denyAt < 10000) {
            hop = Math.max(hop, 2);
          }
          sessionStorage.setItem("elenest_role_hop", String(hop + 1));
        } catch (e) {}
        if (hop >= 2) {
          try {
            sessionStorage.removeItem("elenest_role_hop");
            sessionStorage.removeItem("elenest_staff_gate_deny");
          } catch (e2) {}
          try {
            window.location.replace("login.html");
          } catch (e3) {
            window.location.href = "login.html";
          }
          return;
        }
        try {
          window.location.replace(staffHome);
        } catch (e) {}
        return;
      }
      paintLoggedInGuestNav(user);

      if (window.ElenestGuestProfile && typeof window.ElenestGuestProfile.init === "function") {
        window.ElenestGuestProfile.init();
      }

      if (window.ElenestCustomerNotifications && typeof window.ElenestCustomerNotifications.refresh === "function") {
        window.ElenestCustomerNotifications.refresh(user.email);
      }

      if (reserveBanner) reserveBanner.hidden = true;
      if (gate) gate.hidden = true;
      if (booking) booking.hidden = false;
      if (window.ElenestWeather && typeof window.ElenestWeather.setLoggedIn === "function") {
        window.ElenestWeather.setLoggedIn(true);
      }

      fillGuestDetailsFromUser(user);
      if (!restoreBookingDraft()) {
        ensureDefaultDayTourStayType();
      } else {
        syncStayTypeFromPoolUse();
        afterBookingRuleOrDatesChanged();
      }
      fillGuestDetailsFromUser(user);
      fillTimeSelects();
      renderAppointmentsBoard();
      tryShowWelcomePostLogin();
      applyAvailabilityPrefill();
      restoreFlowStep();
      saveBookingDraft();
    } catch (err) {
      try {
        console.warn("[Elenest Book] Session apply failed:", err);
      } catch (e) {}
    } finally {
      hideBookLoading();
    }
  }

  function closeWelcomeModal() {
    if (!welcomeOverlay) return;
    welcomeOverlay.classList.remove("welcome-modal-overlay--open");
    document.body.style.overflow = "";
    setTimeout(function () {
      welcomeOverlay.setAttribute("hidden", "");
      welcomeOverlay.setAttribute("aria-hidden", "true");
    }, 380);
  }

  function tryShowWelcomePostLogin() {
    if (!welcomeOverlay || !welcomeTitle) return;
    try {
      if (sessionStorage.getItem("elenest_welcome") !== "1") return;
      sessionStorage.removeItem("elenest_welcome");
      var u = window.ElenestAuth.getCurrentUser();
      if (!u) return;
      welcomeTitle.textContent = "Welcome, " + String(u.name || "guest").trim();
      welcomeOverlay.removeAttribute("hidden");
      welcomeOverlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          welcomeOverlay.classList.add("welcome-modal-overlay--open");
        });
      });
      if (welcomeOk) {
        setTimeout(function () {
          welcomeOk.focus();
        }, 100);
      }
    } catch (err) {}
  }

  if (welcomeOk) {
    welcomeOk.addEventListener("click", closeWelcomeModal);
  }

  if (logoutFeedbackYesBtn) {
    logoutFeedbackYesBtn.addEventListener("click", function () {
      performLogout(logoutFeedbackYesBtn);
    });
  }

  if (logoutFeedbackNoBtn) {
    logoutFeedbackNoBtn.addEventListener("click", function () {
      closeFeedbackOverlay();
    });
  }

  if (feedbackOverlay) {
    feedbackOverlay.addEventListener("click", function (e) {
      if (e.target === feedbackOverlay) closeFeedbackOverlay();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (feedbackOverlay && !feedbackOverlay.hasAttribute("hidden")) {
      closeFeedbackOverlay();
      return;
    }
    if (isGuestReceiptOverlayOpen()) {
      closeGuestReceiptModal();
      return;
    }
    if (isAppointmentsOverlayOpen()) {
      closeAppointmentsModal();
      return;
    }
    if (!welcomeOverlay || !welcomeOverlay.classList.contains("welcome-modal-overlay--open"))
      return;
    closeWelcomeModal();
  });

  function refreshHoldTimersOnCards() {
    var PF = window.ElenestPaymentFlow;
    if (!PF) return;
    var needsRerender = false;
    document.querySelectorAll("[data-hold-timer-for]").forEach(function (row) {
      var val = row.querySelector(".admin-arrival-timer");
      if (!val) return;
      var id = row.getAttribute("data-hold-timer-for");
      var user = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
      if (!user || !id || !window.ElenestBookings) return;
      var list = window.ElenestBookings.listForUser(user.email) || [];
      var booking = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(id)) {
          booking = list[i];
          break;
        }
      }
      if (!booking || !PF.showCustomerTimer(booking)) {
        needsRerender = true;
        if (row.parentNode) row.parentNode.removeChild(row);
        return;
      }
      var deadline =
        typeof PF.customerTimerDeadline === "function"
          ? PF.customerTimerDeadline(booking)
          : booking.holdExpiresAt;
      if (!deadline) {
        needsRerender = true;
        if (row.parentNode) row.parentNode.removeChild(row);
        return;
      }
      val.textContent = "🕒 " + PF.formatTimerRemaining(deadline);
      if (PF.formatTimerRemaining(deadline) === "Expired") val.classList.add("admin-arrival-timer--expired");
    });
    document.querySelectorAll("[data-pay-clock]").forEach(function (clock) {
      var deadline = clock.getAttribute("data-deadline");
      if (!deadline) return;
      var label = PF.formatTimerRemaining(deadline);
      clock.textContent = label;
      if (label === "Expired") {
        var alertEl = clock.closest(".pay-deadline-alert");
        if (alertEl) alertEl.classList.add("is-expired");
      }
    });
    var reviewBooking = typeof findReviewBooking === "function" ? findReviewBooking() : null;
    paintPaymentDeadlineAlert(document.getElementById("bookingPaymentDeadlineAlert"), reviewBooking);
    paintPaymentDeadlineAlert(
      document.getElementById("paymentDeadlineAlert"),
      wizardState.payableBooking || reviewBooking
    );
    sweepExpiredPaymentWindows();
    var livePayable = wizardState.payableBooking || reviewBooking;
    var paySubmit = document.getElementById("submitPaymentBtn");
    if (
      paySubmit &&
      livePayable &&
      PF.isAwaitingCustomerPayment(livePayable) &&
      PF.isPaymentWindowExpired(livePayable)
    ) {
      paySubmit.disabled = true;
      if (currentFlowStep === 4) {
        var payLead = document.getElementById("paymentStepLead");
        if (payLead) {
          payLead.textContent =
            "The 3-hour payment window has ended. This booking is expired and the reserved facility has been released.";
        }
      }
    }
    if (
      currentFlowStep === 3 &&
      reviewBooking &&
      (isMarkedPaymentExpired(reviewBooking) ||
        (PF.isAwaitingCustomerPayment(reviewBooking) && PF.isPaymentWindowExpired(reviewBooking))) &&
      refreshHoldTimersOnCards._expiredFor !== String(reviewBooking.id)
    ) {
      refreshHoldTimersOnCards._expiredFor = String(reviewBooking.id);
      renderBookingConfirmationPanel();
    }
    if (needsRerender && isAppointmentsOverlayOpen()) {
      if (!refreshHoldTimersOnCards._queued) {
        refreshHoldTimersOnCards._queued = true;
        setTimeout(function () {
          refreshHoldTimersOnCards._queued = false;
          renderAppointmentsBoard();
        }, 0);
      }
    }
  }

  var holdTick = 0;
  setInterval(function () {
    refreshHoldTimersOnCards();
    holdTick += 1;
    // Auto no-show check every ~30s, not every second.
    if (holdTick % 30 === 0 && window.ElenestBookings && window.ElenestBookings.processAutoNoShows) {
      window.ElenestBookings.processAutoNoShows();
    }
    if (
      currentFlowStep === 3 &&
      holdTick % 5 === 0 &&
      window.ElenestBookings &&
      window.ElenestBookings.refresh
    ) {
      Promise.resolve(window.ElenestBookings.refresh()).catch(function () {
        return null;
      });
    }
    var awaitingVerify = false;
    var tickPF = window.ElenestPaymentFlow;
    if (isAppointmentsOverlayOpen() && window.ElenestAuth && window.ElenestBookings) {
      var tickUser = window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;
      if (tickUser && tickUser.email) {
        var tickList = window.ElenestBookings.listForUser(tickUser.email) || [];
        for (var ti = 0; ti < tickList.length; ti++) {
          if (
            tickPF &&
            tickPF.isAwaitingPaymentVerification &&
            tickPF.isAwaitingPaymentVerification(tickList[ti])
          ) {
            awaitingVerify = true;
            break;
          }
        }
      }
    }
    if (
      isAppointmentsOverlayOpen() &&
      window.ElenestBookings &&
      window.ElenestBookings.syncLivePaymentStatuses &&
      holdTick % 2 === 0
    ) {
      Promise.resolve(window.ElenestBookings.syncLivePaymentStatuses()).catch(function () {
        return null;
      });
    }
    if (
      isAppointmentsOverlayOpen() &&
      window.ElenestBookings &&
      window.ElenestBookings.refresh &&
      (awaitingVerify ? holdTick % 3 === 0 : holdTick % 10 === 0)
    ) {
      Promise.resolve(window.ElenestBookings.refresh()).catch(function () {
        return null;
      });
    }
  }, 1000);

  window.addEventListener("elenest-bookings-updated", function () {
    if (isAppointmentsOverlayOpen() || currentFlowStep === 4) renderAppointmentsBoard();
    if (currentFlowStep === 3) renderBookingConfirmationPanel();
    if (currentFlowStep === 4 && wizardState.paymentProofSubmitted) renderPaymentSubmittedState();
    else if (currentFlowStep === 4) showReceiptForCompletedBooking();
    maybeOpenPaymentFromHash();
  });

  window.addEventListener("elenest-notifications-changed", function () {
    if (!window.ElenestBookings || !window.ElenestBookings.refresh) return;
    Promise.resolve(window.ElenestBookings.refresh())
      .catch(function () {
        return null;
      })
      .then(function () {
        if (isAppointmentsOverlayOpen() || currentFlowStep === 4) renderAppointmentsBoard();
      });
  });

  window.addEventListener("storage", function (e) {
    if (!e || e.key !== "elenest_verified_bookings") return;
    if (isAppointmentsOverlayOpen() || currentFlowStep === 4) renderAppointmentsBoard();
  });

  /* Reserve banner dates open the public calendar via home-reserve.js */

  if (window.ElenestAuth && window.ElenestAuth.ready) {
    // Wait for auth hydrate so staff roles are restored before deciding customer vs dashboard.
    Promise.resolve(window.ElenestAuth.ready)
      .catch(function () {
        return null;
      })
      .then(function () {
        applySession();
      });
  } else {
    applySession();
  }

  window.addEventListener("elenest-auth-change", function () {
    applySession();
  });

  window.addEventListener("pagehide", saveBookingDraft);
  window.addEventListener("beforeunload", saveBookingDraft);
})();