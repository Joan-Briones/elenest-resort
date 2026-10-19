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
  var selectedUnitIds = [];
  var stashOwned = false;
  var pickingLock = false;
  var renderQueued = false;
  var dataReady = false;

  var PUBLIC_DRAFT_KEY = "elenest_public_calendar_draft_v1";
  var DAY_SCHEDULE_LABEL = "8:00 AM – 10:00 PM";
  var DAY_ARRIVAL = "8:00 AM";
  var DAY_DEPARTURE = "10:00 PM";

  function stayTypeSelector(checkedOnly) {
    var names = ["availStayType", "loginReserveStayType", "homeReserveStayType"];
    return names
      .map(function (name) {
        return 'input[name="' + name + '"]' + (checkedOnly ? ":checked" : "");
      })
      .join(", ");
  }

  function getPreferredStayMode() {
    var checked = document.querySelector(stayTypeSelector(true));
    if (checked && checked.value === "day_tour") return "single";
    if (checked && checked.value === "overnight") return "range";
    return stayMode === "single" ? "single" : "range";
  }

  function syncAvailTimes(mode) {
    var dayWrap = document.getElementById("availDayScheduleWrap");
    var arrivalWrap = document.getElementById("availArrivalWrap");
    var departureWrap = document.getElementById("availDepartureWrap");
    var single = mode === "single";
    if (dayWrap) dayWrap.hidden = !single;
    if (arrivalWrap) arrivalWrap.hidden = single;
    if (departureWrap) departureWrap.hidden = single;
    var schedule = document.getElementById("availDaySchedule");
    if (schedule) schedule.value = DAY_SCHEDULE_LABEL;
  }

  function syncStayTypeRadios(mode) {
    var value = mode === "single" ? "day_tour" : "overnight";
    document.querySelectorAll(stayTypeSelector(false)).forEach(function (radio) {
        radio.checked = radio.value === value;
      });
    var lead = document.getElementById("availModalCalendarLead");
    if (lead) {
      lead.innerHTML =
        mode === "single"
          ? "One-Day Book: tap <strong>one available date</strong>, then choose a facility."
          : "Overnight Book: tap <strong>check-in</strong>, then a later <strong>check-out</strong>. Then choose a facility.";
    }
    syncAvailTimes(mode);
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

  var OVERNIGHT_BLOCKED_RANGE_MSG =
    "One of the selected dates is blocked. Please select another date range.";

  function isPreviewDateBlocked(iso) {
    var av = window.ElenestAvailability;
    if (!av || !iso) return false;
    if (av.getManagerBlocked && av.getManagerBlocked(iso)) return true;
    if (typeof av.isUnavailable === "function" && av.isUnavailable(iso)) return true;
    return false;
  }

  /**
   * Overnight check-out is exclusive. Oct 13–15 occupies Oct 13 and Oct 14.
   * Returns a customer-facing message when that span includes a blocked night.
   */
  function previewRangeDateMessage(checkIn, checkOut) {
    if (!checkIn || !checkOut) return "";
    var cur = new Date(checkIn + "T12:00:00");
    var end = new Date(checkOut + "T12:00:00");
    if (!(end > cur)) return "";
    var managerBlocked = false;
    var unavailable = false;
    var av = window.ElenestAvailability;
    while (cur < end) {
      var iso =
        cur.getFullYear() + "-" + pad2(cur.getMonth() + 1) + "-" + pad2(cur.getDate());
      if (av && typeof av.getManagerBlocked === "function" && av.getManagerBlocked(iso)) {
        managerBlocked = true;
      } else if (isPreviewDateBlocked(iso)) {
        unavailable = true;
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (managerBlocked) return OVERNIGHT_BLOCKED_RANGE_MSG;
    if (unavailable) {
      return "The selected dates include unavailable days. Please choose different dates.";
    }
    return "";
  }

  function rangeErrorEl() {
    var el = document.getElementById("availModalRangeError");
    if (el || !pickedSummary || !pickedSummary.parentNode) return el;
    el = document.createElement("p");
    el.id = "availModalRangeError";
    el.className = "date-range-alert";
    el.hidden = true;
    el.setAttribute("role", "alert");
    pickedSummary.insertAdjacentElement("afterend", el);
    return el;
  }

  function showRangeDateMessage(text) {
    var el = rangeErrorEl();
    var notice = window.ElenestCalendarWidget;
    var popup = text === OVERNIGHT_BLOCKED_RANGE_MSG;
    if (popup && notice && typeof notice.showDateNotice === "function") {
      notice.showDateNotice(text);
      if (el) {
        el.textContent = "";
        el.hidden = true;
      }
      return;
    }
    if (notice && typeof notice.hideDateNotice === "function") {
      notice.hideDateNotice();
    }
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  function rejectBlockedOvernightRange() {
    if (stayMode === "single" || !previewState.checkIn || !previewState.checkOut) return false;
    var message = previewRangeDateMessage(previewState.checkIn, previewState.checkOut);
    if (!message) return false;
    previewState.checkIn = null;
    previewState.checkOut = null;
    selectedUnitIds = [];
    facilityTabLocked = false;
    hideFacilityPicker();
    showRangeDateMessage(message);
    updatePickedSummary();
    notifyPreviewChanged();
    updateReserveButton();
    scheduleCalendarRender();
    return true;
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

  var restoringDraft = false;
  var publicDraftRestored = false;

  function notifyPreviewChanged() {
    try {
      window.dispatchEvent(
        new CustomEvent("elenest-avail-preview-changed", {
          detail: {
            checkIn: previewState.checkIn,
            checkOut: previewState.checkOut,
            stayMode: stayMode || "",
            unitId: selectedUnitIds[0] || "",
            unitIds: selectedUnitIds.slice()
          }
        })
      );
    } catch (e) {}
    if (!restoringDraft) savePublicDraft();
  }

  function updatePickedSummary() {
    if (!pickedSummary) return;
    if (!previewState.checkIn) {
      pickedSummary.textContent =
        (getPreferredStayMode() === "single"
          ? "One-Day Book: tap an available date, then choose a facility."
          : "Overnight Book: tap check-in, then a later check-out.") +
        " · " +
        guestPhrase();
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
    msg = guestPhrase() + " · " + msg;
    if (!selectedUnitIds.length) {
      if (datesReady()) msg += " · pick a facility below";
    } else {
      var names = selectedAvailUnits().map(function (unit) {
        return unit.name || unit.id;
      });
      if (names.length) msg += " · " + names.join(", ");
    }
    pickedSummary.textContent = msg;
  }

  function isHomeCalendar() {
    return !isLoginPage() && !isBookPage();
  }

  function updateReserveButton() {
    if (!reserveBtn) return;
    var ready = datesReady() && selectedUnitIds.length > 0;
    var showContinueSignIn = isHomeCalendar() && !isLoggedIn() && ready;
    reserveBtn.disabled = !ready;
    reserveBtn.setAttribute("aria-disabled", ready ? "false" : "true");
    if (showContinueSignIn) {
      reserveBtn.hidden = false;
      reserveBtn.removeAttribute("hidden");
      reserveBtn.textContent = "Continue Sign In";
    } else if (isHomeCalendar() && !isLoggedIn()) {
      reserveBtn.hidden = true;
      reserveBtn.setAttribute("hidden", "");
      reserveBtn.textContent = "Continue Sign In";
    } else {
      reserveBtn.hidden = false;
      reserveBtn.removeAttribute("hidden");
      if (isLoggedIn()) {
        reserveBtn.textContent = ready ? "Continue to booking" : "Select dates & facility";
      } else if (isLoginPage()) {
        reserveBtn.textContent = ready ? "Continue to Sign In" : "Select dates & facility";
      } else {
        reserveBtn.textContent = ready ? "Continue Sign In" : "Select dates & facility";
      }
    }
    renderAvailFacilityConfirm();
    syncStashedPreview();
  }

  function catalogUnitById(id) {
    var UA = window.ElenestUnitAvailability;
    var list = UA && typeof UA.getCatalog === "function" ? UA.getCatalog() || [] : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function selectedAvailUnits() {
    return selectedUnitIds.map(function (id) {
      return catalogUnitById(id) || { id: id, name: "Facility", type: "room" };
    });
  }

  function availRemoveIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
      '<path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>' +
      "</svg>"
    );
  }

  function renderAvailFacilityConfirm() {
    var section = document.getElementById("availModalConfirmSection");
    var body = document.getElementById("availModalConfirmBody");
    if (!section || !body) return;
    body.textContent = "";
    var units = selectedAvailUnits();
    if (!units.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    var box = document.createElement("div");
    box.className = "book-unit-confirm__box";
    units.forEach(function (unit) {
      var row = document.createElement("div");
      row.className = "book-unit-confirm__facility";
      var photo = document.createElement("span");
      photo.className = "book-unit-confirm__photo";
      var img = document.createElement("img");
      img.src = unitImageSrc(unit);
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      photo.appendChild(img);
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "book-unit-confirm__cancel";
      removeBtn.setAttribute("data-avail-remove-facility", String(unit.id));
      removeBtn.setAttribute("aria-label", "Remove " + (unit.name || "facility"));
      removeBtn.title = "Remove " + (unit.name || "facility");
      removeBtn.innerHTML = availRemoveIconSvg();
      photo.appendChild(removeBtn);
      var name = document.createElement("span");
      name.className = "book-unit-confirm__name";
      name.textContent = unit.name || "Facility";
      row.appendChild(photo);
      row.appendChild(name);
      box.appendChild(row);
    });
    body.appendChild(box);
  }

  function removeSelectedAvailFacility(id) {
    var key = String(id || "");
    selectedUnitIds = selectedUnitIds.filter(function (unitId) {
      return String(unitId) !== key;
    });
    if (facilityHost) {
      facilityHost.querySelectorAll(".avail-facility-card").forEach(function (card) {
        card.classList.toggle("is-selected", selectedUnitIds.indexOf(String(card.getAttribute("data-unit-id"))) !== -1);
      });
    }
    updatePickedSummary();
    notifyPreviewChanged();
    updateReserveButton();
  }

  var facilityCategoryFilter = "room";
  var facilityTabLocked = false;
  var guestCounts = { adults: 2, children: 0, childrenUnder6: 0 };
  var syncingGuests = false;
  var nightFitCache = null;

  function clampGuest(value, min, max) {
    var n = parseInt(value, 10);
    if (isNaN(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function guestTotal() {
    return guestCounts.adults + guestCounts.children;
  }

  function guestPhrase() {
    var n = guestTotal();
    return n + (n === 1 ? " guest" : " guests");
  }

  function readGuestsFromForm(form) {
    if (!form) return;
    var adults = form.querySelector('[name="adults"]');
    var children = form.querySelector('[name="children"]');
    var under6 = form.querySelector('[name="childrenUnder6"]');
    if (adults) guestCounts.adults = clampGuest(adults.value, 1, 150);
    if (children) {
      guestCounts.children = clampGuest(children.value === "" ? 0 : children.value, 0, 150);
    }
    if (under6) {
      guestCounts.childrenUnder6 = clampGuest(under6.value === "" ? 0 : under6.value, 0, 150);
    }
  }

  function writeGuestsToForms() {
    syncingGuests = true;
    try {
      document
        .querySelectorAll("#homeReserveForm, #bookReservePreviewForm, #loginReserveForm")
        .forEach(function (form) {
          var adults = form.querySelector('[name="adults"]');
          var children = form.querySelector('[name="children"]');
          var under6 = form.querySelector('[name="childrenUnder6"]');
          if (adults) adults.value = String(guestCounts.adults);
          if (children) children.value = String(guestCounts.children);
          if (under6) under6.value = String(guestCounts.childrenUnder6);
        });
    } finally {
      syncingGuests = false;
    }
  }

  function writeGuestSession() {
    try {
      sessionStorage.setItem("elenest_prefill_adults", String(guestCounts.adults));
      sessionStorage.setItem("elenest_prefill_children", String(guestCounts.children));
      sessionStorage.setItem("elenest_prefill_children_under6", String(guestCounts.childrenUnder6));
      var times = getAvailTimes();
      sessionStorage.setItem("elenest_prefill_arrival_time", times.arrival || "");
      sessionStorage.setItem("elenest_prefill_departure_time", times.departure || "");
    } catch (e) {}
  }

  function clearGuestSession() {
    try {
      sessionStorage.removeItem("elenest_prefill_adults");
      sessionStorage.removeItem("elenest_prefill_children");
      sessionStorage.removeItem("elenest_prefill_children_under6");
      sessionStorage.removeItem("elenest_prefill_arrival_time");
      sessionStorage.removeItem("elenest_prefill_departure_time");
    } catch (e) {}
  }

  function readGuestSession() {
    try {
      var adults = sessionStorage.getItem("elenest_prefill_adults");
      var children = sessionStorage.getItem("elenest_prefill_children");
      var under6 = sessionStorage.getItem("elenest_prefill_children_under6");
      if (adults == null && children == null && under6 == null) return null;
      return {
        adults: clampGuest(adults == null ? guestCounts.adults : adults, 1, 150),
        children: clampGuest(children == null ? 0 : children, 0, 150),
        childrenUnder6: clampGuest(under6 == null ? 0 : under6, 0, 150)
      };
    } catch (e) {
      return null;
    }
  }

  function applyGuestCounts(next) {
    if (!next) return;
    guestCounts.adults = clampGuest(next.adults, 1, 150);
    guestCounts.children = clampGuest(next.children, 0, 150);
    guestCounts.childrenUnder6 = clampGuest(
      next.childrenUnder6 == null ? guestCounts.childrenUnder6 : next.childrenUnder6,
      0,
      150
    );
    writeGuestsToForms();
    paintGuestBar();
  }

  function paintGuestInput(key) {
    var input = document.querySelector("[data-guest-input='" + key + "']");
    if (!input || document.activeElement === input) return;
    input.value = String(guestCounts[key]);
  }

  function paintGuestBar() {
    paintGuestInput("adults");
    paintGuestInput("children");
    paintGuestInput("childrenUnder6");
    var hint = document.getElementById("availModalGuestHint");
    modal.querySelectorAll("[data-guest-step='adults'][data-guest-dir='-1']").forEach(function (btn) {
      btn.disabled = guestCounts.adults <= 1;
    });
    modal.querySelectorAll("[data-guest-step='children'][data-guest-dir='-1']").forEach(function (btn) {
      btn.disabled = guestCounts.children <= 0;
    });
    modal.querySelectorAll("[data-guest-step='childrenUnder6'][data-guest-dir='-1']").forEach(function (btn) {
      btn.disabled = guestCounts.childrenUnder6 <= 0;
    });
    if (hint) {
      hint.textContent =
        "Filtering for " +
        guestPhrase() +
        ". Dates marked No fit have no facility for this guest count.";
    }
  }

  function commitGuestInput(input, allowEmpty) {
    if (!input) return;
    var key = input.getAttribute("data-guest-input");
    if (key !== "adults" && key !== "children" && key !== "childrenUnder6") return;
    var min = key === "adults" ? 1 : 0;
    if (input.value === "" && allowEmpty) return;
    guestCounts[key] = clampGuest(input.value === "" ? min : input.value, min, 150);
    input.value = String(guestCounts[key]);
  }

  function ensureGuestBar() {
    if (document.getElementById("availModalGuestBar")) return;
    var anchor =
      document.getElementById("availModalCalendarLead") ||
      modal.querySelector(".avail-modal__calendar-lead");
    if (!anchor || !anchor.parentNode) return;
    if (!anchor.id) anchor.id = "availModalCalendarLead";
    var bar = document.createElement("div");
    bar.id = "availModalGuestBar";
    bar.className = "avail-guest-bar";
    bar.innerHTML =
      '<div class="avail-guest-bar__field">' +
      '<label class="avail-guest-bar__label" for="availGuestAdults">Adults (13 years &amp; older)</label>' +
      '<div class="avail-guest-stepper" role="group" aria-labelledby="availGuestAdults">' +
      '<button type="button" data-guest-step="adults" data-guest-dir="-1" aria-label="Fewer adults">−</button>' +
      '<input id="availGuestAdults" data-guest-input="adults" type="number" min="1" max="150" inputmode="numeric" value="2" aria-label="Adults (13 years and older)">' +
      '<button type="button" data-guest-step="adults" data-guest-dir="1" aria-label="More adults">+</button>' +
      "</div></div>" +
      '<div class="avail-guest-bar__field">' +
      '<label class="avail-guest-bar__label" for="availGuestChildren">Children (6–12 years)</label>' +
      '<div class="avail-guest-stepper" role="group" aria-labelledby="availGuestChildren">' +
      '<button type="button" data-guest-step="children" data-guest-dir="-1" aria-label="Fewer children ages 6 to 12">−</button>' +
      '<input id="availGuestChildren" data-guest-input="children" type="number" min="0" max="150" inputmode="numeric" value="0" aria-label="Children ages 6 to 12">' +
      '<button type="button" data-guest-step="children" data-guest-dir="1" aria-label="More children ages 6 to 12">+</button>' +
      "</div></div>" +
      '<div class="avail-guest-bar__field">' +
      '<label class="avail-guest-bar__label" for="availGuestChildrenUnder6">Children (0–5 years)</label>' +
      '<div class="avail-guest-stepper" role="group" aria-labelledby="availGuestChildrenUnder6">' +
      '<button type="button" data-guest-step="childrenUnder6" data-guest-dir="-1" aria-label="Fewer children ages 0 to 5">−</button>' +
      '<input id="availGuestChildrenUnder6" data-guest-input="childrenUnder6" type="number" min="0" max="150" inputmode="numeric" value="0" aria-label="Children ages 0 to 5">' +
      '<button type="button" data-guest-step="childrenUnder6" data-guest-dir="1" aria-label="More children ages 0 to 5">+</button>' +
      "</div></div>" +
      '<p class="avail-guest-bar__note">Only <strong>Adults</strong> and <strong>Children (6–12 years)</strong> are counted for facility capacity and entrance fees. Children <strong>0–5 years are FREE</strong> and <strong>do not count toward facility capacity or entrance fees.</strong></p>' +
      '<p class="avail-guest-bar__hint" id="availModalGuestHint" aria-live="polite"></p>';
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    bar.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-guest-step]") : null;
      if (!btn || btn.disabled) return;
      var key = btn.getAttribute("data-guest-step");
      var dir = parseInt(btn.getAttribute("data-guest-dir"), 10) || 0;
      if (key === "adults") guestCounts.adults = clampGuest(guestCounts.adults + dir, 1, 150);
      else if (key === "children") guestCounts.children = clampGuest(guestCounts.children + dir, 0, 150);
      else if (key === "childrenUnder6") {
        guestCounts.childrenUnder6 = clampGuest(guestCounts.childrenUnder6 + dir, 0, 150);
      } else return;
      facilityTabLocked = false;
      writeGuestsToForms();
      paintGuestBar();
      scheduleCalendarRender();
      if (datesReady()) renderFacilityPicker();
      updatePickedSummary();
      notifyPreviewChanged();
      updateReserveButton();
      savePublicDraft();
    });
    bar.addEventListener("input", function (e) {
      var input = e.target && e.target.getAttribute && e.target.getAttribute("data-guest-input") ? e.target : null;
      if (!input) return;
      commitGuestInput(input, true);
      if (input.value === "") return;
      facilityTabLocked = false;
      writeGuestsToForms();
      paintGuestBar();
      nightFitCache = null;
      scheduleCalendarRender();
      if (datesReady()) renderFacilityPicker();
      updatePickedSummary();
      notifyPreviewChanged();
      updateReserveButton();
      savePublicDraft();
    });
    bar.addEventListener("focusout", function (e) {
      var input = e.target && e.target.getAttribute && e.target.getAttribute("data-guest-input") ? e.target : null;
      if (!input) return;
      commitGuestInput(input, false);
      writeGuestsToForms();
      paintGuestBar();
      savePublicDraft();
    });
  }

  function fillAvailTimeSelect(select, placeholder) {
    if (!select || select.getAttribute("data-filled") === "1") return;
    select.innerHTML = "";
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = placeholder;
    select.appendChild(blank);
    for (var h = 8; h <= 22; h++) {
      var hour = h % 12 || 12;
      var label = hour + ":00 " + (h < 12 ? "AM" : "PM");
      var opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.setAttribute("data-filled", "1");
  }

  function ensureStayTimes() {
    if (document.getElementById("availModalTimes")) return;
    var anchor = document.getElementById("availModalGuestBar") || document.getElementById("availModalCalendarLead");
    if (!anchor || !anchor.parentNode) return;
    var wrap = document.createElement("div");
    wrap.id = "availModalTimes";
    wrap.className = "avail-stay-times";
    wrap.innerHTML =
      '<div class="avail-stay-times__field" id="availDayScheduleWrap" hidden>' +
      '<div class="stay-schedule" role="group" aria-label="Check-in 8:00 AM, check-out 10:00 PM">' +
      '<div class="stay-schedule__card"><span class="stay-schedule__kicker">Check-in</span><span class="stay-schedule__time">' +
      DAY_ARRIVAL +
      "</span></div>" +
      '<div class="stay-schedule__card"><span class="stay-schedule__kicker">Check-out</span><span class="stay-schedule__time">' +
      DAY_DEPARTURE +
      "</span></div>" +
      "</div>" +
      '<input id="availDaySchedule" type="hidden" value="' +
      DAY_SCHEDULE_LABEL +
      '">' +
      "</div>" +
      '<div class="avail-stay-times__field" id="availArrivalWrap">' +
      '<label for="availArrivalTime">Arrival time (day of check-in)</label>' +
      '<select id="availArrivalTime"></select>' +
      "</div>" +
      '<div class="avail-stay-times__field" id="availDepartureWrap">' +
      '<label for="availDepartureTime">Departure time (day of check-out)</label>' +
      '<select id="availDepartureTime"></select>' +
      "</div>";
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    fillAvailTimeSelect(document.getElementById("availArrivalTime"), "Select arrival time");
    fillAvailTimeSelect(document.getElementById("availDepartureTime"), "Select departure time");
    wrap.addEventListener("change", function () {
      savePublicDraft();
      writeGuestSession();
    });
    syncAvailTimes(stayMode === "single" ? "single" : "range");
  }

  function getAvailTimes() {
    if (stayMode === "single") {
      return { arrival: DAY_ARRIVAL, departure: DAY_DEPARTURE };
    }
    var arrival = document.getElementById("availArrivalTime");
    var departure = document.getElementById("availDepartureTime");
    return {
      arrival: arrival && arrival.value ? arrival.value : "",
      departure: departure && departure.value ? departure.value : ""
    };
  }

  function applyAvailTimes(arrival, departure) {
    var arrivalEl = document.getElementById("availArrivalTime");
    var departureEl = document.getElementById("availDepartureTime");
    if (arrivalEl && arrival) arrivalEl.value = arrival;
    if (departureEl && departure) departureEl.value = departure;
  }

  function readPublicDraft() {
    try {
      var raw = localStorage.getItem(PUBLIC_DRAFT_KEY);
      if (!raw) return null;
      var draft = JSON.parse(raw);
      return draft && typeof draft === "object" ? draft : null;
    } catch (e) {
      return null;
    }
  }

  function savePublicDraft() {
    try {
      var times = getAvailTimes();
      localStorage.setItem(
        PUBLIC_DRAFT_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          stayMode: stayMode === "single" ? "single" : "range",
          checkIn: previewState.checkIn || "",
          checkOut: previewState.checkOut || "",
          adults: guestCounts.adults,
          children: guestCounts.children,
          childrenUnder6: guestCounts.childrenUnder6,
          unitIds: selectedUnitIds.slice(),
          arrivalTime: times.arrival || "",
          departureTime: times.departure || ""
        })
      );
    } catch (e) {}
  }

  function restorePublicDraft() {
    var draft = readPublicDraft();
    if (!draft) return;
    restoringDraft = true;
    try {
    applyGuestCounts({
      adults: draft.adults,
      children: draft.children,
      childrenUnder6: draft.childrenUnder6
    });
    if (draft.stayMode === "single" || draft.stayMode === "range") {
      stayMode = draft.stayMode;
      syncStayTypeRadios(stayMode);
    }
    if (draft.checkIn) previewState.checkIn = draft.checkIn;
    if (draft.checkOut) previewState.checkOut = draft.checkOut;
    if (Array.isArray(draft.unitIds)) {
      selectedUnitIds = draft.unitIds
        .map(function (id) {
          return String(id || "").trim();
        })
        .filter(Boolean);
    }
    applyAvailTimes(draft.arrivalTime, draft.departureTime);
    publicDraftRestored = true;
    notifyPreviewChanged();
    } finally {
      restoringDraft = false;
    }
  }

  function ensurePartyLegend() {
    if (document.getElementById("availModalPartyLegend")) return;
    var notes = modal.querySelector(".admin-dash-cal-legend");
    if (!notes) return;
    var li = document.createElement("li");
    li.id = "availModalPartyLegend";
    li.innerHTML =
      '<span class="avail-legend__swatch avail-legend__swatch--booked" aria-hidden="true"></span>' +
      '<span class="admin-dash-cal-legend__text">' +
      "<strong>No fit</strong>" +
      "<span>No room or facility fits your guest count on that date.</span>" +
      "</span>";
    notes.appendChild(li);
  }

  function ensureFacilityLead() {
    if (document.getElementById("availModalFacilityLead") || !facilitySection) return;
    var lead = document.createElement("p");
    lead.id = "availModalFacilityLead";
    lead.className = "avail-facility-section__lead";
    lead.hidden = true;
    if (facilityEmpty && facilityEmpty.parentNode === facilitySection) {
      facilitySection.insertBefore(lead, facilityEmpty);
    } else {
      facilitySection.appendChild(lead);
    }
  }

  function unitCaps(unit) {
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.getUnitCapacity === "function") return UA.getUnitCapacity(unit);
    var max = Number(unit && unit.capacity) || 0;
    var min = unit && unit.capacityMin != null ? Number(unit.capacityMin) : null;
    return { min: min, max: max };
  }

  function unitFitsParty(unit, pax) {
    var caps = unitCaps(unit);
    if (!caps.max || pax > caps.max) return false;
    if (caps.min != null && caps.min > 0 && pax < caps.min) return false;
    return true;
  }

  function unitCanCombine(unit, pax) {
    var caps = unitCaps(unit);
    if (!caps.max) return false;
    if (caps.min != null && caps.min > 0 && pax < caps.min) return false;
    return true;
  }

  function recommendCombo(availableItems, pax) {
    var pool = availableItems.filter(function (item) {
      return item && item.unit && unitCanCombine(item.unit, pax);
    });
    if (!pool.length) return null;
    var maxUnit = 0;
    pool.forEach(function (item) {
      var cap = unitCaps(item.unit).max;
      if (cap > maxUnit) maxUnit = cap;
    });
    var limit = pax + maxUnit;
    var best = new Array(limit + 1);
    best[0] = [];
    pool.forEach(function (item) {
      var cap = unitCaps(item.unit).max;
      var sum;
      for (sum = limit - cap; sum >= 0; sum--) {
        if (!best[sum]) continue;
        var next = sum + cap;
        var candidate = best[sum].concat([item]);
        if (!best[next] || candidate.length < best[next].length) best[next] = candidate;
      }
    });
    var chosen = null;
    var chosenSum = 0;
    var s;
    for (s = pax; s <= limit; s++) {
      if (!best[s]) continue;
      if (
        !chosen ||
        best[s].length < chosen.length ||
        (best[s].length === chosen.length && s < chosenSum)
      ) {
        chosen = best[s];
        chosenSum = s;
      }
    }
    if (!chosen || !chosen.length) return null;
    return { items: chosen, total: chosenSum };
  }

  function partyCanStay(list, pax) {
    var available = (list || []).filter(function (item) {
      return item && item.available && item.unit;
    });
    var direct = available.some(function (item) {
      return unitFitsParty(item.unit, pax);
    });
    if (direct) return true;
    return !!recommendCombo(available, pax);
  }

  function partyMissesNight(iso) {
    if (
      stayMode !== "single" &&
      previewState.checkIn &&
      !previewState.checkOut &&
      iso > previewState.checkIn
    ) {
      return false;
    }
    if (stayMode !== "single" && previewState.checkOut && iso === previewState.checkOut) {
      return false;
    }
    if (!nightFitCache) nightFitCache = {};
    if (Object.prototype.hasOwnProperty.call(nightFitCache, iso)) return nightFitCache[iso];
    var UA = window.ElenestUnitAvailability;
    var miss = false;
    if (UA && typeof UA.listUnitsWithAvailability === "function") {
      miss = !partyCanStay(UA.listUnitsWithAvailability(iso, addDaysIso(iso, 1)), guestTotal());
    }
    nightFitCache[iso] = miss;
    return miss;
  }

  function hideFacilityPicker() {
    selectedUnitIds = [];
    facilityCategoryFilter = "room";
    facilityTabLocked = false;
    if (facilitySection) facilitySection.hidden = true;
    if (facilityHost) facilityHost.textContent = "";
    if (facilityEmpty) facilityEmpty.hidden = true;
    var lead = document.getElementById("availModalFacilityLead");
    if (lead) {
      lead.hidden = true;
      lead.textContent = "";
    }
  }

  function unitCategory(unit) {
    var t = String((unit && unit.type) || "room").toLowerCase();
    if (t === "cottage") return "cottage";
    if (t === "hall") return "hall";
    return "room";
  }

  function facilityStatusLabel(item) {
    var status = item && item.status ? item.status : item && item.available ? "available" : "booked";
    if (status === "available") return "Available";
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.occupancyDisplayLabel === "function") {
      var label = UA.occupancyDisplayLabel(status);
      if (label) return label;
    }
    if (status === "pending") return "Pending Admin Confirmation";
    return "Booked";
  }

  function buildFacilityCardHtml(item, UA) {
    var unit = item.unit;
    var available = !!item.available;
    var recommended = !!item.recommended && available;
    var status = item && item.status ? item.status : available ? "available" : "booked";
    var selected = available && selectedUnitIds.indexOf(String(unit.id)) !== -1;
    var cap =
      typeof UA.formatCapacityLabel === "function" ? UA.formatCapacityLabel(unit) : "";
    return (
      '<button type="button" class="avail-facility-card' +
      (selected ? " is-selected" : "") +
      (recommended ? " avail-facility-card--recommended" : "") +
      (available ? "" : " avail-facility-card--unavailable") +
      '" data-unit-id="' +
      esc(unit.id) +
      '"' +
      (available ? "" : ' disabled aria-disabled="true"') +
      ">" +
      (recommended ? '<span class="avail-facility-card__badge">Recommended</span>' : "") +
      '<img class="avail-facility-card__img" src="' +
      esc(unitImageSrc(unit)) +
      '" alt="" loading="lazy">' +
      '<span class="avail-facility-card__body">' +
      '<span class="avail-facility-card__name">' +
      esc(unit.name || unit.id) +
      "</span>" +
      (cap ? '<span class="avail-facility-card__meta">' + esc(cap) + "</span>" : "") +
      '<span class="avail-facility-card__status' +
      (status === "pending" ? " avail-facility-card__status--pending" : "") +
      '">' +
      esc(recommended ? "Fits your group" : facilityStatusLabel(item)) +
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
    var pax = guestTotal();
    var available = list.filter(function (item) {
      return item && item.available && item.unit;
    });
    var fits = available.filter(function (item) {
      return unitFitsParty(item.unit, pax);
    });
    var bookedFit = list.filter(function (item) {
      return item && item.unit && !item.available && unitFitsParty(item.unit, pax);
    }).length;
    var combo = null;
    var display = fits;
    var recommendMode = "fit";

    if (fits.length) {
      var bestLeft = null;
      fits.forEach(function (item) {
        var left = unitCaps(item.unit).max - pax;
        if (bestLeft == null || left < bestLeft) bestLeft = left;
      });
      fits.forEach(function (item) {
        item.recommended = unitCaps(item.unit).max - pax === bestLeft;
      });
      fits.sort(function (a, b) {
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        return unitCaps(a.unit).max - unitCaps(b.unit).max;
      });
      display = fits;
    } else {
      combo = recommendCombo(available, pax);
      if (combo) {
        recommendMode = "combo";
        var recIds = {};
        combo.items.forEach(function (item) {
          recIds[String(item.unit.id)] = true;
        });
        display = available.filter(function (item) {
          return unitCanCombine(item.unit, pax);
        });
        display.forEach(function (item) {
          item.recommended = !!recIds[String(item.unit.id)];
        });
        display.sort(function (a, b) {
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          return unitCaps(b.unit).max - unitCaps(a.unit).max;
        });
      } else {
        display = [];
      }
    }

    var allowed = {};
    display.forEach(function (item) {
      if (item.available) allowed[String(item.unit.id)] = true;
    });
    selectedUnitIds = selectedUnitIds.filter(function (id) {
      return !!allowed[String(id)];
    });

    facilitySection.hidden = false;
    ensureFacilityLead();
    var leadEl = document.getElementById("availModalFacilityLead");
    if (facilityEmpty) facilityEmpty.hidden = true;
    if (!list.length) {
      if (leadEl) {
        leadEl.hidden = true;
        leadEl.textContent = "";
      }
      if (facilityEmpty) {
        facilityEmpty.hidden = false;
        facilityEmpty.textContent = "No facilities found. Try another date.";
      }
      facilityHost.innerHTML = "";
      updateReserveButton();
      return;
    }
    if (!display.length) {
      if (leadEl) {
        leadEl.hidden = true;
        leadEl.textContent = "";
      }
      if (facilityEmpty) {
        facilityEmpty.hidden = false;
        facilityEmpty.textContent = bookedFit
          ? "Every facility that fits " +
            pax +
            " guests is already booked for these dates."
          : "No room or facility fits " +
            pax +
            " guests. Try fewer guests or different dates.";
      }
      facilityHost.innerHTML = "";
      updateReserveButton();
      return;
    }

    if (leadEl) {
      leadEl.hidden = false;
      if (recommendMode === "combo" && combo) {
        var comboNames = combo.items.map(function (item) {
          return item.unit.name || item.unit.id;
        });
        leadEl.textContent =
          "No single facility fits " +
          pax +
          " guests. Recommended: " +
          comboNames.join(" + ") +
          " (up to " +
          combo.total +
          " pax).";
      } else {
        leadEl.textContent =
          "Showing " +
          display.length +
          " open " +
          (display.length === 1 ? "option" : "options") +
          " for " +
          pax +
          " guests. Recommended picks are the closest fit." +
          (bookedFit
            ? " " +
              bookedFit +
              " matching " +
              (bookedFit === 1 ? "facility is" : "facilities are") +
              " already booked."
            : "");
      }
    }

    var sections = [
      {
        key: "room",
        label: "Rooms",
        items: display.filter(function (item) {
          return unitCategory(item.unit) === "room";
        })
      },
      {
        key: "cottage",
        label: "Cottages",
        items: display.filter(function (item) {
          return unitCategory(item.unit) === "cottage";
        })
      },
      {
        key: "hall",
        label: "Event Hall",
        items: display.filter(function (item) {
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

    if (!facilityTabLocked) {
      var recItem = null;
      display.some(function (item) {
        if (item.recommended) {
          recItem = item;
          return true;
        }
        return false;
      });
      if (recItem) facilityCategoryFilter = unitCategory(recItem.unit);
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

    var recommendHtml = "";
    if (recommendMode === "combo" && combo) {
      recommendHtml =
        '<div class="avail-facility-recommend">' +
        '<button type="button" class="btn avail-facility-recommend__btn" data-avail-apply-recommend="' +
        combo.items
          .map(function (item) {
            return esc(item.unit.id);
          })
          .join(",") +
        '">Select recommendation</button></div>';
    }

    facilityHost.innerHTML = recommendHtml + tabsHtml + panelHtml;
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
    nightFitCache = {};
    window.ElenestCalendarWidget.render({
      host: calendarHost,
      monthLabel: monthLabel,
      calView: calView,
      wizardState: getCalendarWizardState(),
      // One-day stays pass check-out as null, so only the visit date is marked pink.
      highlightRange: true,
      showLiveOccupancy: true,
      hidePendingStatus: true,
      extraIsUnavailable: partyMissesNight,
      extraUnavailableTitle: "No facility fits " + guestPhrase() + " on this date",
      extraUnavailableStatus: "No fit",
      onDayClick: pickPreviewDate
    });
  }

  function setSingleDay(iso) {
    showRangeDateMessage("");
    previewState.checkIn = iso;
    previewState.checkOut = addDaysIso(iso, 1);
    stayMode = "single";
    selectedUnitIds = [];
    facilityTabLocked = false;
    if (facilityHost) facilityHost.textContent = "";
    syncStayTypeRadios("single");
  }

  function setOvernightStart(iso) {
    showRangeDateMessage("");
    previewState.checkIn = iso;
    previewState.checkOut = null;
    stayMode = "range";
    selectedUnitIds = [];
    facilityTabLocked = false;
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
          var rangeMsg = previewRangeDateMessage(previewState.checkIn, iso);
          if (rangeMsg) {
            previewState.checkIn = null;
            previewState.checkOut = null;
            selectedUnitIds = [];
            facilityTabLocked = false;
            if (facilityHost) facilityHost.textContent = "";
            hideFacilityPicker();
            showRangeDateMessage(rangeMsg);
            updatePickedSummary();
            notifyPreviewChanged();
            scheduleCalendarRender();
            updateReserveButton();
            return;
          }
          showRangeDateMessage("");
          previewState.checkOut = iso;
          selectedUnitIds = [];
          facilityTabLocked = false;
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
    selectedUnitIds =
      prefill && Array.isArray(prefill.unitIds) && prefill.unitIds.length
        ? prefill.unitIds.map(function (id) {
            return String(id);
          })
        : prefill && prefill.unitId
          ? [String(prefill.unitId)]
          : [];
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
      if (rejectBlockedOvernightRange()) return;
      scheduleCalendarRender();
      if (datesReady()) renderFacilityPicker();
      updateReserveButton();
    });
  }

  function closeModal() {
    var wasOpen = !modal.hidden;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("avail-modal-open");
    if (wasOpen && isLoginPage() && !isLoggedIn() && readStashedPreview()) {
      markLoginBookingNotice();
      showLoginContinueBanner();
    }
  }

  function pageName() {
    var path = String(window.location.pathname || "");
    var name = path.split("/").pop() || "";
    return name.replace(/\.html$/i, "").toLowerCase();
  }

  function isBookPage() {
    return pageName() === "book";
  }

  function isLoginPage() {
    return pageName() === "login";
  }

  function isLoggedIn() {
    return (
      window.ElenestAuth &&
      typeof window.ElenestAuth.isLoggedIn === "function" &&
      window.ElenestAuth.isLoggedIn()
    );
  }

  var LOGIN_BOOKING_NOTICE_KEY = "elenest_login_booking_notice";

  function markLoginBookingNotice() {
    try {
      sessionStorage.setItem(LOGIN_BOOKING_NOTICE_KEY, "1");
    } catch (e) {}
  }

  function hasLoginBookingNotice() {
    try {
      return sessionStorage.getItem(LOGIN_BOOKING_NOTICE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function hideLoginContinueBanner() {
    var banner = document.getElementById("loginReserveContinue");
    if (!banner) return;
    banner.hidden = true;
    banner.setAttribute("hidden", "");
    banner.textContent = "";
  }

  function showLoginContinueBanner() {
    var banner = document.getElementById("loginReserveContinue");
    if (!banner) return;
    if (!isLoginPage() || isLoggedIn() || !hasLoginBookingNotice()) {
      hideLoginContinueBanner();
      return;
    }
    var saved = readStashedPreview();
    if (!saved || !saved.checkIn || !saved.checkOut || !saved.unitIds || !saved.unitIds.length) {
      hideLoginContinueBanner();
      return;
    }
    banner.hidden = false;
    banner.removeAttribute("hidden");
    banner.innerHTML =
      "<strong>Dates &amp; facilities saved.</strong> Sign in below, or " +
      '<a href="register.html?next=' +
      encodeURIComponent("book.html") +
      '">create a guest account</a> to finish your booking.';
    try {
      var authCard = document.getElementById("loginForm") || document.querySelector(".auth-card");
      if (authCard) authCard.scrollIntoView({ behavior: "smooth", block: "start" });
      else banner.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
  }

  function revealSavedSelectionOnLogin() {
    if (!isLoginPage() || isLoggedIn() || !hasLoginBookingNotice()) {
      hideLoginContinueBanner();
      return;
    }
    var saved = readStashedPreview();
    if (!saved || !saved.checkIn || !saved.checkOut || !saved.unitIds.length) {
      hideLoginContinueBanner();
      return;
    }
    var form = document.getElementById("loginReserveForm");
    if (form) {
      var arrival = form.querySelector('[name="arrival"]');
      var departure = form.querySelector('[name="departure"]');
      if (arrival) arrival.value = saved.checkIn;
      if (departure) departure.value = saved.checkOut;
    }
    applyGuestCounts({ adults: saved.adults, children: saved.children });
    showLoginContinueBanner();
    var detail = {
      checkIn: saved.checkIn,
      checkOut: saved.checkOut,
      stayMode: saved.stayMode || "",
      unitId: saved.unitIds[0] || "",
      unitIds: saved.unitIds.slice()
    };
    setTimeout(function () {
      try {
        window.dispatchEvent(
          new CustomEvent("elenest-avail-preview-changed", { detail: detail })
        );
      } catch (e2) {}
    }, 0);
  }

  var RESERVED_FACILITIES_KEY = "elenest_reserved_facilities_v1";
  var facilityClickLockId = "";
  var facilityClickLockUntil = 0;
  var reserveClickLock = false;

  function uniqueFacilityIds(ids) {
    var seen = {};
    return (ids || [])
      .map(function (id) {
        return String(id || "").trim();
      })
      .filter(function (id) {
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
  }

  function rememberReservedFacilities(ci, co, mode, ids) {
    var unique = uniqueFacilityIds(ids);
    if (!ci || !co || !unique.length) return;
    var times = getAvailTimes();
    try {
      localStorage.setItem(
        RESERVED_FACILITIES_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          checkIn: ci,
          checkOut: co,
          stayMode: mode === "single" ? "single" : "range",
          unitIds: unique,
          adults: guestCounts.adults,
          children: guestCounts.children,
          childrenUnder6: guestCounts.childrenUnder6,
          arrivalTime: times.arrival || "",
          departureTime: times.departure || ""
        })
      );
    } catch (e) {}
  }

  function forgetReservedFacilities() {
    try {
      localStorage.removeItem(RESERVED_FACILITIES_KEY);
    } catch (e) {}
  }

  function stashPreviewForBooking() {
    try {
      if (!previewState.checkIn || !previewState.checkOut || !selectedUnitIds.length) return false;
      sessionStorage.setItem("elenest_prefill_checkin", previewState.checkIn);
      sessionStorage.setItem("elenest_prefill_checkout", previewState.checkOut);
      sessionStorage.setItem("elenest_prefill_unit_id", selectedUnitIds[0] || "");
      sessionStorage.setItem("elenest_prefill_unit_ids", JSON.stringify(selectedUnitIds));
      sessionStorage.setItem("elenest_prefill_stay_mode", stayMode === "single" ? "single" : "range");
      sessionStorage.setItem("elenest_avail_proceed", "1");
      writeGuestSession();
      rememberReservedFacilities(
        previewState.checkIn,
        previewState.checkOut,
        stayMode === "single" ? "single" : "range",
        selectedUnitIds
      );
      stashOwned = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearStashedPreview() {
    try {
      sessionStorage.removeItem("elenest_avail_proceed");
      sessionStorage.removeItem("elenest_prefill_checkin");
      sessionStorage.removeItem("elenest_prefill_checkout");
      sessionStorage.removeItem("elenest_prefill_unit_id");
      sessionStorage.removeItem("elenest_prefill_unit_ids");
      sessionStorage.removeItem("elenest_prefill_stay_mode");
      clearGuestSession();
      forgetReservedFacilities();
    } catch (e) {}
    stashOwned = false;
  }

  function syncStashedPreview() {
    if (datesReady() && selectedUnitIds.length) stashPreviewForBooking();
    else if (stashOwned) clearStashedPreview();
  }

  function readStashedPreview() {
    try {
      if (sessionStorage.getItem("elenest_avail_proceed") !== "1") return null;
      var ids = [];
      var raw = sessionStorage.getItem("elenest_prefill_unit_ids");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) ids = parsed;
      }
      if (!ids.length) {
        var one = sessionStorage.getItem("elenest_prefill_unit_id") || "";
        if (one) ids = [one];
      }
      var seen = {};
      ids = ids
        .map(function (id) {
          return String(id || "").trim();
        })
        .filter(function (id) {
          if (!id || seen[id]) return false;
          seen[id] = true;
          return true;
        });
      if (!ids.length) return null;
      var savedGuests = readGuestSession();
      return {
        checkIn: sessionStorage.getItem("elenest_prefill_checkin") || "",
        checkOut: sessionStorage.getItem("elenest_prefill_checkout") || "",
        stayMode: sessionStorage.getItem("elenest_prefill_stay_mode") || "",
        unitIds: ids,
        adults: savedGuests ? savedGuests.adults : guestCounts.adults,
        children: savedGuests ? savedGuests.children : guestCounts.children,
        childrenUnder6: savedGuests ? savedGuests.childrenUnder6 : guestCounts.childrenUnder6,
        arrivalTime: sessionStorage.getItem("elenest_prefill_arrival_time") || "",
        departureTime: sessionStorage.getItem("elenest_prefill_departure_time") || ""
      };
    } catch (e) {
      return null;
    }
  }

  function saveSelectionForSignIn() {
    var ci = previewState.checkIn;
    var co = previewState.checkOut;
    var mode = stayMode === "single" ? "single" : "range";
    var ids = selectedUnitIds.slice();
    var form = document.getElementById("homeReserveForm");
    if (form) {
      var arrival = form.querySelector('[name="arrival"]');
      var departure = form.querySelector('[name="departure"]');
      if (!ci && arrival && arrival.value) ci = arrival.value;
      if (!co && departure && departure.value) co = departure.value;
    }
    if (!ids.length) {
      var existing = readStashedPreview();
      if (
        existing &&
        existing.unitIds.length &&
        (!ci || ci === existing.checkIn) &&
        (!co || co === existing.checkOut)
      ) {
        ids = existing.unitIds.slice();
        if (!ci) ci = existing.checkIn;
        if (!co) co = existing.checkOut;
        if (existing.stayMode === "single" || existing.stayMode === "range") {
          mode = existing.stayMode;
        }
      }
    }
    if (!ci || !co) return false;
    try {
      var seen = {};
      ids = ids
        .map(function (id) {
          return String(id || "").trim();
        })
        .filter(function (id) {
          if (!id || seen[id]) return false;
          seen[id] = true;
          return true;
        });
      sessionStorage.setItem("elenest_prefill_checkin", ci);
      sessionStorage.setItem("elenest_prefill_checkout", co);
      sessionStorage.setItem("elenest_prefill_unit_id", ids[0] || "");
      sessionStorage.setItem("elenest_prefill_unit_ids", JSON.stringify(ids));
      sessionStorage.setItem("elenest_prefill_stay_mode", mode);
      sessionStorage.setItem("elenest_avail_proceed", "1");
      writeGuestSession();
      if (ids.length) {
        rememberReservedFacilities(ci, co, mode, ids);
        stashOwned = true;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function showAvailActionError(text) {
    var summary = document.getElementById("availModalPickedSummary");
    if (summary) summary.textContent = text;
  }

  function continueSignIn() {
    if (!saveSelectionForSignIn()) {
      showAvailActionError("Could not save your dates. Allow site storage for this page, then try again.");
      return false;
    }
    if (isLoggedIn()) {
      window.location.href = "book.html";
      return "leave";
    }
    markLoginBookingNotice();
    window.location.href = "login.html?next=" + encodeURIComponent("book.html");
    return "leave";
  }

  function proceedToBooking() {
    if (stayMode !== "single" && previewRangeDateMessage(previewState.checkIn, previewState.checkOut)) {
      rejectBlockedOvernightRange();
      return false;
    }
    if (!datesReady() || !selectedUnitIds.length) {
      updatePickedSummary();
      showAvailActionError("Select your dates and at least one facility to continue.");
      if (facilitySection && datesReady()) {
        try {
          facilitySection.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (e) {}
      }
      return false;
    }
    if (!stashPreviewForBooking()) {
      showAvailActionError("Could not save your selection. Allow site storage for this page, then try again.");
      return false;
    }
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
        return "stay";
      }
      window.location.href = "book.html";
      return "leave";
    }

    if (isLoginPage()) {
      markLoginBookingNotice();
      showLoginContinueBanner();
      return "stay";
    }

    markLoginBookingNotice();
    window.location.href = "login.html?next=" + encodeURIComponent("book.html");
    return "leave";
  }

  function openFromReserveForm(form) {
    readGuestsFromForm(form);
    writeGuestsToForms();
    paintGuestBar();
    nightFitCache = null;
    var prefill = {};
    if (form) {
      var arrival = form.querySelector('[name="arrival"]');
      var departure = form.querySelector('[name="departure"]');
      if (arrival && arrival.value) prefill.checkIn = arrival.value;
      if (departure && departure.value) prefill.checkOut = departure.value;
    }
    prefill.stayMode = getPreferredStayMode();
    var memoryIds = selectedUnitIds.slice();
    var datesMatchMemory =
      memoryIds.length &&
      previewState.checkIn &&
      previewState.checkOut &&
      (!prefill.checkIn || prefill.checkIn === previewState.checkIn) &&
      (!prefill.checkOut || prefill.checkOut === previewState.checkOut);
    if (datesMatchMemory) {
      if (!prefill.checkIn) prefill.checkIn = previewState.checkIn;
      if (!prefill.checkOut) prefill.checkOut = previewState.checkOut;
      prefill.stayMode = stayMode === "single" ? "single" : "range";
      prefill.unitIds = memoryIds;
    } else {
      var stashed = readStashedPreview();
      var datesMatchStash =
        stashed &&
        stashed.unitIds.length &&
        (!prefill.checkIn || prefill.checkIn === stashed.checkIn) &&
        (!prefill.checkOut || prefill.checkOut === stashed.checkOut);
      if (datesMatchStash) {
        if (!prefill.checkIn) prefill.checkIn = stashed.checkIn;
        if (!prefill.checkOut) prefill.checkOut = stashed.checkOut;
        if (stashed.stayMode === "single" || stashed.stayMode === "range") {
          prefill.stayMode = stashed.stayMode;
        }
        prefill.unitIds = stashed.unitIds;
      }
    }
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
    reserveBtn.addEventListener("click", function () {
      if (reserveClickLock) return;
      reserveClickLock = true;
      var BL = window.ElenestButtonLoading;
      function work() {
        var result;
        try {
          result = isHomeCalendar() && !isLoggedIn() ? continueSignIn() : proceedToBooking();
        } catch (err) {
          reserveClickLock = false;
          showAvailActionError("Could not continue. Please try again.");
          return;
        }
        if (result === "leave") return new Promise(function () {});
        reserveClickLock = false;
      }
      if (BL && typeof BL.run === "function") {
        BL.run(reserveBtn, work, "Please wait…").catch(function () {
          reserveClickLock = false;
          showAvailActionError("Could not continue. Please try again.");
        });
        return;
      }
      work();
    });
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.name) return;
    if (
      t.name !== "availStayType" &&
      t.name !== "loginReserveStayType" &&
      t.name !== "homeReserveStayType"
    ) {
      return;
    }
    var nextMode = t.value === "day_tour" ? "single" : "range";
    stayMode = nextMode;
    previewState.checkIn = null;
    previewState.checkOut = null;
    selectedUnitIds = [];
    if (facilityHost) facilityHost.textContent = "";
    hideFacilityPicker();
    syncStayTypeRadios(nextMode);
    updatePickedSummary();
    notifyPreviewChanged();
    updateReserveButton();
    savePublicDraft();
    if (!modal.hidden) scheduleCalendarRender();
  });

  if (facilityHost) {
    facilityHost.addEventListener("click", function (e) {
      var tabBtn =
        e.target && e.target.closest ? e.target.closest("[data-facility-tab]") : null;
      if (tabBtn) {
        facilityCategoryFilter = String(tabBtn.getAttribute("data-facility-tab") || "room");
        facilityTabLocked = true;
        renderFacilityPicker();
        return;
      }

      var applyBtn =
        e.target && e.target.closest ? e.target.closest("[data-avail-apply-recommend]") : null;
      if (applyBtn) {
        selectedUnitIds = String(applyBtn.getAttribute("data-avail-apply-recommend") || "")
          .split(",")
          .map(function (id) {
            return id.trim();
          })
          .filter(Boolean);
        renderFacilityPicker();
        updatePickedSummary();
        notifyPreviewChanged();
        updateReserveButton();
        return;
      }

      var btn = e.target && e.target.closest ? e.target.closest("[data-unit-id]") : null;
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      if (btn.classList.contains("avail-facility-card--unavailable")) return;
      var pickedId = String(btn.getAttribute("data-unit-id") || "");
      if (!pickedId) return;
      var now = Date.now();
      if (facilityClickLockId === pickedId && now < facilityClickLockUntil) return;
      facilityClickLockId = pickedId;
      facilityClickLockUntil = now + 500;
      if (selectedUnitIds.indexOf(pickedId) !== -1) return;
      selectedUnitIds.push(pickedId);
      facilityHost.querySelectorAll(".avail-facility-card").forEach(function (card) {
        card.classList.toggle(
          "is-selected",
          selectedUnitIds.indexOf(String(card.getAttribute("data-unit-id"))) !== -1
        );
      });
      updatePickedSummary();
      notifyPreviewChanged();
      updateReserveButton();
    });
  }

  var availConfirmBody = document.getElementById("availModalConfirmBody");
  if (availConfirmBody) {
    availConfirmBody.addEventListener("click", function (e) {
      var removeBtn =
        e.target && e.target.closest ? e.target.closest("[data-avail-remove-facility]") : null;
      if (!removeBtn) return;
      e.preventDefault();
      e.stopPropagation();
      removeSelectedAvailFacility(removeBtn.getAttribute("data-avail-remove-facility"));
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

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("#googleLoginBtn")) {
        if (datesReady() && selectedUnitIds.length) stashPreviewForBooking();
        return;
      }
      var loginLink = t.closest("#roleLoginTrigger");
      if (!loginLink) return;
      if (!datesReady() || !selectedUnitIds.length) return;
      stashPreviewForBooking();
      if (!isLoggedIn() && loginLink.tagName === "A") {
        loginLink.setAttribute("href", "login.html?next=" + encodeURIComponent("book.html"));
      }
    },
    true
  );

  var loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener(
      "submit",
      function () {
        if (datesReady() && selectedUnitIds.length) stashPreviewForBooking();
      },
      true
    );
  }

  var modalRefreshQueued = false;
  function softRefreshOpenModal(withFacilities) {
    if (modal.hidden || pickingLock || modalRefreshQueued) return;
    modalRefreshQueued = true;
    requestAnimationFrame(function () {
      modalRefreshQueued = false;
      if (modal.hidden || pickingLock) return;
      if (rejectBlockedOvernightRange()) return;
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

  revealSavedSelectionOnLogin();

  ensureGuestBar();
  ensureStayTimes();
  ensurePartyLegend();
  ensureFacilityLead();
  restorePublicDraft();
  if (!publicDraftRestored) {
  readGuestsFromForm(
    document.getElementById("homeReserveForm") ||
      document.getElementById("loginReserveForm") ||
      document.getElementById("bookReservePreviewForm")
  );
  var savedGuestsOnLoad = readGuestSession();
  if (savedGuestsOnLoad) applyGuestCounts(savedGuestsOnLoad);
  else paintGuestBar();
    syncStayTypeRadios(getPreferredStayMode());
    stayMode = getPreferredStayMode();
  } else {
    writeGuestsToForms();
    paintGuestBar();
  }

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (
      !t ||
      syncingGuests ||
      (t.name !== "adults" && t.name !== "children" && t.name !== "childrenUnder6")
    ) {
      return;
    }
    var form =
      t.closest &&
      t.closest("#homeReserveForm, #bookReservePreviewForm, #loginReserveForm");
    if (!form) return;
    readGuestsFromForm(form);
    writeGuestsToForms();
    paintGuestBar();
    nightFitCache = null;
    facilityTabLocked = false;
    if (modal.hidden) return;
    scheduleCalendarRender();
    if (datesReady()) renderFacilityPicker();
    updatePickedSummary();
    updateReserveButton();
    savePublicDraft();
  });

  window.ElenestAvailabilityModal = {
    open: openModal,
    close: closeModal,
    continueSignIn: continueSignIn
  };
})();
