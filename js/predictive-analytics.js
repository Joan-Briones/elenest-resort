/**
 * Predictive Analytics — aligned with the Flutter mobile app.
 *
 * Source of truth:
 *   • Bookings + guest feedback from Supabase (live)
 *   • Weather from Open-Meteo (external API)
 *   • Forecasts computed client-side (Linear Regression)
 *   • booking_monthly_history / booking_forecasts / forecast_recommendations = optional cache
 */
(function () {
  "use strict";

  var UNIT_NIGHTS_PER_MONTH = 24 * 30;
  var WEATHER_LAT = 13.9650558;
  var WEATHER_LON = 121.1073418;
  var WEATHER_CACHE_KEY = "elenest_pa_weather_cache_v1";
  var WEATHER_CACHE_MS = 30 * 60 * 1000;
  var PINK = "#c46b82";
  var GREEN = "#3f6d1c";
  var INK = "#3d3340";
  var MUTED = "#6b6570";
  var GREEN_SOFT = "rgba(63, 109, 28, 0.12)";
  var PINK_SOFT = "rgba(196, 107, 130, 0.12)";
  var GRID = "rgba(61, 51, 64, 0.08)";

  var state = {
    horizon: 6,
    facilityType: "all",
    weatherFilter: "expected",
    yearFilter: "",
    monthFilter: "",
    section: "overview",
    lastResult: null,
    persistTimer: null,
    pulseTimer: null,
    refreshTimer: null,
    bound: false,
    loading: false,
    inFlight: null,
    lastError: null,
    charts: {}
  };

  function isPredictiveSectionVisible() {
    var section = el("section-predictive");
    if (!section) return false;
    if (section.hasAttribute("hidden")) return false;
    return !section.hidden;
  }

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback == null ? 0 : fallback;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function daysInMonth(y, m /* 1-12 */) {
    return new Date(y, m, 0).getDate();
  }

  function monthLabel(y, m /* 1-12 */) {
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[m - 1] + " " + y;
  }

  function facilityLabel(ft) {
    if (ft === "rooms") return "Rooms";
    if (ft === "cottages") return "Cottages";
    if (ft === "event_hall" || ft === "hall") return "Event Hall";
    return "All facilities";
  }

  function normalizeFacilityType(ft) {
    if (ft === "hall") return "event_hall";
    return ft || "all";
  }

  function fmtPHP(n) {
    var v = Math.round(toNum(n, 0));
    try {
      return "₱" + v.toLocaleString("en-PH");
    } catch (e) {
      return "₱" + String(v);
    }
  }

  function fmtPHPCompact(n) {
    var v = toNum(n, 0);
    if (Math.abs(v) >= 1000000) return "₱" + (v / 1000000).toFixed(2) + "M";
    if (Math.abs(v) >= 1000) return "₱" + (v / 1000).toFixed(1) + "K";
    return fmtPHP(v);
  }

  /* —— Data loaders (same mapping as Flutter BookingsTableColumns / GuestFeedbackTableColumns) —— */
  function parsePayload(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) || {};
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  function mapBookingRow(row) {
    var p = parsePayload(row.payload);
    // Mirror Flutter toAppBooking / toAppBookingMap
    var checkIn = row.check_in || p.checkIn || p.check_in || "";
    if (checkIn && String(checkIn).length >= 10) checkIn = String(checkIn).slice(0, 10);
    var adults = toNum(p.adults != null ? p.adults : row.adults, 0);
    var children = toNum(p.children != null ? p.children : row.children, 0);
    var totalPrice = toNum(
      row.total_estimate != null
        ? row.total_estimate
        : p.total_price != null
          ? p.total_price
          : p.totalEstimate != null
            ? p.totalEstimate
            : row.total_price,
      0
    );
    var dbStatus = row.status || p.status || "";
    // Exact Flutter mapping: confirmed | cancelled | pending
    var st = String(dbStatus || "").toLowerCase().trim();
    var status = st === "confirmed" ? "confirmed" : st === "cancelled" ? "cancelled" : "pending";

    return {
      id: row.id || p.id || "",
      status: status,
      check_in: checkIn,
      adults: adults,
      children: children,
      total_price: totalPrice,
      total_estimate: totalPrice,
      room_type: row.room_type || p.roomType || p.room_name || "",
      room_name: p.room_name || row.room_type || "",
      facilities: p.facilities || [],
      roomCatalogIds: p.roomCatalogIds || p.room_catalog_ids || [],
      cottageCatalogIds: p.cottageCatalogIds || p.cottage_catalog_ids || [],
      hallCatalogIds: p.hallCatalogIds || p.hall_catalog_ids || [],
      hallCatalogId: p.hallCatalogId || p.hall_catalog_id || "",
      eventHall: p.eventHall || p.event_hall || "",
      payload: p
    };
  }

  function waitForAnalyticsSource() {
    var waits = [];
    var B = window.ElenestBookings;
    var F = window.ElenestGuestFeedback;
    if (B && B.ready) waits.push(B.ready);
    if (F && F.ready) waits.push(F.ready);
    if (B && typeof B.ensureHistoricalLoaded === "function") waits.push(B.ensureHistoricalLoaded());
    if (F && typeof F.ensureHistoricalLoaded === "function") waits.push(F.ensureHistoricalLoaded());
    return Promise.all(waits).catch(function () {
      return null;
    });
  }

  function loadBookings(options) {
    return waitForAnalyticsSource().then(function () {
      return loadBookingsFromLocal();
    });
  }

  function loadBookingsFromLocal() {
    var B = window.ElenestBookings;
    var local = B && typeof B.listAll === "function" ? B.listAll() || [] : [];
    return local.map(function (item) {
      var b = item && item.booking ? item.booking : item || {};
      return mapBookingRow({
        id: b.id,
        status: b.status,
        check_in: b.checkIn || b.check_in,
        total_estimate: b.totalEstimate != null ? b.totalEstimate : b.total_estimate,
        room_type: b.roomType || b.room_type,
        payload: b
      });
    });
  }

  function mapReviewRow(row) {
    // Mirror Flutter GuestFeedbackTableColumns.toAppReviewMap
    var stars = toNum(row.stars != null ? row.stars : row.rating, 0);
    return {
      id: row.id,
      created_at: row.created_at || row.createdAt,
      rating: stars,
      stars: stars,
      sentiment: row.sentiment || "",
      positive_aspects: row.positive_aspects || row.positiveAspects || "",
      negative_aspects: row.negative_aspects || row.negativeAspects || "",
      comment: row.comment || ""
    };
  }

  function loadReviews(options) {
    options = options || {};
    return waitForAnalyticsSource().then(function () {
      return loadReviewsFromLocal();
    });
  }

  function loadReviewsFromLocal() {
    var F = window.ElenestGuestFeedback;
    var local = F && typeof F.listAll === "function" ? F.listAll() || [] : [];
    return local.map(function (item) {
      return mapReviewRow({
        id: item.id,
        created_at: item.createdAt || item.created_at,
        stars: item.stars != null ? item.stars : item.rating,
        sentiment: item.sentiment,
        positive_aspects: item.positiveAspects || item.positive_aspects,
        negative_aspects: item.negativeAspects || item.negative_aspects,
        comment: item.comment
      });
    });
  }

  function fetchWeatherDaily() {
    try {
      var raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (raw) {
        var cached = JSON.parse(raw);
        if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) {
          return Promise.resolve(cached.daily || []);
        }
      }
    } catch (e) {}

    var url =
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      WEATHER_LAT +
      "&longitude=" +
      WEATHER_LON +
      "&daily=weather_code,precipitation_sum,precipitation_probability_max" +
      "&timezone=Asia%2FManila&forecast_days=7";

    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("weather");
        return res.json();
      })
      .then(function (json) {
        var daily = [];
        var codes = (json.daily && json.daily.weather_code) || [];
        var times = (json.daily && json.daily.time) || [];
        for (var i = 0; i < codes.length; i++) {
          daily.push({ date: times[i], weatherCode: toNum(codes[i], 0) });
        }
        try {
          localStorage.setItem(
            WEATHER_CACHE_KEY,
            JSON.stringify({ fetchedAt: Date.now(), daily: daily })
          );
        } catch (e2) {}
        return daily;
      })
      .catch(function () {
        return [];
      });
  }

  /* —— Calendar / climate (Batangas) —— */
  function easterSunday(year) {
    var a = year % 19;
    var b = Math.floor(year / 100);
    var c = year % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function philippineHolidays(year) {
    var list = [
      new Date(year, 0, 1),
      new Date(year, 3, 9),
      new Date(year, 4, 1),
      new Date(year, 5, 12),
      new Date(year, 7, 21),
      new Date(year, 10, 1),
      new Date(year, 10, 30),
      new Date(year, 11, 8),
      new Date(year, 11, 25),
      new Date(year, 11, 30),
      new Date(year, 11, 31)
    ];
    var heroes = new Date(year, 7, 31);
    while (heroes.getDay() !== 1) {
      heroes = new Date(heroes.getFullYear(), heroes.getMonth(), heroes.getDate() - 1);
    }
    list.push(heroes);
    var easter = easterSunday(year);
    list.push(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 3));
    list.push(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2));
    return list;
  }

  function weekendDaysInMonth(year, month) {
    var days = daysInMonth(year, month);
    var count = 0;
    for (var d = 1; d <= days; d++) {
      var wd = new Date(year, month - 1, d).getDay();
      if (wd === 0 || wd === 6) count++;
    }
    return count;
  }

  function holidayDaysInMonth(year, month) {
    return philippineHolidays(year).filter(function (d) {
      return d.getMonth() + 1 === month;
    }).length;
  }

  function climateDays(year, month) {
    var days = daysInMonth(year, month);
    var sunnyShare = 0.5;
    var rainyShare = 0.4;
    if (month <= 3) {
      sunnyShare = 0.72;
      rainyShare = 0.22;
    } else if (month === 4) {
      sunnyShare = 0.68;
      rainyShare = 0.26;
    } else if (month <= 6) {
      sunnyShare = 0.4;
      rainyShare = 0.48;
    } else if (month <= 9) {
      sunnyShare = 0.28;
      rainyShare = 0.42;
    } else if (month === 10) {
      sunnyShare = 0.45;
      rainyShare = 0.4;
    } else {
      sunnyShare = 0.62;
      rainyShare = 0.3;
    }
    var sunny = Math.round(days * sunnyShare);
    var rainy = Math.round(days * rainyShare);
    var stormy = Math.max(0, days - sunny - rainy);
    return { sunny: sunny, rainy: rainy, stormy: stormy };
  }

  function bucketForCode(code) {
    code = toNum(code, 0);
    if (code >= 95) return "stormy";
    if (code >= 51 && code <= 67) return "rainy";
    if (code >= 80 && code <= 82) return "rainy";
    if (code === 0 || code === 1 || code <= 3) return "sunny";
    return "rainy";
  }

  function weatherFromDaily(daily, year, month) {
    if (!daily || !daily.length) return climateDays(year, month);
    var sunny = 0;
    var rainy = 0;
    var stormy = 0;
    daily.forEach(function (day) {
      var b = bucketForCode(day.weatherCode);
      if (b === "sunny") sunny++;
      else if (b === "stormy") stormy++;
      else rainy++;
    });
    var climate = climateDays(year, month);
    var days = daysInMonth(year, month);
    var observed = sunny + rainy + stormy;
    if (!observed) return climate;
    var remaining = Math.max(0, days - observed);
    return {
      sunny: sunny + Math.round((climate.sunny * remaining) / days),
      rainy: rainy + Math.round((climate.rainy * remaining) / days),
      stormy: stormy + Math.round((climate.stormy * remaining) / days)
    };
  }

  /* —— Feedback —— */
  function reviewStars(r) {
    return toNum(r.rating != null ? r.rating : r.stars, 0);
  }

  function isPositiveFeedback(r) {
    // Flutter PredictiveAnalyticsService._isPositiveFeedback
    var s = String(r.sentiment || "").trim().toLowerCase();
    if (s === "positive") return true;
    if (s === "negative" || s === "neutral") return false;
    return reviewStars(r) >= 4;
  }

  function buildFeedbackSignal(reviews) {
    // Flutter PredictiveAnalyticsService._buildFeedbackSignal
    var positive = 0;
    var negative = 0;
    var neutral = 0;
    var ratingSum = 0;
    var aspectCounts = {};
    (reviews || []).forEach(function (r) {
      var stars = reviewStars(r);
      ratingSum += stars;
      var s = String(r.sentiment || "").trim().toLowerCase();
      if (s === "positive" || ((!s || s === "") && stars >= 4)) positive++;
      else if (s === "negative" || ((!s || s === "") && stars <= 2)) negative++;
      else neutral++;
      String(r.positive_aspects || "")
        .split(/[,;|/]/)
        .forEach(function (part) {
          var label = part.trim();
          if (label.length < 3) return;
          aspectCounts[label] = (aspectCounts[label] || 0) + 1;
        });
    });
    var total = (reviews || []).length;
    var positiveShare = total === 0 ? 0 : positive / total;
    var demandLiftPct = Math.max(-8, Math.min(18, (positiveShare - 0.55) * 28));
    var top = Object.keys(aspectCounts)
      .map(function (k) {
        return { k: k, n: aspectCounts[k] };
      })
      .sort(function (a, b) {
        return b.n - a.n;
      })
      .slice(0, 5)
      .map(function (x) {
        return x.k;
      });
    return {
      totalFeedback: total,
      positiveCount: positive,
      neutralCount: neutral,
      negativeCount: negative,
      avgRating: total === 0 ? 0 : ratingSum / total,
      positiveShare: positiveShare,
      topPositiveAspects: top,
      demandLiftPct: Math.round(demandLiftPct * 10) / 10
    };
  }

  function aggregatePositiveFeedback(reviews) {
    var buckets = {};
    (reviews || []).forEach(function (r) {
      var created = new Date(r.created_at || "");
      if (isNaN(created.getTime())) return;
      var key = created.getFullYear() + "-" + (created.getMonth() + 1);
      if (!buckets[key]) buckets[key] = { total: 0, positive: 0, ratingSum: 0 };
      buckets[key].total += 1;
      buckets[key].ratingSum += reviewStars(r);
      if (isPositiveFeedback(r)) buckets[key].positive += 1;
    });
    return buckets;
  }

  /* —— History aggregation —— */
  function facilityTypeOf(booking) {
    // Match Flutter PredictiveAnalyticsService._facilityTypeOf
    var p = booking.payload || {};
    var facilities = booking.facilities || p.facilities || [];
    var facText = "";
    if (Array.isArray(facilities)) {
      facText = facilities
        .map(function (f) {
          if (!f) return "";
          if (typeof f === "string") return f;
          return [f.type, f.name, f.id, f.roomKind].join(" ");
        })
        .join(" ");
    }
    var blob = [
      booking.room_type,
      booking.room_name,
      booking.facility_type,
      booking.type,
      booking.category,
      p.roomType,
      p.facility_type,
      p.type,
      facText
    ]
      .join(" ")
      .toLowerCase();

    if (blob.indexOf("cottage") !== -1) return "cottages";
    if (blob.indexOf("hall") !== -1 || blob.indexOf("event") !== -1) return "event_hall";

    // Fallback: catalog ids (website payloads)
    var cottages = [].concat(booking.cottageCatalogIds || p.cottageCatalogIds || []);
    var halls = [].concat(booking.hallCatalogIds || p.hallCatalogIds || [])
      .concat(booking.hallCatalogId || p.hallCatalogId ? [1] : [])
      .concat(booking.eventHall || p.eventHall ? [1] : []);
    if (cottages.length) return "cottages";
    if (halls.length) return "event_hall";
    return "rooms";
  }

  function syntheticBaseline(facilityType) {
    var now = new Date();
    var points = [];
    for (var i = 11; i >= 0; i--) {
      var period = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var y = period.getFullYear();
      var m = period.getMonth() + 1;
      var climate = climateDays(y, m);
      var seasonal =
        18 +
        6 * Math.sin((2 * Math.PI * m) / 12) +
        climate.sunny * 0.08 -
        climate.rainy * 0.05 -
        climate.stormy * 0.12;
      var bookings = Math.max(4, Math.round(seasonal));
      var positive = Math.max(1, Math.round(bookings * 0.35));
      points.push({
        year: y,
        month: m,
        facility_type: facilityType,
        bookings: bookings,
        guests: bookings * 4,
        revenue: bookings * 4500,
        occupancy_rate: Math.min(100, (bookings / UNIT_NIGHTS_PER_MONTH) * 100),
        weekend_days: weekendDaysInMonth(y, m),
        holiday_days: holidayDaysInMonth(y, m),
        sunny_days: climate.sunny,
        rainy_days: climate.rainy,
        stormy_days: climate.stormy,
        positive_feedback_count: positive,
        feedback_count: positive + 1,
        avg_rating: 4.4,
        synthetic: true
      });
    }
    return points;
  }

  function aggregateHistory(bookings, facilityType, feedbackByMonth) {
    var buckets = {};
    (bookings || []).forEach(function (booking) {
      // Flutter: only skip status == 'cancelled' (after toAppStatus).
      // Rejected / For Verification / Checked In → pending → INCLUDED.
      var status = String(booking.status || "").toLowerCase().trim();
      if (status === "cancelled") return;

      var checkInRaw = String(booking.check_in || "");
      if (!checkInRaw) return;
      var checkIn = new Date(
        checkInRaw.length <= 10 ? checkInRaw + "T12:00:00" : checkInRaw
      );
      if (isNaN(checkIn.getTime())) return;

      var type = facilityTypeOf(booking);
      if (facilityType !== "all" && type !== facilityType) return;

      var key = checkIn.getFullYear() + "-" + (checkIn.getMonth() + 1);
      if (!buckets[key]) {
        buckets[key] = {
          year: checkIn.getFullYear(),
          month: checkIn.getMonth() + 1,
          bookings: 0,
          guests: 0,
          revenue: 0
        };
      }
      var adults = toNum(booking.adults, 0);
      var children = toNum(booking.children, 0);
      var guests = Math.max(1, adults + children);
      // Flutter: total_estimate column, else payload total_price
      var revenue = toNum(booking.total_price, 0);
      buckets[key].bookings += 1;
      buckets[key].guests += guests;
      buckets[key].revenue += revenue;
    });

    if (!Object.keys(buckets).length) return syntheticBaseline(facilityType);

    var keys = Object.keys(buckets).sort(function (a, b) {
      var ap = buckets[a];
      var bp = buckets[b];
      return ap.year !== bp.year ? ap.year - bp.year : ap.month - bp.month;
    });
    var first = buckets[keys[0]];
    var now = new Date();
    var cursor = new Date(first.year, first.month - 1, 1);
    var end = new Date(now.getFullYear(), now.getMonth(), 1);
    var points = [];
    while (cursor <= end) {
      var y = cursor.getFullYear();
      var m = cursor.getMonth() + 1;
      var key = y + "-" + m;
      var bucket = buckets[key];
      var climate = climateDays(y, m);
      var bookingsCount = bucket ? bucket.bookings : 0;
      var fb = feedbackByMonth[key];
      points.push({
        year: y,
        month: m,
        facility_type: facilityType,
        bookings: bookingsCount,
        guests: bucket ? bucket.guests : 0,
        revenue: bucket ? bucket.revenue : 0,
        occupancy_rate: Math.min(100, (bookingsCount / UNIT_NIGHTS_PER_MONTH) * 100),
        weekend_days: weekendDaysInMonth(y, m),
        holiday_days: holidayDaysInMonth(y, m),
        sunny_days: climate.sunny,
        rainy_days: climate.rainy,
        stormy_days: climate.stormy,
        positive_feedback_count: fb ? fb.positive : 0,
        feedback_count: fb ? fb.total : 0,
        avg_rating: fb && fb.total ? fb.ratingSum / fb.total : 0,
        synthetic: false
      });
      cursor = new Date(y, m, 1);
    }
    return points;
  }

  /* —— OLS —— */
  function featureRow(h, tIndex) {
    var angle = (2 * Math.PI * h.month) / 12;
    return [
      1,
      tIndex,
      Math.sin(angle),
      Math.cos(angle),
      h.weekend_days,
      h.sunny_days,
      h.rainy_days,
      h.stormy_days,
      h.holiday_days,
      h.positive_feedback_count
    ];
  }

  function featuresFor(opts) {
    var angle = (2 * Math.PI * opts.month) / 12;
    return [
      1,
      opts.tIndex,
      Math.sin(angle),
      Math.cos(angle),
      opts.weekends,
      opts.sunny,
      opts.rainy,
      opts.stormy,
      opts.holidays,
      opts.positiveFeedback
    ];
  }

  function featuresForWeatherScenario(base, year, month, scenario) {
    var days = daysInMonth(year, month);
    var copy = base.slice();
    if (scenario === "sunny") {
      copy[5] = days * 0.75;
      copy[6] = days * 0.2;
      copy[7] = days * 0.05;
    } else if (scenario === "rainy") {
      copy[5] = days * 0.2;
      copy[6] = days * 0.7;
      copy[7] = days * 0.1;
    } else if (scenario === "stormy") {
      copy[5] = days * 0.1;
      copy[6] = days * 0.35;
      copy[7] = days * 0.55;
    }
    return copy;
  }

  function solveLinearSystem(a, b) {
    var n = b.length;
    var m = a.map(function (row, i) {
      return row.slice().concat([b[i]]);
    });
    for (var col = 0; col < n; col++) {
      var pivot = col;
      for (var row = col + 1; row < n; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      var tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
      var diag = m[col][col];
      if (Math.abs(diag) < 1e-12) continue;
      for (var j = col; j <= n; j++) m[col][j] /= diag;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var factor = m[r2][col];
        for (var j2 = col; j2 <= n; j2++) m[r2][j2] -= factor * m[col][j2];
      }
    }
    return m.map(function (row) {
      return row[n];
    });
  }

  function ols(x, y) {
    var n = x.length;
    if (!n) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var k = x[0].length;
    if (n < k) {
      var mean = y.reduce(function (a, b) { return a + b; }, 0) / n;
      var beta = [];
      for (var i = 0; i < k; i++) beta[i] = 0;
      beta[0] = mean;
      if (n >= 2) beta[1] = (y[n - 1] - y[0]) / Math.max(1, n - 1);
      beta[5] = 0.15;
      beta[6] = -0.2;
      beta[7] = -0.45;
      beta[8] = 0.35;
      if (k > 9) beta[9] = 0.55;
      return beta;
    }
    var xtx = [];
    var xty = [];
    var r, c, i2;
    for (r = 0; r < k; r++) {
      xtx[r] = [];
      xty[r] = 0;
      for (c = 0; c < k; c++) xtx[r][c] = 0;
    }
    for (i2 = 0; i2 < n; i2++) {
      for (r = 0; r < k; r++) {
        xty[r] += x[i2][r] * y[i2];
        for (c = 0; c < k; c++) xtx[r][c] += x[i2][r] * x[i2][c];
      }
    }
    for (r = 0; r < k; r++) xtx[r][r] += 1e-3;
    return solveLinearSystem(xtx, xty);
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function clampForecast(value, mean, floor, ceilingFactor) {
    if (!isFinite(value)) return floor;
    var ceiling = mean <= 0 ? value : mean * ceilingFactor;
    return Math.max(floor, Math.min(Math.max(ceiling, floor + 1), value));
  }

  function seasonalDemandFactor(opts) {
    var monthFactor = {
      1: 1.22, 2: 1.12, 3: 1.18, 4: 1.28, 5: 1.05, 6: 0.88,
      7: 0.78, 8: 0.74, 9: 0.76, 10: 0.9, 11: 1.08, 12: 1.32
    };
    var factor = monthFactor[opts.month] || 1;
    factor += (opts.weekends - 8) * 0.03;
    factor += opts.holidays * 0.06;
    var weatherDays = Math.max(1, opts.sunny + opts.rainy + opts.stormy);
    factor += (opts.sunny / weatherDays - 0.45) * 0.25;
    factor -= (opts.rainy / weatherDays) * 0.12;
    factor -= (opts.stormy / weatherDays) * 0.28;
    if (opts.weatherFilter === "sunny") factor *= 1.12;
    else if (opts.weatherFilter === "rainy") factor *= 0.88;
    else if (opts.weatherFilter === "stormy") factor *= 0.72;
    factor += ((opts.month * 17) % 7) * 0.01;
    return Math.max(0.55, Math.min(1.55, factor));
  }

  function confidenceScore(rmse, mean, sampleSize, horizon) {
    if (!sampleSize) return 35;
    var cv = mean <= 0 ? 1 : Math.max(0, Math.min(1.5, rmse / mean));
    var score = 92 - cv * 40 - horizon * 3.5 + Math.min(12, sampleSize);
    return Math.max(35, Math.min(96, score));
  }

  function projectedPositiveFeedback(history) {
    if (!history.length) return 0;
    var recent = history.length > 3 ? history.slice(history.length - 3) : history;
    var sum = recent.reduce(function (a, h) {
      return a + h.positive_feedback_count;
    }, 0);
    return sum / recent.length;
  }

  function weatherImpacts(betaBookings, meanBookings, sampleMonth) {
    var year = sampleMonth ? sampleMonth.year : new Date().getFullYear();
    var month = sampleMonth ? sampleMonth.month : new Date().getMonth() + 1;
    var weekends = weekendDaysInMonth(year, month);
    var holidays = holidayDaysInMonth(year, month);
    var days = daysInMonth(year, month);
    var tIndex = 12;
    var descriptions = {
      sunny: "Sunny weather typically lifts outdoor & leisure demand.",
      rainy: "Rainy weather usually softens day-tour and cottage bookings.",
      stormy: "Stormy / typhoon conditions strongly suppress arrivals."
    };

    function predict(w) {
      var base = featuresFor({
        month: month,
        sunny: 0,
        rainy: 0,
        stormy: 0,
        weekends: weekends,
        holidays: holidays,
        positiveFeedback: sampleMonth ? sampleMonth.positive_feedback_count : 0,
        tIndex: tIndex
      });
      var pure = featuresForWeatherScenario(base, year, month, w === "expected" ? "expected" : w);
      if (w === "expected") {
        var climate = climateDays(year, month);
        pure[5] = climate.sunny;
        pure[6] = climate.rainy;
        pure[7] = climate.stormy;
      } else if (w === "sunny") {
        pure[5] = days;
        pure[6] = 0;
        pure[7] = 0;
      } else if (w === "rainy") {
        pure[5] = 0;
        pure[6] = days;
        pure[7] = 0;
      } else if (w === "stormy") {
        pure[5] = 0;
        pure[6] = 0;
        pure[7] = days;
      }
      return Math.max(0, dot(pure, betaBookings));
    }

    var baseline = predict("expected");
    var denom = baseline > 0 ? baseline : meanBookings > 0 ? meanBookings : 1;
    return ["sunny", "rainy", "stormy"].map(function (w) {
      var value = predict(w);
      var delta = value - baseline;
      var pct = (delta / denom) * 100;
      return {
        weather: w,
        label: w.charAt(0).toUpperCase() + w.slice(1),
        description: descriptions[w],
        demand_delta_pct: Math.round(pct * 10) / 10,
        delta_pct: Math.round(pct * 10) / 10,
        bookings_delta: Math.round(delta * 10) / 10,
        delta_bookings: Math.round(delta * 10) / 10,
        baseline_bookings: Math.round(baseline * 10) / 10,
        scenario_bookings: Math.round(value * 10) / 10
      };
    });
  }

  function buildRecommendations(forecasts, facilityType, history, feedbackSignal) {
    if (!forecasts.length) return [];
    var byBookings = forecasts.slice().sort(function (a, b) {
      return b.predicted_bookings - a.predicted_bookings;
    });
    var peak = byBookings[0];
    var trough = byBookings[byBookings.length - 1];
    var avgBookings =
      forecasts.reduce(function (a, f) {
        return a + f.predicted_bookings;
      }, 0) / forecasts.length;
    var avgRevenue =
      forecasts.reduce(function (a, f) {
        return a + f.predicted_revenue;
      }, 0) / forecasts.length;
    var histAvg = history.length
      ? history.reduce(function (a, h) {
          return a + h.revenue;
        }, 0) / history.length
      : avgRevenue;
    var richest = forecasts.slice().sort(function (a, b) {
      return b.predicted_revenue - a.predicted_revenue;
    })[0];
    var vsHist = histAvg <= 0 ? 0 : ((richest.predicted_revenue - histAvg) / histAvg) * 100;
    var fac = facilityLabel(facilityType);
    var icons = {
      staffing: "👥",
      promotion: "🏷",
      facilities: "📦",
      maintenance: "🔧",
      revenue: "₱",
      reputation: "★"
    };
    var recs = [
      {
        year: peak.year,
        month: peak.month,
        category: "staffing",
        priority: "high",
        title: "Increase staff in " + monthLabel(peak.year, peak.month),
        meta: monthLabel(peak.year, peak.month) + " · " + fac,
        detail:
          "Predicted " +
          Math.round(peak.predicted_bookings) +
          " bookings (~" +
          Math.round(peak.predicted_guests) +
          " guests) — schedule extra front desk, F&B, and housekeeping before peak demand.",
        icon: icons.staffing
      },
      {
        year: trough.year,
        month: trough.month,
        category: "promotion",
        priority: trough.predicted_bookings < avgBookings * 0.75 ? "high" : "medium",
        title: "Launch promotional discounts in " + monthLabel(trough.year, trough.month),
        meta: monthLabel(trough.year, trough.month) + " · " + fac,
        detail:
          "Forecast drops to " +
          Math.round(trough.predicted_bookings) +
          " bookings. Offer midweek packages or cottage day-tour promos to lift occupancy.",
        icon: icons.promotion
      },
      {
        year: peak.year,
        month: peak.month,
        category: "facilities",
        priority: "high",
        title: "Prepare facilities & supplies before " + monthLabel(peak.year, peak.month),
        meta: monthLabel(peak.year, peak.month) + " · " + fac,
        detail:
          "Stock linens, pool chemicals, and event supplies ahead of the peak month (" +
          peak.predicted_occupancy.toFixed(0) +
          "% projected occupancy).",
        icon: icons.facilities
      },
      {
        year: trough.year,
        month: trough.month,
        category: "maintenance",
        priority: "medium",
        title: "Schedule maintenance in " + monthLabel(trough.year, trough.month),
        meta: monthLabel(trough.year, trough.month) + " · " + fac,
        detail:
          "Lowest expected occupancy (" +
          trough.predicted_occupancy.toFixed(0) +
          "%) — ideal window for room refreshes, cottage repairs, and hall upgrades.",
        icon: icons.maintenance
      },
      {
        year: richest.year,
        month: richest.month,
        category: "revenue",
        priority: "medium",
        title: "Expected income outlook — " + monthLabel(richest.year, richest.month),
        meta: monthLabel(richest.year, richest.month) + " · " + fac,
        detail:
          "Projected " +
          fmtPHPCompact(richest.predicted_revenue) +
          " vs historical monthly average " +
          fmtPHPCompact(histAvg) +
          " (" +
          (vsHist >= 0 ? "+" : "") +
          vsHist.toFixed(1) +
          "%). Average forecast income across the horizon: " +
          fmtPHPCompact(avgRevenue) +
          ".",
        icon: icons.revenue
      }
    ];

    var signal = feedbackSignal;
    if (signal && signal.totalFeedback > 0) {
      var aspects =
        signal.topPositiveAspects && signal.topPositiveAspects.length
          ? signal.topPositiveAspects.slice(0, 2).join(" & ")
          : "service and amenities";
      if (signal.positiveShare >= 0.65 && signal.demandLiftPct > 0) {
        recs.push({
          year: peak.year,
          month: peak.month,
          category: "reputation",
          priority: "high",
          title: "Leverage strong positive feedback before " + monthLabel(peak.year, peak.month),
          meta: monthLabel(peak.year, peak.month) + " · " + fac,
          detail:
            signal.positiveCount +
            " positive reviews (" +
            Math.round(signal.positiveShare * 100) +
            "% · avg " +
            signal.avgRating.toFixed(1) +
            "★) lift demand by ~" +
            signal.demandLiftPct.toFixed(1) +
            "%. Feature praise about " +
            aspects +
            " in promos and social posts.",
          icon: icons.reputation
        });
      } else if (signal.positiveShare < 0.45 || signal.negativeCount > signal.positiveCount) {
        recs.push({
          year: trough.year,
          month: trough.month,
          category: "reputation",
          priority: "high",
          title: "Improve guest experience before pushing promotions",
          meta: monthLabel(trough.year, trough.month) + " · " + fac,
          detail:
            "Only " +
            Math.round(signal.positiveShare * 100) +
            "% of " +
            signal.totalFeedback +
            " reviews are positive (" +
            signal.negativeCount +
            " negative). Fix service gaps first — discounts alone will not sustain bookings.",
          icon: icons.reputation
        });
      }
    }
    return recs;
  }

  function runModel(opts) {
    var history = opts.history;
    var horizonMonths = opts.horizonMonths;
    var facilityType = opts.facilityType;
    var weatherFilter = opts.weatherFilter;
    var dailyForecast = opts.dailyForecast || [];
    var feedbackSignal = opts.feedbackSignal;
    var runId = uuid();
    var generatedAt = new Date();

    var yBookings = history.map(function (h) { return h.bookings; });
    var yGuests = history.map(function (h) { return h.guests; });
    var yRevenue = history.map(function (h) { return h.revenue; });
    var design = history.map(function (h, i) { return featureRow(h, i); });
    var betaBookings = ols(design, yBookings);
    var betaGuests = ols(design, yGuests);
    var betaRevenue = ols(design, yRevenue);

    var mean = function (arr) {
      return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0;
    };
    var meanBookings = mean(yBookings);
    var meanGuests = mean(yGuests);
    var meanRevenue = mean(yRevenue);

    var residuals = history.map(function (h, i) {
      return yBookings[i] - dot(design[i], betaBookings);
    });
    var rmse = Math.sqrt(
      residuals.reduce(function (a, r) {
        return a + r * r;
      }, 0) / Math.max(1, residuals.length)
    );

    var impacts = weatherImpacts(betaBookings, meanBookings, history.length ? history[history.length - 1] : null);
    var last = history.length
      ? { year: history[history.length - 1].year, month: history[history.length - 1].month }
      : { year: generatedAt.getFullYear(), month: generatedAt.getMonth() + 1 };
    var lastRevenue = history.length ? history[history.length - 1].revenue : 0;
    var projectedPositive = projectedPositiveFeedback(history);
    var reputationLift = (feedbackSignal && feedbackSignal.demandLiftPct ? feedbackSignal.demandLiftPct : 0) / 100;

    var forecasts = [];
    var h;
    for (h = 1; h <= horizonMonths; h++) {
      var period = new Date(last.year, last.month - 1 + h, 1);
      var y = period.getFullYear();
      var m = period.getMonth() + 1;
      var climate = climateDays(y, m);
      var nearTerm = h === 1 ? weatherFromDaily(dailyForecast, y, m) : climate;
      var weekends = weekendDaysInMonth(y, m);
      var holidays = holidayDaysInMonth(y, m);
      var expectedFeatures = featuresFor({
        month: m,
        sunny: nearTerm.sunny,
        rainy: nearTerm.rainy,
        stormy: nearTerm.stormy,
        weekends: weekends,
        holidays: holidays,
        positiveFeedback: projectedPositive,
        tIndex: history.length + h - 1
      });
      var scenarioFeatures =
        weatherFilter === "expected"
          ? expectedFeatures
          : featuresForWeatherScenario(expectedFeatures, y, m, weatherFilter);

      var olsBookings = Math.max(0, dot(scenarioFeatures, betaBookings));
      var olsGuests = Math.max(0, dot(scenarioFeatures, betaGuests));
      var olsRevenue = Math.max(0, dot(scenarioFeatures, betaRevenue));

      var baseBookings = meanBookings > 0 ? olsBookings * 0.45 + meanBookings * 0.55 : olsBookings;
      var baseGuests = meanGuests > 0 ? olsGuests * 0.45 + meanGuests * 0.55 : baseBookings * 4;
      var baseRevenue = meanRevenue > 0 ? olsRevenue * 0.45 + meanRevenue * 0.55 : olsRevenue;

      var seasonal = seasonalDemandFactor({
        month: m,
        weekends: weekends,
        holidays: holidays,
        sunny: nearTerm.sunny,
        rainy: nearTerm.rainy,
        stormy: nearTerm.stormy,
        weatherFilter: weatherFilter
      });

      var predictedBookings = Math.max(0, baseBookings * seasonal);
      var predictedGuests = Math.max(0, baseGuests * seasonal);
      var predictedRevenue = Math.max(0, baseRevenue * seasonal);

      if (reputationLift) {
        var factor = 1 + reputationLift * 0.5;
        predictedBookings *= factor;
        predictedGuests *= factor;
        predictedRevenue *= factor;
      }

      predictedBookings = clampForecast(predictedBookings, meanBookings || predictedBookings, 0, 3.5);
      predictedGuests = clampForecast(predictedGuests, meanGuests || meanBookings * 4, 0, 3.5);
      predictedRevenue = clampForecast(predictedRevenue, meanRevenue || predictedRevenue, 0, 3.5);

      if (predictedBookings > 0) {
        var avgParty =
          meanBookings > 0 && meanGuests > 0 ? meanGuests / meanBookings : 4;
        avgParty = Math.max(2, Math.min(12, avgParty));
        predictedGuests = predictedBookings * avgParty;
      }

      var occupancy = Math.min(100, (predictedBookings / UNIT_NIGHTS_PER_MONTH) * 100);
      var baselineBookings = Math.max(0, dot(expectedFeatures, betaBookings));
      var weatherImpactPct =
        baselineBookings <= 0
          ? 0
          : ((predictedBookings - baselineBookings) / baselineBookings) * 100;

      var conf = confidenceScore(rmse, meanBookings, history.length, h);
      if (feedbackSignal && feedbackSignal.positiveShare >= 0.65) {
        conf = Math.max(35, Math.min(96, conf + 4));
      }

      var prevRevenue = h === 1 ? lastRevenue : forecasts[h - 2].predicted_revenue;
      var deltaPct =
        prevRevenue <= 0 ? null : ((predictedRevenue - prevRevenue) / prevRevenue) * 100;

      forecasts.push({
        year: y,
        month: m,
        month_key: y + "-" + pad2(m),
        horizon_months: h,
        facility_type: facilityType,
        weather_scenario: weatherFilter,
        predicted_bookings: Math.round(predictedBookings * 10) / 10,
        predicted_guests: Math.round(predictedGuests * 10) / 10,
        predicted_revenue: Math.round(predictedRevenue * 100) / 100,
        predicted_occupancy: Math.round(occupancy * 10) / 10,
        confidence_level: Math.round(conf * 10) / 10,
        weather_impact_pct: Math.round(weatherImpactPct * 10) / 10,
        previous_month_revenue: prevRevenue,
        revenue_delta_pct: deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
        vs_prev_month_revenue:
          prevRevenue == null ? null : Math.round((predictedRevenue - prevRevenue) * 100) / 100,
        model_type: "linear_regression"
      });
    }

    var recommendations = buildRecommendations(
      forecasts,
      facilityType,
      history,
      feedbackSignal
    );

    var feedbackNote =
      !feedbackSignal || !feedbackSignal.totalFeedback
        ? "No guest feedback yet — reputation signal unused."
        : feedbackSignal.positiveCount +
          "/" +
          feedbackSignal.totalFeedback +
          " positive (" +
          Math.round(feedbackSignal.positiveShare * 100) +
          "%) · reputation lift " +
          (feedbackSignal.demandLiftPct >= 0 ? "+" : "") +
          feedbackSignal.demandLiftPct.toFixed(1) +
          "%.";

    return {
      runId: runId,
      generatedAt: generatedAt.toISOString(),
      horizon: horizonMonths,
      facilityType: facilityType,
      weatherFilter: weatherFilter,
      history: history,
      predictions: forecasts,
      impactScenarios: impacts,
      weatherImpact: impacts,
      recommendations: recommendations,
      feedbackSignal: feedbackSignal,
      modelNote:
        (history.length < 3
          ? "Limited history — using trend + seasonal priors + positive feedback. "
          : "Linear Regression on " +
            history.length +
            " months (trend, seasonality, weekends, holidays, weather, positive feedback). ") +
        feedbackNote,
      model: {
        name: "linear_regression",
        history_months: history.length,
        train_months: history.length
      }
    };
  }

  /* —— Persist optional cache (mobile tables) —— */
  function persistResult(result) {
    var sb = getClient();
    if (!sb || !result) return Promise.resolve(null);

    var historyRows = (result.history || []).map(function (h) {
      return {
        year: h.year,
        month: h.month,
        facility_type: h.facility_type === "hall" ? "event_hall" : h.facility_type,
        bookings_count: Math.round(h.bookings),
        guests_count: Math.round(h.guests),
        revenue: h.revenue,
        occupancy_rate: h.occupancy_rate,
        weekend_days: h.weekend_days,
        holiday_days: h.holiday_days,
        sunny_days: h.sunny_days,
        rainy_days: h.rainy_days,
        stormy_days: h.stormy_days,
        positive_feedback_count: h.positive_feedback_count || 0,
        feedback_count: h.feedback_count || 0,
        avg_rating: h.avg_rating || 0,
        source: h.synthetic ? "synthetic" : "aggregated",
        updated_at: new Date().toISOString()
      };
    });

    var forecastRows = (result.predictions || []).map(function (f) {
      return {
        forecast_run_id: result.runId,
        year: f.year,
        month: f.month,
        horizon_months: f.horizon_months,
        facility_type: f.facility_type === "hall" ? "event_hall" : f.facility_type,
        weather_scenario: f.weather_scenario || "expected",
        predicted_bookings: f.predicted_bookings,
        predicted_guests: f.predicted_guests,
        predicted_revenue: f.predicted_revenue,
        predicted_occupancy: f.predicted_occupancy,
        confidence_level: f.confidence_level,
        weather_impact_pct: f.weather_impact_pct,
        model_type: "linear_regression",
        previous_month_revenue: f.previous_month_revenue,
        revenue_delta_pct: f.revenue_delta_pct
      };
    });

    var recRows = (result.recommendations || []).map(function (r) {
      return {
        forecast_run_id: result.runId,
        year: r.year || new Date().getFullYear(),
        month: r.month || new Date().getMonth() + 1,
        facility_type: result.facilityType === "hall" ? "event_hall" : result.facilityType,
        category: r.category || "revenue",
        priority: r.priority || "medium",
        title: r.title,
        detail: r.detail
      };
    });

    var pHist = historyRows.length
      ? sb.from("booking_monthly_history").upsert(historyRows, {
          onConflict: "year,month,facility_type"
        })
      : Promise.resolve({ error: null });

    return pHist
      .then(function () {
        return forecastRows.length
          ? sb.from("booking_forecasts").insert(forecastRows)
          : { error: null };
      })
      .then(function () {
        return recRows.length
          ? sb.from("forecast_recommendations").insert(recRows)
          : { error: null };
      })
      .catch(function (err) {
        try {
          console.warn(
            "[Elenest PredictiveAnalytics] cache persist skipped:",
            err && err.message ? err.message : err
          );
        } catch (e) {}
        return null;
      });
  }

  function schedulePersist(result) {
    if (state.persistTimer) clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(function () {
      state.persistTimer = null;
      persistResult(result);
    }, 600);
  }

  function filterPredictions(predictions, yearFilter, monthFilter) {
    return (predictions || []).filter(function (p) {
      if (yearFilter && String(p.year) !== String(yearFilter)) return false;
      if (monthFilter && String(p.month) !== String(parseInt(monthFilter, 10))) return false;
      return true;
    });
  }

  /** Always regenerate from live Supabase bookings + reviews + weather API. */
  function generateForecast(options) {
    options = options || {};
    var horizon = Math.max(1, Math.min(12, toNum(options.horizon, state.horizon) || 6));
    var facilityType = normalizeFacilityType(options.facilityType || state.facilityType);
    var weatherFilter = options.weatherFilter || state.weatherFilter || "expected";
    if (weatherFilter === "all") weatherFilter = "expected";
    var yearFilter = options.yearFilter != null ? options.yearFilter : state.yearFilter;
    var monthFilter = options.monthFilter != null ? options.monthFilter : state.monthFilter;
    var persist = options.persist !== false;
    var preferLocal = !!options.preferLocal;
    var loadOpts = preferLocal ? { preferLocal: true } : {};

    return Promise.all([
      loadBookings(loadOpts),
      loadReviews(loadOpts),
      fetchWeatherDaily()
    ]).then(function (parts) {
      var bookings = parts[0] || [];
      var reviews = parts[1] || [];
      var daily = parts[2] || [];
      var feedbackByMonth = aggregatePositiveFeedback(reviews);
      var feedbackSignal = buildFeedbackSignal(reviews);
      var history = aggregateHistory(bookings, facilityType, feedbackByMonth);
      var result = runModel({
        history: history,
        horizonMonths: horizon,
        facilityType: facilityType,
        weatherFilter: weatherFilter,
        dailyForecast: daily,
        feedbackSignal: feedbackSignal
      });
      result.yearFilter = yearFilter || "";
      result.monthFilter = monthFilter || "";
      result.predictions = filterPredictions(result.predictions, yearFilter, monthFilter);
      result.allPredictions = result.predictions;
      state.lastResult = result;
      if (persist) schedulePersist(result);
      return result;
    });
  }

  /* —— Charts / DOM (UI) —— */
  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  function setLive(syncing) {
    var badge = el("paLiveBadge");
    var label = el("paLiveLabel");
    if (!badge) return;
    badge.classList.toggle("is-syncing", !!syncing);
    badge.classList.toggle("is-pulse", !!syncing);
    if (label) label.textContent = syncing ? "Syncing" : "Live";
    if (syncing) {
      if (state.pulseTimer) clearTimeout(state.pulseTimer);
      state.pulseTimer = setTimeout(function () {
        badge.classList.remove("is-syncing", "is-pulse");
        if (label) label.textContent = "Live";
      }, 1600);
    }
  }

  function setPaStatus(mode, message) {
    var bar = el("paStatusBar");
    var msg = el("paStatusMsg");
    var retry = el("paStatusRetry");
    if (!bar || !msg) return;
    if (!mode) {
      bar.hidden = true;
      bar.classList.remove("is-loading", "is-error");
      if (retry) retry.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.classList.toggle("is-loading", mode === "loading");
    bar.classList.toggle("is-error", mode === "error");
    msg.textContent = message || "";
    if (retry) retry.hidden = mode !== "error";
  }

  function showPaLoading() {
    state.lastError = null;
    setPaStatus("loading", "Loading predictive analytics...");
  }

  function showPaError(err) {
    var EE = window.ElenestErrors;
    var text =
      (EE && typeof EE.friendlyMessage === "function"
        ? EE.friendlyMessage(err, "Could not load predictive analytics.")
        : null) ||
      (err && (err.message || err.error_description || String(err))) ||
      "Could not load predictive analytics.";
    if (/TypeError:|ReferenceError:|at\s+\S+\s+\(/i.test(String(text))) {
      text = "Could not load predictive analytics.";
    }
    state.lastError = text;
    setPaStatus("error", text + " Tap Retry to try again.");
  }

  function clearPaStatus() {
    setPaStatus(null);
  }

  function prepareChartContext(canvas, fallbackW, fallbackH) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = canvas.clientWidth;
    var cssW = cw >= 64 ? Math.floor(cw) : fallbackW;
    var ratio = fallbackH / fallbackW;
    var cssH = Math.max(Math.round(cssW * ratio), 160);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.style.maxHeight = "none";
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  function formatChartValue(value, isRevenue) {
    if (value == null || !isFinite(value)) return "—";
    if (isRevenue) return fmtPHPCompact(value);
    return String(Math.round(value));
  }

  function buildSmoothPath(ctx, pts) {
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) return;
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var cp1x = p1.x + (p2.x - p0.x) / 6;
      var cp1y = p1.y + (p2.y - p0.y) / 6;
      var cp2x = p2.x - (p3.x - p1.x) / 6;
      var cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  function strokeSmoothSegment(ctx, pts, color) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    buildSmoothPath(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function fillSmoothUnder(ctx, pts, baselineY, color) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    buildSmoothPath(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, baselineY);
    ctx.lineTo(pts[0].x, baselineY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function tipIdForCanvas(canvasId) {
    if (canvasId === "paChartBookings") return "paTipBookings";
    if (canvasId === "paChartRevenue") return "paTipRevenue";
    return null;
  }

  function hideChartTooltip(canvasId) {
    var tip = el(tipIdForCanvas(canvasId));
    if (tip) tip.hidden = true;
    var meta = state.charts[canvasId];
    if (meta && meta.hoverIndex != null) {
      meta.hoverIndex = null;
      paintLineChart(canvasId);
    }
  }

  function showChartTooltip(canvasId, point, clientX, clientY) {
    var tip = el(tipIdForCanvas(canvasId));
    var canvas = el(canvasId);
    if (!tip || !canvas || !point) return;
    var wrap = canvas.parentElement;
    if (!wrap) return;
    var kindClass = point.forecast
      ? "pa-chart-tooltip__kind pa-chart-tooltip__kind--forecast"
      : "pa-chart-tooltip__kind";
    tip.innerHTML =
      '<p class="pa-chart-tooltip__month">' +
      point.fullLabel +
      "</p>" +
      '<p class="pa-chart-tooltip__value">' +
      point.display +
      "</p>" +
      '<p class="' +
      kindClass +
      '">' +
      (point.forecast ? "Forecast" : "Past") +
      "</p>";
    tip.hidden = false;
    var rect = wrap.getBoundingClientRect();
    var left = clientX - rect.left;
    var top = clientY - rect.top;
    var tipW = tip.offsetWidth || 120;
    left = Math.max(tipW / 2 + 4, Math.min(rect.width - tipW / 2 - 4, left));
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, top) + "px";
  }

  function nearestChartPoint(meta, mx, my) {
    if (!meta || !meta.points || !meta.points.length) return -1;
    var best = -1;
    var bestDist = 28;
    for (var i = 0; i < meta.points.length; i++) {
      var p = meta.points[i];
      var dx = p.x - mx;
      var dy = p.y - my;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function paintLineChart(canvasId) {
    var meta = state.charts[canvasId];
    if (!meta || !meta.series) return;
    var canvas = el(canvasId);
    if (!canvas) return;
    var prep = prepareChartContext(canvas, 640, 280);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    var series = meta.series;
    var isRevenue = meta.isRevenue;
    var hoverIndex = meta.hoverIndex;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    if (!series.length) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px Poppins, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No data for current filters.", w / 2, h / 2);
      meta.points = [];
      return;
    }

    var padL = 40;
    var padR = 16;
    var padT = 28;
    var padB = 32;
    var chartW = w - padL - padR;
    var chartH = h - padT - padB;
    var maxV = Math.max(
      1,
      Math.max.apply(
        null,
        series.map(function (s) {
          return s.value;
        })
      )
    );
    var minV = 0;
    var span = Math.max(1, maxV - minV);
    var baselineY = padT + chartH;

    var points = series.map(function (s, idx) {
      var x =
        series.length === 1
          ? padL + chartW / 2
          : padL + (idx / (series.length - 1)) * chartW;
      var y = padT + chartH - ((s.value - minV) / span) * (chartH - 8);
      return {
        x: x,
        y: y,
        label: s.label,
        fullLabel: s.fullLabel,
        value: s.value,
        display: formatChartValue(s.value, isRevenue),
        forecast: s.forecast
      };
    });
    meta.points = points;
    meta.layout = { padL: padL, padT: padT, chartW: chartW, chartH: chartH, w: w, h: h };

    // Light horizontal guides (readability only)
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) {
      var gy = padT + (chartH * g) / 3;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + chartW, gy);
      ctx.stroke();
    }

    var split = 0;
    for (var i = 0; i < points.length; i++) {
      if (points[i].forecast) break;
      split = i + 1;
    }

    var pastPts = points.slice(0, Math.max(split, 0));
    var forecastPts =
      split > 0 && split < points.length
        ? points.slice(split - 1)
        : points.slice(split);

    if (pastPts.length >= 2) fillSmoothUnder(ctx, pastPts, baselineY, GREEN_SOFT);
    if (forecastPts.length >= 2) fillSmoothUnder(ctx, forecastPts, baselineY, PINK_SOFT);

    if (pastPts.length >= 2) strokeSmoothSegment(ctx, pastPts, GREEN);
    else if (pastPts.length === 1 && forecastPts.length < 2) {
      ctx.beginPath();
      ctx.arc(pastPts[0].x, pastPts[0].y, 3, 0, Math.PI * 2);
      ctx.fillStyle = GREEN;
      ctx.fill();
    }

    if (forecastPts.length >= 2) strokeSmoothSegment(ctx, forecastPts, PINK);
    else if (forecastPts.length === 1) {
      ctx.beginPath();
      ctx.arc(forecastPts[0].x, forecastPts[0].y, 3, 0, Math.PI * 2);
      ctx.fillStyle = PINK;
      ctx.fill();
    }

    // Data points
    points.forEach(function (p, idx) {
      var active = hoverIndex === idx;
      var color = p.forecast ? PINK : GREEN;
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 5.5 : 3.8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = active ? 2.4 : 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    });

    // Month labels — keep sparse if many points or narrow screens
    ctx.fillStyle = MUTED;
    ctx.font = "10px Poppins, sans-serif";
    ctx.textAlign = "center";
    var labelStep = 1;
    if (points.length > 10 || w < 420) labelStep = 3;
    else if (points.length > 8 || w < 560) labelStep = 2;
    points.forEach(function (p, idx) {
      if (idx % labelStep !== 0 && idx !== points.length - 1) return;
      ctx.fillText(p.label, p.x, padT + chartH + 16);
    });
  }

  function drawHistoryForecastChart(canvasId, history, predictions, isRevenue) {
    var past = (history || []).slice(-4);
    var future = predictions || [];
    var series = past
      .map(function (p) {
        return {
          label: monthLabel(p.year, p.month).split(" ")[0],
          fullLabel: monthLabel(p.year, p.month),
          value: toNum(isRevenue ? p.revenue : p.bookings, 0),
          forecast: false
        };
      })
      .concat(
        future.map(function (p) {
          return {
            label: monthLabel(p.year, p.month).split(" ")[0],
            fullLabel: monthLabel(p.year, p.month),
            value: toNum(isRevenue ? p.predicted_revenue : p.predicted_bookings, 0),
            forecast: true
          };
        })
      );

    state.charts[canvasId] = {
      series: series,
      isRevenue: !!isRevenue,
      hoverIndex: state.charts[canvasId] ? state.charts[canvasId].hoverIndex : null,
      points: []
    };
    paintLineChart(canvasId);
    bindChartInteractions(canvasId);
  }

  function bindChartInteractions(canvasId) {
    var canvas = el(canvasId);
    if (!canvas || canvas.getAttribute("data-pa-bound") === "1") return;
    canvas.setAttribute("data-pa-bound", "1");

    canvas.addEventListener("mousemove", function (evt) {
      var meta = state.charts[canvasId];
      if (!meta || !meta.points || !meta.points.length) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * (meta.layout ? meta.layout.w : rect.width);
      var my = ((evt.clientY - rect.top) / rect.height) * (meta.layout ? meta.layout.h : rect.height);
      var idx = nearestChartPoint(meta, mx, my);
      if (idx < 0) {
        hideChartTooltip(canvasId);
        return;
      }
      if (meta.hoverIndex !== idx) {
        meta.hoverIndex = idx;
        paintLineChart(canvasId);
      }
      showChartTooltip(canvasId, meta.points[idx], evt.clientX, evt.clientY);
    });

    canvas.addEventListener("mouseleave", function () {
      hideChartTooltip(canvasId);
    });
  }

  function showSection(section) {
    state.section = section || "overview";
    document.querySelectorAll(".pa-section-btn").forEach(function (btn) {
      var active = btn.getAttribute("data-pa-section") === state.section;
      btn.classList.toggle("pa-section-btn--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll(".pa-view").forEach(function (view) {
      var match = view.getAttribute("data-pa-view") === state.section;
      if (match) view.removeAttribute("hidden");
      else view.setAttribute("hidden", "");
    });
    if (state.lastResult && state.section === "charts") {
      drawHistoryForecastChart(
        "paChartBookings",
        state.lastResult.history,
        state.lastResult.predictions,
        false
      );
      drawHistoryForecastChart(
        "paChartRevenue",
        state.lastResult.history,
        state.lastResult.predictions,
        true
      );
    }
  }

  function readFiltersFromDom() {
    state.horizon = el("paHorizon") ? parseInt(el("paHorizon").value, 10) || 6 : 6;
    state.facilityType = el("paFacilityType")
      ? normalizeFacilityType(el("paFacilityType").value)
      : "all";
    state.weatherFilter = el("paWeatherFilter") ? el("paWeatherFilter").value : "expected";
    state.yearFilter = el("paYearFilter") ? el("paYearFilter").value : "";
    state.monthFilter = el("paMonthFilter") ? el("paMonthFilter").value : "";
  }

  function populateYearOptions(result) {
    var sel = el("paYearFilter");
    if (!sel) return;
    var current = sel.value;
    var years = {};
    var nowY = new Date().getFullYear();
    years[nowY] = true;
    years[nowY + 1] = true;
    (result.history || []).forEach(function (h) {
      years[h.year] = true;
    });
    (result.predictions || []).forEach(function (p) {
      years[p.year] = true;
    });
    sel.textContent = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All years";
    sel.appendChild(all);
    Object.keys(years)
      .sort()
      .forEach(function (y) {
        var opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        sel.appendChild(opt);
      });
    if (current) sel.value = current;
  }

  function formatUpdated(iso) {
    try {
      var d = new Date(iso);
      return (
        "Updated " +
        d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }) +
        " · tap a section below"
      );
    } catch (e) {
      return "tap a section below";
    }
  }

  function renderOverview(result) {
    var preds = result.predictions || [];
    var sumBookings = preds.reduce(function (a, p) { return a + p.predicted_bookings; }, 0);
    var sumGuests = preds.reduce(function (a, p) { return a + p.predicted_guests; }, 0);
    var sumRevenue = preds.reduce(function (a, p) { return a + p.predicted_revenue; }, 0);
    var avgOcc = preds.length
      ? preds.reduce(function (a, p) { return a + p.predicted_occupancy; }, 0) / preds.length
      : 0;
    var avgConf = preds.length
      ? preds.reduce(function (a, p) { return a + p.confidence_level; }, 0) / preds.length
      : 0;

    setText("paKpiBookings", String(Math.round(sumBookings)));
    setText("paKpiGuests", String(Math.round(sumGuests)));
    setText("paKpiRevenue", fmtPHP(sumRevenue));
    setText("paKpiOccConf", Math.round(avgOcc) + "% · " + Math.round(avgConf) + "%");

    var fb = result.feedbackSignal || {};
    setText("paFbPositive", (fb.positiveCount || 0) + "/" + (fb.totalFeedback || 0));
    setText("paFbShare", Math.round((fb.positiveShare || 0) * 100) + "%");
    setText("paFbRating", (fb.avgRating || 0).toFixed(1) + " ★");
    var lift = fb.demandLiftPct || 0;
    setText("paFbLift", (lift >= 0 ? "+" : "") + lift + "%");
    setText("paModelNote", result.modelNote || "");
    setText("paUpdatedNote", formatUpdated(result.generatedAt));
  }

  function renderTable(result) {
    var host = el("paForecastTableBody");
    if (!host) return;
    host.textContent = "";
    var preds = result.predictions || [];
    if (!preds.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 8;
      td0.textContent = "No months match the selected filters.";
      td0.style.color = MUTED;
      tr0.appendChild(td0);
      host.appendChild(tr0);
      return;
    }
    preds.forEach(function (p) {
      var tr = document.createElement("tr");
      function td(text, className) {
        var cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text;
        return cell;
      }
      tr.appendChild(td(monthLabel(p.year, p.month)));
      tr.appendChild(td(String(Math.round(p.predicted_bookings))));
      tr.appendChild(td(String(Math.round(p.predicted_guests))));
      tr.appendChild(td(p.predicted_occupancy + "%"));
      tr.appendChild(td(fmtPHP(p.predicted_revenue)));
      var confTd = document.createElement("td");
      var pill = document.createElement("span");
      pill.className = "pa-conf-pill";
      pill.textContent = Math.round(p.confidence_level) + "%";
      confTd.appendChild(pill);
      tr.appendChild(confTd);
      var wDelta = p.weather_impact_pct;
      tr.appendChild(
        td(
          (wDelta >= 0 ? "+" : "") + wDelta + "%",
          wDelta >= 0 ? "pa-delta-pos" : "pa-delta-neg"
        )
      );
      var vs = p.revenue_delta_pct;
      tr.appendChild(
        td(
          vs == null ? "—" : (vs >= 0 ? "+" : "") + vs + "%",
          vs == null ? "" : vs >= 0 ? "pa-delta-pos" : "pa-delta-neg"
        )
      );
      host.appendChild(tr);
    });
  }

  function renderWeather(result) {
    var host = el("paWeatherImpactList");
    if (!host) return;
    host.textContent = "";
    var icons = { sunny: "☀", rainy: "☂", stormy: "⛈" };
    (result.impactScenarios || []).forEach(function (s) {
      var row = document.createElement("div");
      row.className = "pa-weather-row pa-weather-row--" + s.weather;
      var left = document.createElement("div");
      left.className = "pa-weather-row__left";
      var ico = document.createElement("span");
      ico.className = "pa-weather-ico";
      ico.textContent = icons[s.weather] || "☁";
      var copy = document.createElement("div");
      var name = document.createElement("p");
      name.className = "pa-weather-name";
      name.textContent = s.label;
      var desc = document.createElement("p");
      desc.className = "pa-weather-desc";
      desc.textContent = s.description;
      copy.appendChild(name);
      copy.appendChild(desc);
      left.appendChild(ico);
      left.appendChild(copy);
      var right = document.createElement("div");
      right.className = "pa-weather-row__right";
      var pct = document.createElement("p");
      pct.className =
        "pa-weather-pct " + (s.delta_pct >= 0 ? "pa-delta-pos" : "pa-delta-neg");
      pct.textContent = (s.delta_pct >= 0 ? "+" : "") + s.delta_pct + "%";
      var books = document.createElement("p");
      books.className = "pa-weather-bookings";
      books.textContent =
        (s.delta_bookings >= 0 ? "+" : "") +
        Math.round(s.delta_bookings) +
        " bookings";
      right.appendChild(pct);
      right.appendChild(books);
      row.appendChild(left);
      row.appendChild(right);
      host.appendChild(row);
    });
  }

  function renderRecommendations(result) {
    var host = el("paRecommendationsList");
    if (!host) return;
    host.textContent = "";
    (result.recommendations || []).forEach(function (r) {
      var li = document.createElement("li");
      li.className = "pa-rec-item";
      var ico = document.createElement("span");
      ico.className = "pa-rec-ico";
      ico.textContent = r.icon || "•";
      var body = document.createElement("div");
      var title = document.createElement("h4");
      title.className = "pa-rec-title";
      title.textContent = r.title;
      var meta = document.createElement("p");
      meta.className = "pa-rec-meta";
      meta.textContent = r.meta || "";
      var detail = document.createElement("p");
      detail.className = "pa-rec-detail";
      detail.textContent = r.detail;
      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(detail);
      var badge = document.createElement("span");
      badge.className =
        "pa-priority" + (r.priority === "medium" ? " pa-priority--medium" : "");
      badge.textContent = String(r.priority || "high").toUpperCase();
      li.appendChild(ico);
      li.appendChild(body);
      li.appendChild(badge);
      host.appendChild(li);
    });
  }

  function renderIncomeCompare(result) {
    var host = el("paIncomeCompare");
    if (!host) return;
    host.textContent = "";
    var history = (result.history || []).filter(function (h) {
      return !h.synthetic;
    }).slice(-3);
    if (!history.length) history = (result.history || []).slice(-3);
    var preds = (result.predictions || []).slice(0, 3);
    var table = document.createElement("table");
    table.className = "pa-table pa-table--compact";
    table.innerHTML =
      "<thead><tr><th>Period</th><th>Type</th><th>Revenue</th><th>vs prior</th></tr></thead>";
    var tbody = document.createElement("tbody");
    history.forEach(function (h, idx) {
      var prev = idx > 0 ? history[idx - 1] : null;
      var delta = prev ? h.revenue - prev.revenue : null;
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        monthLabel(h.year, h.month) +
        "</td><td>Actual</td><td>" +
        fmtPHP(h.revenue) +
        "</td><td class='" +
        (delta == null ? "" : delta >= 0 ? "pa-delta-pos" : "pa-delta-neg") +
        "'>" +
        (delta == null
          ? "—"
          : (delta >= 0 ? "+" : "−") + fmtPHP(Math.abs(delta))) +
        "</td>";
      tbody.appendChild(tr);
    });
    preds.forEach(function (p) {
      var tr = document.createElement("tr");
      tr.className = "pa-row-forecast";
      var vs = p.revenue_delta_pct;
      tr.innerHTML =
        "<td>" +
        monthLabel(p.year, p.month) +
        "</td><td>Forecast</td><td>" +
        fmtPHP(p.predicted_revenue) +
        "</td><td class='" +
        (vs == null ? "" : vs >= 0 ? "pa-delta-pos" : "pa-delta-neg") +
        "'>" +
        (vs == null ? "—" : (vs >= 0 ? "+" : "") + vs + "%") +
        "</td>";
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderCharts(result) {
    drawHistoryForecastChart("paChartBookings", result.history, result.predictions, false);
    drawHistoryForecastChart("paChartRevenue", result.history, result.predictions, true);
    var guests = (result.predictions || [])
      .map(function (p) {
        return Math.round(p.predicted_guests);
      })
      .join(" · ");
    setText("paGuestsFooter", guests ? "Guests (next months): " + guests : "");
    var revenues = (result.predictions || [])
      .map(function (p) {
        return fmtPHP(p.predicted_revenue);
      })
      .join(" · ");
    setText("paRevenueFooter", revenues ? "Revenue (next months): " + revenues : "");
    renderChartAnalytics(result);
  }

  function shortMonthName(y, m) {
    return monthLabel(y, m).split(" ")[0];
  }

  function pickExtrema(rows, getter) {
    if (!rows || !rows.length) return { max: null, min: null };
    var max = rows[0];
    var min = rows[0];
    rows.forEach(function (row) {
      if (getter(row) > getter(max)) max = row;
      if (getter(row) < getter(min)) min = row;
    });
    return { max: max, min: min };
  }

  function fillInsightList(listId, items) {
    var list = el(listId);
    if (!list) return;
    list.textContent = "";
    (items || []).forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function padInsights(items, extras) {
    var out = (items || []).slice(0, 4);
    var i = 0;
    extras = extras || [];
    while (out.length < 4 && extras[i]) {
      if (out.indexOf(extras[i]) === -1) out.push(extras[i]);
      i += 1;
    }
    return out.slice(0, 4);
  }

  function buildBookingChartInsights(history, preds) {
    var past = (history || []).slice(-4);
    var future = preds || [];
    var items = [];
    if (!past.length && !future.length) {
      return ["No booking history or forecast is available for the current filters."];
    }

    if (past.length) {
      var hist = pickExtrema(past, function (h) {
        return toNum(h.bookings, 0);
      });
      items.push(
        "Recent peak was " +
          shortMonthName(hist.max.year, hist.max.month) +
          " (" +
          Math.round(hist.max.bookings) +
          " bookings). Lowest recent month was " +
          shortMonthName(hist.min.year, hist.min.month) +
          " (" +
          Math.round(hist.min.bookings) +
          ")."
      );
    }

    if (future.length) {
      var fExt = pickExtrema(future, function (p) {
        return toNum(p.predicted_bookings, 0);
      });
      items.push(
        "Forecast peaks in " +
          shortMonthName(fExt.max.year, fExt.max.month) +
          " at " +
          Math.round(fExt.max.predicted_bookings) +
          " bookings (~" +
          Math.round(fExt.max.predicted_guests) +
          " guests). Softest outlook is " +
          shortMonthName(fExt.min.year, fExt.min.month) +
          " (" +
          Math.round(fExt.min.predicted_bookings) +
          " bookings, ~" +
          Math.round(fExt.min.predicted_guests) +
          " guests)."
      );

      var first = future[0];
      var firstGuests = toNum(first.predicted_guests, 0);
      var peakGuests = toNum(fExt.max.predicted_guests, 0);
      if (firstGuests > 0 && peakGuests > firstGuests) {
        var guestGrowth = Math.round(((peakGuests - firstGuests) / firstGuests) * 100);
        items.push(
          "Guest volume is projected to rise " +
            guestGrowth +
            "% from " +
            shortMonthName(first.year, first.month) +
            " (" +
            Math.round(firstGuests) +
            ") to " +
            shortMonthName(fExt.max.year, fExt.max.month) +
            " (" +
            Math.round(peakGuests) +
            ")."
        );
      }

      if (past.length) {
        var lastHist = past[past.length - 1];
        var lastBookings = toNum(lastHist.bookings, 0);
        var nextBookings = toNum(first.predicted_bookings, 0);
        if (lastBookings > 0 && nextBookings >= lastBookings * 1.15) {
          items.push(
            "The outlook recovers after " +
              shortMonthName(lastHist.year, lastHist.month) +
              ", with bookings rising into " +
              shortMonthName(first.year, first.month) +
              " and the months that follow."
          );
        } else if (lastBookings > 0 && nextBookings < lastBookings * 0.9) {
          items.push(
            shortMonthName(first.year, first.month) +
              " is forecast softer than the latest actual month. Promotions in that window can help rebuild volume."
          );
        }
      }

      var hasDec = future.some(function (p) {
        return Number(p.month) === 12;
      });
      var hasJul = past.some(function (h) {
        return Number(h.month) === 7;
      });
      if (hasDec && hasJul) {
        items.push(
          "Seasonality is visible: a summer peak and a stronger holiday-season outlook toward December."
        );
      }
    }

    return padInsights(items, [
      "Guest demand and reservation volume move together across the forecast horizon.",
      "Use the stronger months for staffing and the softer months for promotions."
    ]);
  }

  function buildRevenueChartInsights(history, preds) {
    var past = (history || []).slice(-4);
    var future = preds || [];
    var items = [];
    if (!past.length && !future.length) {
      return ["No revenue history or forecast is available for the current filters."];
    }

    if (past.length) {
      var hist = pickExtrema(past, function (h) {
        return toNum(h.revenue, 0);
      });
      items.push(
        "Confirmed revenue peaked in " +
          shortMonthName(hist.max.year, hist.max.month) +
          " at " +
          fmtPHP(hist.max.revenue) +
          ", then was weakest in " +
          shortMonthName(hist.min.year, hist.min.month) +
          " (" +
          fmtPHP(hist.min.revenue) +
          ")."
      );
    }

    if (future.length) {
      var fExt = pickExtrema(future, function (p) {
        return toNum(p.predicted_revenue, 0);
      });
      items.push(
        "Forecasted revenue is highest in " +
          shortMonthName(fExt.max.year, fExt.max.month) +
          " (" +
          fmtPHP(fExt.max.predicted_revenue) +
          ") and lowest in " +
          shortMonthName(fExt.min.year, fExt.min.month) +
          " (" +
          fmtPHP(fExt.min.predicted_revenue) +
          ")."
      );

      var first = future[0];
      var last = future[future.length - 1];
      var firstRev = toNum(first.predicted_revenue, 0);
      var peakRev = toNum(fExt.max.predicted_revenue, 0);
      if (firstRev > 0 && peakRev > firstRev) {
        var revGrowth = Math.round(((peakRev - firstRev) / firstRev) * 100);
        items.push(
          "Revenue is projected to climb " +
            revGrowth +
            "% from " +
            shortMonthName(first.year, first.month) +
            " to " +
            shortMonthName(fExt.max.year, fExt.max.month) +
            "."
        );
      }

      var lastRev = toNum(last.predicted_revenue, 0);
      if (firstRev > 0 && last !== first) {
        if (lastRev > firstRev) {
          items.push(
            shortMonthName(last.year, last.month) +
              " is still stronger than the forecast start in " +
              shortMonthName(first.year, first.month) +
              " (" +
              fmtPHP(lastRev) +
              " vs " +
              fmtPHP(firstRev) +
              "), so the recovery is expected to hold."
          );
        } else if (lastRev < firstRev * 0.9) {
          items.push(
            "By " +
              shortMonthName(last.year, last.month) +
              " revenue eases versus " +
              shortMonthName(first.year, first.month) +
              ". Plan promotions after the peak to keep income steadier."
          );
        }
      }

      items.push(
        "Revenue follows the same shape as bookings, so guest volume is the main driver of the income outlook."
      );
    }

    return padInsights(items, [
      "Revenue follows the same shape as bookings, so guest volume is the main driver of the income outlook.",
      "Keep packages ready for the stronger months and promotions ready for the softer ones."
    ]);
  }

  function renderChartAnalytics(result) {
    var history = (result && result.history) || [];
    var preds = (result && result.predictions) || [];
    fillInsightList("paBookingsInsightsList", buildBookingChartInsights(history, preds));
    fillInsightList("paRevenueInsightsList", buildRevenueChartInsights(history, preds));
  }

  function renderAll(result) {
    if (!result) return;
    populateYearOptions(result);
    renderOverview(result);
    renderCharts(result);
    renderTable(result);
    renderWeather(result);
    renderRecommendations(result);
    renderIncomeCompare(result);
    showSection(state.section);
  }

  function refresh(options) {
    options = options || {};
    // One in-flight forecast at a time (filter changes / live updates reuse it).
    if (state.inFlight) {
      return state.inFlight;
    }
    readFiltersFromDom();
    setLive(true);
    state.loading = true;
    state.lastError = null;
    if (!state.lastResult) showPaLoading();
    else setPaStatus("loading", "Loading predictive analytics...");
    var btn = el("paRunForecastBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Updating…";
    }
    state.inFlight = generateForecast({
      horizon: options.horizon != null ? options.horizon : state.horizon,
      facilityType:
        options.facilityType != null ? options.facilityType : state.facilityType,
      weatherFilter:
        options.weatherFilter != null ? options.weatherFilter : state.weatherFilter,
      yearFilter: options.yearFilter != null ? options.yearFilter : state.yearFilter,
      monthFilter:
        options.monthFilter != null ? options.monthFilter : state.monthFilter,
      persist: options.persist !== false,
      preferLocal: !!options.preferLocal
    })
      .then(function (result) {
        state.lastError = null;
        clearPaStatus();
        if (isPredictiveSectionVisible()) renderAll(result);
        return result;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest] Predictive analytics failed:", err);
        } catch (e) {}
        showPaError(err);
        return state.lastResult;
      })
      .finally(function () {
        state.loading = false;
        state.inFlight = null;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Refresh";
        }
      });
    return state.inFlight;
  }

  function scheduleVisibleRefresh(options) {
    options = options || {};
    if (!isPredictiveSectionVisible()) return;
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(function () {
      state.refreshTimer = null;
      if (!isPredictiveSectionVisible()) return;
      refresh({
        persist: false,
        preferLocal: true,
        skipIfLoading: true
      });
    }, options.delay != null ? options.delay : 450);
  }

  function bindUi() {
    if (state.bound) return;
    state.bound = true;

    ["paHorizon", "paFacilityType", "paWeatherFilter", "paYearFilter", "paMonthFilter"].forEach(
      function (id) {
        var node = el(id);
        if (!node) return;
        node.addEventListener("change", function () {
          refresh({ persist: true, skipIfLoading: true });
        });
      }
    );

    var runBtn = el("paRunForecastBtn");
    if (runBtn) {
      runBtn.addEventListener("click", function () {
        refresh({ persist: true });
      });
    }

    var retryBtn = el("paStatusRetry");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        refresh({ persist: true });
      });
    }

    document.querySelectorAll(".pa-section-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showSection(btn.getAttribute("data-pa-section"));
      });
    });
    document.querySelectorAll("[data-pa-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showSection(btn.getAttribute("data-pa-jump"));
      });
    });

    // Only refresh while this section is open — never run forecasts in the background
    // (that was freezing the whole admin UI / blocking clicks).
    window.addEventListener("elenest-bookings-updated", function () {
      scheduleVisibleRefresh();
    });
    window.addEventListener("elenest-feedback-updated", function () {
      scheduleVisibleRefresh();
    });
    window.addEventListener("resize", function () {
      if (!isPredictiveSectionVisible()) return;
      if (state.lastResult && state.section === "charts") renderCharts(state.lastResult);
    });
  }

  function renderSection() {
    bindUi();
    showPaLoading();
    return refresh({ persist: true, skipIfLoading: true });
  }

  window.ElenestPredictiveAnalytics = {
    renderSection: renderSection,
    refresh: refresh,
    generateForecast: generateForecast,
    runForecast: function (opts) {
      return generateForecast(opts || {});
    },
    getLastResult: function () {
      return state.lastResult;
    }
  };
})();
