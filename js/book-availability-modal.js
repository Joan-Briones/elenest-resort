/**
 * Public availability calendar — simple & smooth:
 * • 1 tap  = same-day / 1-day visit (day tour style)
 * • 2nd tap on a later date = overnight range
 * then pick a facility → continue.
 */
(function () {
  var modal = document.getElementById("availCalendarModal");
  if (!modal) return;

  var monthLabel = document.getElementById("availModalCalMonthLabel");
  var calendarHost = document.getElementById("availModalCalendarHost");
  var pickedSummary = document.getElementById("availModalPickedSummary");
  var prevBtn = document.getElementById("availModalCalPrev");
  var nextBtn = document.getElementById("availModalCalNext");
  var reserveBtn = document.getElementById("availModalReserveBtn");
  var facilitySection = document.getElementById("availModalFacilitySection");
  var facilityHost = document.getElementById("availModalFacilityHost");
  var facilityEmpty = document.getElementById("availModalFacilityEmpty");

  var calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var previewState = { checkIn: null, checkOut: null };
  /** 'single' = one-day / day tour; 'range' = overnight check-in → check-out */
  var stayMode = "range";
  var selectedUnitId = "";
  var pickingLock = false;
  var renderQueued = false;
  var dataReady = false;

  function getPreferredStayMode() {
    var checked = document.querySelector(
      'input[name="availStayType"]:checked, input[name="loginReserveStayType"]:checked'
    );
    if (checked && checked.value === "day_tour") return "single";
    if (checked && checked.value === "overnight") return "range";
    return stayMode === "single" ? "single" : "range";
  }

  function syncStayTypeRadios(mode) {
    var value = mode === "single" ? "day_tour" : "overnight";
    document
      .querySelectorAll('input[name="availStayType"], input[name="loginReserveStayType"]')
      .forEach(function (radio) {
        radio.checked = radio.value === value;
      });
    var lead = document.getElementById("availModalCalendarLead");
    if (lead) {
      lead.innerHTML =
        mode === "single"
          ? "One-Day Book: tap <strong>one available date</strong>, then choose a facility."
          : "Overnight Book: tap <strong>check-in</strong>, then a later <strong>check-out</strong>. Then choose a facility.";
    }
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function addDaysIso(iso, days) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function isSingleDayStay() {
    return stayMode === "single" && !!previewState.checkIn;
  }

  function ensureAvailabilityReady() {
    if (dataReady) return Promise.resolve();
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
    return Promise.all(tasks).then(function () {
      dataReady = true;
    });
  }

  function isPreviewDateBlocked(iso) {
    var av = window.ElenestAvailability;
    if (!av || !iso) return false;
    if (av.getManagerBlocked && av.getManagerBlocked(iso)) return true;
    if (typeof av.isUnavailable === "function" && av.isUnavailable(iso)) return true;
    return false;
  }

  function previewRangeHasBlockedNight(checkIn, checkOut) {
    if (!checkIn || !checkOut) return false;
    var cur = new Date(checkIn + "T12:00:00");
    var end = new Date(checkOut + "T12:00:00");
    while (cur < end) {
      var iso =
        cur.getFullYear() + "-" + pad2(cur.getMonth() + 1) + "-" + pad2(cur.getDate());
      if (isPreviewDateBlocked(iso)) return true;
      cur.setDate(cur.getDate() + 1);
    }
    return false;
  }

  function datesReady() {
    if (!previewState.checkIn || !previewState.checkOut) return false;
    if (isSingleDayStay()) return previewState.checkOut > previewState.checkIn;
    return previewState.checkOut > previewState.checkIn;
  }

  function esc(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDateLong(iso) {
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch (e) {
      return iso;
    }
  }

  function unitImageSrc(unit) {
    if (!unit) return "../Images/gallery-1.png";
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilityImages === "function") {
      var imgs = S.getFacilityImages(unit);
      if (imgs && imgs[0]) return imgs[0];
    }
    return unit.image || unit.img || unit.photo || "../Images/gallery-1.png";
  }

  function notifyPreviewChanged() {
    try {
      window.dispatchEvent(
        new CustomEvent("elenest-avail-preview-changed", {
          detail: {
            checkIn: previewState.checkIn,
            checkOut: previewState.checkOut,
            stayMode: stayMode || "",
            unitId: selectedUnitId || ""
          }
        })
      );
    } catch (e) {}
  }

  function updatePickedSummary() {
    if (!pickedSummary) return;
    if (!previewState.checkIn) {
      pickedSummary.textContent =
        getPreferredStayMode() === "single"
          ? "One-Day Book: tap an available date, then choose a facility."
          : "Overnight Book: tap check-in, then a later check-out.";
      return;
    }
    var msg;
    if (isSingleDayStay()) {
      msg = "One-Day Book · " + fmtDateLong(previewState.checkIn);
    } else if (previewState.checkOut) {
      msg =
        "Overnight Book · " +
        fmtDateLong(previewState.checkIn) +
        " → " +
        fmtDateLong(previewState.checkOut);
    } else {
      msg = "Check-in " + fmtDateLong(previewState.checkIn) + " — tap a check-out date";
    }
    if (!selectedUnitId) {
      if (datesReady()) msg += " · pick a facility below";
    } else {
      var UA = window.ElenestUnitAvailability;
      var unit =
        UA && typeof UA.getCatalog === "function"
          ? UA.getCatalog().find(function (u) {
              return String(u.id) === String(selectedUnitId);
            })
          : null;
      if (unit) msg += " · " + (unit.name || selectedUnitId);
    }
    pickedSummary.textContent = msg;
  }

  function updateReserveButton() {
    if (!reserveBtn) return;
    var ready = datesReady() && !!selectedUnitId;
    reserveBtn.disabled = !ready;
    reserveBtn.setAttribute("aria-disabled", ready ? "false" : "true");
    if (isLoggedIn()) {
      reserveBtn.textContent = ready ? "Continue to booking" : "Select dates & facility";
    } else if (isLoginPage()) {
      reserveBtn.textContent = ready ? "Continue to Sign In" : "Select dates & facility";
    } else {
      reserveBtn.textContent = ready ? "Continue to Sign In" : "Select dates & facility";
    }
  }

  var facilityCategoryFilter = "room";

  function hideFacilityPicker() {
    selectedUnitId = "";
    facilityCategoryFilter = "room";
    if (facilitySection) facilitySection.hidden = true;
    if (facilityHost) facilityHost.textContent = "";
    if (facilityEmpty) facilityEmpty.hidden = true;
  }

  function unitCategory(unit) {
    var t = String((unit && unit.type) || "room").toLowerCase();
    if (t === "cottage") return "cottage";
    if (t === "hall") return "hall";
    return "room";
  }

  function buildFacilityCardHtml(item, UA) {
    var unit = item.unit;
    var available = !!item.available;
    var selected = available && String(unit.id) === String(selectedUnitId);
    var cap =
      typeof UA.formatCapacityLabel === "function" ? UA.formatCapacityLabel(unit) : "";
    return (
      '<button type="button" class="avail-facility-card' +
      (selected ? " is-selected" : "") +
      (available ? "" : " avail-facility-card--unavailable") +
      '" data-unit-id="' +
      esc(unit.id) +
      '"' +
      (available ? "" : ' disabled aria-disabled="true"') +
      ">" +
      '<img class="avail-facility-card__img" src="' +
      esc(unitImageSrc(unit)) +
      '" alt="" loading="lazy">' +
      '<span class="avail-facility-card__body">' +
      '<span class="avail-facility-card__name">' +
      esc(unit.name || unit.id) +
      "</span>" +
      (cap ? '<span class="avail-facility-card__meta">' + esc(cap) + "</span>" : "") +
      '<span class="avail-facility-card__status">' +
      (available ? "Available" : "Booked") +
      "</span>" +
      "</span></button>"
    );
  }

  function renderFacilityPicker() {
    if (!facilitySection || !facilityHost) return;
    if (!datesReady()) {
      hideFacilityPicker();
      updateReserveButton();
      return;
    }

    var UA = window.ElenestUnitAvailability;
    if (!UA || typeof UA.listUnitsWithAvailability !== "function") {
      facilitySection.hidden = false;
      facilityHost.innerHTML = '<p class="note">Loading facilities…</p>';
      updateReserveButton();
      return;
    }

    var list = UA.listUnitsWithAvailability(previewState.checkIn, previewState.checkOut);
    var available = list.filter(function (item) {
      return item && item.available;
    });

    facilitySection.hidden = false;
    if (facilityEmpty) {
      facilityEmpty.hidden = list.length > 0;
      if (!list.length) {
        facilityEmpty.textContent = "No facilities found. Try another date.";
      } else if (!available.length) {
        facilityEmpty.hidden = false;
        facilityEmpty.textContent =
          "All rooms, cottages, and event halls are booked for these dates. Gray cards cannot be selected.";
      }
    }

    if (
      selectedUnitId &&
      !available.some(function (item) {
        return String(item.unit.id) === String(selectedUnitId);
      })
    ) {
      selectedUnitId = "";
    }

    var sections = [
      {
        key: "room",
        label: "Rooms",
        items: list.filter(function (item) {
          return unitCategory(item.unit) === "room";
        })
      },
      {
        key: "cottage",
        label: "Cottages",
        items: list.filter(function (item) {
          return unitCategory(item.unit) === "cottage";
        })
      },
      {
        key: "hall",
        label: "Event Hall",
        items: list.filter(function (item) {
          return unitCategory(item.unit) === "hall";
        })
      }
    ];

    var openSections = sections.filter(function (section) {
      return section.items.length > 0;
    });

    if (!openSections.length) {
      facilityHost.innerHTML = "";
      updateReserveButton();
      return;
    }

    if (
      !openSections.some(function (section) {
        return section.key === facilityCategoryFilter;
      })
    ) {
      facilityCategoryFilter = openSections[0].key;
    }

    var tabsHtml =
      '<div class="avail-facility-tabs" role="tablist" aria-label="Facility type">' +
      openSections
        .map(function (section) {
          var on = facilityCategoryFilter === section.key;
          return (
            '<button type="button" class="avail-facility-tab' +
            (on ? " avail-facility-tab--active" : "") +
            '" data-facility-tab="' +
            section.key +
            '" role="tab" aria-selected="' +
            (on ? "true" : "false") +
            '">' +
            esc(section.label) +
            ' <span class="avail-facility-tab__count">' +
            section.items.length +
            "</span></button>"
          );
        })
        .join("") +
      "</div>";

    var active =
      openSections.find(function (section) {
        return section.key === facilityCategoryFilter;
      }) || openSections[0];

    var panelHtml =
      '<div class="avail-facility-panel" data-facility-panel="' +
      active.key +
      '" role="tabpanel">' +
      '<h5 class="avail-facility-panel__title">' +
      esc(active.label) +
      "</h5>" +
      '<div class="avail-facility-grid">' +
      active.items
        .map(function (item) {
          return buildFacilityCardHtml(item, UA);
        })
        .join("") +
      "</div></div>";

    facilityHost.innerHTML = tabsHtml + panelHtml;
    updateReserveButton();
  }

  function scheduleCalendarRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderModalCalendarNow();
    });
  }

  function getCalendarWizardState() {
    // Single-day: highlight only the visit date (checkout is stored as +1 day for availability).
    if (isSingleDayStay()) {
      return { checkIn: previewState.checkIn, checkOut: null };
    }
    return { checkIn: previewState.checkIn, checkOut: previewState.checkOut };
  }

  function renderModalCalendarNow() {
    if (!window.ElenestCalendarWidget || !calendarHost || !monthLabel) return;
    window.ElenestCalendarWidget.render({
      host: calendarHost,
      monthLabel: monthLabel,
      calView: calView,
      wizardState: getCalendarWizardState(),
      highlightRange: !isSingleDayStay(),
      showLiveOccupancy: true,
      onDayClick: pickPreviewDate
    });
  }

  function setSingleDay(iso) {
    previewState.checkIn = iso;
    previewState.checkOut = addDaysIso(iso, 1);
    stayMode = "single";
    selectedUnitId = "";
    if (facilityHost) facilityHost.textContent = "";
    syncStayTypeRadios("single");
  }

  function setOvernightStart(iso) {
    previewState.checkIn = iso;
    previewState.checkOut = null;
    stayMode = "range";
    selectedUnitId = "";
    if (facilityHost) facilityHost.textContent = "";
    syncStayTypeRadios("range");
  }

  function pickPreviewDate(iso) {
    if (!iso || isPreviewDateBlocked(iso) || pickingLock) return;
    pickingLock = true;
    try {
      var preferred = getPreferredStayMode();

      if (preferred === "single") {
        setSingleDay(iso);
      } else if (!previewState.checkIn || (stayMode === "range" && previewState.checkOut)) {
        // Fresh overnight pick, or restart after a completed range.
        setOvernightStart(iso);
      } else if (stayMode === "range" && !previewState.checkOut) {
        if (iso > previewState.checkIn) {
          if (previewRangeHasBlockedNight(previewState.checkIn, iso)) return;
          previewState.checkOut = iso;
          selectedUnitId = "";
          if (facilityHost) facilityHost.textContent = "";
        } else {
          setOvernightStart(iso);
        }
      } else {
        setOvernightStart(iso);
      }

      updatePickedSummary();
      notifyPreviewChanged();
      scheduleCalendarRender();
      if (datesReady()) {
        renderFacilityPicker();
        if (facilitySection) {
          try {
            facilitySection.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch (e) {}
        }
      }
      updateReserveButton();
    } finally {
      setTimeout(function () {
        pickingLock = false;
      }, 80);
    }
  }

  function openModal(prefill) {
    previewState.checkIn = prefill && prefill.checkIn ? prefill.checkIn : null;
    previewState.checkOut = prefill && prefill.checkOut ? prefill.checkOut : null;
    selectedUnitId = prefill && prefill.unitId ? String(prefill.unitId) : "";
    if (prefill && prefill.stayMode === "single") stayMode = "single";
    else if (prefill && prefill.stayMode === "range") stayMode = "range";
    else stayMode = getPreferredStayMode();

    if (previewState.checkIn && previewState.checkOut) {
      if (stayMode !== "single" && stayMode !== "range") {
        stayMode =
          previewState.checkOut === addDaysIso(previewState.checkIn, 1) ? "single" : "range";
      }
    } else if (previewState.checkIn && !previewState.checkOut) {
      if (stayMode === "single") setSingleDay(previewState.checkIn);
      else setOvernightStart(previewState.checkIn);
    }
    syncStayTypeRadios(stayMode === "single" ? "single" : "range");
    if (previewState.checkIn) {
      var d = new Date(previewState.checkIn + "T12:00:00");
      if (!isNaN(d.getTime())) {
        calView.y = d.getFullYear();
        calView.m = d.getMonth();
      }
    } else {
      var now = new Date();
      calView.y = now.getFullYear();
      calView.m = now.getMonth();
    }

    updatePickedSummary();
    notifyPreviewChanged();
    updateReserveButton();
    if (!datesReady()) hideFacilityPicker();

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("avail-modal-open");

    // Paint immediately, then hydrate when data is ready (no polling loop).
    scheduleCalendarRender();
    if (datesReady()) renderFacilityPicker();

    ensureAvailabilityReady().then(function () {
      if (modal.hidden) return;
      scheduleCalendarRender();
      if (datesReady()) renderFacilityPicker();
      updateReserveButton();
    });
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("avail-modal-open");
  }

  function isBookPage() {
    var path = window.location.pathname || "";
    return /(?:^|\/)book\.html$/i.test(path);
  }

  function isLoginPage() {
    var path = window.location.pathname || "";
    return /(?:^|\/)login\.html$/i.test(path);
  }

  function isLoggedIn() {
    return (
      window.ElenestAuth &&
      typeof window.ElenestAuth.isLoggedIn === "function" &&
      window.ElenestAuth.isLoggedIn()
    );
  }

  function showLoginContinueBanner() {
    var banner = document.getElementById("loginReserveContinue");
    if (!banner) return;
    banner.hidden = false;
    banner.innerHTML =
      "<strong>Dates &amp; facility saved.</strong> Sign in below, or " +
      '<a href="register.html?next=' +
      encodeURIComponent("book.html") +
      '">create a guest account</a> to finish your booking.';
    try {
      var authCard = document.getElementById("loginForm") || document.querySelector(".auth-card");
      if (authCard) authCard.scrollIntoView({ behavior: "smooth", block: "start" });
      else banner.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
  }

  function stashPreviewForBooking() {
    try {
      if (!previewState.checkIn || !previewState.checkOut || !selectedUnitId) return false;
      sessionStorage.setItem("elenest_prefill_checkin", previewState.checkIn);
      sessionStorage.setItem("elenest_prefill_checkout", previewState.checkOut);
      sessionStorage.setItem("elenest_prefill_unit_id", selectedUnitId);
      sessionStorage.setItem("elenest_prefill_stay_mode", stayMode === "single" ? "single" : "range");
      sessionStorage.setItem("elenest_avail_proceed", "1");
      return true;
    } catch (e) {
      return false;
    }
  }

  function proceedToBooking() {
    if (!datesReady() || !selectedUnitId) {
      updatePickedSummary();
      if (facilitySection && datesReady()) {
        try {
          facilitySection.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (e) {}
      }
      return;
    }
    if (!stashPreviewForBooking()) return;
    closeModal();

    if (isLoggedIn()) {
      if (isBookPage()) {
        if (
          window.ElenestBookFlow &&
          typeof window.ElenestBookFlow.applyAvailabilityPrefill === "function"
        ) {
          window.ElenestBookFlow.applyAvailabilityPrefill();
        }
        var booking = document.getElementById("bookingSection");
        if (booking && !booking.hidden) {
          booking.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      window.location.href = "book.html";
      return;
    }

    if (isLoginPage()) {
      showLoginContinueBanner();
      return;
    }

    window.location.href = "login.html?next=" + encodeURIComponent("book.html");
  }

  function openFromReserveForm(form) {
    var prefill = {};
    if (form) {
      var arrival = form.querySelector('[name="arrival"]');
      var departure = form.querySelector('[name="departure"]');
      if (arrival && arrival.value) prefill.checkIn = arrival.value;
      if (departure && departure.value) prefill.checkOut = departure.value;
    }
    prefill.stayMode = getPreferredStayMode();
    openModal(prefill);
  }

  modal.querySelectorAll("[data-avail-close]").forEach(function (el) {
    el.addEventListener("click", closeModal);
  });

  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      calView.m--;
      if (calView.m < 0) {
        calView.m = 11;
        calView.y--;
      }
      scheduleCalendarRender();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      calView.m++;
      if (calView.m > 11) {
        calView.m = 0;
        calView.y++;
      }
      scheduleCalendarRender();
    });
  }

  if (reserveBtn) {
    reserveBtn.addEventListener("click", proceedToBooking);
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.name) return;
    if (t.name !== "availStayType" && t.name !== "loginReserveStayType") return;
    var nextMode = t.value === "day_tour" ? "single" : "range";
    stayMode = nextMode;
    previewState.checkIn = null;
    previewState.checkOut = null;
    selectedUnitId = "";
    if (facilityHost) facilityHost.textContent = "";
    hideFacilityPicker();
    syncStayTypeRadios(nextMode);
    updatePickedSummary();
    notifyPreviewChanged();
    updateReserveButton();
    if (!modal.hidden) scheduleCalendarRender();
  });

  if (facilityHost) {
    facilityHost.addEventListener("click", function (e) {
      var tabBtn =
        e.target && e.target.closest ? e.target.closest("[data-facility-tab]") : null;
      if (tabBtn) {
        facilityCategoryFilter = String(tabBtn.getAttribute("data-facility-tab") || "room");
        renderFacilityPicker();
        return;
      }

      var btn = e.target && e.target.closest ? e.target.closest("[data-unit-id]") : null;
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      if (btn.classList.contains("avail-facility-card--unavailable")) return;
      selectedUnitId = String(btn.getAttribute("data-unit-id") || "");
      facilityHost.querySelectorAll(".avail-facility-card").forEach(function (card) {
        card.classList.toggle(
          "is-selected",
          String(card.getAttribute("data-unit-id")) === selectedUnitId
        );
      });
      updatePickedSummary();
      notifyPreviewChanged();
      updateReserveButton();
    });
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var trigger = t.closest("[data-open-avail-cal]");
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      var form =
        trigger.closest("form") ||
        document.getElementById("bookReservePreviewForm") ||
        document.getElementById("homeReserveForm") ||
        document.getElementById("loginReserveForm");
      openFromReserveForm(form);
    },
    true
  );

  document.querySelectorAll("#homeReserveForm, #bookReservePreviewForm, #loginReserveForm").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openFromReserveForm(form);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  var modalRefreshQueued = false;
  function softRefreshOpenModal(withFacilities) {
    if (modal.hidden || pickingLock || modalRefreshQueued) return;
    modalRefreshQueued = true;
    requestAnimationFrame(function () {
      modalRefreshQueued = false;
      if (modal.hidden || pickingLock) return;
      scheduleCalendarRender();
      if (withFacilities && datesReady()) renderFacilityPicker();
    });
  }

  // Soft update only when bookings actually change — no interval polling.
  window.addEventListener("elenest-bookings-updated", function () {
    softRefreshOpenModal(true);
  });

  window.addEventListener("elenest-manager-blocks-updated", function () {
    softRefreshOpenModal(false);
  });

  window.ElenestAvailabilityModal = {
    open: openModal,
    close: closeModal
  };
})();
