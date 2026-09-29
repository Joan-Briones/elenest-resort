/**
 * Syncs the "Select dates" field with the availability calendar.
 */
(function () {
  var forms = document.querySelectorAll(
    "#homeReserveForm, #bookReservePreviewForm, #loginReserveForm"
  );
  if (!forms.length) return;

  function fmtShort(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short"
      });
    } catch (e) {
      return iso;
    }
  }

  function addDaysIso(iso, days) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return (
      d.getFullYear() +
      "-" +
      (m < 10 ? "0" : "") +
      m +
      "-" +
      (day < 10 ? "0" : "") +
      day
    );
  }

  function syncFormDates(form, checkIn, checkOut, stayMode) {
    var arrival = form.querySelector('[name="arrival"]');
    var departure = form.querySelector('[name="departure"]');
    var datesBtn = form.querySelector("[data-date-role='dates']");
    var label = datesBtn ? datesBtn.querySelector("[data-date-label]") : null;

    if (arrival) arrival.value = checkIn || "";
    if (departure) departure.value = checkOut || "";

    if (!label || !datesBtn) return;

    var single =
      stayMode === "single" ||
      (checkIn && checkOut && checkOut === addDaysIso(checkIn, 1) && stayMode !== "range");

    if (checkIn && checkOut && single) {
      label.textContent = fmtShort(checkIn) + " · 1 day";
      datesBtn.classList.add("is-filled");
    } else if (checkIn && checkOut) {
      label.textContent = fmtShort(checkIn) + " → " + fmtShort(checkOut);
      datesBtn.classList.add("is-filled");
    } else if (checkIn) {
      label.textContent = fmtShort(checkIn) + " · 1 day";
      datesBtn.classList.add("is-filled");
    } else {
      label.textContent = form.id === "loginReserveForm" ? "Open calendar" : "Select dates";
      datesBtn.classList.remove("is-filled");
    }
  }

  window.addEventListener("elenest-avail-preview-changed", function (ev) {
    var detail = (ev && ev.detail) || {};
    forms.forEach(function (form) {
      syncFormDates(form, detail.checkIn || null, detail.checkOut || null, detail.stayMode || "");
    });
  });
})();
