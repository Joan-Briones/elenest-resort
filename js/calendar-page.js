(function () {
  var calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var wizardState = { checkIn: null, checkOut: null };

  function render() {
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") {
      return;
    }
    window.ElenestCalendarWidget.render({
      host: "calendarHost",
      monthLabel: "calMonthLabel",
      calView: calView,
      wizardState: wizardState,
      highlightRange: false,
      showLiveOccupancy: true,
      onDayClick: function (iso) {
        try {
          sessionStorage.setItem("elenest_prefill_checkin", iso);
          sessionStorage.setItem("elenest_prefill_open_step", "2");
        } catch (e) {}
        window.location.href =
          "book.html?checkin=" + encodeURIComponent(iso) + "&step=2";
      }
    });
  }

  var prev = document.getElementById("calPrev");
  var next = document.getElementById("calNext");
  if (prev) {
    prev.addEventListener("click", function () {
      calView.m--;
      if (calView.m < 0) {
        calView.m = 11;
        calView.y--;
      }
      render();
    });
  }
  if (next) {
    next.addEventListener("click", function () {
      calView.m++;
      if (calView.m > 11) {
        calView.m = 0;
        calView.y++;
      }
      render();
    });
  }

  render();
})();
