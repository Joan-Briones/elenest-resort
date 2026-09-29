/**
 * Admin Reservation Queue calendar.
 * Dates open the rooms for that night. A room opens its requests in submit order.
 */
(function () {
  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var now = new Date();
  var state = {
    bookings: [],
    year: now.getFullYear(),
    month: now.getMonth(),
    selectedDate: "",
    tab: "room",
    viewKey: "",
    loadedOnce: false
  };
  var bound = false;

  function isoFromDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function parseIso(iso) {
    var parts = String(iso || "").slice(0, 10).split("-");
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function addDays(iso, days) {
    var d = parseIso(iso);
    if (!d) return "";
    d.setDate(d.getDate() + days);
    return isoFromDate(d);
  }

  function todayIso() {
    return isoFromDate(new Date());
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var FACILITY_GROUPS = [
    { type: "room", label: "Rooms" },
    { type: "cottage", label: "Cottages" },
    { type: "hall", label: "Event Halls" }
  ];

  function facilityType(unit) {
    var type = String((unit && unit.type) || "room");
    if (type === "cottage" || type === "hall") return type;
    return "room";
  }

  function facilityNoun(unit) {
    var type = facilityType(unit);
    if (type === "cottage") return "cottage";
    if (type === "hall") return "event hall";
    return "room";
  }

  function facilities() {
    var UA = window.ElenestUnitAvailability;
    var list = UA && typeof UA.getCatalog === "function" ? UA.getCatalog() : [];
    return list
      .filter(function (unit) {
        var type = facilityType(unit);
        return type === "room" || type === "cottage" || type === "hall";
      })
      .slice()
      .sort(function (a, b) {
        return String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { numeric: true });
      });
  }

  function roomById(id) {
    var wanted = String(id || "").toLowerCase();
    var found = null;
    facilities().some(function (unit) {
      if (String(unit.id || "").toLowerCase() === wanted) {
        found = unit;
        return true;
      }
      return false;
    });
    return found;
  }

  function bookingRoomIds(b) {
    var ids = [];
    function add(value) {
      var s = String(value || "").trim().toLowerCase();
      if (s && s !== "none" && s !== "no" && ids.indexOf(s) === -1) ids.push(s);
    }
    if (!b) return ids;
    add(b.roomCatalogId);
    add(b.queueRoomId);
    add(b.cottageCatalogId);
    add(b.hallCatalogId);
    (b.roomCatalogIds || []).forEach(add);
    (b.cottageCatalogIds || []).forEach(add);
    (b.hallCatalogIds || []).forEach(add);
    (b.room_ids || []).forEach(add);
    (b.facilityIds || []).forEach(add);
    return ids;
  }

  function isClosed(b) {
    var st = String((b && b.status) || "").toLowerCase();
    return (
      st === "cancelled" ||
      st === "canceled" ||
      st === "rejected" ||
      st === "no show" ||
      st === "no_show" ||
      st === "completed" ||
      st === "checked out" ||
      st === "checked_out" ||
      st === "checked-out"
    );
  }

  function coversDate(b, iso) {
    var start = String((b && b.checkIn) || "").slice(0, 10);
    var end = String((b && b.checkOut) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
    return start <= iso && iso < end;
  }

  function toneOfBooking(b) {
    var st = String((b && b.status) || "").toLowerCase();
    if (st === "checked in" || st === "checked_in") return "unavailable";
    if (st === "confirmed" || st === "reserved" || st === "approved" || st === "active") return "reserved";
    return "pending";
  }

  function requestMillis(b) {
    var raw = b && (b.requestedAt || b.submittedAt || b.createdAt || "");
    var t = Date.parse(String(raw || ""));
    return isNaN(t) ? 8640000000000000 : t;
  }

  function requestsFor(roomId, iso) {
    var wanted = String(roomId || "").toLowerCase();
    return state.bookings
      .filter(function (b) {
        if (!b || !coversDate(b, iso)) return false;
        return bookingRoomIds(b).indexOf(wanted) !== -1;
      })
      .sort(function (a, b) {
        var at = requestMillis(a);
        var bt = requestMillis(b);
        if (at !== bt) return at - bt;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
  }

  function activeRequestsFor(roomId, iso) {
    return requestsFor(roomId, iso).filter(function (b) {
      return !isClosed(b);
    });
  }

  function roomTone(roomId, iso) {
    var Av = window.ElenestAvailability;
    if (Av && typeof Av.getManagerBlocked === "function" && Av.getManagerBlocked(iso)) return "unavailable";
    var active = activeRequestsFor(roomId, iso);
    if (!active.length) return "available";
    var rank = { pending: 1, reserved: 2, unavailable: 3 };
    var best = "pending";
    active.forEach(function (b) {
      var tone = toneOfBooking(b);
      if (rank[tone] > rank[best]) best = tone;
    });
    return best;
  }

  function dayTone(iso) {
    var Av = window.ElenestAvailability;
    if (Av && typeof Av.getManagerBlocked === "function" && Av.getManagerBlocked(iso)) return "unavailable";
    var list = facilities();
    if (!list.length) return "available";
    var counts = { available: 0, pending: 0, reserved: 0, unavailable: 0 };
    list.forEach(function (unit) {
      counts[roomTone(unit.id, iso)] += 1;
    });
    if (!counts.available) return "unavailable";
    if (counts.reserved) return "reserved";
    if (counts.pending) return "pending";
    return "available";
  }

  function formatLongDate(iso) {
    var d = parseIso(iso);
    if (!d) return "Select a date";
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatClock(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (/am|pm/i.test(s)) return s.replace(/\s+/g, " ").replace(/am/gi, "AM").replace(/pm/gi, "PM");
    var parts = s.split(":");
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1] || "0", 10);
    if (isNaN(h) || isNaN(m)) return s;
    var ap = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }

  function stayTime(b) {
    var a = formatClock(b.checkInTime);
    var c = formatClock(b.checkOutTime);
    if (a && c) return a + " – " + c;
    return a || c || "Time not set";
  }

  function formatRequestTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Time not recorded";
    return d.toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }

  function guestLabel(b) {
    var adults = parseInt(b.adults, 10) || 0;
    var children = parseInt(b.children, 10) || 0;
    var under = parseInt(b.childrenUnder6, 10) || 0;
    var total = adults + children + under;
    if (!total) {
      var cap = parseInt(b.capacityTotal, 10) || parseInt(b.guests, 10) || 0;
      return cap ? cap + " guests" : "Guests not set";
    }
    var parts = [];
    if (adults) parts.push(adults + (adults === 1 ? " adult" : " adults"));
    if (children) parts.push(children + (children === 1 ? " child" : " children"));
    if (under) parts.push(under + " under 6");
    return total + " (" + parts.join(", ") + ")";
  }

  function isNotified(b) {
    return !!(b && (b.roomNotifiedAt || b.room_notified_at));
  }

  function isConfirmedStatus(b) {
    var status = String((b && b.status) || "").toLowerCase();
    return status === "confirmed" || status === "approved" || status === "active";
  }

  function statusClass(b) {
    var cls = "rq-status";
    if (isConfirmedStatus(b) || isNotified(b)) cls += " rq-status--notified";
    return cls;
  }

  function statusLabel(b) {
    var status = String(b.status || "Pending");
    var role = String(b.queueRole || "").toLowerCase();
    if (isNotified(b) && (role === "unavailable" || role === "queued" || role === "next")) {
      return status + " · Notified";
    }
    if (role === "hold") return status + " · Holding the room";
    if (role === "next") return status + " · Next in queue";
    if (role === "queued") return status + " · Waiting";
    return status;
  }

  function ordinal(n) {
    var names = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
    if (n > 0 && n < names.length) return names[n];
    return n + "th";
  }

  function reserveRankLabel(index) {
    if (index === 0) return "Reserved first";
    return ordinal(index + 1) + " request";
  }

  function collectBookings() {
    var B = window.ElenestBookings;
    if (!B || typeof B.listLive !== "function") return [];
    return B.listLive()
      .map(function (item) {
        var booking = item && item.booking;
        if (booking && item.accountEmail && !booking.email) booking.email = item.accountEmail;
        return booking;
      })
      .filter(function (b) {
        return b && b.id && String(b.id).indexOf("past-") !== 0;
      });
  }

  function goToPayment(id) {
    if (!id) return;
    window.location.hash = "#section-payments?booking=" + encodeURIComponent(id);
  }

  function needsAnotherFacility(b) {
    var role = String((b && (b.queueRole || b.guestQueueRole)) || "").toLowerCase();
    return role === "unavailable";
  }

  function anotherFacilityMessage(unit) {
    var kind = facilityNoun(unit);
    if (kind === "cottage") {
      return "This cottage is unavailable for your selected date and time. Please select another available cottage.";
    }
    if (kind === "event hall") {
      return "This event hall is unavailable for your selected date and time. Please select another available event hall.";
    }
    return "This room is unavailable for your selected date and time. Please select another available room.";
  }

  function selectAnotherEmailUrl() {
    var path = String(window.location.pathname || "");
    if (path.indexOf("/html/") !== -1) return "../api/send-select-another.php";
    return "api/send-select-another.php";
  }

  function askConfirm(title, text) {
    if (window.Swal && typeof window.Swal.fire === "function") {
      return window.Swal.fire({
        icon: "question",
        title: title,
        text: text,
        showCancelButton: true,
        confirmButtonText: "Notify",
        cancelButtonText: "Cancel",
        confirmButtonColor: "#a14b63"
      }).then(function (result) {
        return !!(result && result.isConfirmed);
      });
    }
    return Promise.resolve(window.confirm(text));
  }

  function tellAdmin(icon, title, text) {
    if (window.Swal && typeof window.Swal.fire === "function") {
      return window.Swal.fire({
        icon: icon,
        title: title,
        text: text,
        confirmButtonColor: "#a14b63"
      });
    }
    window.alert(text);
    return Promise.resolve();
  }

  function notifyGuest(b, unit, btn) {
    var email = String((b && (b.email || b.accountEmail)) || "").trim();
    var name = (b && (b.fullName || b.full_name)) || "Guest";
    var message = anotherFacilityMessage(unit);
    var kind = facilityNoun(unit);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      tellAdmin("error", "No email", "This guest has no email address, so the notice cannot be sent.");
      return;
    }
    askConfirm(
      "Notify guest?",
      "Email " + name + " and add a notification asking them to select another " + kind + "."
    ).then(function (ok) {
      if (!ok) return;
      if (btn) btn.disabled = true;
      if (window.ElenestNotifications && typeof window.ElenestNotifications.notifySelectAnother === "function") {
        window.ElenestNotifications.notifySelectAnother(email, b, message);
      }
      return fetch(selectAnotherEmailUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          name: name,
          facility: (unit && unit.name) || "",
          facility_kind: kind,
          check_in: formatLongDate(String((b && b.checkIn) || "").slice(0, 10)),
          check_out: formatLongDate(String((b && b.checkOut) || "").slice(0, 10)),
          message: message,
          booking_id: b && b.id ? String(b.id) : ""
        })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.message) || "Could not send email.");
          }
          return data;
        }, function () {
          throw new Error("Invalid response from email server.");
        });
      }).then(function () {
        return markNotified(b).then(function () {
          tellAdmin(
            "success",
            "Guest notified",
            "Email sent to " + email + ". Status is now Notified."
          );
        });
      }).catch(function (err) {
        return markNotified(b).then(function () {
          tellAdmin(
            "warning",
            "Notification saved",
            "Status is now Notified, but the email could not be sent" +
              (err && err.message ? ": " + err.message : ".")
          );
        });
      });
    });
  }

  function markNotified(b) {
    if (!b) return Promise.resolve(false);
    var stamp = new Date().toISOString();
    b.roomNotifiedAt = stamp;
    state.bookings = collectBookings();
    paint();
    var B = window.ElenestBookings;
    if (!B || typeof B.updateById !== "function" || !b.id) return Promise.resolve(false);
    return B.updateById(b.id, { roomNotifiedAt: stamp }).catch(function () {
      return false;
    });
  }

  function notifyButton(b, unit) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--outline btn--small";
    btn.textContent = "Notify";
    btn.addEventListener("click", function () {
      notifyGuest(b, unit, btn);
    });
    return btn;
  }

  function tabUnits() {
    return facilities().filter(function (unit) {
      return facilityType(unit) === state.tab;
    });
  }

  function monthDates() {
    var count = new Date(state.year, state.month + 1, 0).getDate();
    var list = [];
    for (var day = 1; day <= count; day++) {
      list.push(isoFromDate(new Date(state.year, state.month, day)));
    }
    return list;
  }

  function overlapCount(iso) {
    var max = 0;
    tabUnits().forEach(function (unit) {
      var count = activeRequestsFor(unit.id, iso).length;
      if (count > max) max = count;
    });
    return max;
  }

  function doubleGroups(dates) {
    var groups = [];
    (dates || []).forEach(function (iso) {
      tabUnits().forEach(function (unit) {
        var reqs = activeRequestsFor(unit.id, iso);
        if (reqs.length >= 2) groups.push({ iso: iso, unit: unit, requests: reqs });
      });
    });
    groups.sort(function (a, b) {
      var at = requestMillis(a.requests[0]);
      var bt = requestMillis(b.requests[0]);
      if (at !== bt) return at - bt;
      if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
      return String(a.unit.name || a.unit.id).localeCompare(String(b.unit.name || b.unit.id), undefined, { numeric: true });
    });
    return groups;
  }

  function paintCalendar() {
    var host = document.getElementById("rqCalendar");
    var title = document.getElementById("rqCalTitle");
    if (!host) return;
    if (title) title.textContent = MONTHS[state.month] + " " + state.year;
    host.textContent = "";
    var first = new Date(state.year, state.month, 1);
    var start = new Date(first);
    start.setDate(1 - first.getDay());
    var today = todayIso();
    if (state.selectedDate && state.selectedDate < today) state.selectedDate = "";
    var days = [];
    for (var i = 0; i < 42; i++) {
      var date = new Date(start);
      date.setDate(start.getDate() + i);
      days.push(date);
    }
    while (days.length >= 7) {
      var week = days.slice(days.length - 7);
      var inMonth = week.some(function (d) { return d.getMonth() === state.month; });
      if (inMonth) break;
      days.length -= 7;
    }
    days.forEach(function (date) {
      var iso = isoFromDate(date);
      var overlap = overlapCount(iso);
      var outside = date.getMonth() !== state.month;
      var past = iso < today;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "rq-day" +
        (outside ? " is-outside" : "") +
        (past ? " is-past" : "") +
        (iso === state.selectedDate ? " is-selected" : "") +
        (iso === today ? " is-today" : "") +
        (overlap >= 2 ? " has-note" : "");
      btn.disabled = past;
      btn.setAttribute("aria-pressed", iso === state.selectedDate ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        formatLongDate(iso) + (past ? ", past" : "") + (overlap >= 2 ? ", " + overlap + " requests" : "")
      );
      btn.appendChild(el("span", "rq-day__num", String(date.getDate())));
      if (overlap >= 2) {
        btn.appendChild(el("span", "rq-day__note", overlap + " requests"));
      }
      if (!past) {
        btn.addEventListener("click", function (picked) {
          return function () {
            var pickedDate = parseIso(picked);
            if (pickedDate) {
              state.year = pickedDate.getFullYear();
              state.month = pickedDate.getMonth();
            }
            state.selectedDate = state.selectedDate === picked ? "" : picked;
            state.viewKey = "";
            paint();
          };
        }(iso));
      }
      host.appendChild(btn);
    });
  }

  function paintDoubles() {
    var host = document.getElementById("rqDoubles");
    if (!host) return;
    host.textContent = "";

    var head = el("div", "rq-panel__head rq-doubles__head");
    var titles = el("div");
    titles.appendChild(el("p", "rq-panel__kicker", "Double bookings"));
    titles.appendChild(el("h3", "rq-panel__title", state.selectedDate ? formatLongDate(state.selectedDate) : MONTHS[state.month] + " " + state.year));
    titles.appendChild(el("p", "rq-panel__lead", "Same facility and date are grouped by reservation time. The earliest request is Reserved first."));
    head.appendChild(titles);
    if (state.selectedDate) {
      var clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn--outline btn--small";
      clearBtn.textContent = "Show all this month";
      clearBtn.addEventListener("click", function () {
        state.selectedDate = "";
        state.viewKey = "";
        paint();
      });
      head.appendChild(clearBtn);
    }
    host.appendChild(head);

    var tabs = el("div", "rq-tabs");
    tabs.setAttribute("role", "tablist");
    FACILITY_GROUPS.forEach(function (group) {
      var previous = state.tab;
      state.tab = group.type;
      var count = doubleGroups(state.selectedDate ? [state.selectedDate] : monthDates()).length;
      state.tab = previous;
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "rq-tab" + (state.tab === group.type ? " is-active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", state.tab === group.type ? "true" : "false");
      tab.appendChild(document.createTextNode(group.label));
      tab.appendChild(el("span", "rq-tab__count", String(count)));
      tab.addEventListener("click", function () {
        state.tab = group.type;
        state.viewKey = "";
        paint();
      });
      tabs.appendChild(tab);
    });
    host.appendChild(tabs);

    var dates = state.selectedDate ? [state.selectedDate] : monthDates();
    var groups = doubleGroups(dates);
    if (!groups.length) {
      var empty = el("div", "rq-empty-card");
      empty.appendChild(el("p", "rq-empty-card__title", "No double bookings"));
      empty.appendChild(el("p", "rq-empty", state.selectedDate
        ? "This date has no facility with two or more requests."
        : "This month has no facility with two or more requests."));
      host.appendChild(empty);
      return;
    }

    var wrap = el("div", "rq-table-wrap");
    var table = document.createElement("table");
    table.className = "rq-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Facility", "Customer", "Reservation date", "Stay time", "Reserved at", "Guests", "Who reserved", "Status", "Actions"].forEach(function (label) {
      headRow.appendChild(el("th", "", label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    groups.forEach(function (group) {
      var first = group.requests[0];
      var firstName = (first && (first.fullName || first.full_name)) || "Guest";
      var band = document.createElement("tr");
      band.className = "rq-group";
      var bandCell = document.createElement("td");
      bandCell.colSpan = 9;
      bandCell.textContent =
        (group.unit.name || group.unit.id) +
        " · " +
        formatLongDate(group.iso) +
        " — " +
        firstName +
        " reserved first at " +
        formatRequestTime(first && (first.requestedAt || first.submittedAt || first.createdAt));
      band.appendChild(bandCell);
      tbody.appendChild(band);
      group.requests.forEach(function (b, index) {
        var key = group.unit.id + "|" + group.iso + "|" + b.id;
        var open = state.viewKey === key;
        var tr = document.createElement("tr");
        tr.className = (index === 0 ? "rq-row--first" : "") + (open ? " is-open" : "");
        tr.appendChild(el("td", "rq-strong", group.unit.name || group.unit.id));
        tr.appendChild(el("td", "rq-strong", b.fullName || b.full_name || "Guest"));
        tr.appendChild(el("td", "", formatLongDate(group.iso)));
        tr.appendChild(el("td", "", stayTime(b)));
        tr.appendChild(el("td", index === 0 ? "rq-strong" : "rq-muted", formatRequestTime(b.requestedAt || b.submittedAt || b.createdAt)));
        tr.appendChild(el("td", "", guestLabel(b)));
        var orderTd = document.createElement("td");
        orderTd.appendChild(el("span", "rq-order" + (index === 0 ? " rq-order--first" : ""), reserveRankLabel(index)));
        tr.appendChild(orderTd);
        var statusTd = document.createElement("td");
        statusTd.appendChild(el("span", statusClass(b), statusLabel(b)));
        tr.appendChild(statusTd);
        var actions = document.createElement("td");
        var actionRow = el("div", "rq-table__actions");
        var viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "btn btn--outline btn--small";
        viewBtn.textContent = open ? "Hide" : "View";
        viewBtn.addEventListener("click", function () {
          state.viewKey = open ? "" : key;
          paintDoubles();
        });
        var payBtn = document.createElement("button");
        payBtn.type = "button";
        payBtn.className = "btn btn--small rq-pay-btn";
        payBtn.textContent = "Go to Payment Management";
        payBtn.addEventListener("click", function () {
          goToPayment(b.id);
        });
        actionRow.appendChild(viewBtn);
        if (needsAnotherFacility(b)) actionRow.appendChild(notifyButton(b, group.unit));
        actionRow.appendChild(payBtn);
        actions.appendChild(actionRow);
        tr.appendChild(actions);
        tbody.appendChild(tr);
        tbody.appendChild(queueExtraRow(b, group, index));

        if (open) {
          var detail = document.createElement("tr");
          detail.className = "rq-table__detail";
          var cell = document.createElement("td");
          cell.colSpan = 9;
          var panel = el("div", "rq-detail");
          panel.appendChild(detailRow("Customer", b.fullName || b.full_name || "Guest"));
          panel.appendChild(detailRow("Email", b.email || "—"));
          panel.appendChild(detailRow("Phone", b.phone || b.contactNumber || "—"));
          panel.appendChild(detailRow("Booking ID", b.id || "—"));
          panel.appendChild(detailRow("Facility", group.unit.name || group.unit.id));
          panel.appendChild(detailRow("Reservation date", formatLongDate(String(b.checkIn || "").slice(0, 10))));
          panel.appendChild(detailRow("Stay time", stayTime(b)));
          panel.appendChild(detailRow("Reserved at", formatRequestTime(b.requestedAt || b.submittedAt || b.createdAt)));
          panel.appendChild(detailRow("Who reserved", reserveRankLabel(index) + " of " + group.requests.length));
          panel.appendChild(detailRow("Guests", guestLabel(b)));
          panel.appendChild(detailRow("Status", statusLabel(b)));
          panel.appendChild(detailRow("Queue note", b.queueMessage || b.guestQueueMessage || "—"));
          panel.appendChild(detailRow("Payment", (b.paymentType || "—") + (b.paymentStatus ? " · " + b.paymentStatus : "")));
          panel.appendChild(detailRow("Notes", b.notes || b.specialRequests || "None"));
          var detailActions = el("div", "rq-request__actions");
          var payDetail = document.createElement("button");
          payDetail.type = "button";
          payDetail.className = "btn btn--small rq-pay-btn";
          payDetail.textContent = "Go to Payment Management";
          payDetail.addEventListener("click", function () {
            goToPayment(b.id);
          });
          if (needsAnotherFacility(b)) detailActions.appendChild(notifyButton(b, group.unit));
          detailActions.appendChild(payDetail);
          panel.appendChild(detailActions);
          cell.appendChild(panel);
          detail.appendChild(cell);
          tbody.appendChild(detail);
        }
      });
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function queueExtraRow(b, group, index) {
    var extra = document.createElement("tr");
    extra.className = "m-record-extra";
    extra.hidden = true;
    var cell = document.createElement("td");
    cell.colSpan = 9;
    var dl = document.createElement("dl");
    function addPair(label, value) {
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      dd.textContent = value || "—";
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    addPair("Email", b.email || "");
    addPair("Phone", b.phone || b.contactNumber || "");
    addPair("Booking ID", b.id || "");
    addPair("Queue note", b.queueMessage || b.guestQueueMessage || "");
    addPair("Payment", (b.paymentType || "—") + (b.paymentStatus ? " · " + b.paymentStatus : ""));
    addPair("Notes", b.notes || b.specialRequests || "None");
    addPair("Who reserved", reserveRankLabel(index) + " of " + group.requests.length);
    cell.appendChild(dl);
    extra.appendChild(cell);
    return extra;
  }

  function detailRow(label, value) {
    var row = el("div", "rq-detail__row");
    row.appendChild(el("span", "rq-detail__label", label));
    row.appendChild(el("span", "rq-detail__value", value || "—"));
    return row;
  }

  function paint() {
    var lead = document.getElementById("adminReservationQueueLead");
    if (lead) {
      lead.textContent = "A date shows a note only when the same facility has two or more requests. Use the tabs to switch between rooms, cottages, and event halls.";
    }
    paintCalendar();
    paintDoubles();
  }

  function shiftMonth(delta) {
    var d = new Date(state.year, state.month + delta, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    state.selectedDate = "";
    state.viewKey = "";
    paint();
  }

  function bind() {
    if (bound) return;
    bound = true;
    var prev = document.getElementById("rqCalPrev");
    var next = document.getElementById("rqCalNext");
    var today = document.getElementById("rqCalToday");
    var refresh = document.getElementById("adminReservationQueueRefresh");
    if (prev) prev.addEventListener("click", function () { shiftMonth(-1); });
    if (next) next.addEventListener("click", function () { shiftMonth(1); });
    if (today) {
      today.addEventListener("click", function () {
        var d = new Date();
        state.year = d.getFullYear();
        state.month = d.getMonth();
        state.selectedDate = isoFromDate(d);
        state.viewKey = "";
        paint();
      });
    }
    if (refresh) {
      refresh.addEventListener("click", function () {
        var B = window.ElenestBookings;
        if (!B || typeof B.refresh !== "function") {
          state.bookings = collectBookings();
          paint();
          return;
        }
        refresh.disabled = true;
        B.refresh()
          .then(function () {
            state.bookings = collectBookings();
            paint();
          })
          .catch(function () {
            state.bookings = collectBookings();
            paint();
          })
          .then(function () {
            refresh.disabled = false;
          });
      });
    }
  }

  function renderSection() {
    bind();
    state.bookings = collectBookings();
    paint();
    if (state.loadedOnce) return;
    state.loadedOnce = true;
    var B = window.ElenestBookings;
    if (!B || typeof B.refresh !== "function") return;
    B.refresh()
      .then(function () {
        state.bookings = collectBookings();
        paint();
      })
      .catch(function () {});
  }

  window.ElenestReservationQueue = {
    renderSection: renderSection
  };
})();
