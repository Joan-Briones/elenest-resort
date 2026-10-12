                                                                                                                    (function () {
  var STORAGE = "elenest_bookings";
  var STORAGE_USERS = "elenest_users";
  var STORAGE_STAFF_PASSWORDS = "elenest_staff_passwords";
  var STORAGE_ROOM_CATALOG = "elenest_room_catalog";

  function listBookings() {
    var B = window.ElenestBookings;
    if (B && typeof B.listLive === "function") return B.listLive();
    if (B && typeof B.listAll === "function") return B.listAll();
    return readAllBookings();
  }

  function listBookingsAll() {
    var B = window.ElenestBookings;
    if (B && typeof B.listAll === "function") return B.listAll();
    return listBookings();
  }

  /* Historical report rows are aggregated in the background — never keep 3,000
     full booking objects in memory (that was freezing the admin tab). */
  var pastReportBookingsCache = null;
  var pastReportBookingsPromise = null;
  var pastReportLiteItems = null;

  function fetchJsonFile(url) {
    return fetch(url, { cache: "force-cache" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + url);
      return res.json();
    });
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function pastRowToLiteItem(row) {
    if (!row) return null;
    var payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    return {
      accountEmail: "",
      booking: {
        id: row.id,
        checkIn: row.check_in || row.checkIn || payload.checkIn || "",
        status: row.status || payload.status || "Confirmed",
        totalEstimate:
          row.total_estimate != null
            ? row.total_estimate
            : payload.totalEstimate,
        amountDown:
          row.amount_down != null ? row.amount_down : payload.amountDown,
        roomType: row.room_type || payload.roomType || "",
        sheetType: payload.sheetType || payload.type || row.room_type || "",
        type: payload.type || payload.sheetType || row.room_type || "",
        eventHall: payload.eventHall || "",
        historical: true
      }
    };
  }

  function finalizePastReportLiteItems(items) {
    pastReportLiteItems = items || [];
    pastReportBookingsCache = pastReportLiteItems;
    pastReportBookingsPromise = null;
    return pastReportLiteItems;
  }

  function liteItemsFromHistoricalEntries(entries) {
    var items = [];
    var i;
    for (i = 0; i < (entries || []).length; i++) {
      var entry = entries[i];
      var b = entry && entry.booking;
      if (!b || !b.id) continue;
      items.push({
        accountEmail: entry.accountEmail || "",
        booking: {
          id: b.id,
          checkIn: b.checkIn || b.check_in || "",
          status: b.status || "Confirmed",
          totalEstimate:
            b.totalEstimate != null ? b.totalEstimate : b.total_estimate,
          amountDown: b.amountDown != null ? b.amountDown : b.amount_down,
          roomType: b.roomType || b.room_type || "",
          sheetType: b.sheetType || b.type || b.roomType || "",
          type: b.type || b.sheetType || b.roomType || "",
          eventHall: b.eventHall || "",
          historical: true
        }
      });
    }
    return items;
  }

  /** Load historical bookings — Supabase first (via ElenestBookings), then JSON files. */
  function loadPastReportBookings() {
    if (pastReportLiteItems) return Promise.resolve(pastReportLiteItems);
    if (pastReportBookingsPromise) return pastReportBookingsPromise;

    function loadFromJsonFiles() {
      var HD = window.ElenestHistoricalData;
      if (HD && typeof HD.loadBookings === "function") {
        return HD.loadBookings().then(function (result) {
          var rows = (result && result.rows) || [];
          var items = [];
          var j;
          for (j = 0; j < rows.length; j++) {
            var item = pastRowToLiteItem(rows[j]);
            if (item) items.push(item);
          }
          return items;
        });
      }
      return fetchJsonFile("../data/historical-manifest.json")
        .then(function (manifest) {
          var urls = (manifest && manifest.bookings) || [];
          var items = [];
          var i = 0;
          function next() {
            if (i >= urls.length) return Promise.resolve(items);
            var url = urls[i++];
            return fetchJsonFile(url)
              .then(function (rows) {
                var chunk = rows || [];
                var j;
                for (j = 0; j < chunk.length; j++) {
                  var item = pastRowToLiteItem(chunk[j]);
                  if (item) items.push(item);
                }
                return yieldToBrowser().then(next);
              })
              .catch(function () {
                return yieldToBrowser().then(next);
              });
          }
          return next();
        })
        .catch(function () {
          return [];
        });
    }

    var B = window.ElenestBookings;
    pastReportBookingsPromise = (
      B && typeof B.ensureHistoricalLoaded === "function"
        ? B.ensureHistoricalLoaded()
        : Promise.resolve([])
    )
      .then(function (entries) {
        var fromApi = liteItemsFromHistoricalEntries(entries);
        // If Supabase (or merged cache) already has past rows, use that as source of truth.
        if (fromApi.length) return finalizePastReportLiteItems(fromApi);
        return loadFromJsonFiles().then(finalizePastReportLiteItems);
      })
      .catch(function () {
        return loadFromJsonFiles()
          .then(finalizePastReportLiteItems)
          .catch(function () {
            return finalizePastReportLiteItems(pastReportLiteItems || []);
          });
      });
    return pastReportBookingsPromise;
  }

  function mergeReportBookings(live, past) {
    var byId = {};
    var out = [];
    function add(item) {
      var b = item && item.booking;
      if (!b || !b.id) return;
      var id = String(b.id);
      if (byId[id]) return;
      byId[id] = true;
      out.push(item);
    }
    (live || []).forEach(add);
    (past || []).forEach(add);
    return out;
  }

  var ADMIN_PAGE_SIZE = 5;
  var adminListPages = {
    bookingReview: 1,
    paymentVerification: 1,
    arrivalMonitoring: 1,
    paymentHistory: 1,
    userAccounts: 1
  };
  var paymentPeriodFilter = {
    mode: "all",
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    week: paymentWeekNumberForDate(new Date())
  };
  var PAYMENT_MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  var PAYMENT_MONTH_SHORT = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  var staffAccountsCache = null;

  function hasSwal() {
    return typeof Swal !== "undefined" && typeof Swal.fire === "function";
  }

  function swalConfirm(options) {
    options = options || {};
    var text = options.text || options.message || "Are you sure?";
    if (!hasSwal()) {
      return Promise.resolve(window.confirm(text));
    }
    return Swal.fire({
      icon: options.icon || "question",
      title: options.title || "Please confirm",
      text: text,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: options.confirmText || "OK",
      cancelButtonText: options.cancelText || "Cancel",
      confirmButtonColor: options.confirmColor || "#c46b82",
      cancelButtonColor: "#6b7280",
      reverseButtons: true
    }).then(function (result) {
      return !!(result && result.isConfirmed);
    });
  }

  function swalAlert(options) {
    options = options || {};
    var text = options.text || options.message || "";
    if (!hasSwal()) {
      window.alert(text);
      return Promise.resolve();
    }
    return Swal.fire({
      icon: options.icon || "info",
      title: options.title || "",
      text: text,
      confirmButtonText: options.confirmText || "OK",
      confirmButtonColor: options.confirmColor || "#c46b82"
    });
  }

  function swalPrompt(options) {
    options = options || {};
    var label = options.text || options.message || "";
    if (!hasSwal()) {
      var value = window.prompt(label, options.defaultValue || "");
      return Promise.resolve(value === null ? null : String(value));
    }
    return Swal.fire({
      icon: options.icon || "question",
      title: options.title || "Enter details",
      text: label,
      input: "text",
      inputValue: options.defaultValue || "",
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: options.confirmText || "Continue",
      cancelButtonText: options.cancelText || "Cancel",
      confirmButtonColor: options.confirmColor || "#c46b82",
      cancelButtonColor: "#6b7280",
      reverseButtons: true
    }).then(function (result) {
      if (!result || !result.isConfirmed) return null;
      return result.value == null ? "" : String(result.value);
    });
  }

  function paginateItems(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Number(pageSize) || ADMIN_PAGE_SIZE);
    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / size) || 1);
    var current = Math.max(1, Math.min(Number(page) || 1, totalPages));
    var start = (current - 1) * size;
    return {
      items: list.slice(start, start + size),
      page: current,
      pageSize: size,
      total: total,
      totalPages: totalPages,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total)
    };
  }

  function renderPaginationControls(host, state, onPageChange) {
    if (!host) return;
    host.textContent = "";
    if (!state || state.total <= state.pageSize) {
      host.hidden = true;
      host.removeAttribute("data-has-pages");
      return;
    }
    host.hidden = false;
    host.setAttribute("data-has-pages", "1");
    host.className = "admin-pagination";

    var info = document.createElement("span");
    info.className = "admin-pagination__info";
    info.textContent =
      "Showing " + state.from + "–" + state.to + " of " + state.total;

    var nav = document.createElement("div");
    nav.className = "admin-pagination__nav";

    function makeBtn(label, disabled, page) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline btn--small";
      btn.textContent = label;
      btn.disabled = !!disabled;
      if (!disabled) {
        btn.addEventListener("click", function () {
          onPageChange(page);
        });
      }
      return btn;
    }

    nav.appendChild(makeBtn("Prev", state.page <= 1, state.page - 1));

    var pageLabel = document.createElement("span");
    pageLabel.className = "admin-pagination__page";
    pageLabel.textContent = "Page " + state.page + " / " + state.totalPages;
    nav.appendChild(pageLabel);

    nav.appendChild(makeBtn("Next", state.page >= state.totalPages, state.page + 1));

    host.appendChild(info);
    host.appendChild(nav);

    // Keep reports pagination collapsed when its sibling list is still hidden.
    var listSibling = host.previousElementSibling;
    if (listSibling && listSibling.hasAttribute("hidden")) {
      host.setAttribute("hidden", "");
    }
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function getUsers() {
    try {
      var raw = localStorage.getItem(STORAGE_USERS);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }

  function readStaffPasswordMap() {
    try {
      var raw = localStorage.getItem(STORAGE_STAFF_PASSWORDS);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function rememberStaffPassword(email, password) {
    var key = normalizeEmail(email);
    var value = password != null ? String(password) : "";
    if (!key || !value) return;
    var map = readStaffPasswordMap();
    map[key] = value;
    try {
      localStorage.setItem(STORAGE_STAFF_PASSWORDS, JSON.stringify(map));
    } catch (e) {}
    var users = getUsers();
    var found = false;
    users = users.map(function (row) {
      if (normalizeEmail(row && row.email) !== key) return row;
      found = true;
      var next = Object.assign({}, row, { password: value });
      return next;
    });
    if (!found) {
      users.push({ email: key, password: value });
    }
    saveUsers(users);
  }

  function getRoomCatalog() {
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilitiesAll === "function") return S.getFacilitiesAll();
    try {
      var raw = localStorage.getItem(STORAGE_ROOM_CATALOG);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRoomCatalog(list) {
    var S = window.ElenestContentStore;
    if (S && typeof S.saveFacilities === "function") {
      return S.saveFacilities(list);
    }
    localStorage.setItem(STORAGE_ROOM_CATALOG, JSON.stringify(list));
    return Promise.resolve(true);
  }

  function getAll() {
    try {
      var raw = localStorage.getItem(STORAGE);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function feedbackGuestName(f) {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.displayName === "function") return api.displayName(f);
    var name = String((f && f.name) || "").trim();
    if (!name || name.toLowerCase() === "guest") return "Guest";
    return name;
  }

  function getFeedback() {
    if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listLive === "function") {
      return window.ElenestGuestFeedback.listLive();
    }
    if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.listAll === "function") {
      return window.ElenestGuestFeedback.listAll();
    }
    try {
      var raw = localStorage.getItem("elenest_feedback");
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Same review KPI set as the public homepage (home-reviews.js):
   * Average rating (X.X/5), Would recommend (%), Total reviews.
   * Uses live + historical so totals match the home page.
   */
  function getAllReviewRecordsForHomeKpis() {
    var GF = window.ElenestGuestFeedback;
    if (GF && typeof GF.listAll === "function") return GF.listAll() || [];
    if (GF && typeof GF.listLive === "function") return GF.listLive() || [];
    return getFeedback();
  }

  function getSupabaseForReviews() {
    try {
      if (
        window.ElenestSupabaseHelpers &&
        typeof window.ElenestSupabaseHelpers.getClient === "function"
      ) {
        return window.ElenestSupabaseHelpers.getClient();
      }
    } catch (e) {}
    return window.ElenestSupabase || null;
  }

  var homeReviewKpisCache = null;
  var homeReviewKpisPromise = null;

  function invalidateFullReviewsCache() {
    homeReviewKpisCache = null;
    homeReviewKpisPromise = null;
  }

  function yieldToUi() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function isRecommendableReview(f) {
    var raw = String((f && (f.sentiment || f.sentimentLabel)) || "")
      .trim()
      .toLowerCase();
    if (/^(pos|positive)\b/.test(raw) || raw === "pos") return true;
    return Number(f && f.stars) >= 4;
  }

  function computeHomeStyleReviewKpis(list) {
    var rows = list || [];
    var total = rows.length;
    var withStars = rows.filter(function (f) {
      return Number(f.stars) > 0;
    });
    var average = 0;
    if (withStars.length) {
      var sum = withStars.reduce(function (a, c) {
        return a + Number(c.stars || 0);
      }, 0);
      average = sum / withStars.length;
    }
    var recommend = total
      ? Math.round((rows.filter(isRecommendableReview).length / total) * 100)
      : 0;
    return { average: average, recommend: recommend, total: total };
  }

  function createEmptyReviewKpiAccumulator() {
    var buckets = buildSentimentMonthBuckets(6);
    var byKey = {};
    buckets.forEach(function (b) {
      byKey[b.key] = b;
    });
    return {
      total: 0,
      starSum: 0,
      starN: 0,
      recommend: 0,
      pos: 0,
      neu: 0,
      neg: 0,
      buckets: buckets,
      byKey: byKey,
      seen: {}
    };
  }

  function accumulateReviewRow(acc, row) {
    if (!row) return;
    var id = String(row.id || "");
    if (id) {
      if (acc.seen[id]) return;
      acc.seen[id] = true;
    }
    acc.total += 1;
    var s = Number(row.stars != null ? row.stars : row.rating) || 0;
    if (s > 0) {
      acc.starSum += s;
      acc.starN += 1;
    }
    if (isRecommendableReview(row)) acc.recommend += 1;
    var cl = classifySentimentFromStars(s);
    if (cl === "pos") acc.pos += 1;
    else if (cl === "neg") acc.neg += 1;
    else acc.neu += 1;
    var iso = row.createdAt || row.created_at || row.submittedAt || "";
    var mk = monthKeyFromIso(iso);
    if (mk && acc.byKey[mk]) {
      if (cl === "pos") acc.byKey[mk].pos += 1;
      else if (cl === "neg") acc.byKey[mk].neg += 1;
      else acc.byKey[mk].neu += 1;
    }
  }

  function finalizeReviewKpiAccumulator(acc) {
    var total = acc.total;
    var pct = function (n) {
      return total ? Math.round((n / total) * 100) : 0;
    };
    return {
      average: acc.starN ? acc.starSum / acc.starN : 0,
      recommend: total ? Math.round((acc.recommend / total) * 100) : 0,
      total: total,
      pos: acc.pos,
      neu: acc.neu,
      neg: acc.neg,
      pctPos: pct(acc.pos),
      pctNeu: pct(acc.neu),
      pctNeg: pct(acc.neg),
      buckets: acc.buckets
    };
  }

  function fetchSupabaseFeedbackPagesInto(acc) {
    var sb = getSupabaseForReviews();
    if (!sb || typeof sb.from !== "function") return Promise.resolve(acc);

    function fetchPage(from, pageSize, columns) {
      return sb
        .from("guest_feedback")
        .select(columns)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          var i;
          for (i = 0; i < rows.length; i++) accumulateReviewRow(acc, rows[i]);
          if (rows.length === pageSize) {
            return yieldToUi().then(function () {
              return fetchPage(from + pageSize, pageSize, columns);
            });
          }
          return acc;
        });
    }

    return fetchPage(0, 500, "id, stars, sentiment, created_at").catch(function () {
      return fetchPage(0, 500, "id, stars, created_at");
    });
  }

  function loadHistoricalFeedbackRowsInto(acc) {
    var HD = window.ElenestHistoricalData;
    var GF = window.ElenestGuestFeedback;
    var tasks = [];

    if (GF && typeof GF.ensureHistoricalLoaded === "function") {
      tasks.push(
        GF.ensureHistoricalLoaded().then(function () {
          var list =
            typeof GF.listAll === "function" ? GF.listAll() : getAllReviewRecordsForHomeKpis();
          var i;
          for (i = 0; i < (list || []).length; i++) accumulateReviewRow(acc, list[i]);
        })
      );
    }

    if (HD && typeof HD.loadFeedback === "function") {
      tasks.push(
        HD.loadFeedback()
          .then(function (result) {
            var rows = (result && result.rows) || [];
            var i = 0;
            function chunk() {
              var end = Math.min(i + 400, rows.length);
              for (; i < end; i++) accumulateReviewRow(acc, rows[i]);
              if (i < rows.length) return yieldToUi().then(chunk);
              return acc;
            }
            return chunk();
          })
          .catch(function () {
            return acc;
          })
      );
    }

    if (!tasks.length) {
      var local = getAllReviewRecordsForHomeKpis();
      var j;
      for (j = 0; j < (local || []).length; j++) accumulateReviewRow(acc, local[j]);
      return Promise.resolve(acc);
    }

    return Promise.all(tasks).then(function () {
      return acc;
    });
  }

  /** Load homepage review KPIs once; cache for smooth dashboard / reports paints. */
  function loadHomeReviewKpis(force) {
    if (force) {
      homeReviewKpisCache = null;
      if (homeReviewKpisPromise) return homeReviewKpisPromise;
    } else {
      if (homeReviewKpisCache) return Promise.resolve(homeReviewKpisCache);
      if (homeReviewKpisPromise) return homeReviewKpisPromise;
    }

    var acc = createEmptyReviewKpiAccumulator();
    homeReviewKpisPromise = loadHistoricalFeedbackRowsInto(acc)
      .then(function () {
        return yieldToUi();
      })
      .then(function () {
        return fetchSupabaseFeedbackPagesInto(acc);
      })
      .then(function () {
        var kpis = finalizeReviewKpiAccumulator(acc);
        homeReviewKpisCache = kpis;
        homeReviewKpisPromise = null;
        return kpis;
      })
      .catch(function () {
        homeReviewKpisPromise = null;
        var fallbackList = getAllReviewRecordsForHomeKpis();
        var fallback = computeHomeStyleReviewKpis(fallbackList);
        var liveAcc = createEmptyReviewKpiAccumulator();
        var i;
        for (i = 0; i < (fallbackList || []).length; i++) {
          accumulateReviewRow(liveAcc, fallbackList[i]);
        }
        homeReviewKpisCache = finalizeReviewKpiAccumulator(liveAcc);
        if (!homeReviewKpisCache.total) homeReviewKpisCache = Object.assign(fallback, {
          pctPos: 0,
          pctNeu: 0,
          pctNeg: 0,
          buckets: buildSentimentMonthBuckets(6)
        });
        return homeReviewKpisCache;
      });

    return homeReviewKpisPromise;
  }

  /** Live-only subset (no past-fb-*) — kept for sentiment/ops where historical is excluded. */
  function getLiveReviewRecordsForKpis() {
    var GF = window.ElenestGuestFeedback;
    var list =
      GF && typeof GF.listLive === "function"
        ? GF.listLive()
        : getFeedback();
    return (list || []).filter(function (f) {
      if (!f) return false;
      if (GF && typeof GF.isHistoricalFeedback === "function" && GF.isHistoricalFeedback(f)) {
        return false;
      }
      var id = String(f.id || "");
      return id.indexOf("past-fb-") !== 0;
    });
  }

  /** Active Guest Sentiment comments for the current Mon–Sun week (non-archived). */
  function getSentimentFeedback() {
    if (
      window.ElenestGuestFeedback &&
      typeof window.ElenestGuestFeedback.listForSentiment === "function"
    ) {
      return window.ElenestGuestFeedback.listForSentiment();
    }
    var all = getFeedback();
    var currentKey = weekStartKeyFromDate(new Date());
    return all.filter(function (f) {
      if (f.sentimentArchived) return false;
      var k =
        f.sentimentWeekKey ||
        (f.createdAt ? weekStartKeyFromDate(new Date(f.createdAt)) : currentKey);
      return k === currentKey;
    });
  }

  function ensureWeeklySentimentArchive() {
    var GF = window.ElenestGuestFeedback;
    if (!GF || typeof GF.ensureWeeklyArchive !== "function") {
      return Promise.resolve(false);
    }
    return GF.ensureWeeklyArchive(buildArchivedSentimentRecommendationPayload);
  }

  function buildArchivedSentimentRecommendationPayload(weekComments, weekLabel, weekKey) {
    var payload = buildSentimentRecommendationsPayload({
      allListLen: weekComments.length,
      recCount: weekComments.length,
      weekLabel: weekLabel,
      weekStartKey: weekKey,
      feedbackForRecommendation: weekComments,
      allList: weekComments,
      archiveMode: true
    });
    return enrichSentimentRecPayloadForArchive(payload, weekKey);
  }

  function registerSentimentArchiveBuilder() {
    var GF = window.ElenestGuestFeedback;
    if (!GF || typeof GF.setArchivePayloadBuilder !== "function") return;
    GF.setArchivePayloadBuilder(buildArchivedSentimentRecommendationPayload);
    if (typeof GF.scheduleArchiveRun === "function") {
      GF.scheduleArchiveRun();
    }
  }

  /** Shown in charts/details/recommendations until real guest feedback exists. */
  function getAdminExampleFeedback() {
    var t = new Date().toISOString();
    return [
      {
        id: "ex-fb-1",
        name: "Ariana Grande",
        stars: 5,
        comment:
          "Our cottage was peaceful and the pool was spotless. The event hall team handled our reunion setup professionally—overall service felt five-star.",
        createdAt: t
      },
      {
        id: "ex-fb-2",
        name: "Justin Bieber",
        stars: 2,
        comment:
          "Room smelled musty and the AC dripped. Several pool loungers were broken. Waited a long time at reception for extra towels.",
        createdAt: t
      },
      {
        id: "ex-fb-3",
        name: "Taylor Swift",
        stars: 3,
        comment:
          "Event hall lighting was too dim for our program. Room was clean but tight for four people. Pool area gets crowded on weekends.",
        createdAt: t
      }
    ];
  }

  var ACCEPTED_SENTIMENT_RECS_KEY = "elenest_accepted_sentiment_recs";
  var lastSentimentRecPayload = null;

  function getCurrentSentimentWeekKey() {
    var GF = window.ElenestGuestFeedback;
    if (GF && typeof GF.getCurrentWeekStartKey === "function") {
      return GF.getCurrentWeekStartKey();
    }
    return weekStartKeyFromDate(new Date());
  }

  function sentimentRecAcceptStorageId(recId, weekKey) {
    return (weekKey || getCurrentSentimentWeekKey()) + "::" + String(recId || "");
  }

  function getAcceptedSentimentRecIds() {
    try {
      var raw = localStorage.getItem(ACCEPTED_SENTIMENT_RECS_KEY);
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  function isSentimentRecAccepted(recId, weekKey) {
    return (
      getAcceptedSentimentRecIds().indexOf(
        sentimentRecAcceptStorageId(recId, weekKey)
      ) >= 0
    );
  }

  function addAcceptedSentimentRecId(recId, weekKey) {
    if (!recId) return;
    var storageId = sentimentRecAcceptStorageId(recId, weekKey);
    var s = getAcceptedSentimentRecIds();
    if (s.indexOf(storageId) >= 0) return;
    s.push(storageId);
    localStorage.setItem(ACCEPTED_SENTIMENT_RECS_KEY, JSON.stringify(s));
  }

  function enrichSentimentRecPayloadForArchive(payload, weekKey) {
    if (!payload) return payload;
    var copy = JSON.parse(JSON.stringify(payload));
    copy.weekStartKey = weekKey;
    var acceptedIds = getAcceptedSentimentRecIds();
    var anyAccepted = false;
    copy.items = (copy.items || []).map(function (item) {
      var recId = item.recId || "weekly-recommendation";
      var storageId = sentimentRecAcceptStorageId(recId, weekKey);
      var accepted = acceptedIds.indexOf(storageId) >= 0;
      if (accepted) anyAccepted = true;
      return Object.assign({}, item, { accepted: accepted });
    });
    copy.wasAccepted = anyAccepted;
    if (anyAccepted) {
      copy.acceptedAt = new Date().toISOString();
    }
    return copy;
  }

  var CATEGORY_LABELS = {
    room: "Rooms",
    pools: "Pools",
    events: "Event halls",
    cottage: "Cottages",
    services: "Services & staff",
    overall: "Overall experience"
  };

  var CATEGORY_PATTERNS = {
    room: /(room|rooms|suite|bed|bathroom|bath|shower|linen|pillow|towel|housekeeping|\bac\b|aircon|air con|cleanliness|musty)/i,
    pools: /(pool|pools|swimming|jacuzzi|lounger|lap pool)/i,
    events: /(event|hall|function|wedding|banquet|conference|venue|program|company lunch)/i,
    cottage: /(cottage|cabana|bungalow|hut|villa)/i,
    services: /(staff|service|reception|front desk|check-?in|check-?out|attendant|waiter|room service|concierge)/i
  };

  function detectFeedbackCategories(comment) {
    var c = String(comment || "");
    var found = [];
    Object.keys(CATEGORY_PATTERNS).forEach(function (key) {
      if (CATEGORY_PATTERNS[key].test(c)) found.push(key);
    });
    if (!found.length) found.push("overall");
    return found;
  }

  function snippetComment(f, maxLen) {
    var s = String((f && f.comment) || "").trim();
    if (!s) return "";
    maxLen = maxLen || 120;
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + "…";
  }

  var IMPROVEMENT_BY_AREA = {
    room: {
      recId: "imp-room",
      title: "Guest rooms",
      text:
        "Use a clear room checklist before every check-in. Confirm clean air, stable cooling, complete linens, and low noise so each room meets one quality standard."
    },
    pools: {
      recId: "imp-pools",
      title: "Pool area",
      text:
        "Inspect pool furniture and floor safety every day. Keep towel supply ready during peak hours, and record water quality and safety signs in a daily log."
    },
    events: {
      recId: "imp-events",
      title: "Event spaces",
      text:
        "Check cooling, lighting, sound, and power before each event. Give staff a simple service timeline for meal flow, room reset, and host support."
    },
    cottage: {
      recId: "imp-cottage",
      title: "Cottages",
      text:
        "Inspect each cottage before arrival for maintenance, privacy, and complete amenities. Ensure the actual setup matches the details shown in your booking materials."
    },
    services: {
      recId: "imp-services",
      title: "Service standards",
      text:
        "Set clear response-time targets for front desk and in-stay requests. Use one handover format between shifts so commitments remain accurate and consistent."
    },
    overall: {
      recId: "imp-overall",
      title: "End-to-end stay",
      text:
        "Review the full guest journey from arrival to departure. Assign one owner for each issue type and track completion until the problem is resolved."
    }
  };

  function getExampleImprovementItems() {
    return [
      {
        recId: "ex-combined-weekly",
        tone: "watch",
        title: "Weekly priority from guest feedback",
        text:
          "Based on all guest comments on file, prioritize room readiness, pool maintenance, event-space setup, and front-desk response. Use one room checklist before check-in, inspect pool furniture and towel supply daily, confirm event hall cooling and lighting before each booking, and set clear reception response-time targets with shift handover notes."
      }
    ];
  }

  /**
   * One operational recommendation inferred from all guest comments combined.
   */
  function buildImprovementRecommendations(feedbackList, options) {
    options = options || {};
    var scopeLabel = options.scopeLabel || "on file";
    var list = feedbackList || [];
    if (!list.length) return [];

    var categoryScores = {
      room: 0,
      pools: 0,
      events: 0,
      cottage: 0,
      services: 0,
      overall: 0
    };
    var negCount = 0;
    var neuCount = 0;

    list.forEach(function (f) {
      var cl = classifySentimentFromStars(f.stars);
      var weight = cl === "neg" ? 3 : cl === "neu" ? 1 : 0.25;
      if (cl === "neg") negCount++;
      else if (cl === "neu") neuCount++;
      detectFeedbackCategories(f.comment).forEach(function (cat) {
        if (Object.prototype.hasOwnProperty.call(categoryScores, cat)) {
          categoryScores[cat] += weight;
        }
      });
    });

    var order = ["room", "pools", "events", "cottage", "services", "overall"];
    var ranked = order
      .filter(function (cat) {
        return categoryScores[cat] > 0;
      })
      .sort(function (a, b) {
        return categoryScores[b] - categoryScores[a];
      });

    if (!negCount && !neuCount) {
      return [
        {
          recId: "combined-positive",
          tone: "positive",
          title: "Maintain guest experience standards",
          text:
            "All guest comments " +
            scopeLabel +
            " are largely positive. Document what guests praise most often and keep those practices in daily training and handover notes."
        }
      ];
    }

    if (!ranked.length) {
      var overallTpl = IMPROVEMENT_BY_AREA.overall;
      return [
        {
          recId: overallTpl.recId,
          tone: negCount ? "action" : "watch",
          title: overallTpl.title,
          text: overallTpl.text
        }
      ];
    }

    var topCats = ranked.slice(0, 3);
    var focusLabels = topCats.map(function (cat) {
      return (CATEGORY_LABELS[cat] || cat).toLowerCase();
    });
    var actionParts = topCats
      .map(function (cat) {
        var tpl = IMPROVEMENT_BY_AREA[cat];
        return tpl ? tpl.text : "";
      })
      .filter(Boolean);
    var singleTitle = topCats.length === 1 ? IMPROVEMENT_BY_AREA[topCats[0]].title : null;
    var intro =
      negCount > 0
        ? "Based on all guest comments " + scopeLabel + ", recurring concerns point to "
        : "Based on all guest comments " + scopeLabel + ", neutral remarks suggest attention to ";

    return [
      {
        recId: "combined-" + topCats.join("-"),
        tone: negCount ? "action" : "watch",
        title: singleTitle || "Combined priority from guest feedback",
        text: intro + focusLabels.join(", ") + ". " + actionParts.join(" ")
      }
    ];
  }

  function buildCategoryRecommendationItems(feedbackList) {
    var by = {
      room: { pos: [], neu: [], neg: [] },
      pools: { pos: [], neu: [], neg: [] },
      events: { pos: [], neu: [], neg: [] },
      cottage: { pos: [], neu: [], neg: [] },
      services: { pos: [], neu: [], neg: [] },
      overall: { pos: [], neu: [], neg: [] }
    };

    feedbackList.forEach(function (f) {
      var cl = classifySentimentFromStars(f.stars);
      var band = cl === "pos" ? "pos" : cl === "neg" ? "neg" : "neu";
      var cats = detectFeedbackCategories(f.comment);
      cats.forEach(function (cat) {
        if (by[cat]) by[cat][band].push(f);
      });
    });

    var order = ["room", "pools", "events", "cottage", "services", "overall"];
    var items = [];

    function oneItem(cat, b) {
      var label = CATEGORY_LABELS[cat] || cat;
      var ex = b.neg[0] || b.neu[0] || b.pos[0];
      var snip = snippetComment(ex, 100);
      if (b.neg.length) {
        return {
          recId: "cat-" + cat + "-neg",
          category: label,
          tone: "action",
          title: label + " — negative feedback",
          text:
            b.neg.length +
            " guest(s) rated negatively with comments about " +
            label.toLowerCase() +
            (snip ? '. For example: "' + snip + '"' : "") +
            ". Inspect standards, brief staff, and follow up on recurring issues."
        };
      }
      if (b.neu.length) {
        return {
          recId: "cat-" + cat + "-neu",
          category: label,
          tone: "watch",
          title: label + " — neutral feedback",
          text:
            b.neu.length +
            " guest(s) left neutral (3-star) remarks touching " +
            label.toLowerCase() +
            (snip ? '. E.g. "' + snip + '"' : "") +
            ". Small upgrades or clearer communication often move these stays to positive."
        };
      }
      if (b.pos.length) {
        return {
          recId: "cat-" + cat + "-pos",
          category: label,
          tone: "positive",
          title: label + " — positive feedback",
          text:
            b.pos.length +
            " guest(s) praised " +
            label.toLowerCase() +
            (snip ? ' ("' + snip + '")' : "") +
            ". Document what works and keep it in training checklists."
        };
      }
      return null;
    }

    order.forEach(function (cat) {
      var b = by[cat];
      var it = oneItem(cat, b);
      if (it) items.push(it);
    });

    return items;
  }

  function starsText(n) {
    var s = Math.max(0, Math.min(5, Number(n) || 0));
    return "★★★★★".slice(0, s) + "☆☆☆☆☆".slice(0, 5 - s);
  }

  function saveAll(data) {
    localStorage.setItem(STORAGE, JSON.stringify(data));
  }

  function normalizeStatus(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && PF.normalizeBookingStatus) return PF.normalizeBookingStatus(st);
    var s = String(st || "Pending").trim().toLowerCase();
    if (s === "for verification" || s === "pending payment verification") return "For Verification";
    if (s === "confirmed" || s === "approved" || s === "active") return "Confirmed";
    if (s === "reserved") return "Reserved";
    if (s === "rejected") return "Rejected";
    if (s === "no show" || s === "no_show") return "No Show";
    if (s === "cancelled" || s === "canceled") return "Cancelled";
    return "Pending";
  }

  function statusLabel(st) {
    var raw = String(st || "Pending").trim();
    var lower = raw.toLowerCase();
    if (lower === "for verification" || lower === "pending payment verification") {
      return "Pending";
    }
    var n = normalizeStatus(st);
    if (n === "Reserved") return "Confirmed";
    if (n === "Checked In") return "Confirmed";
    if (n === "Checked Out" || n === "Completed") return "Completed";
    if (n === "No Show" || lower === "rejected") return "Cancelled";
    if (n === "Cancelled") return "Cancelled";
    if (n === "Confirmed") return "Confirmed";
    if (n === "Pending") return "Pending";
    return n;
  }

  function bookingStatusLabel(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingDisplayStatus === "function" && b) {
      return PF.bookingDisplayStatus(b);
    }
    if (PF && typeof PF.bookingLifecycleLabel === "function" && b) {
      var life = PF.bookingLifecycleLabel(b, null);
      if (life) return life;
    }
    return statusLabel(b && b.status);
  }

  function paymentStatusLabel(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.paymentDisplayLabel === "function") {
      return PF.paymentDisplayLabel(b);
    }
    return (b && b.paymentStatus) || "For Verification";
  }

  function arrivalStatusLabelForBooking(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.arrivalDisplayLabel === "function") {
      return PF.arrivalDisplayLabel(b);
    }
    return "Not Arrived";
  }

  function createStatusTripletNodes(b) {
    var nodes = [];
    var pay = createStatusBadge(
      "Payment: " + paymentStatusLabel(b),
      paymentStatusLabel(b) === "Approved"
        ? "booking-status--confirmed"
        : paymentStatusLabel(b) === "Rejected"
          ? "booking-status--cancelled"
          : "booking-status--pending"
    );
    nodes.push(pay);
    var book = document.createElement("span");
    book.className = "admin-pay-cell-sub admin-status-triplet__line";
    book.textContent = "Booking: " + bookingStatusLabel(b);
    nodes.push(book);
    var arr = document.createElement("span");
    arr.className = "admin-pay-cell-sub admin-status-triplet__line";
    arr.textContent = "Arrival: " + arrivalStatusLabelForBooking(b);
    nodes.push(arr);
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(b)) {
      var future = document.createElement("span");
      future.className = "admin-arrival-status-pill admin-future-booking-pill";
      future.textContent = PF.futureBookingLabel(b);
      nodes.push(future);
    }
    return nodes;
  }

  function statusClass(st) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.getStatusPresentation === "function") {
      return PF.getStatusPresentation(st).badgeClass;
    }
    var raw = String(st || "Pending").trim().toLowerCase();
    if (raw === "pending payment verification" || raw === "for verification") {
      return "booking-status--pending";
    }
    var s = normalizeStatus(st);
    if (s === "Confirmed" || s === "Checked In" || s === "Checked Out" || s === "Completed") {
      return "booking-status--confirmed";
    }
    if (s === "Reserved") return "booking-status--pending";
    if (s === "No Show" || raw === "rejected" || s === "Cancelled") return "booking-status--cancelled";
    return "booking-status--pending";
  }

  function applyBookingStatusBadge(el, booking, label) {
    var PF = window.ElenestPaymentFlow;
    var text = label != null ? label : statusLabel(booking && booking.status);
    if (PF && typeof PF.getStatusPresentation === "function" && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(el, PF.getStatusPresentation(booking, { label: text }));
      return el;
    }
    el.className = "booking-status " + statusClass(booking && booking.status);
    el.textContent = text;
    return el;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function toNumberOrNull(v) {
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function fmtPHP(amount) {
    var n = toNumberOrNull(amount);
    if (n === null) return "₱0";
    return "₱" + Math.round(n).toLocaleString();
  }

  function escapeHtml(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSameMonthByIsoDate(iso, y, m) {
    if (!iso) return false;
    try {
      var d = new Date(iso + "T12:00:00");
      if (isNaN(d.getTime())) return false;
      return d.getFullYear() === y && d.getMonth() === m;
    } catch (e) {
      return false;
    }
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

  function fmtWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (err) {
      return "—";
    }
  }

  function labelRoomType(v) {
    if (v === "big") return "Big room";
    if (v === "small") return "Small room";
    if (v === "couple") return "Couple room";
    if (v === "none") return "No room";
    return v ? String(v) : "—";
  }

  function labelPoolForBooking(b) {
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.swimmingPoolLabelForBooking === "function") {
      return UA.swimmingPoolLabelForBooking(b);
    }
    return labelPool(b && b.poolUse);
  }

  function labelPool(v) {
    if (v === "day_tour") return "Swimming Included (Day Tour)";
    if (v === "pool_only") return "Swimming Pool Only";
    if (v === "none" || !v) return "Swimming Included";
    if (v === "swimming_overnight") return "Swimming Included";
    return v ? String(v) : "—";
  }

  function labelEventHall(v) {
    if (v === "poolside") return "Poolside hall";
    if (v === "upper") return "Upper hall";
    if (v === "new_function") return "New function hall";
    if (v === "ac") return "Air-conditioned hall";
    if (v === "none" || !v) return "No hall";
    return v ? String(v) : "—";
  }

  function labelEventType(v) {
    if (v === "birthday") return "Birthday";
    if (v === "wedding") return "Wedding";
    if (v === "reunion") return "Reunion";
    if (v === "swimming") return "Swimming";
    if (v === "other") return "Other";
    if (v === "na") return "N/A";
    if (v === "none" || !v) return "—";
    return v ? String(v) : "—";
  }

  function labelRole(v) {
    var r = String(v || "").trim().toLowerCase();
    if (r === "admin" || r === "administrator") return "Admin";
    if (r === "manager") return "Manager";
    if (r === "receptionist") return "Receptionist";
    if (r === "guest") return "Guest";
    if (r === "staff") return "Staff";
    if (!r) return "—";
    return v;
  }

  function readAllBookings() {
    var all = getAll();
    var list = [];
    for (var email in all) {
      if (!Object.prototype.hasOwnProperty.call(all, email)) continue;
      var bookings = all[email];
      if (!Array.isArray(bookings)) continue;
      for (var i = 0; i < bookings.length; i++) {
        var b = bookings[i];
        if (!b || !b.id) continue;
        list.push({ accountEmail: email, booking: b });
      }
    }
    // newest first, fallback to check-in
    list.sort(function (a, c) {
      var as = a.booking.submittedAt || "";
      var bs = c.booking.submittedAt || "";
      if (as !== bs) return bs < as ? -1 : bs > as ? 1 : 0;
      var ai = a.booking.checkIn || "";
      var bi = c.booking.checkIn || "";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return 0;
    });
    return list;
  }

  function updateBookingById(id, newStatus, extraPatch) {
    if (!id) return false;
    var B = window.ElenestBookings;
    if (!B) return false;

    var patch = Object.assign({}, extraPatch || {});
    if (newStatus != null && newStatus !== "") {
      var target = normalizeStatus(newStatus);
      patch.status =
        newStatus === "For Verification" || newStatus === "Pending Payment Verification"
          ? "For Verification"
          : target;
      if (!patch.paymentStatus) {
        if (target === "Confirmed" && patch.nonRefundable) {
          patch.paymentStatus = "Fully Paid";
        } else if (target === "Reserved") {
          patch.paymentStatus = "Down Payment Received";
        } else if (target === "Cancelled") {
          patch.paymentStatus = patch.paymentStatus || "Payment rejected — booking cancelled";
        }
      }
    }

    if (typeof B.updateById === "function") {
      return B.updateById(id, patch);
    }

    var rows = B.listAll ? B.listAll() : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].booking && rows[i].booking.id === id) {
        return B.updateFields(rows[i].accountEmail, id, patch);
      }
    }
    return false;
  }

  function findBookingEntry(id) {
    var rows = listBookings();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].booking && rows[i].booking.id === id) return rows[i];
    }
    return null;
  }

  function verifyBookingPayment(id, approved, reason) {
    if (!id) return false;
    var entry = findBookingEntry(id);
    var booking = entry && entry.booking ? entry.booking : null;
    var PF = window.ElenestPaymentFlow;
    var admin = window.ElenestAuth && window.ElenestAuth.getCurrentUser
      ? window.ElenestAuth.getCurrentUser()
      : null;
    var adminEmail = admin && admin.email ? admin.email : "";

    if (!PF) {
      var legacyPatch = approved
        ? {
            status: "Confirmed",
            paymentVerifiedAt: new Date().toISOString(),
            paymentVerifiedBy: adminEmail,
            paymentStatus: "Fully Paid",
            arrivalStatus: "not_arrived"
          }
        : {
            status: "Rejected",
            paymentRejectedAt: new Date().toISOString(),
            paymentRejectedBy: adminEmail,
            paymentRejectionReason: reason || "",
            paymentStatus: "Rejected",
            arrivalStatus: "not_arrived"
          };
      return updateBookingById(id, approved ? "Confirmed" : "Rejected", legacyPatch);
    }

    var patch = approved
      ? PF.buildVerificationApprovePatch(booking, adminEmail)
      : PF.buildVerificationRejectPatch(booking, adminEmail, reason);
    return updateBookingById(id, patch.status, patch);
  }

  function updateArrivalStatus(id, arrivalStatus) {
    if (!id) return false;
    var PF = window.ElenestPaymentFlow;
    if (!PF) return false;
    var next = PF.normalizeArrivalStatus(arrivalStatus);
    if (next === "arrived") {
      return markGuestArrived(id);
    }
    return updateBookingById(id, null, {
      arrivalStatus: next
    });
  }

  function markGuestArrived(id) {
    if (!id) return false;
    var entry = findBookingEntry(id);
    var booking = entry && entry.booking ? entry.booking : null;
    var PF = window.ElenestPaymentFlow;
    var admin = window.ElenestAuth && window.ElenestAuth.getCurrentUser
      ? window.ElenestAuth.getCurrentUser()
      : null;
    // Allow when check-in window is open OR while a 3-hour hold is being monitored.
    var allowed = true;
    if (PF && booking) {
      var canArrive = typeof PF.canMarkGuestArrived === "function" && PF.canMarkGuestArrived(booking);
      var holdActive =
        typeof PF.isActiveDownPaymentHold === "function" && PF.isActiveDownPaymentHold(booking);
      allowed = !!(canArrive || holdActive);
    }
    if (booking && !allowed) return false;
    var patch = PF
      ? PF.buildArrivalCheckInPatch(admin && admin.email ? admin.email : "")
      : {
          status: "Confirmed",
          arrivalStatus: "arrived",
          holdExpiresAt: null
        };
    return updateBookingById(id, patch.status, patch);
  }

  // Back-compat alias — Arrive must never be confused with payment approval.
  function checkInDownPaymentBooking(id) {
    return markGuestArrived(id);
  }

  function markBookingNoShow(id) {
    if (!id) return false;
    var PF = window.ElenestPaymentFlow;
    var patch = PF ? PF.buildNoShowPatch() : { status: "No Show", paymentStatus: "No show — reservation cancelled" };
    return updateBookingById(id, patch.status, patch);
  }

  function isPaymentVerificationHistory(b) {
    if (!b) return false;
    if (b.paymentVerifiedAt || b.paymentRejectedAt) return true;
    var PF = window.ElenestPaymentFlow;
    if (PF && PF.normalizeBookingStatus(b.status) === PF.STATUS.REJECTED && hasSubmittedReceipt(b)) {
      return true;
    }
    return false;
  }

  function hasSubmittedReceipt(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.hasSubmittedReceipt === "function") {
      return PF.hasSubmittedReceipt(b);
    }
    return !!(b && (b.paymentProof || b.paymentProofUrl || b.paymentSubmittedAt || b.hasPaymentProof));
  }

  function isAwaitingPaymentVerification(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isAwaitingPaymentVerification === "function") {
      return PF.isAwaitingPaymentVerification(b);
    }
    if (!b) return false;
    if (b.paymentVerifiedAt || b.paymentRejectedAt) return false;
    var st = String(b.status || "").trim().toLowerCase();
    return st === "for verification" || st === "pending payment verification";
  }

  function setPaymentMethodMsg(ok, text) {
    var el = document.getElementById("adminPaymentMethodMsg");
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function clearPaymentMethodForm() {
    var form = document.getElementById("adminPaymentMethodForm");
    if (form) form.reset();
    var editId = document.getElementById("adminPaymentMethodEditId");
    if (editId) editId.value = "";
    var active = document.getElementById("adminPaymentActive");
    if (active) active.checked = true;
    var cancelBtn = document.getElementById("adminPaymentMethodCancelBtn");
    if (cancelBtn) cancelBtn.hidden = true;
    var submitBtn = document.getElementById("adminPaymentMethodSubmitBtn");
    if (submitBtn) submitBtn.textContent = "Save payment method";
    var msg = document.getElementById("adminPaymentMethodMsg");
    if (msg) {
      msg.hidden = true;
      msg.textContent = "";
    }
    var upload = document.getElementById("adminPaymentQrUpload");
    if (upload) upload.value = "";
  }

  function fillPaymentMethodForm(item) {
    setPaymentsTab("settings");
    var editId = document.getElementById("adminPaymentMethodEditId");
    var provider = document.getElementById("adminPaymentProvider");
    var accountName = document.getElementById("adminPaymentAccountName");
    var accountNumber = document.getElementById("adminPaymentAccountNumber");
    var instructions = document.getElementById("adminPaymentInstructions");
    var qrUrl = document.getElementById("adminPaymentQrUrl");
    var active = document.getElementById("adminPaymentActive");
    var cancelBtn = document.getElementById("adminPaymentMethodCancelBtn");
    var submitBtn = document.getElementById("adminPaymentMethodSubmitBtn");
    if (editId) editId.value = item.id || "";
    if (provider) provider.value = item.provider || "";
    if (accountName) accountName.value = item.accountName || "";
    if (accountNumber) accountNumber.value = item.accountNumber || "";
    if (instructions) instructions.value = item.instructions || "";
    if (qrUrl) qrUrl.value = item.qrImage && String(item.qrImage).indexOf("data:") !== 0 ? item.qrImage : "";
    if (active) active.checked = item.active !== false;
    if (cancelBtn) cancelBtn.hidden = false;
    if (submitBtn) submitBtn.textContent = "Update payment method";
  }

  function renderAdminPaymentMethodsList() {
    var host = document.getElementById("adminPaymentMethodsList");
    if (!host) return;
    host.textContent = "";
    var PM = window.ElenestPaymentMethods;
    if (!PM || typeof PM.listAll !== "function") {
      host.textContent = "Payment methods module not loaded.";
      return;
    }
    var list = PM.listAll();
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "admin-payment-empty";
      empty.textContent = "No payment methods yet. Add one using the form.";
      host.appendChild(empty);
      return;
    }
    list.forEach(function (m) {
      var card = document.createElement("article");
      card.className = "admin-payment-method-item";
      var head = document.createElement("div");
      head.className = "admin-payment-method-item__head";
      var title = document.createElement("strong");
      title.textContent = m.provider || "Payment method";
      head.appendChild(title);
      var badge = document.createElement("span");
      var PF = window.ElenestPaymentFlow;
      if (PF && typeof PF.fillStatusBadge === "function") {
        PF.fillStatusBadge(badge, {
          kind: m.active !== false ? "success" : "cancelled",
          label: m.active !== false ? "Active" : "Inactive"
        });
      } else {
        badge.className =
          "booking-status " + (m.active !== false ? "booking-status--confirmed" : "booking-status--cancelled");
        badge.textContent = m.active !== false ? "Active" : "Inactive";
      }
      head.appendChild(badge);
      card.appendChild(head);
      if (m.qrImage) {
        var qr = document.createElement("img");
        qr.className = "admin-payment-method-item__qr";
        qr.src = m.qrImage;
        qr.alt = (m.provider || "Payment") + " QR";
        card.appendChild(qr);
      }
      var meta = document.createElement("dl");
      meta.className = "booking-dl booking-dl--compact";
      function row(term, val) {
        var dt = document.createElement("dt");
        dt.textContent = term;
        var dd = document.createElement("dd");
        dd.textContent = val || "—";
        meta.appendChild(dt);
        meta.appendChild(dd);
      }
      row("Account name", m.accountName);
      row("Account number", m.accountNumber);
      row("Instructions", m.instructions);
      card.appendChild(meta);
      var actions = document.createElement("div");
      actions.className = "admin-payment-method-item__actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn--outline btn--small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        fillPaymentMethodForm(m);
      });
      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn btn--outline btn--small";
      toggleBtn.textContent = m.active !== false ? "Deactivate" : "Activate";
      toggleBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.run(toggleBtn, function () {
            return Promise.resolve(PM.toggleActive(m.id)).then(function () {
              renderAdminPaymentMethodsList();
            });
          });
          return;
        }
        Promise.resolve(PM.toggleActive(m.id)).then(function () {
          renderAdminPaymentMethodsList();
        });
      });
      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--outline btn--small";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        if (!confirm("Delete this payment method? This cannot be undone.")) return;
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.run(delBtn, function () {
            return Promise.resolve(PM.remove(m.id)).then(function () {
              renderAdminPaymentMethodsList();
            });
          });
          return;
        }
        Promise.resolve(PM.remove(m.id)).then(function () {
          renderAdminPaymentMethodsList();
        });
      });
      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function openPaymentProofModal(src, guestName, booking) {
    var overlay = document.getElementById("adminPaymentProofOverlay");
    var host = document.getElementById("adminPaymentProofImageHost");
    var title = document.getElementById("adminPaymentProofTitle");
    if (!overlay || !host) return;
    host.textContent = "";
    if (title) title.textContent = guestName ? "Proof — " + guestName : "Proof of payment";

    function showMessage(text) {
      host.textContent = "";
      var msg = document.createElement("p");
      msg.className = "booking-card__value";
      msg.textContent = text;
      host.appendChild(msg);
    }

    function showImage(url) {
      host.textContent = "";
      var img = document.createElement("img");
      img.src = url;
      img.alt = "Payment proof";
      img.className = "admin-payment-proof-image";
      img.addEventListener("error", function () {
        if (!booking) {
          showMessage("Could not load receipt image.");
          return;
        }
        resolvePaymentProofSrc(booking).then(function (fresh) {
          if (fresh && fresh !== img.src) {
            img.src = fresh;
            return;
          }
          showMessage("Could not load receipt image.");
        });
      });
      host.appendChild(img);
    }

    if (!src && booking) {
      showMessage("Loading receipt…");
      resolvePaymentProofSrc(booking).then(function (fresh) {
        if (fresh) showImage(fresh);
        else showMessage("Uploaded (reload from customer device if image missing)");
      });
      overlay.removeAttribute("hidden");
      return;
    }

    if (!src) {
      showMessage("Uploaded (reload from customer device if image missing)");
      overlay.removeAttribute("hidden");
      return;
    }

    showImage(src);
    overlay.removeAttribute("hidden");
  }

  function closePaymentProofModal() {
    var overlay = document.getElementById("adminPaymentProofOverlay");
    if (overlay) overlay.setAttribute("hidden", "");
  }

  function getPaymentProofSrc(booking) {
    var PP = window.ElenestPaymentProofs;
    if (PP && typeof PP.getProofSrc === "function") {
      return PP.getProofSrc(booking);
    }
    if (!booking) return "";
    if (booking.paymentProofUrl) return booking.paymentProofUrl;
    if (booking.paymentProof) return booking.paymentProof;
    if (booking.id) {
      try {
        var stored = localStorage.getItem("elenest_proof_" + booking.id);
        if (stored) return stored;
      } catch (e) {}
    }
    return "";
  }

  function resolvePaymentProofSrc(booking) {
    var PP = window.ElenestPaymentProofs;
    if (PP && typeof PP.resolveProofSrc === "function") {
      return PP.resolveProofSrc(booking);
    }
    return Promise.resolve(getPaymentProofSrc(booking));
  }

  function renderPaymentProofBlock(card, booking, guestName, addRow) {
    var proofSrc = getPaymentProofSrc(booking);
    var showProofUi =
      proofSrc ||
      booking.hasPaymentProof ||
      booking.paymentSubmittedAt ||
      booking.paymentProofUrl ||
      booking.paymentProof;
    if (!showProofUi) return;

    if (proofSrc) {
      var proofRow = document.createElement("div");
      proofRow.className = "admin-payment-proof-thumb-row";
      var thumb = document.createElement("img");
      thumb.className = "admin-payment-proof-thumb";
      thumb.src = proofSrc;
      thumb.alt = "Payment proof thumbnail";
      thumb.addEventListener("error", function () {
        resolvePaymentProofSrc(booking).then(function (fresh) {
          if (fresh && fresh !== thumb.src) thumb.src = fresh;
        });
      });
      thumb.addEventListener("click", function () {
        openPaymentProofModal(thumb.src || proofSrc, guestName, booking);
      });
      var viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "btn btn--outline btn--small";
      viewBtn.textContent = "View full receipt";
      viewBtn.addEventListener("click", function () {
        openPaymentProofModal(thumb.src || proofSrc, guestName, booking);
      });
      proofRow.appendChild(thumb);
      proofRow.appendChild(viewBtn);
      card.appendChild(proofRow);

      resolvePaymentProofSrc(booking).then(function (resolved) {
        if (resolved && resolved !== proofSrc) {
          thumb.src = resolved;
        }
      });
      return;
    }

    var loadingRow = document.createElement("div");
    loadingRow.className = "admin-payment-proof-thumb-row";
    var loading = document.createElement("span");
    loading.className = "booking-card__value";
    loading.textContent = "Loading receipt…";
    loadingRow.appendChild(loading);
    card.appendChild(loadingRow);

    resolvePaymentProofSrc(booking).then(function (resolved) {
      loadingRow.remove();
      if (resolved) {
        renderPaymentProofBlock(card, Object.assign({}, booking, { paymentProofUrl: resolved }), guestName, addRow);
        return;
      }
      if (booking.hasPaymentProof && typeof addRow === "function") {
        addRow("Receipt", "Uploaded (reload from customer device if image missing)");
      }
    });
  }

  function paymentTypeLabel(b) {
    if (window.ElenestPaymentFlow) {
      return window.ElenestPaymentFlow.paymentTypeLabel(b && b.paymentType);
    }
    return b && b.paymentType === "full" ? "Full Payment" : "Down Payment";
  }

  function hasReceiptUi(booking) {
    if (!booking) return false;
    return !!(
      getPaymentProofSrc(booking) ||
      booking.hasPaymentProof ||
      booking.paymentSubmittedAt ||
      booking.paymentProofUrl ||
      booking.paymentProof
    );
  }

  function createPayIconButton(kind, label) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-pay-icon-btn admin-pay-icon-btn--" + kind;
    btn.setAttribute("aria-label", label);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var pathSpecs =
      kind === "approve"
        ? ["M20 6 9 17l-5-5"]
        : kind === "reject"
          ? ["M18 6 6 18", "M6 6l12 12"]
          : ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"];
    pathSpecs.forEach(function (d) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    if (kind === "view") {
      var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "3");
      svg.appendChild(circle);
    }
    var tip = document.createElement("span");
    tip.className = "admin-pay-icon-tip";
    tip.textContent = label;
    btn.appendChild(svg);
    btn.appendChild(tip);
    return btn;
  }

  function createPayTable(headers) {
    var table = document.createElement("table");
    table.className = "admin-pay-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headers.forEach(function (lab) {
      var th = document.createElement("th");
      th.textContent = lab;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    return { table: table, tbody: tbody };
  }

  function appendPayEmpty(host, text) {
    var empty = document.createElement("p");
    empty.className = "admin-payment-empty";
    empty.textContent = text;
    host.appendChild(empty);
  }

  function appendStackedCell(tr, main, sub) {
    var td = document.createElement("td");
    td.className = "admin-pay-cell-wrap";
    var mainEl = document.createElement("div");
    mainEl.className = "admin-pay-cell-main";
    mainEl.textContent = main || "—";
    td.appendChild(mainEl);
    if (sub) {
      var subEl = document.createElement("div");
      subEl.className = "admin-pay-cell-sub";
      subEl.textContent = sub;
      td.appendChild(subEl);
    }
    tr.appendChild(td);
    return td;
  }

  function appendTextCell(tr, text, wrap) {
    var td = document.createElement("td");
    if (wrap) td.className = "admin-pay-cell-wrap";
    td.textContent = text || "—";
    tr.appendChild(td);
    return td;
  }

  function appendStatusCell(tr, nodes) {
    var td = document.createElement("td");
    var stack = document.createElement("div");
    stack.className = "admin-pay-status-stack";
    (nodes || []).forEach(function (node) {
      if (node) stack.appendChild(node);
    });
    td.appendChild(stack);
    tr.appendChild(td);
    return td;
  }

  function createStatusBadge(text, className) {
    var badge = document.createElement("span");
    var PF = window.ElenestPaymentFlow;
    var cls = String(className || "booking-status--pending");
    var kind = "pending";
    if (cls.indexOf("confirmed") !== -1) kind = "success";
    else if (cls.indexOf("cancelled") !== -1) kind = "cancelled";
    if (PF && typeof PF.fillStatusBadge === "function") {
      PF.fillStatusBadge(badge, { kind: kind, label: text, badgeClass: cls });
      return badge;
    }
    badge.className = "booking-status " + cls;
    badge.textContent = text;
    return badge;
  }

  function createViewReceiptButton(booking, guestName) {
    var btn = createPayIconButton("view", "View full receipt");
    if (!hasReceiptUi(booking)) {
      btn.disabled = true;
      btn.querySelector(".admin-pay-icon-tip").textContent = "No receipt uploaded";
      btn.setAttribute("aria-label", "No receipt uploaded");
      return btn;
    }
    btn.addEventListener("click", function () {
      openPaymentProofModal(getPaymentProofSrc(booking), guestName, booking);
    });
    return btn;
  }

  function getBookingVerifiedEmailApiUrl() {
    if (window.location.protocol === "file:") {
      return "http://localhost/Elenest_Resort/api/send-booking-verified.php";
    }
    var path = window.location.pathname || "";
    if (path.indexOf("/html/") !== -1) {
      return "../api/send-booking-verified.php";
    }
    return "api/send-booking-verified.php";
  }

  function bookingFacilitySummary(b) {
    var names = []
      .concat(b && b.roomCatalogNames ? b.roomCatalogNames : [])
      .concat(b && b.roomCatalogName ? [b.roomCatalogName] : [])
      .concat(b && b.cottageCatalogNames ? b.cottageCatalogNames : [])
      .concat(b && b.hallCatalogNames ? b.hallCatalogNames : [])
      .concat(b && b.hallCatalogName ? [b.hallCatalogName] : []);
    var seen = {};
    names = names.filter(function (name) {
      var key = String(name || "").trim().toLowerCase();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
    if (names.length) return names.join(", ");
    var room = labelRoomType(b && b.roomType);
    return room && room !== "—" ? room : "";
  }

  function bookingStayLabel(b) {
    var pool = String((b && b.poolUse) || "").toLowerCase();
    if (pool === "pool_only") return "Swimming Pool Only";
    if (pool === "day_tour") return "One-Day Book";
    if (pool === "swimming_overnight") return "Overnight Book";
    if (b && b.checkIn && b.checkOut && String(b.checkIn) === String(b.checkOut)) return "One-Day Book";
    if (b && b.checkIn && b.checkOut) return "Overnight Book";
    return "";
  }

  function paymentApprovalRecipients(item, booking) {
    var seen = {};
    var list = [];
    [booking && booking.email, booking && booking.user_email, booking && booking.userEmail, item && item.accountEmail].forEach(function (em) {
      var raw = String(em || "").trim();
      var key = raw.toLowerCase();
      if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) || seen[key]) return;
      seen[key] = true;
      list.push(raw);
    });
    return list;
  }

  function sendBookingVerifiedEmail(item, booking, isFull) {
    var recipients = paymentApprovalRecipients(item, booking);
    if (!recipients.length) {
      return Promise.resolve({ ok: false, skipped: true, message: "Customer email is missing." });
    }
    var amountPaid = booking && (booking.amountPaid != null ? booking.amountPaid : booking.amountDown);
    var amountText = isFull
      ? paymentTypeLabel(booking) + " — " + fmtPHP(amountPaid) + " (fully paid)"
      : paymentTypeLabel(booking) + " — " + fmtPHP(amountPaid);
    var accountEmail = String((item && item.accountEmail) || "").trim();
    function sendOne(to) {
      return fetch(getBookingVerifiedEmailApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to,
          name: (booking && (booking.fullName || booking.name)) || "Guest",
          payment_type: isFull ? "full" : "down",
          check_in: booking && booking.checkIn ? fmtDateLong(booking.checkIn) : "",
          check_out: booking && booking.checkOut ? fmtDateLong(booking.checkOut) : "",
          facility: bookingFacilitySummary(booking),
          stay_label: bookingStayLabel(booking),
          amount: amountText,
          booking_id: booking && booking.id ? String(booking.id) : "",
          account_email: accountEmail
        })
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (e) {
            data = null;
          }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.message) || "Could not send email.");
          }
          return data;
        });
      });
    }
    return recipients.reduce(function (chain, to) {
      return chain.then(function (results) {
        return sendOne(to).then(function (data) {
          results.push(data);
          return results;
        });
      });
    }, Promise.resolve([])).then(function (results) {
      var sentTo = recipients.join(", ");
      return { ok: true, message: "Approval email sent to " + sentTo + ".", results: results };
    });
  }

  function bindApprovePayment(approveBtn, rejectBtn, item) {
    var b = item.booking;
    approveBtn.addEventListener("click", function () {
      var PF = window.ElenestPaymentFlow;
      var isFull = PF && PF.normalizePaymentType(b.paymentType) === "full";
      var isFuture = PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(b);
      var msg;
      if (isFull) {
        msg = isFuture
          ? "Approve this FULL payment? Payment becomes Approved, Booking Confirmed, Arrival stays Not Arrived until the guest’s check-in date."
          : "Approve this FULL payment? Payment becomes Approved and Booking Confirmed. Arrival stays Not Arrived until check-in.";
      } else if (isFuture) {
        msg =
          "Approve this DOWN payment for a future stay? Payment becomes Approved, Booking Confirmed, Arrival stays Not Arrived. The 3-hour timer will start on the check-in date — not now.";
      } else {
        msg =
          "Approve this DOWN payment? Payment becomes Approved and a 3-hour hold timer will start. Arrival stays Not Arrived until you mark Arrive on the check-in date.";
      }
      swalConfirm({
        icon: "success",
        title: isFull ? "Approve full payment?" : "Approve down payment?",
        text: msg,
        confirmText: "Approve",
        confirmColor: "#16a34a"
      }).then(function (ok) {
        if (!ok) return;
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.set(approveBtn, true, " ");
          BL.set(rejectBtn, true, " ");
        } else {
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
        }

        function stopApproveLoading() {
          if (BL) {
            BL.set(approveBtn, false);
            BL.set(rejectBtn, false);
          } else {
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
          }
        }

        function finishApproved(emailNote) {
          stopApproveLoading();
          var guestEmail = String((b && b.email) || item.accountEmail || "").trim();
          var base = isFull
            ? "Payment Approved · Booking Confirmed · Arrival Not Arrived."
            : isFuture
              ? "Down payment approved. Booking Confirmed for a future date. Arrival remains Not Arrived."
              : "Down payment approved. 3-hour hold started. Arrival remains Not Arrived.";
          swalAlert({
            icon: "success",
            title: "Payment approved",
            text: emailNote ? base + " " + emailNote : base + (guestEmail ? " Email sent to " + guestEmail + "." : "")
          });
          renderPaymentVerificationList();
          renderPaymentVerificationHistory();
          renderArrivalMonitoringList();
          renderDashboard();
        }

        return Promise.resolve(verifyBookingPayment(b.id, true)).then(function (saved) {
          if (!saved) {
            stopApproveLoading();
            swalAlert({
              icon: "error",
              title: "Approval failed",
              text: "Could not save approval. Please try again."
            });
            syncPaymentsSection();
            return;
          }
          try {
            if (window.ElenestNotifications && typeof window.ElenestNotifications.notifyPaymentApproved === "function") {
              paymentApprovalRecipients(item, b).forEach(function (em) {
                window.ElenestNotifications.notifyPaymentApproved(em, b);
              });
            }
          } catch (notifyErr) {}
          return sendBookingVerifiedEmail(item, b, isFull).then(function (data) {
            if (data && data.skipped) {
              finishApproved("No customer email was on file, so no confirmation email was sent.");
              return;
            }
            finishApproved((data && data.message) || "");
          }).catch(function (err) {
            finishApproved(
              "The booking is saved, but the confirmation email could not be sent" +
                ((err && err.message) ? ": " + err.message : ".")
            );
          });
        }).catch(function () {
          stopApproveLoading();
          swalAlert({
            icon: "error",
            title: "Approval failed",
            text: "Could not save approval. Please try again."
          });
          syncPaymentsSection();
        });
      });
    });
  }

  function bindRejectPayment(approveBtn, rejectBtn, item) {
    var b = item.booking;
    rejectBtn.addEventListener("click", function () {
      swalPrompt({
        icon: "warning",
        title: "Reject payment?",
        text: "Optional reason for rejection (shown internally):",
        confirmText: "Continue",
        defaultValue: ""
      }).then(function (reason) {
        if (reason === null) return;
        return swalConfirm({
          icon: "warning",
          title: "Confirm rejection",
          text: "Reject this payment? Status will be REJECTED (final) and the room will be released.",
          confirmText: "Reject payment",
          confirmColor: "#dc2626"
        }).then(function (ok) {
          if (!ok) return;
          var BL = window.ElenestButtonLoading;
          if (BL) {
            BL.set(approveBtn, true, " ");
            BL.set(rejectBtn, true, " ");
          } else {
            approveBtn.disabled = true;
            rejectBtn.disabled = true;
          }
          return Promise.resolve(verifyBookingPayment(b.id, false, reason)).then(function (saved) {
            if (BL) {
              BL.set(approveBtn, false);
              BL.set(rejectBtn, false);
            } else {
              approveBtn.disabled = false;
              rejectBtn.disabled = false;
            }
            if (!saved) {
              swalAlert({
                icon: "error",
                title: "Rejection failed",
                text: "Could not save rejection. Please try again."
              });
              syncPaymentsSection();
              return;
            }
            if (window.ElenestNotifications && item.accountEmail) {
              window.ElenestNotifications.notifyPaymentRejected(item.accountEmail, b, reason);
            }
            swalAlert({
              icon: "success",
              title: "Payment rejected",
              text: "Booking was rejected and the room was released."
            });
            renderPaymentVerificationList();
            renderPaymentVerificationHistory();
            renderArrivalMonitoringList();
            renderDashboard();
          }).catch(function () {
            if (BL) {
              BL.set(approveBtn, false);
              BL.set(rejectBtn, false);
            } else {
              approveBtn.disabled = false;
              rejectBtn.disabled = false;
            }
            swalAlert({
              icon: "error",
              title: "Rejection failed",
              text: "Could not save rejection. Please try again."
            });
          });
        });
      });
    });
  }

  function paymentWeeksInMonth(year, monthIndex) {
    var lastDay = new Date(year, monthIndex + 1, 0).getDate();
    var weeks = [];
    var startDay = 1;
    var number = 1;
    while (startDay <= lastDay) {
      var endDay = Math.min(startDay + 6, lastDay);
      weeks.push({ number: number, startDay: startDay, endDay: endDay });
      startDay = endDay + 1;
      number += 1;
    }
    return weeks;
  }

  function paymentWeekNumberForDate(date) {
    var weeks = paymentWeeksInMonth(date.getFullYear(), date.getMonth());
    var day = date.getDate();
    for (var i = 0; i < weeks.length; i++) {
      if (day >= weeks[i].startDay && day <= weeks[i].endDay) return weeks[i].number;
    }
    return 1;
  }

  function paymentRecordInstant(booking) {
    if (!booking) return null;
    var raw = String(
      booking.paymentVerifiedAt ||
        booking.payment_verified_at ||
        booking.paymentRejectedAt ||
        booking.payment_rejected_at ||
        booking.paymentSubmittedAt ||
        booking.payment_submitted_at ||
        booking.submittedAt ||
        booking.submitted_at ||
        booking.createdAt ||
        booking.created_at ||
        ""
    ).trim();
    if (!raw) return null;
    var instant = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + "T12:00:00") : new Date(raw);
    return isNaN(instant.getTime()) ? null : instant;
  }

  function clampPaymentWeek() {
    var weeks = paymentWeeksInMonth(paymentPeriodFilter.year, paymentPeriodFilter.month);
    if (!weeks.length) {
      paymentPeriodFilter.week = 1;
      return weeks;
    }
    if (paymentPeriodFilter.week < 1) paymentPeriodFilter.week = 1;
    if (paymentPeriodFilter.week > weeks.length) paymentPeriodFilter.week = weeks.length;
    return weeks;
  }

  function paymentPeriodRange() {
    var mode = paymentPeriodFilter.mode;
    var year = paymentPeriodFilter.year;
    var month = paymentPeriodFilter.month;
    if (mode === "year") {
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0),
        end: new Date(year, 11, 31, 23, 59, 59, 999),
        label: String(year)
      };
    }
    if (mode === "month") {
      var lastDay = new Date(year, month + 1, 0).getDate();
      return {
        start: new Date(year, month, 1, 0, 0, 0, 0),
        end: new Date(year, month, lastDay, 23, 59, 59, 999),
        label: PAYMENT_MONTH_NAMES[month] + " " + year
      };
    }
    if (mode === "week") {
      var weeks = clampPaymentWeek();
      var week = null;
      for (var i = 0; i < weeks.length; i++) {
        if (weeks[i].number === paymentPeriodFilter.week) week = weeks[i];
      }
      if (!week) week = weeks[0];
      if (!week) return null;
      return {
        start: new Date(year, month, week.startDay, 0, 0, 0, 0),
        end: new Date(year, month, week.endDay, 23, 59, 59, 999),
        label:
          "Week " +
          week.number +
          " of " +
          PAYMENT_MONTH_NAMES[month] +
          " " +
          year +
          " (" +
          PAYMENT_MONTH_SHORT[month] +
          " " +
          week.startDay +
          "–" +
          week.endDay +
          ")"
      };
    }
    return null;
  }

  function filterPaymentItemsByPeriod(items) {
    var list = items || [];
    if (paymentPeriodFilter.mode === "all") return list;
    var range = paymentPeriodRange();
    if (!range) return list;
    return list.filter(function (item) {
      var instant = paymentRecordInstant(item && item.booking);
      if (!instant) return false;
      var time = instant.getTime();
      return time >= range.start.getTime() && time <= range.end.getTime();
    });
  }

  function paymentPeriodEmptyText(base) {
    if (paymentPeriodFilter.mode === "all") return base;
    var range = paymentPeriodRange();
    if (!range || !range.label) return base;
    return String(base || "").replace(/\.$/, "") + " for " + range.label + ".";
  }

  function paymentRecordYears() {
    var years = {};
    var nowYear = new Date().getFullYear();
    var y;
    for (y = nowYear - 5; y <= nowYear + 1; y++) years[y] = true;
    listBookings().forEach(function (item) {
      var instant = paymentRecordInstant(item && item.booking);
      if (instant) years[instant.getFullYear()] = true;
    });
    return Object.keys(years)
      .map(function (key) {
        return parseInt(key, 10);
      })
      .filter(function (year) {
        return !isNaN(year);
      })
      .sort(function (a, b) {
        return b - a;
      });
  }

  function setPeriodFieldHidden(id, hidden) {
    var el = document.getElementById(id);
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function fillPaymentYearOptions() {
    var select = document.getElementById("adminPaymentsPeriodYear");
    if (!select) return;
    var years = paymentRecordYears();
    if (years.indexOf(paymentPeriodFilter.year) === -1 && years.length) {
      paymentPeriodFilter.year = years[0];
    }
    var markup = years
      .map(function (year) {
        return '<option value="' + year + '">' + year + "</option>";
      })
      .join("");
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = String(paymentPeriodFilter.year);
  }

  function fillPaymentWeekOptions() {
    var select = document.getElementById("adminPaymentsPeriodWeek");
    if (!select) return;
    var weeks = clampPaymentWeek();
    var month = paymentPeriodFilter.month;
    var markup = weeks
      .map(function (week) {
        var label =
          "Week " +
          week.number +
          " (" +
          PAYMENT_MONTH_SHORT[month] +
          " " +
          week.startDay +
          "–" +
          week.endDay +
          ")";
        return '<option value="' + week.number + '">' + label + "</option>";
      })
      .join("");
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = String(paymentPeriodFilter.week);
  }

  function syncPaymentPeriodControls() {
    var mode = paymentPeriodFilter.mode;
    if (mode !== "week" && mode !== "month" && mode !== "year") mode = "all";
    paymentPeriodFilter.mode = mode;
    document.querySelectorAll("[data-payment-period]").forEach(function (btn) {
      var active = btn.getAttribute("data-payment-period") === mode;
      btn.classList.toggle("admin-payments-period__mode--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    setPeriodFieldHidden("adminPaymentsPeriodFields", mode === "all");
    setPeriodFieldHidden("adminPaymentsPeriodYearField", mode === "all");
    setPeriodFieldHidden("adminPaymentsPeriodMonthField", mode !== "week" && mode !== "month");
    setPeriodFieldHidden("adminPaymentsPeriodWeekField", mode !== "week");
    fillPaymentYearOptions();
    var monthSelect = document.getElementById("adminPaymentsPeriodMonth");
    if (monthSelect) monthSelect.value = String(paymentPeriodFilter.month);
    if (mode === "week") fillPaymentWeekOptions();
    var summary = document.getElementById("adminPaymentsPeriodSummary");
    if (!summary) return;
    var summaryText = "";
    if (mode !== "all") {
      var range = paymentPeriodRange();
      summaryText = range && range.label
        ? "Showing payments for " + range.label + ". Lists update as soon as you change the period."
        : "Showing payments for the selected period.";
    }
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    if (summaryText) summary.removeAttribute("hidden");
    else summary.setAttribute("hidden", "");
  }

  function applyPaymentPeriodFilter() {
    adminListPages.paymentVerification = 1;
    adminListPages.arrivalMonitoring = 1;
    adminListPages.paymentHistory = 1;
    renderPaymentVerificationList();
    renderArrivalMonitoringList();
    renderPaymentVerificationHistory();
    applyPaymentFocus();
  }

  function listPendingPaymentVerificationsRaw() {
    var B = window.ElenestBookings;
    if (B && typeof B.listPendingVerifications === "function") {
      return B.listPendingVerifications();
    }
    return listBookings().filter(function (item) {
      return isAwaitingPaymentVerification(item.booking);
    });
  }

  function listPendingPaymentVerifications() {
    return filterPaymentItemsByPeriod(listPendingPaymentVerificationsRaw());
  }

  function updatePaymentVerificationCount(count) {
    var el = document.getElementById("adminPaymentVerificationCount");
    if (!el) return;
    if (!count) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = count + " awaiting verification";
  }

  function updatePaymentSummaryCards(verificationCount, arrivalCount, historyCount) {
    var vEl = document.getElementById("adminPaymentKpiVerification");
    var aEl = document.getElementById("adminPaymentKpiArrival");
    var hEl = document.getElementById("adminPaymentKpiHistory");
    if (vEl) vEl.textContent = String(verificationCount || 0);
    if (aEl) aEl.textContent = String(arrivalCount || 0);
    if (hEl) hEl.textContent = String(historyCount || 0);
  }

  function listArrivalMonitoringItemsRaw() {
    return listBookings().filter(function (item) {
      if (item.booking && (item.booking.linkedFacilityBooking || item.booking.parentBookingId)) {
        return false;
      }
      return isDownPaymentHoldActive(item.booking);
    });
  }

  function listArrivalMonitoringItems() {
    return filterPaymentItemsByPeriod(listArrivalMonitoringItemsRaw());
  }

  function listPaymentHistoryItemsRaw() {
    var items = listBookings().filter(function (item) {
      if (item.booking && (item.booking.linkedFacilityBooking || item.booking.parentBookingId)) {
        return false;
      }
      return isPaymentVerificationHistory(item.booking);
    });
    items.sort(function (a, c) {
      var aAt =
        (a.booking && (a.booking.paymentVerifiedAt || a.booking.paymentRejectedAt)) || "";
      var bAt =
        (c.booking && (c.booking.paymentVerifiedAt || c.booking.paymentRejectedAt)) || "";
      if (aAt !== bAt) return bAt < aAt ? -1 : bAt > aAt ? 1 : 0;
      return 0;
    });
    return items;
  }

  function listPaymentHistoryItems() {
    return filterPaymentItemsByPeriod(listPaymentHistoryItemsRaw());
  }

  function bookingScheduleLabel(b) {
    var pool = String((b && b.poolUse) || "").toLowerCase();
    if (pool === "day_tour" || pool === "pool_only") return "8:00 AM — 10:00 PM";
    var inn = b && b.checkInTime ? String(b.checkInTime) : "";
    var out = b && b.checkOutTime ? String(b.checkOutTime) : "";
    if (inn && out) return inn + " – " + out;
    return inn || out || "—";
  }

  function bookingGuestLabel(b) {
    var adults = parseInt(b && b.adults, 10);
    var children = parseInt(b && b.children, 10);
    var under = parseInt(b && b.childrenUnder6, 10);
    if (isNaN(adults)) adults = 0;
    if (isNaN(children)) children = 0;
    if (isNaN(under)) under = 0;
    var text = adults + " adult" + (adults === 1 ? "" : "s");
    if (children) text += ", " + children + " child" + (children === 1 ? "" : "ren") + " (6–12)";
    if (under) text += ", " + under + " under 6";
    return text;
  }

  function bookingReviewAvailability(b) {
    var UA = window.ElenestUnitAvailability;
    if (!b || !UA || typeof UA.validateSelection !== "function") {
      return { ok: null, text: "Availability not checked" };
    }
    var selection = {
      roomCatalogIds: b.roomCatalogIds || (b.roomCatalogId ? [b.roomCatalogId] : []),
      cottageCatalogIds: b.cottageCatalogIds || [],
      hallCatalogIds: b.hallCatalogIds || (b.hallCatalogId ? [b.hallCatalogId] : []),
      hallCatalogId: b.hallCatalogId || ""
    };
    function uniqueIds(list) {
      var seen = {};
      return (list || []).filter(function (id) {
        var key = String(id || "").trim();
        if (!key || seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }
    selection.roomCatalogIds = uniqueIds(selection.roomCatalogIds);
    selection.cottageCatalogIds = uniqueIds(selection.cottageCatalogIds);
    selection.hallCatalogIds = uniqueIds(selection.hallCatalogIds);
    var result = UA.validateSelection(selection, b.checkIn, b.checkOut, b.id, {
      validateGuests: true,
      adults: b.adults,
      children: b.children,
      childrenUnder6: b.childrenUnder6,
      checkInTime: b.checkInTime,
      checkOutTime: b.checkOutTime,
      skipSnapshotBlocks: true
    });
    if (result && result.ok) return { ok: true, text: "Available" };
    return {
      ok: false,
      text: (result && result.errors && result.errors[0]) || "Unavailable for this date and time"
    };
  }

  function listBookingReviewItems() {
    var PF = window.ElenestPaymentFlow;
    return listBookings().filter(function (item) {
      var b = item && item.booking;
      if (!b || b.linkedFacilityBooking || b.parentBookingId) return false;
      return PF && typeof PF.isAwaitingBookingReview === "function" && PF.isAwaitingBookingReview(b);
    });
  }

  function paymentReadyDetails(booking) {
    var methods =
      window.ElenestPaymentMethods && typeof window.ElenestPaymentMethods.listActive === "function"
        ? window.ElenestPaymentMethods.listActive()
        : [];
    var methodBits = methods.map(function (m) {
      var bit = m.provider || "Payment";
      if (m.accountName) bit += " — " + m.accountName;
      if (m.accountNumber) bit += " (" + m.accountNumber + ")";
      return bit;
    });
    var when = "";
    if (booking && booking.checkIn) {
      when = fmtDateLong(booking.checkIn);
      if (booking.checkOut && String(booking.checkOut).slice(0, 10) !== String(booking.checkIn).slice(0, 10)) {
        when += " to " + fmtDateLong(booking.checkOut);
      }
      var schedule = bookingScheduleLabel(booking);
      if (schedule && schedule !== "—") when += ", " + schedule;
    }
    return {
      facility: bookingFacilitySummary(booking) || "Selected facility",
      when: when,
      guests: bookingGuestLabel(booking),
      amount: fmtPHP(booking && booking.totalEstimate),
      deadlineLabel: booking && booking.paymentDeadlineAt ? fmtWhen(booking.paymentDeadlineAt) : "",
      methodsText: methodBits.join("; "),
      methods: methods.map(function (m) {
        return {
          provider: m.provider || "",
          accountName: m.accountName || "",
          accountNumber: m.accountNumber || "",
          instructions: m.instructions || ""
        };
      })
    };
  }

  function getPaymentReadyEmailApiUrl() {
    if (window.location.protocol === "file:") {
      return "http://localhost/Elenest_Resort/api/send-payment-ready.php";
    }
    var path = window.location.pathname || "";
    if (path.indexOf("/html/") !== -1) return "../api/send-payment-ready.php";
    return "api/send-payment-ready.php";
  }

  function sendPaymentReadyEmail(item, booking, details) {
    var to = String((booking && booking.email) || (item && item.accountEmail) || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return Promise.resolve({ ok: false, skipped: true, message: "Customer email is missing." });
    }
    details = details || paymentReadyDetails(booking);
    return fetch(getPaymentReadyEmailApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to,
        name: (booking && (booking.fullName || booking.name)) || "Guest",
        facility: details.facility,
        schedule: details.when,
        guests: details.guests,
        amount: details.amount,
        deadline: details.deadlineLabel,
        methods: details.methods,
        instructions:
          "Pay the amount due using one of the methods below, then upload a photo of your receipt on your booking page before the deadline. Uploading proof does not mark the booking as paid until an admin verifies it.",
        booking_id: booking && booking.id ? String(booking.id) : ""
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
    });
  }

  function confirmBookingForPayment(item, button) {
    var b = item && item.booking;
    if (!b || !b.id) return;
    var avail = bookingReviewAvailability(b);
    if (avail.ok === false) {
      swalAlert({
        icon: "warning",
        title: "Facility unavailable",
        text: avail.text + " Decline this request so the guest can choose another schedule."
      });
      return;
    }
    swalConfirm({
      icon: "question",
      title: "Confirm this booking?",
      text:
        "The guest will be notified by email and in-app message that they can pay online. They will have 3 hours from now to submit payment.",
      confirmText: "Confirm booking",
      confirmColor: "#16a34a"
    }).then(function (ok) {
      if (!ok) return;
      var PF = window.ElenestPaymentFlow;
      var admin = window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
      var adminEmail = admin && admin.email ? admin.email : "";
      var BL = window.ElenestButtonLoading;
      if (BL && button) BL.set(button, true);
      else if (button) button.disabled = true;
      var patch = PF
        ? PF.buildBookingConfirmForPaymentPatch()
        : { status: "Awaiting Payment", workflow: "awaiting_payment" };
      patch.bookingConfirmedBy = adminEmail;
      Promise.resolve(updateBookingById(b.id, patch.status, patch)).then(function (saved) {
        if (!saved) {
          if (BL && button) BL.set(button, false);
          else if (button) button.disabled = false;
          swalAlert({ icon: "error", title: "Could not confirm", text: "Please try again." });
          return;
        }
        var merged = Object.assign({}, b, patch);
        var details = paymentReadyDetails(merged);
        if (window.ElenestNotifications && item.accountEmail) {
          window.ElenestNotifications.notifyPaymentWindowOpened(item.accountEmail, merged, details);
        }
        return sendPaymentReadyEmail(item, merged, details).then(function (data) {
          if (BL && button) BL.set(button, false);
          swalAlert({
            icon: "success",
            title: "Booking confirmed",
            text:
              data && data.skipped
                ? "Payment is open for 3 hours. No customer email was on file."
                : "The guest was notified and has 3 hours to pay."
          });
          renderBookingReviewList();
          renderDashboard();
        }).catch(function (err) {
          if (BL && button) BL.set(button, false);
          swalAlert({
            icon: "warning",
            title: "Booking confirmed",
            text:
              "Payment is open, but the email could not be sent" +
              (err && err.message ? ": " + err.message : ".")
          });
          renderBookingReviewList();
        });
      }).catch(function () {
        if (BL && button) BL.set(button, false);
        swalAlert({ icon: "error", title: "Could not confirm", text: "Please try again." });
      });
    });
  }

  function declineBookingReview(item, button) {
    var b = item && item.booking;
    if (!b || !b.id) return;
    swalConfirm({
      icon: "warning",
      title: "Decline this booking?",
      text: "The reserved schedule will be released and the guest will be notified.",
      confirmText: "Decline",
      confirmColor: "#b91c1c"
    }).then(function (ok) {
      if (!ok) return;
      var PF = window.ElenestPaymentFlow;
      var admin = window.ElenestAuth && window.ElenestAuth.getCurrentUser
        ? window.ElenestAuth.getCurrentUser()
        : null;
      var patch = PF
        ? PF.buildBookingReviewRejectPatch(admin && admin.email ? admin.email : "", "Booking details were not confirmed.")
        : { status: "Rejected", slotLocked: false, workflow: "rejected" };
      var BL = window.ElenestButtonLoading;
      if (BL && button) BL.set(button, true);
      Promise.resolve(updateBookingById(b.id, patch.status, patch)).then(function (saved) {
        if (BL && button) BL.set(button, false);
        if (!saved) {
          swalAlert({ icon: "error", title: "Could not decline", text: "Please try again." });
          return;
        }
        if (window.ElenestNotifications && item.accountEmail) {
          window.ElenestNotifications.notifyBookingUpdated(
            item.accountEmail,
            Object.assign({}, b, patch),
            "Your booking request was not confirmed. The schedule has been released. You can submit a new booking."
          );
        }
        renderBookingReviewList();
        renderDashboard();
      });
    });
  }

  function renderBookingReviewList() {
    var host = document.getElementById("adminBookingReviewList");
    if (!host) return;
    var refreshBtn = document.getElementById("adminBookingReviewRefresh");
    if (refreshBtn && refreshBtn.getAttribute("data-bound") !== "1") {
      refreshBtn.setAttribute("data-bound", "1");
      refreshBtn.addEventListener("click", function () {
        var B = window.ElenestBookings;
        if (B && typeof B.refresh === "function") {
          Promise.resolve(B.refresh()).then(renderBookingReviewList).catch(renderBookingReviewList);
        } else {
          renderBookingReviewList();
        }
      });
    }
    host.textContent = "";
    var items = listBookingReviewItems();
    if (!items.length) {
      appendPayEmpty(host, "No booking requests waiting for confirmation.");
      return;
    }
    items.forEach(function (item) {
      var b = item.booking;
      var avail = bookingReviewAvailability(b);
      var card = document.createElement("article");
      card.className = "admin-booking-review-card";
      var top = document.createElement("div");
      top.className = "admin-booking-review-card__top";
      var who = document.createElement("div");
      var name = document.createElement("h4");
      name.className = "admin-booking-review-card__name";
      name.textContent = b.fullName || "Guest";
      var email = document.createElement("p");
      email.className = "admin-booking-review-card__email";
      email.textContent = b.email || item.accountEmail || "";
      who.appendChild(name);
      who.appendChild(email);
      var badge = document.createElement("span");
      badge.className =
        "admin-booking-review-card__badge " +
        (avail.ok === false ? "is-unavailable" : "is-available");
      badge.textContent = avail.ok === false ? "Unavailable" : "Available";
      top.appendChild(who);
      top.appendChild(badge);
      card.appendChild(top);

      var grid = document.createElement("dl");
      grid.className = "admin-booking-review-card__grid";
      function addFact(label, value) {
        var wrap = document.createElement("div");
        var dt = document.createElement("dt");
        dt.textContent = label;
        var dd = document.createElement("dd");
        dd.textContent = value || "—";
        wrap.appendChild(dt);
        wrap.appendChild(dd);
        grid.appendChild(wrap);
      }
      addFact("Facility", bookingFacilitySummary(b) || "—");
      addFact("Date", b.checkIn ? fmtDateLong(b.checkIn) : "—");
      addFact("Schedule", bookingScheduleLabel(b));
      addFact("Guests", bookingGuestLabel(b));
      addFact("Total", fmtPHP(b.totalEstimate));
      card.appendChild(grid);

      if (avail.ok === false) {
        var note = document.createElement("p");
        note.className = "admin-booking-review-card__note";
        note.textContent = avail.text;
        card.appendChild(note);
      }

      var actions = document.createElement("div");
      actions.className = "admin-booking-review-card__actions";
      var confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "btn btn--small";
      confirmBtn.textContent = "Confirm booking";
      confirmBtn.disabled = avail.ok === false;
      confirmBtn.addEventListener("click", function () {
        confirmBookingForPayment(item, confirmBtn);
      });
      var declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "btn btn--outline btn--small";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", function () {
        declineBookingReview(item, declineBtn);
      });
      actions.appendChild(confirmBtn);
      actions.appendChild(declineBtn);
      card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function renderPaymentVerificationList() {
    var host = document.getElementById("adminPaymentVerificationList");
    var pager = document.getElementById("adminPaymentVerificationPagination");
    if (!host) return;
    host.textContent = "";
    var items = listPendingPaymentVerifications();
    updatePaymentVerificationCount(items.length);
    updatePaymentSummaryCards(
      items.length,
      listArrivalMonitoringItems().length,
      listPaymentHistoryItems().length
    );
    if (!items.length) {
      adminListPages.paymentVerification = 1;
      appendPayEmpty(host, paymentPeriodEmptyText("No payments awaiting verification."));
      renderPaginationControls(pager, null);
      return;
    }
    var pageState = paginateItems(items, adminListPages.paymentVerification, ADMIN_PAGE_SIZE);
    adminListPages.paymentVerification = pageState.page;
    var built = createPayTable([
      "Guest",
      "Payment",
      "Amount",
      "Submitted",
      "Status",
      "Actions"
    ]);
    pageState.items.forEach(function (item) {
      var b = item.booking;
      var tr = document.createElement("tr");
      markPaymentRow(tr, b);
      appendStackedCell(tr, b.fullName || "Guest", b.email || item.accountEmail);
      appendStackedCell(tr, paymentTypeLabel(b), b.paymentMethod || "—");
      appendStackedCell(
        tr,
        fmtPHP(b.amountPaid != null ? b.amountPaid : b.amountDown),
        "Est. " + fmtPHP(b.totalEstimate)
      );
      appendTextCell(
        tr,
        b.paymentSubmittedAt ? fmtWhen(b.paymentSubmittedAt) : fmtWhen(b.submittedAt)
      );
      appendStatusCell(tr, [createStatusBadge("For Verification", "booking-status--pending")]);
      var actionsTd = document.createElement("td");
      var actions = document.createElement("div");
      actions.className = "admin-pay-table-actions";
      var viewBtn = createViewReceiptButton(b, b.fullName);
      var approveBtn = createPayIconButton("approve", "Approve payment");
      var rejectBtn = createPayIconButton("reject", "Reject payment");
      bindApprovePayment(approveBtn, rejectBtn, item);
      bindRejectPayment(approveBtn, rejectBtn, item);
      actions.appendChild(viewBtn);
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPaginationControls(pager, pageState, function (page) {
      adminListPages.paymentVerification = page;
      renderPaymentVerificationList();
    });
  }

  function isDownPaymentHoldActive(b) {
    if (!b) return false;
    var PF = window.ElenestPaymentFlow;
    if (!PF) return false;
    if (typeof PF.isActiveDownPaymentHold === "function") {
      return PF.isActiveDownPaymentHold(b);
    }
    if (PF.normalizePaymentType(b.paymentType) !== "down") return false;
    if (!b.holdExpiresAt || PF.isHoldExpired(b)) return false;
    var st = PF.normalizeBookingStatus(b.status);
    if (st !== PF.STATUS.RESERVED && st !== PF.STATUS.CONFIRMED) return false;
    if (PF.normalizeArrivalStatus(b.arrivalStatus) === "arrived" || b.checkedInAt) return false;
    if (PF.normalizeArrivalStatus(b.arrivalStatus) === "no_show") return false;
    if (b.paymentRejectedAt) return false;
    return true;
  }

  function renderArrivalMonitoringList() {
    var host = document.getElementById("adminArrivalMonitoringList");
    var pager = document.getElementById("adminArrivalMonitoringPagination");
    if (!host) return;
    if (window.ElenestBookings && window.ElenestBookings.processAutoNoShows) {
      window.ElenestBookings.processAutoNoShows();
    }
    host.textContent = "";
    var PF = window.ElenestPaymentFlow;
    var items = listArrivalMonitoringItems();
    updatePaymentSummaryCards(
      listPendingPaymentVerifications().length,
      items.length,
      listPaymentHistoryItems().length
    );
    if (!items.length) {
      adminListPages.arrivalMonitoring = 1;
      appendPayEmpty(host, paymentPeriodEmptyText("No down-payment holds with active 3-hour timers."));
      renderPaginationControls(pager, null);
      return;
    }
    var pageState = paginateItems(items, adminListPages.arrivalMonitoring, ADMIN_PAGE_SIZE);
    adminListPages.arrivalMonitoring = pageState.page;
    var built = createPayTable([
      "Guest",
      "Stay",
      "Payment",
      "Timer",
      "Status",
      "Actions"
    ]);
    pageState.items.forEach(function (item) {
      var b = item.booking;
      var tr = document.createElement("tr");
      tr.className = "admin-arrival-row";
      markPaymentRow(tr, b);
      appendStackedCell(tr, b.fullName || "Guest", b.email || item.accountEmail);
      appendTextCell(tr, fmtDateLong(b.checkIn) + " → " + fmtDateLong(b.checkOut), true);
      appendTextCell(tr, b.paymentStatus || "Down Payment Received", true);
      var deadline =
        PF && typeof PF.downPaymentHoldDeadline === "function"
          ? PF.downPaymentHoldDeadline(b)
          : b.holdExpiresAt;
      var timerTd = document.createElement("td");
      var timerEl = document.createElement("div");
      timerEl.className =
        "admin-arrival-timer admin-arrival-timer-live" +
        (PF && PF.isHoldExpired({ holdExpiresAt: deadline }) ? " admin-arrival-timer--expired" : "");
      if (deadline) timerEl.setAttribute("data-hold-expires", deadline);
      timerEl.textContent = PF ? "🕒 " + PF.formatTimerRemaining(deadline) : "—";
      timerTd.appendChild(timerEl);
      tr.appendChild(timerTd);
      var holdBadge = createStatusBadge(
        "3-Hour Hold Active",
        "booking-status--pending"
      );
      var arrivalPill = document.createElement("span");
      arrivalPill.className = "admin-arrival-status-pill";
      arrivalPill.textContent = "📍 Arrival: " + arrivalStatusLabelForBooking(b);
      var payPill = document.createElement("span");
      payPill.className = "admin-pay-cell-sub";
      payPill.textContent = "Payment: " + paymentStatusLabel(b) + " · Booking: " + bookingStatusLabel(b);
      appendStatusCell(tr, [holdBadge, arrivalPill, payPill]);
      var actionsTd = document.createElement("td");
      var isHoldRow = PF && typeof PF.isActiveDownPaymentHold === "function"
        ? PF.isActiveDownPaymentHold(b)
        : PF && PF.normalizeBookingStatus(b.status) === PF.STATUS.RESERVED;
      if (!isHoldRow) {
        var waitNote = document.createElement("p");
        waitNote.className = "admin-pay-wait-note";
        waitNote.textContent = "Receipt still For Verification — approve it in the queue above.";
        actionsTd.appendChild(waitNote);
      } else {
        var actions = document.createElement("div");
        actions.className = "admin-arrival-actions";

        var arrivedBtn = document.createElement("button");
        arrivedBtn.type = "button";
        arrivedBtn.className = "btn btn--small admin-arrival-arrive-btn";
        arrivedBtn.textContent = "Arrived";
        arrivedBtn.setAttribute("aria-label", "Mark guest as arrived");
        arrivedBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (arrivedBtn.disabled) return;
          arrivedBtn.disabled = true;
          noShowBtn.disabled = true;

          var timerEl = tr.querySelector(".admin-arrival-timer-live, .admin-arrival-timer");
          if (timerEl) {
            timerEl.removeAttribute("data-hold-expires");
            timerEl.classList.remove("admin-arrival-timer-live", "admin-arrival-timer--expired");
            timerEl.classList.add("admin-arrival-timer--stopped");
            timerEl.textContent = "Stopped";
          }
          tr.classList.add("admin-arrival-row--processing");
          tr.setAttribute("aria-busy", "true");

          var BL = window.ElenestButtonLoading;
          var work = function () {
            return Promise.resolve(markGuestArrived(b.id)).then(function (ok) {
              if (ok === false) throw new Error("Arrive update failed");
              renderArrivalMonitoringList();
              renderPaymentVerificationHistory();
              renderDashboard();
              return ok;
            });
          };
          var done = BL ? BL.run(arrivedBtn, work, "Saving…") : work();
          Promise.resolve(done).catch(function () {
            tr.classList.remove("admin-arrival-row--processing");
            tr.removeAttribute("aria-busy");
            arrivedBtn.disabled = false;
            noShowBtn.disabled = false;
            renderArrivalMonitoringList();
            swalAlert({
              icon: "error",
              title: "Could not mark arrived",
              text: "Please try again."
            });
          });
        });

        var noShowBtn = document.createElement("button");
        noShowBtn.type = "button";
        noShowBtn.className = "btn btn--outline btn--small admin-arrival-noshow-btn";
        noShowBtn.textContent = "No Show";
        noShowBtn.setAttribute("aria-label", "Mark guest as no show");
        noShowBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (noShowBtn.disabled) return;
          swalConfirm({
            icon: "warning",
            title: "Mark as No Show?",
            text: "This cancels the reservation and releases the slot.",
            confirmText: "No Show",
            cancelText: "Cancel",
            confirmColor: "#dc2626"
          }).then(function (ok) {
            if (!ok) return;
            arrivedBtn.disabled = true;
            noShowBtn.disabled = true;
            var BL = window.ElenestButtonLoading;
            var work = function () {
              return Promise.resolve(markBookingNoShow(b.id)).then(function () {
                renderArrivalMonitoringList();
                renderDashboard();
              });
            };
            var done = BL ? BL.run(noShowBtn, work, "Saving…") : work();
            return Promise.resolve(done).catch(function () {
              arrivedBtn.disabled = false;
              noShowBtn.disabled = false;
              renderArrivalMonitoringList();
            });
          });
        });

        actions.appendChild(arrivedBtn);
        actions.appendChild(noShowBtn);
        actionsTd.appendChild(actions);
      }
      tr.appendChild(actionsTd);
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPaginationControls(pager, pageState, function (page) {
      adminListPages.arrivalMonitoring = page;
      renderArrivalMonitoringList();
    });
  }

  function renderPaymentVerificationHistory() {
    var host = document.getElementById("adminPaymentVerificationHistoryList");
    var pager = document.getElementById("adminPaymentHistoryPagination");
    if (!host) return;
    host.textContent = "";
    var items = listPaymentHistoryItems();
    updatePaymentSummaryCards(
      listPendingPaymentVerifications().length,
      listArrivalMonitoringItems().length,
      items.length
    );
    if (!items.length) {
      adminListPages.paymentHistory = 1;
      appendPayEmpty(host, paymentPeriodEmptyText("No verified payments yet."));
      renderPaginationControls(pager, null);
      return;
    }
    var pageState = paginateItems(items, adminListPages.paymentHistory, ADMIN_PAGE_SIZE);
    adminListPages.paymentHistory = pageState.page;
    var built = createPayTable([
      "Guest",
      "Payment",
      "Amount",
      "Reviewed",
      "Status",
      "Actions"
    ]);
    pageState.items.forEach(function (item) {
      var b = item.booking;
      var approved = !!b.paymentVerifiedAt;
      var tr = document.createElement("tr");
      markPaymentRow(tr, b);
      appendStackedCell(tr, b.fullName || "Guest", b.email || item.accountEmail);
      appendStackedCell(tr, paymentTypeLabel(b), (b.paymentMethod || "—") + " · " + (b.paymentStatus || "—"));
      appendTextCell(tr, fmtPHP(b.amountPaid != null ? b.amountPaid : b.amountDown));
      var reviewer = approved ? b.paymentVerifiedBy : b.paymentRejectedBy;
      var when = fmtWhen(approved ? b.paymentVerifiedAt : b.paymentRejectedAt);
      appendStackedCell(tr, when, reviewer ? "By " + reviewer : "");
      var statusNodes = createStatusTripletNodes(b);
      if (!approved && b.paymentRejectionReason) {
        var reason = document.createElement("span");
        reason.className = "admin-pay-cell-sub";
        reason.textContent = "Reason: " + b.paymentRejectionReason;
        statusNodes.push(reason);
      }
      appendStatusCell(tr, statusNodes);
      var actionsTd = document.createElement("td");
      var actions = document.createElement("div");
      actions.className = "admin-pay-table-actions";
      actions.appendChild(createViewReceiptButton(b, b.fullName));
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
    renderPaginationControls(pager, pageState, function (page) {
      adminListPages.paymentHistory = page;
      renderPaymentVerificationHistory();
    });
  }

  var paymentsSyncInFlight = false;

  function tickArrivalTimers() {
    var PF = window.ElenestPaymentFlow;
    if (!PF) return;
    document.querySelectorAll(".admin-arrival-timer-live").forEach(function (el) {
      var iso = el.getAttribute("data-hold-expires");
      if (!iso) return;
      var expired = PF.isHoldExpired({ holdExpiresAt: iso });
      el.className =
        "admin-arrival-timer admin-arrival-timer-live" + (expired ? " admin-arrival-timer--expired" : "");
      el.textContent = "🕒 " + PF.formatTimerRemaining(iso);
    });
  }

  var paymentsActiveTab = "bookings";

  function setPaymentsTab(tabId) {
    var next = tabId === "settings" || tabId === "bookings" ? tabId : "approval";
    paymentsActiveTab = next;
    if (next === "bookings") renderBookingReviewList();
    document.querySelectorAll("[data-payments-tab]").forEach(function (btn) {
      var active = btn.getAttribute("data-payments-tab") === next;
      btn.classList.toggle("content-mgmt-tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-payments-panel]").forEach(function (panel) {
      var show = panel.getAttribute("data-payments-panel") === next;
      if (show) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  }

  var pendingPaymentFocusId = "";
  var paymentFocusLock = false;

  function bookingIdFromLocationHash() {
    var raw = String(window.location.hash || "");
    if (raw.charAt(0) === "#") raw = raw.slice(1);
    var match = raw.match(/(?:[?&]|^)booking=([^&]+)/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  function markPaymentRow(tr, booking) {
    if (!tr || !booking || !booking.id) return;
    tr.setAttribute("data-payment-booking-id", String(booking.id));
  }

  function paymentListIndex(items, id) {
    var wanted = String(id || "");
    for (var i = 0; i < items.length; i++) {
      var b = items[i] && items[i].booking;
      if (b && String(b.id) === wanted) return i;
    }
    return -1;
  }

  function ensurePaymentFocusNote() {
    var note = document.getElementById("adminPaymentFocusNote");
    if (note) return note;
    var board = document.querySelector(".admin-payment-approval-board");
    if (!board) return null;
    note = document.createElement("p");
    note.id = "adminPaymentFocusNote";
    note.className = "admin-payment-focus-note";
    note.hidden = true;
    board.insertBefore(note, board.firstChild);
    return note;
  }

  function highlightPaymentRows(id) {
    var wanted = String(id || "");
    var matched = [];
    document.querySelectorAll("[data-payment-booking-id]").forEach(function (row) {
      var on = !!wanted && row.getAttribute("data-payment-booking-id") === wanted;
      row.classList.toggle("admin-pay-row--focus", on);
      if (on) matched.push(row);
    });
    return matched;
  }

  function applyPaymentFocus() {
    if (paymentFocusLock) return;
    var id = pendingPaymentFocusId;
    var note = ensurePaymentFocusNote();
    if (!id) {
      if (note) note.hidden = true;
      highlightPaymentRows("");
      return;
    }
    var indexes = [
      { key: "paymentVerification", index: paymentListIndex(listPendingPaymentVerifications(), id) },
      { key: "arrivalMonitoring", index: paymentListIndex(listArrivalMonitoringItems(), id) },
      { key: "paymentHistory", index: paymentListIndex(listPaymentHistoryItems(), id) }
    ];
    var found = false;
    var pageChanged = false;
    indexes.forEach(function (entry) {
      if (entry.index < 0) return;
      found = true;
      var page = Math.floor(entry.index / ADMIN_PAGE_SIZE) + 1;
      if (adminListPages[entry.key] !== page) {
        adminListPages[entry.key] = page;
        pageChanged = true;
      }
    });
    if (paymentsActiveTab !== "approval") setPaymentsTab("approval");
    if (pageChanged) {
      paymentFocusLock = true;
      renderPaymentVerificationList();
      renderArrivalMonitoringList();
      renderPaymentVerificationHistory();
      paymentFocusLock = false;
    }
    var matched = highlightPaymentRows(id);
    if (note) {
      note.hidden = false;
      var outsidePeriod =
        !found &&
        !matched.length &&
        paymentPeriodFilter.mode !== "all" &&
        (paymentListIndex(listPendingPaymentVerificationsRaw(), id) >= 0 ||
          paymentListIndex(listArrivalMonitoringItemsRaw(), id) >= 0 ||
          paymentListIndex(listPaymentHistoryItemsRaw(), id) >= 0);
      note.textContent = found || matched.length
        ? "Payment record for booking " + id + " is highlighted below. Use the existing verification actions on that row."
        : outsidePeriod
          ? "This payment is outside the selected period. Choose All, or pick the week, month, or year that includes it."
          : "No payment record was found for booking " + id + ". This guest may not have submitted a receipt yet.";
    }
    if (matched[0]) {
      window.requestAnimationFrame(function () {
        try {
          matched[0].scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (e) {}
      });
    }
  }

  function renderPaymentsSection() {
    syncPaymentPeriodControls();
    renderAdminPaymentMethodsList();
    renderPaymentVerificationList();
    renderPaymentVerificationHistory();
    renderArrivalMonitoringList();
    setPaymentsTab(paymentsActiveTab || "bookings");
    applyPaymentFocus();
  }

  function syncPaymentsSection() {
    var B = window.ElenestBookings;
    if (!B || typeof B.refresh !== "function") {
      renderPaymentsSection();
      return Promise.resolve();
    }
    if (paymentsSyncInFlight) return Promise.resolve();
    paymentsSyncInFlight = true;
    return B.refresh()
      .then(function () {
        paymentsSyncInFlight = false;
        renderPaymentsSection();
      })
      .catch(function () {
        paymentsSyncInFlight = false;
        renderPaymentsSection();
      });
  }

  function initPaymentManagementHandlers() {
    var form = document.getElementById("adminPaymentMethodForm");
    var cancelBtn = document.getElementById("adminPaymentMethodCancelBtn");
    var refreshBtn = document.getElementById("adminPaymentVerificationRefresh");
    var historyRefreshBtn = document.getElementById("adminPaymentHistoryRefresh");
    var proofClose = document.getElementById("adminPaymentProofCloseBtn");
    var proofOverlay = document.getElementById("adminPaymentProofOverlay");

    document.querySelectorAll("[data-payments-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPaymentsTab(btn.getAttribute("data-payments-tab") || "bookings");
      });
    });
    setPaymentsTab("bookings");

    var periodRoot = document.getElementById("adminPaymentsPeriodFilters");
    if (periodRoot) {
      periodRoot.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-payment-period]") : null;
        if (!btn || !periodRoot.contains(btn)) return;
        var next = btn.getAttribute("data-payment-period") || "all";
        if (next !== "week" && next !== "month" && next !== "year") next = "all";
        if (paymentPeriodFilter.mode === next) return;
        paymentPeriodFilter.mode = next;
        clampPaymentWeek();
        syncPaymentPeriodControls();
        applyPaymentPeriodFilter();
      });
      periodRoot.addEventListener("change", function (e) {
        var target = e.target;
        if (!target || !target.id) return;
        if (target.id === "adminPaymentsPeriodYear") {
          paymentPeriodFilter.year = parseInt(target.value, 10);
          if (isNaN(paymentPeriodFilter.year)) paymentPeriodFilter.year = new Date().getFullYear();
        } else if (target.id === "adminPaymentsPeriodMonth") {
          paymentPeriodFilter.month = parseInt(target.value, 10);
          if (isNaN(paymentPeriodFilter.month) || paymentPeriodFilter.month < 0 || paymentPeriodFilter.month > 11) {
            paymentPeriodFilter.month = new Date().getMonth();
          }
        } else if (target.id === "adminPaymentsPeriodWeek") {
          paymentPeriodFilter.week = parseInt(target.value, 10);
          if (isNaN(paymentPeriodFilter.week)) paymentPeriodFilter.week = 1;
        } else {
          return;
        }
        clampPaymentWeek();
        syncPaymentPeriodControls();
        applyPaymentPeriodFilter();
      });
    }
    syncPaymentPeriodControls();

    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        clearPaymentMethodForm();
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(refreshBtn, function () { return syncPaymentsSection(); });
        else syncPaymentsSection();
      });
    }
    if (historyRefreshBtn) {
      historyRefreshBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.run(historyRefreshBtn, function () { return syncPaymentsSection(); });
        else syncPaymentsSection();
      });
    }
    var arrivalRefreshBtn = document.getElementById("adminArrivalMonitoringRefresh");
    if (arrivalRefreshBtn) {
      arrivalRefreshBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) {
          BL.run(arrivalRefreshBtn, function () {
            renderArrivalMonitoringList();
          });
        } else {
          renderArrivalMonitoringList();
        }
      });
    }
    document.querySelectorAll(".admin-payment-kpi-card").forEach(function (card) {
      function jump() {
        setPaymentsTab("approval");
        var targetId = card.getAttribute("data-scroll-target");
        var target = targetId ? document.getElementById(targetId) : null;
        if (target) {
          window.setTimeout(function () {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 40);
        }
      }
      card.addEventListener("click", jump);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump();
        }
      });
    });
    setInterval(function () {
      var paymentsSection = document.getElementById("section-payments");
      if (!paymentsSection || paymentsSection.hasAttribute("hidden")) return;
      tickArrivalTimers();
    }, 1000);
    if (proofClose) proofClose.addEventListener("click", closePaymentProofModal);
    if (proofOverlay) {
      proofOverlay.addEventListener("click", function (e) {
        if (e.target === proofOverlay) closePaymentProofModal();
      });
    }

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var PM = window.ElenestPaymentMethods;
        if (!PM) {
          setPaymentMethodMsg(false, "Payment methods module not loaded.");
          return;
        }
        var provider = document.getElementById("adminPaymentProvider");
        var accountName = document.getElementById("adminPaymentAccountName");
        var accountNumber = document.getElementById("adminPaymentAccountNumber");
        var instructions = document.getElementById("adminPaymentInstructions");
        var qrUrl = document.getElementById("adminPaymentQrUrl");
        var qrUpload = document.getElementById("adminPaymentQrUpload");
        var active = document.getElementById("adminPaymentActive");
        var editId = document.getElementById("adminPaymentMethodEditId");

        var payload = {
          provider: provider ? provider.value.trim() : "",
          accountName: accountName ? accountName.value.trim() : "",
          accountNumber: accountNumber ? accountNumber.value.trim() : "",
          instructions: instructions ? instructions.value.trim() : "",
          qrImage: qrUrl && qrUrl.value.trim() ? qrUrl.value.trim() : "../Images/payment-qr.svg",
          active: active ? active.checked : true
        };
        if (!payload.provider || !payload.accountName || !payload.accountNumber) {
          setPaymentMethodMsg(false, "Provider, account name, and account number are required.");
          return;
        }

        var submitBtn = form.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;

        function finishSave(imageData) {
          if (imageData) payload.qrImage = imageData;
          var id = editId ? editId.value.trim() : "";
          var done = id ? PM.update(id, payload) : PM.add(payload);
          return Promise.resolve(done).then(function () {
            setPaymentMethodMsg(true, id ? "Payment method updated." : "Payment method added.");
            clearPaymentMethodForm();
            renderAdminPaymentMethodsList();
          });
        }

        if (BL) BL.set(submitBtn, true);

        if (qrUpload && qrUpload.files && qrUpload.files[0]) {
          var file = qrUpload.files[0];
          if (String(file.type || "").indexOf("image/") !== 0) {
            if (BL) BL.set(submitBtn, false);
            setPaymentMethodMsg(false, "QR upload must be an image.");
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            finishSave(String(reader.result || ""))
              .catch(function () {
                setPaymentMethodMsg(false, "Could not save payment method.");
              })
              .then(function () {
                if (BL) BL.set(submitBtn, false);
              });
          };
          reader.onerror = function () {
            if (BL) BL.set(submitBtn, false);
            setPaymentMethodMsg(false, "Failed to read QR image.");
          };
          reader.readAsDataURL(file);
          return;
        }
        finishSave("")
          .catch(function () {
            setPaymentMethodMsg(false, "Could not save payment method.");
          })
          .then(function () {
            if (BL) BL.set(submitBtn, false);
          });
      });
    }
  }

  function nightsFromCheckInOut(checkIn, checkOut) {
    if (!checkIn || !checkOut) return null;
    try {
      var a = new Date(checkIn + "T12:00:00");
      var b = new Date(checkOut + "T12:00:00");
      if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
      var diff = b.getTime() - a.getTime();
      var nights = Math.round(diff / 86400000);
      if (nights < 0) return null;
      return nights;
    } catch (e) {
      return null;
    }
  }

  function buildAdminBookingCard(item) {
    var b = item.booking;

    var card = document.createElement("article");
    card.className = "booking-card";

    var top = document.createElement("div");
    top.className = "booking-card__top";

    var badge = document.createElement("span");
    applyBookingStatusBadge(badge, b, bookingStatusLabel(b));

    top.appendChild(badge);

    var nameEl = document.createElement("h4");
    nameEl.className = "booking-card__name";
    nameEl.textContent = b.fullName || "Guest";

    var dateRow = document.createElement("div");
    dateRow.className = "booking-card__row";
    var dateLab = document.createElement("span");
    dateLab.className = "booking-card__label";
    dateLab.textContent = "Stay begins";
    var dateVal = document.createElement("span");
    dateVal.className = "booking-card__value";
    dateVal.textContent = fmtDateLong(b.checkIn);
    dateRow.appendChild(dateLab);
    dateRow.appendChild(dateVal);

    var roomRow = document.createElement("div");
    roomRow.className = "booking-card__row";
    var roomLab = document.createElement("span");
    roomLab.className = "booking-card__label";
    roomLab.textContent = "Room type";
    var roomVal = document.createElement("span");
    roomVal.className = "booking-card__value";
    roomVal.textContent = labelRoomType(b.roomType);
    roomRow.appendChild(roomLab);
    roomRow.appendChild(roomVal);

    var sub = document.createElement("p");
    sub.className = "booking-card__sub";
    sub.textContent = "Submitted " + fmtWhen(b.submittedAt);

    var details = document.createElement("details");
    details.className = "booking-card__details";
    var summ = document.createElement("summary");
    summ.textContent = "Full request details";
    var dl = document.createElement("dl");
    dl.className = "booking-dl booking-dl--compact";

    function addRow(term, val) {
      var dt = document.createElement("dt");
      dt.textContent = term;
      var dd = document.createElement("dd");
      dd.textContent = val === undefined || val === null || val === "" ? "—" : String(val);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    addRow("Phone", b.phone);
    addRow("Email", b.email || item.accountEmail);
    addRow("Room type", labelRoomType(b.roomType));
    var facilityNames = []
      .concat(b.roomCatalogNames || (b.roomCatalogName ? [b.roomCatalogName] : []))
      .concat(b.cottageCatalogNames || [])
      .concat(b.hallCatalogNames || (b.hallCatalogName ? [b.hallCatalogName] : []))
      .filter(Boolean);
    if (facilityNames.length) addRow("Facilities", facilityNames.join(", "));
    if (b.capacityTotal != null && b.capacityTotal !== "") {
      addRow("Capacity", String(b.capacityTotal) + " pax");
    }
    addRow("Check-out", fmtDateLong(b.checkOut));
    addRow("Adults", b.adults);
    addRow("Children", b.children);
    addRow("Event hall rental", labelEventHall(b.eventHall));
    addRow("Swimming pool", labelPoolForBooking(b));
    addRow("Event", labelEventType(b.eventType));
    addRow("Special request", b.request);

    details.appendChild(summ);
    details.appendChild(dl);

    card.appendChild(top);
    card.appendChild(nameEl);
    card.appendChild(dateRow);
    card.appendChild(roomRow);
    card.appendChild(sub);
    card.appendChild(details);

    return card;
  }

  // Calendar view state (used only by the admin dashboard calendar)
  var adminCalView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  var adminReservationModalDate = null;
  var adminReservationSelectedId = null;

  function adminIsoToUtcDate(iso) {
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10) - 1;
    var d = parseInt(iso.slice(8, 10), 10);
    return new Date(Date.UTC(y, m, d));
  }

  function adminIsIsoInStay(iso, checkIn, checkOut) {
    if (!iso || !checkIn || !checkOut) return false;
    try {
      var cur = adminIsoToUtcDate(checkIn);
      var end = adminIsoToUtcDate(checkOut);
      var target = adminIsoToUtcDate(iso);
      return target >= cur && target < end;
    } catch (e) {
      return false;
    }
  }

  function getAdminBookingsForDate(iso) {
    return listBookings()
      .filter(function (it) {
        var b = it.booking || {};
        if (!b.checkIn || !b.checkOut) return false;
        return adminIsIsoInStay(iso, b.checkIn, b.checkOut);
      })
      .sort(function (a, c) {
        var ai = (a.booking && a.booking.checkIn) || "";
        var bi = (c.booking && c.booking.checkIn) || "";
        if (ai !== bi) return ai < bi ? -1 : 1;
        var as = (a.booking && a.booking.submittedAt) || "";
        var bs = (c.booking && c.booking.submittedAt) || "";
        return as > bs ? -1 : as < bs ? 1 : 0;
      });
  }

  function labelFacilityReserved(b) {
    b = b || {};
    var facilityNames = []
      .concat(b.roomCatalogNames || (b.roomCatalogName ? [b.roomCatalogName] : []))
      .concat(b.cottageCatalogNames || [])
      .concat(b.hallCatalogNames || (b.hallCatalogName ? [b.hallCatalogName] : []))
      .filter(Boolean);
    if (facilityNames.length) return facilityNames.join(", ");
    if (b.roomType && b.roomType !== "none") return labelRoomType(b.roomType);
    if (b.eventHall && b.eventHall !== "none") return labelEventHall(b.eventHall);
    return "—";
  }

  function formatGuestCountForBooking(b) {
    b = b || {};
    var adults = toNumberOrNull(b.adults);
    var children = toNumberOrNull(b.children);
    if (adults !== null || children !== null) {
      var total = (adults || 0) + (children || 0);
      return total > 0 ? String(total) : "—";
    }
    if (b.capacityTotal != null && b.capacityTotal !== "") return String(b.capacityTotal);
    return "—";
  }

  function guestInitials(name) {
    var parts = String(name || "Guest")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return (parts[0] || "G").slice(0, 2).toUpperCase();
  }

  function paymentStatusPillClass(status) {
    var s = String(status || "").toLowerCase();
    if (s.indexOf("fully paid") !== -1 || s.indexOf("approved") !== -1 || s.indexOf("confirmed") !== -1) {
      return "admin-reservation-pill--paid";
    }
    if (s.indexOf("reject") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("no show") !== -1) {
      return "admin-reservation-pill--danger";
    }
    return "admin-reservation-pill--pending";
  }

  function buildAdminReservationField(label, value, extraClass) {
    var cell = document.createElement("div");
    cell.className = "admin-reservation-field" + (extraClass ? " " + extraClass : "");
    var lab = document.createElement("span");
    lab.className = "admin-reservation-field__label";
    lab.textContent = label;
    var val = document.createElement("span");
    val.className = "admin-reservation-field__value";
    val.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
    cell.appendChild(lab);
    cell.appendChild(val);
    return cell;
  }

  function buildAdminReservationDetailEl(item) {
    var b = item.booking || {};
    var guestName = b.fullName || "Guest";
    var paymentStatus = paymentStatusLabel(b);
    var guestCount = formatGuestCountForBooking(b);
    var facility = labelFacilityReserved(b);
    var wrap = document.createElement("div");
    wrap.className = "admin-reservation-detail__panel";

    var hero = document.createElement("div");
    hero.className = "admin-reservation-detail__hero";

    var avatar = document.createElement("div");
    avatar.className = "admin-reservation-detail__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = guestInitials(guestName);
    hero.appendChild(avatar);

    var heroText = document.createElement("div");
    heroText.className = "admin-reservation-detail__hero-text";
    var nameEl = document.createElement("h4");
    nameEl.textContent = guestName;
    heroText.appendChild(nameEl);

    var badges = document.createElement("div");
    badges.className = "admin-reservation-detail__badges";
    var statusBadge = document.createElement("span");
    applyBookingStatusBadge(statusBadge, b, bookingStatusLabel(b));
    badges.appendChild(statusBadge);
    var payBadge = document.createElement("span");
    var payPres =
      window.ElenestPaymentFlow && typeof window.ElenestPaymentFlow.getPaymentPresentation === "function"
        ? window.ElenestPaymentFlow.getPaymentPresentation(b, { label: paymentStatus })
        : null;
    var payKind = payPres ? payPres.kind : "pending";
    if (!payPres) {
      var pillCls = paymentStatusPillClass(paymentStatus);
      if (pillCls.indexOf("paid") !== -1) payKind = "success";
      else if (pillCls.indexOf("danger") !== -1) payKind = "cancelled";
    }
    payBadge.className =
      "admin-reservation-pill " +
      (payKind === "success"
        ? "admin-reservation-pill--paid"
        : payKind === "cancelled"
          ? "admin-reservation-pill--danger"
          : "admin-reservation-pill--pending");
    var payIcon = document.createElement("span");
    payIcon.className = "booking-status__icon";
    payIcon.setAttribute("aria-hidden", "true");
    if (window.ElenestPaymentFlow && typeof window.ElenestPaymentFlow.statusGlyph === "function") {
      payIcon.innerHTML = window.ElenestPaymentFlow.statusGlyph(payKind);
    } else {
      payIcon.textContent = payKind === "success" ? "✓" : payKind === "cancelled" ? "✕" : "⏱";
    }
    var payText = document.createElement("span");
    payText.textContent = paymentStatus;
    payBadge.appendChild(payIcon);
    payBadge.appendChild(payText);
    badges.appendChild(payBadge);
    heroText.appendChild(badges);
    hero.appendChild(heroText);
    wrap.appendChild(hero);

    var highlights = document.createElement("div");
    highlights.className = "admin-reservation-detail__highlights";

    function addStat(label, value, mod) {
      var stat = document.createElement("div");
      stat.className = "admin-reservation-stat" + (mod ? " admin-reservation-stat--" + mod : "");
      var statLabel = document.createElement("span");
      statLabel.className = "admin-reservation-stat__label";
      statLabel.textContent = label;
      var statValue = document.createElement("span");
      statValue.className = "admin-reservation-stat__value";
      statValue.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
      stat.appendChild(statLabel);
      stat.appendChild(statValue);
      highlights.appendChild(stat);
    }

    addStat("Total amount", fmtPHP(b.totalEstimate), "amount");
    addStat("Guests", guestCount);
    addStat("Facility", facility);
    wrap.appendChild(highlights);

    var grid = document.createElement("div");
    grid.className = "admin-reservation-detail__grid";
    grid.appendChild(buildAdminReservationField("Contact number", b.phone));
    grid.appendChild(buildAdminReservationField("Booking ID", b.id, "admin-reservation-field--wide"));
    grid.appendChild(buildAdminReservationField("Check-in", fmtDateLong(b.checkIn)));
    grid.appendChild(buildAdminReservationField("Check-out", fmtDateLong(b.checkOut)));
    grid.appendChild(buildAdminReservationField("Payment status", paymentStatusLabel(b)));
    grid.appendChild(buildAdminReservationField("Booking status", bookingStatusLabel(b)));
    grid.appendChild(buildAdminReservationField("Arrival status", arrivalStatusLabelForBooking(b)));
    if (
      window.ElenestPaymentFlow &&
      typeof window.ElenestPaymentFlow.isFutureBooking === "function" &&
      window.ElenestPaymentFlow.isFutureBooking(b)
    ) {
      grid.appendChild(
        buildAdminReservationField(
          "Schedule note",
          window.ElenestPaymentFlow.futureBookingLabel(b),
          "admin-reservation-field--wide"
        )
      );
    }
    wrap.appendChild(grid);

    return wrap;
  }

  function renderAdminReservationModal(iso, preferredId) {
    var overlay = document.getElementById("adminReservationOverlay");
    var dateLabel = document.getElementById("adminReservationDateLabel");
    var picker = document.getElementById("adminReservationPicker");
    var detail = document.getElementById("adminReservationDetail");
    var empty = document.getElementById("adminReservationEmpty");
    if (!overlay || !picker || !detail || !empty) return;

    var items = getAdminBookingsForDate(iso);
    if (dateLabel) dateLabel.textContent = fmtDateLong(iso);

    picker.textContent = "";
    detail.textContent = "";
    setHidden(empty, true);
    setHidden(picker, true);

    if (!items.length) {
      setHidden(empty, false);
      adminReservationSelectedId = null;
      return;
    }

    var selectedItem = null;
    if (preferredId) {
      items.some(function (it) {
        if (it.booking && String(it.booking.id) === String(preferredId)) {
          selectedItem = it;
          return true;
        }
        return false;
      });
    }
    if (!selectedItem) selectedItem = items[0];
    adminReservationSelectedId = selectedItem.booking && selectedItem.booking.id ? String(selectedItem.booking.id) : null;

    if (items.length > 1) {
      setHidden(picker, false);
      var pickerHead = document.createElement("div");
      pickerHead.className = "admin-reservation-picker__head";
      var pickerTitle = document.createElement("p");
      pickerTitle.className = "admin-reservation-picker__title";
      pickerTitle.textContent = "Select a reservation";
      var pickerCount = document.createElement("span");
      pickerCount.className = "admin-reservation-picker__count";
      pickerCount.textContent = items.length + " on this date";
      pickerHead.appendChild(pickerTitle);
      pickerHead.appendChild(pickerCount);
      picker.appendChild(pickerHead);

      var list = document.createElement("div");
      list.className = "admin-reservation-picker__list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Reservations on selected date");
      items.forEach(function (it) {
        var b = it.booking || {};
        var guestName = b.fullName || "Guest";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "admin-reservation-picker__item";
        btn.setAttribute("role", "option");
        if (adminReservationSelectedId && String(b.id) === String(adminReservationSelectedId)) {
          btn.classList.add("admin-reservation-picker__item--active");
          btn.setAttribute("aria-selected", "true");
        } else {
          btn.setAttribute("aria-selected", "false");
        }
        btn.setAttribute("data-booking-id", b.id || "");

        var pickerAvatar = document.createElement("span");
        pickerAvatar.className = "admin-reservation-picker__avatar";
        pickerAvatar.setAttribute("aria-hidden", "true");
        pickerAvatar.textContent = guestInitials(guestName);

        var body = document.createElement("span");
        body.className = "admin-reservation-picker__body";
        var name = document.createElement("span");
        name.className = "admin-reservation-picker__name";
        name.textContent = guestName;
        var meta = document.createElement("span");
        meta.className = "admin-reservation-picker__meta";
        meta.textContent =
          labelFacilityReserved(b) +
          " · " +
          formatGuestCountForBooking(b) +
          " guest(s) · " +
          fmtPHP(b.totalEstimate);
        body.appendChild(name);
        body.appendChild(meta);

        var pickerBadge = document.createElement("span");
        applyBookingStatusBadge(pickerBadge, b, statusLabel(b.status));

        btn.appendChild(pickerAvatar);
        btn.appendChild(body);
        btn.appendChild(pickerBadge);
        btn.addEventListener("click", function () {
          adminReservationSelectedId = b.id ? String(b.id) : null;
          renderAdminReservationModal(iso, adminReservationSelectedId);
        });
        list.appendChild(btn);
      });
      picker.appendChild(list);
    }

    detail.appendChild(buildAdminReservationDetailEl(selectedItem));
  }

  function openAdminReservationModal(iso, preferredId) {
    var overlay = document.getElementById("adminReservationOverlay");
    if (!overlay || !iso) return;
    if (adminReservationModalDate !== iso) adminReservationSelectedId = null;
    adminReservationModalDate = iso;
    if (preferredId) adminReservationSelectedId = String(preferredId);
    renderAdminReservationModal(iso, adminReservationSelectedId);
    overlay.removeAttribute("hidden");
  }

  function openAdminBookingById(bookingId) {
    if (!bookingId) return false;
    var entry = findBookingEntry(bookingId);
    if (!entry || !entry.booking || !entry.booking.checkIn) return false;
    openAdminReservationModal(String(entry.booking.checkIn).slice(0, 10), bookingId);
    try {
      var card = document.getElementById("adminUpcomingBookingsCard");
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
    return true;
  }

  function listUpcomingActionBookings() {
    var PF = window.ElenestPaymentFlow;
    var today = PF && PF.todayIsoLocal ? PF.todayIsoLocal() : "";
    var items = listBookings().filter(function (item) {
      var b = item.booking;
      if (!b || b.linkedFacilityBooking || b.parentBookingId) return false;
      if (PF && typeof PF.shouldSendFutureBookingReminders === "function") {
        return PF.shouldSendFutureBookingReminders(b);
      }
      var day = String(b.checkIn || "").slice(0, 10);
      if (!day || (today && day < today)) return false;
      var st = normalizeStatus(b.status);
      return st === "Confirmed" || st === "Reserved" || !!b.paymentVerifiedAt;
    });
    items.sort(function (a, c) {
      var ai = (a.booking && a.booking.checkIn) || "";
      var ci = (c.booking && c.booking.checkIn) || "";
      if (ai !== ci) return ai < ci ? -1 : 1;
      return 0;
    });
    return items;
  }

  function upcomingBookingsSignature(items) {
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var b = items[i] && items[i].booking;
      if (!b) continue;
      parts.push(
        [
          b.id,
          b.status,
          b.paymentStatus,
          b.arrivalStatus,
          b.checkIn,
          b.checkOut,
          b.fullName,
          b.totalEstimate
        ].join("~")
      );
    }
    return parts.join(";");
  }

  function renderUpcomingBookingsSection() {
    var host = document.getElementById("adminUpcomingBookingsList");
    var empty = document.getElementById("adminUpcomingBookingsEmpty");
    if (!host) return;
    var items = listUpcomingActionBookings();
    var sig = upcomingBookingsSignature(items);
    if (sig === renderUpcomingBookingsSection._sig && host.childElementCount) return;
    if (!items.length && sig === renderUpcomingBookingsSection._sig && empty && !empty.hidden) return;
    renderUpcomingBookingsSection._sig = sig;
    host.textContent = "";
    if (!items.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = "No upcoming confirmed bookings.";
      }
      return;
    }
    if (empty) empty.hidden = true;
    var PF = window.ElenestPaymentFlow;
    var built = createPayTable([
      "Guest",
      "Booking date",
      "Facility",
      "Payment",
      "Booking",
      "Arrival",
      "Actions"
    ]);
    built.table.classList.add("admin-upcoming-table");
    items.forEach(function (item) {
      var b = item.booking;
      var tr = document.createElement("tr");
      appendStackedCell(tr, b.fullName || "Guest", b.email || item.accountEmail);
      var dateCell = document.createElement("td");
      dateCell.className = "admin-pay-cell-wrap admin-upcoming-date-cell";
      var dateMain = document.createElement("div");
      dateMain.className = "admin-upcoming-date-main";
      dateMain.textContent = fmtDateLong(b.checkIn);
      dateCell.appendChild(dateMain);
      if (PF && typeof PF.isCheckInDateToday === "function" && PF.isCheckInDateToday(b)) {
        var todayPill = document.createElement("span");
        todayPill.className = "admin-arrival-status-pill admin-checkin-today-pill";
        todayPill.textContent = "Check-in Today";
        dateCell.appendChild(todayPill);
      } else if (PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(b)) {
        var fut = document.createElement("span");
        fut.className = "admin-pay-cell-sub";
        fut.textContent = PF.futureBookingLabel(b);
        dateCell.appendChild(fut);
      }
      tr.appendChild(dateCell);
      appendTextCell(tr, labelFacilityReserved(b), true);
      appendTextCell(tr, paymentStatusLabel(b));
      appendTextCell(tr, bookingStatusLabel(b));
      appendTextCell(tr, arrivalStatusLabelForBooking(b));
      var actionsTd = document.createElement("td");
      actionsTd.className = "admin-upcoming-actions-cell";
      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn--outline btn--small";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", function () {
        openAdminBookingById(b.id);
      });
      actionsTd.appendChild(openBtn);
      tr.appendChild(actionsTd);
      built.tbody.appendChild(tr);
    });
    host.appendChild(built.table);
  }

  function closeAdminReservationModal() {
    var overlay = document.getElementById("adminReservationOverlay");
    if (overlay) overlay.setAttribute("hidden", "");
    adminReservationModalDate = null;
    adminReservationSelectedId = null;
  }

  function refreshAdminReservationModalIfOpen() {
    if (!adminReservationModalDate) return;
    var overlay = document.getElementById("adminReservationOverlay");
    if (!overlay || overlay.hasAttribute("hidden")) return;
    renderAdminReservationModal(adminReservationModalDate, adminReservationSelectedId);
  }

  function initAdminReservationModal() {
    var overlay = document.getElementById("adminReservationOverlay");
    var closeBtn = document.getElementById("adminReservationCloseBtn");
    var closeBtn2 = document.getElementById("adminReservationCloseBtn2");
    if (!overlay) return;

    function closeModal() {
      closeAdminReservationModal();
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (closeBtn2) closeBtn2.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && !overlay.hasAttribute("hidden")) closeModal();
    });
  }

  function adminCalendarSignature() {
    var items = [];
    try {
      items = listBookings() || [];
    } catch (e) {
      return "";
    }
    var parts = [String(adminCalView.y), String(adminCalView.m)];
    for (var i = 0; i < items.length; i++) {
      var b = items[i] && items[i].booking;
      if (!b || !b.id) continue;
      parts.push(
        [
          b.id,
          b.status,
          b.workflow,
          b.checkIn,
          b.checkOut,
          b.slotLocked ? 1 : 0,
          b.paymentDeadlineAt || "",
          b.paymentVerifiedAt || ""
        ].join("~")
      );
    }
    return parts.join("|");
  }

  function renderAdminCalendar() {
    var host = document.getElementById("adminCalendarHost");
    var label = document.getElementById("adminCalMonthLabel");
    if (!host || !label) return;
    if (!window.ElenestCalendarWidget || typeof window.ElenestCalendarWidget.render !== "function") return;
    var sig = adminCalendarSignature();
    if (sig && sig === renderAdminCalendar.paintSig && host.childElementCount) return;
    renderAdminCalendar.paintSig = sig;

    window.ElenestCalendarWidget.render({
      host: host,
      monthLabel: label,
      calView: adminCalView,
      highlightRange: false,
      resortWideView: true,
      allowAllDayClick: true,
      onDayClick: function (iso) {
        openAdminReservationModal(iso);
      }
    });
  }

  function renderDashboard() {
    var board = document.getElementById("adminBookingsBoard");
    var bookings = listBookings();

    // Dashboard KPIs: counts by booking status + pending check-in work at reception.
    var pending = 0;
    var confirmed = 0;
    var cancelled = 0;
    var pendingIds = {};
    var PF = window.ElenestPaymentFlow;

    bookings.forEach(function (item) {
      var b = item.booking;
      var display =
        PF && typeof PF.bookingDisplayStatus === "function"
          ? PF.bookingDisplayStatus(b)
          : statusLabel(b.status);
      if (display === "Pending") {
        pending++;
        pendingIds[String(b.id || item.accountEmail || Math.random())] = true;
      }
      if (display === "Confirmed") confirmed++;
      if (display === "Cancelled") cancelled++;
    });
    pending = Object.keys(pendingIds).length;

    var pendingEl = document.getElementById("adminKpiPending");
    if (pendingEl) pendingEl.textContent = pending;
    var confirmedEl = document.getElementById("adminKpiConfirmed");
    if (confirmedEl) confirmedEl.textContent = confirmed;
    var cancelledEl = document.getElementById("adminKpiCancelled");
    if (cancelledEl) cancelledEl.textContent = cancelled;

    // Total Reviews: paint from cache instantly; refresh in background (no force reload).
    var totalReviewsEl = document.getElementById("adminKpiTotalReviews");
    if (totalReviewsEl) {
      if (homeReviewKpisCache) {
        totalReviewsEl.textContent = String(homeReviewKpisCache.total);
      } else {
        totalReviewsEl.textContent = String(getLiveReviewRecordsForKpis().length);
      }
    }
    loadHomeReviewKpis(false).then(function (kpis) {
      if (!totalReviewsEl || !kpis) return;
      totalReviewsEl.textContent = String(kpis.total);
    });

    // Dashboard should only show totals; clear any legacy board if it exists.
    if (board) board.textContent = "";
    renderUpcomingBookingsSection();
  }

  function renderSentimentFeedbackList() {
    var host = document.querySelector("#section-sentiment .sentiment-feedback-list");
    if (!host) return;
    var list = getSentimentFeedback();
    var weekLabel = formatWeekRangeLabel(getCurrentWeekStartDate());
    var weekNote = document.getElementById("sentimentCurrentWeekNote");
    if (weekNote) {
      weekNote.textContent = "Showing comments for the current week (" + weekLabel + ").";
    }
    host.textContent = "";
    if (!list.length) {
      if (getFeedback().length) {
        var empty = document.createElement("p");
        empty.className = "sentiment-current-week-empty";
        empty.textContent =
          "No guest comments yet for this week. Previous weeks are in the Comment Archive.";
        host.appendChild(empty);
        return;
      }
      var examples = [
        {
          name: "Joan Briones",
          stars: 5,
          comment: "Very peaceful place. Staff are kind, rooms are spotless, and check-in was smooth. Perfect weekend escape.",
          img: "../Images/blog-s1.png"
        },
        {
          name: "Chryzel de Torres",
          stars: 4,
          comment: "We loved the pool and food. Relaxing environment and attentive staff from start to finish.",
          img: "../Images/blog-s2.png"
        },
        {
          name: "Kate Mangurali",
          stars: 5,
          comment: "Excellent service and smooth check-in. We celebrated a birthday here and the team helped with every detail.",
          img: "../Images/blog-s3.png"
        }
      ];
      examples.forEach(function (ex, i) {
        var card = document.createElement("article");
        card.className = "review-card";
        var img = document.createElement("img");
        img.className = "review-img";
        img.src = ex.img;
        img.alt = "Guest " + ex.name;
        var nameLine = document.createElement("p");
        nameLine.className = "review-name";
        nameLine.style.margin = "0 0 6px";
        nameLine.style.fontWeight = "600";
        nameLine.style.fontSize = "0.95rem";
        nameLine.textContent = ex.name;
        var stars = document.createElement("p");
        stars.className = "stars";
        stars.textContent = starsText(ex.stars);
        var txt = document.createElement("p");
        txt.textContent = '"' + ex.comment + '"';
        card.appendChild(img);
        card.appendChild(nameLine);
        card.appendChild(stars);
        card.appendChild(txt);
        host.appendChild(card);
      });
      return;
    }
    list.slice(0, 6).forEach(function (f, i) {
      var card = document.createElement("article");
      card.className = "review-card";
      var img = document.createElement("img");
      img.className = "review-img";
      img.src = f.photo || ["../Images/blog-s1.png", "../Images/blog-s2.png", "../Images/blog-s3.png"][i % 3];
      var guestName = feedbackGuestName(f);
      img.alt = guestName;
      var nameLine = document.createElement("p");
      nameLine.className = "review-name";
      nameLine.style.margin = "0 0 6px";
      nameLine.style.fontWeight = "600";
      nameLine.style.fontSize = "0.95rem";
      nameLine.textContent = guestName;
      var stars = document.createElement("p");
      stars.className = "stars";
      stars.textContent = starsText(f.stars);
      var txt = document.createElement("p");
      txt.textContent = '"' + String(f.comment || "No comment provided.") + '"';
      card.appendChild(img);
      card.appendChild(nameLine);
      card.appendChild(stars);
      card.appendChild(txt);
      host.appendChild(card);
    });
  }

  function renderReports() {
    function paint(pastItems) {
      // Live bookings only for merge base — never listAll() (may include huge historical sets).
      var bookings = mergeReportBookings(listBookings(), pastItems || []);
      lastReportBookings = bookings;

      var now = new Date();
      var curY = now.getFullYear();
      var curM = now.getMonth();

      var monthlyIncome = 0;
      var totalIncome = 0;

      bookings.forEach(function (item) {
        var b = item.booking || {};
        var st = normalizeStatus(b.status);

        if (st === "Confirmed") {
          var income = bookingConfirmedIncome(b);
          totalIncome += income;
          if (isSameMonthByIsoDate(b.checkIn || b.check_in, curY, curM)) {
            monthlyIncome += income;
          }
        }
      });

      var monthlyIncomeEl = document.getElementById("adminKpiMonthlyIncome");
      if (monthlyIncomeEl) monthlyIncomeEl.textContent = fmtPHP(monthlyIncome);

      var totalIncomeEl = document.getElementById("adminKpiTotalIncome");
      if (totalIncomeEl) totalIncomeEl.textContent = fmtPHP(totalIncome);

      paintAllReportCharts(bookings);
      renderReportsGuestReviews();
      bindReportChartsResize();
    }

    var monthlyIncomeEl = document.getElementById("adminKpiMonthlyIncome");
    var totalIncomeEl = document.getElementById("adminKpiTotalIncome");

    // Paint live data immediately so the admin tab stays responsive.
    paint(pastReportLiteItems || []);

    if (!pastReportLiteItems) {
      if (monthlyIncomeEl && monthlyIncomeEl.textContent === "₱0") {
        monthlyIncomeEl.textContent = "Loading…";
      }
      if (totalIncomeEl && totalIncomeEl.textContent === "₱0") {
        totalIncomeEl.textContent = "Loading…";
      }
      // Defer heavy historical JSON so first paint + navigation stay smooth.
      setTimeout(function () {
        loadPastReportBookings().then(function (past) {
          var section = document.getElementById("section-reports");
          if (section && !section.hidden) paint(past);
        });
      }, 400);
    }
  }

  function renderAnalytics() {
    var section = document.getElementById("section-reports");
    if (!section || section.hidden) return;
    var EV = window.ElenestModelEvaluation;
    if (EV && typeof EV.render === "function") EV.render();
  }

  var lastReportBookings = null;
  var reportChartsResizeBound = false;

  function bookingConfirmedIncome(b) {
    var income = toNumberOrNull(b.totalEstimate != null ? b.totalEstimate : b.total_estimate);
    if (income === null) income = toNumberOrNull(b.amountDown != null ? b.amountDown : b.amount_down);
    return income === null ? 0 : income;
  }

  function reportDisplayStatus(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.bookingDisplayStatus === "function") {
      return PF.bookingDisplayStatus(b);
    }
    return statusLabel(b && b.status);
  }

  function facilityCategoryForBooking(b) {
    b = b || {};
    var sheet = String(b.sheetType || b.type || b.room_type || b.roomType || "")
      .trim()
      .toLowerCase();
    if (sheet === "reservation") return "Rooms";
    if (sheet === "entrance") return "Entrance";
    if (sheet === "hall rental" || sheet === "hall_rental") return "Event halls";
    if (sheet === "event") return "Events";

    var cottageCount =
      (Array.isArray(b.cottageCatalogNames) ? b.cottageCatalogNames.length : 0) ||
      (Array.isArray(b.cottageCatalogIds) ? b.cottageCatalogIds.length : 0) ||
      Number(b.cottageQty) ||
      0;
    var hallCount =
      (Array.isArray(b.hallCatalogNames) ? b.hallCatalogNames.length : 0) ||
      (Array.isArray(b.hallCatalogIds) ? b.hallCatalogIds.length : 0) ||
      (b.hallCatalogName ? 1 : 0) ||
      (b.eventHall && String(b.eventHall).toLowerCase() !== "none" ? 1 : 0);
    var roomCount =
      (Array.isArray(b.roomCatalogNames) ? b.roomCatalogNames.length : 0) ||
      (Array.isArray(b.roomCatalogIds) ? b.roomCatalogIds.length : 0) ||
      (b.roomCatalogName ? 1 : 0) ||
      (b.roomType && String(b.roomType).toLowerCase() !== "none" ? 1 : 0);
    var poolOnly = String(b.poolUse || "").toLowerCase() === "pool_only";

    if (cottageCount) return "Cottages";
    if (hallCount) return "Event halls";
    if (poolOnly) return "Entrance";
    if (roomCount) return "Rooms";
    if (/hall|event/.test(sheet)) return "Event halls";
    if (/entrance|pool/.test(sheet)) return "Entrance";
    if (/cottage|cabana/.test(sheet)) return "Cottages";
    if (/room|reservation/.test(sheet)) return "Rooms";
    return "Other";
  }

  function buildMonthBuckets(monthCount) {
    var now = new Date();
    var months = [];
    for (var i = monthCount - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var mk = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      months.push({
        key: mk,
        label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        bookings: 0,
        income: 0
      });
    }
    return months;
  }

  function paintAllReportCharts(bookings) {
    drawAdminTrendChart(bookings);
    drawAdminStatusChart(bookings);
    drawAdminFacilityChart(bookings);
    drawAdminRevenueChart(bookings);
  }

  function bindReportChartsResize() {
    if (reportChartsResizeBound) return;
    reportChartsResizeBound = true;
    var timer = null;
    window.addEventListener("resize", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        var section = document.getElementById("section-reports");
        if (!section || section.hidden) return;
        if (lastReportBookings) paintAllReportCharts(lastReportBookings);
      }, 180);
    });
  }

  function monthKeyFromIso(iso) {
    if (!iso || String(iso).length < 7) return null;
    return String(iso).slice(0, 7);
  }

  function drawCanvasTextFallback(ctx, w, h, text) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#64748b";
    ctx.font = "13px 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
  }

  /* —— Admin reporting charts: formal palette & grid —— */
  var CHART_FONT =
    "13px Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  var CHART_FONT_AXIS =
    "11px Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  var CHART_FONT_CAP =
    "11px Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  var CHART_BG = "#ffffff";
  var CHART_PLOT_BG = "rgba(248, 246, 249, 0.72)";
  var CHART_GRID = "rgba(61, 51, 64, 0.07)";
  var CHART_AXIS = "rgba(61, 51, 64, 0.16)";
  var CHART_TEXT = "#2f2933";
  var CHART_MUTED = "#6b6570";
  var CHART_PINK = "#c46b82";
  var CHART_PINK_DEEP = "#a84f68";
  var CHART_GREEN = "#7fc142";
  var CHART_GREEN_DEEP = "#5f9e2e";
  var CHART_PINK_SOFT = "rgba(196, 107, 130, 0.1)";
  var CHART_GREEN_SOFT = "rgba(127, 193, 66, 0.12)";
  var adminTrendChartMeta = null;
  var adminRevenueChartMeta = null;

  /** Crisp rendering on high-DPI displays; drawing uses CSS pixel units in returned w/h. */
  function prepareChartContext(canvas, fallbackW, fallbackH, minH) {
    if (!canvas || !canvas.getContext) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = canvas.clientWidth;
    var cssW = cw >= 64 ? Math.floor(cw) : fallbackW;
    var ratio = fallbackH / fallbackW;
    var cssH = Math.max(Math.round(cssW * ratio), minH != null ? minH : 120);
    // Keep CSS box equal to drawing size so labels are not squashed by max-height rules.
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.style.maxHeight = "none";
    var wPx = Math.max(1, Math.round(cssW * dpr));
    var hPx = Math.max(1, Math.round(cssH * dpr));
    canvas.width = wPx;
    canvas.height = hPx;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { ctx: ctx, w: cssW, h: cssH };
  }

  /** Thin month labels on narrow chart widths so they do not overlap. */
  function chartMonthLabelStep(cssW, count) {
    var n = count || 12;
    /* iPhone 13 ~390px → chart plot often ~280–340px */
    if (cssW < 420 || n > 14) return 3;
    if (cssW < 640 || n > 10) return 2;
    return 1;
  }

  function formatChartMonthAxisLabel(label, cssW) {
    var text = String(label || "");
    if (cssW < 640) {
      return text.replace(/\s+\d{2}$/, "");
    }
    return text;
  }

  function fillChartMonthsRow(rowEl, months, cssW, plotL, plotW) {
    if (!rowEl || !months || !months.length) return;
    var step = chartMonthLabelStep(cssW, months.length);
    rowEl.style.gridTemplateColumns = "repeat(" + months.length + ", minmax(0, 1fr))";
    rowEl.style.paddingLeft = (plotL != null ? plotL : 0) + "px";
    rowEl.style.paddingRight =
      Math.max(0, cssW - ((plotL || 0) + (plotW != null ? plotW : cssW))) + "px";
    rowEl.innerHTML = months
      .map(function (m, idx) {
        var skip = idx % step !== 0 && idx !== months.length - 1;
        var text = formatChartMonthAxisLabel(m.label, cssW);
        return (
          '<span class="' +
          (skip ? "is-chart-label-skip" : "") +
          '">' +
          (skip ? "" : text) +
          "</span>"
        );
      })
      .join("");
  }

  function drawProChartPlotBg(ctx, x0, y0, chartW, chartH) {
    ctx.save();
    ctx.fillStyle = CHART_PLOT_BG;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x0, y0, chartW, chartH, 10);
      ctx.fill();
    } else {
      ctx.fillRect(x0, y0, chartW, chartH);
    }
    ctx.restore();
  }

  function drawProChartGrid(ctx, x0, y0, chartW, chartH, lineCount) {
    lineCount = lineCount || 5;
    ctx.save();
    ctx.strokeStyle = CHART_GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    var g;
    for (g = 0; g <= lineCount; g++) {
      var y = y0 + (chartH * g) / lineCount;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + chartW, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawProChartBaseline(ctx, x0, y0, chartW, chartH) {
    ctx.save();
    ctx.strokeStyle = CHART_AXIS;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + chartH);
    ctx.lineTo(x0 + chartW, y0 + chartH);
    ctx.stroke();
    ctx.restore();
  }

  function formatChartAxisPeso(n) {
    var v = Math.abs(Number(n) || 0);
    if (v >= 1000000) {
      var m = v / 1000000;
      return "₱" + (m >= 10 ? Math.round(m) : m.toFixed(m >= 1 ? 1 : 2).replace(/\.0$/, "")) + "M";
    }
    if (v >= 1000) {
      var k = v / 1000;
      return "₱" + (k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "")) + "K";
    }
    return "₱" + Math.round(v).toLocaleString();
  }

  function makeVerticalBarGradient(ctx, x, y, bw, bh, topColor, bottomColor) {
    var grad = ctx.createLinearGradient(x, y, x, y + Math.max(bh, 1));
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    return grad;
  }

  function makeHorizontalBarGradient(ctx, x, y, bw, bh, leftColor, rightColor) {
    var grad = ctx.createLinearGradient(x, y, x + Math.max(bw, 1), y);
    grad.addColorStop(0, leftColor);
    grad.addColorStop(1, rightColor);
    return grad;
  }

  function fillRoundBar(ctx, x, y, bw, bh, radius) {
    var r = Math.min(radius || 3, bw / 2, bh / 2);
    if (r <= 0 || bh < 2) {
      ctx.fillRect(x, y, bw, bh);
      return;
    }
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, bw, bh);
    }
  }

  /** Rounded top corners only — cleaner vertical bars. */
  function fillRoundTopBar(ctx, x, y, bw, bh, radius) {
    if (bh < 2) {
      ctx.fillRect(x, y, bw, Math.max(bh, 0));
      return;
    }
    var r = Math.min(radius || 6, bw / 2, bh);
    ctx.beginPath();
    ctx.moveTo(x, y + bh);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh);
    ctx.closePath();
    ctx.fill();
  }

  function drawChartExampleFooter() {
    /* Intentionally blank — placeholder charts do not show a footer label. */
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
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y
      );
    }
  }

  function strokeSmoothWave(ctx, pts, color) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    buildSmoothPath(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function fillSmoothWave(ctx, pts, baselineY, color) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    buildSmoothPath(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, baselineY);
    ctx.lineTo(pts[0].x, baselineY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawWavePoints(ctx, pts, color, hoverKey, seriesKey) {
    pts.forEach(function (p, idx) {
      var active = hoverKey === seriesKey + ":" + idx;
      var r = active ? 5.5 : 4.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      if (active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 2.8, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    });
  }

  function hideAdminTrendTooltip() {
    var tip = document.getElementById("adminReportTrendTip");
    if (tip) tip.hidden = true;
    if (adminTrendChartMeta && adminTrendChartMeta.hoverKey != null) {
      adminTrendChartMeta.hoverKey = null;
      paintAdminTrendChart();
    }
  }

  function showAdminTrendTooltip(point, clientX, clientY) {
    var tip = document.getElementById("adminReportTrendTip");
    var canvas = document.getElementById("adminReportTrendChart");
    if (!tip || !canvas || !point) return;
    var wrap = canvas.parentElement;
    if (!wrap) return;
    var kindClass =
      point.series === "revenue"
        ? "admin-report-chart-tooltip__kind admin-report-chart-tooltip__kind--pink"
        : "admin-report-chart-tooltip__kind";
    tip.innerHTML =
      '<p class="admin-report-chart-tooltip__month">' +
      point.label +
      "</p>" +
      '<p class="admin-report-chart-tooltip__value">' +
      point.display +
      "</p>" +
      '<p class="' +
      kindClass +
      '">' +
      point.seriesLabel +
      "</p>";
    tip.hidden = false;
    var rect = wrap.getBoundingClientRect();
    var left = clientX - rect.left;
    var tipW = tip.offsetWidth || 120;
    left = Math.max(tipW / 2 + 4, Math.min(rect.width - tipW / 2 - 4, left));
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, clientY - rect.top) + "px";
  }

  function nearestAdminTrendPoint(mx, my) {
    if (!adminTrendChartMeta || !adminTrendChartMeta.hit.length) return null;
    var best = null;
    var bestDist = 36;
    adminTrendChartMeta.hit.forEach(function (p) {
      if (p.bar) {
        var inside =
          mx >= p.bar.x &&
          mx <= p.bar.x + p.bar.w &&
          my >= p.bar.y &&
          my <= p.bar.y + p.bar.h;
        if (inside) {
          var cx = p.bar.x + p.bar.w / 2;
          var dBar = Math.abs(mx - cx);
          if (dBar < bestDist) {
            bestDist = dBar;
            best = p;
          }
          return;
        }
      }
      var dx = p.x - mx;
      var dy = p.y - my;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    });
    return best;
  }

  function bindAdminTrendInteractions() {
    var canvas = document.getElementById("adminReportTrendChart");
    if (!canvas || canvas.getAttribute("data-trend-bound") === "1") return;
    canvas.setAttribute("data-trend-bound", "1");
    canvas.addEventListener("mousemove", function (evt) {
      if (!adminTrendChartMeta || !adminTrendChartMeta.layout) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * adminTrendChartMeta.layout.w;
      var my = ((evt.clientY - rect.top) / rect.height) * adminTrendChartMeta.layout.h;
      var point = nearestAdminTrendPoint(mx, my);
      if (!point) {
        hideAdminTrendTooltip();
        return;
      }
      var key = point.series + ":" + point.index;
      if (adminTrendChartMeta.hoverKey !== key) {
        adminTrendChartMeta.hoverKey = key;
        paintAdminTrendChart();
      }
      showAdminTrendTooltip(point, evt.clientX, evt.clientY);
    });
    canvas.addEventListener("mouseleave", hideAdminTrendTooltip);
  }

  function paintAdminTrendChart() {
    var canvas = document.getElementById("adminReportTrendChart");
    if (!canvas || !adminTrendChartMeta || !adminTrendChartMeta.months) return;
    var prep = prepareChartContext(canvas, 640, 200, 160);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    var months = adminTrendChartMeta.months;
    var hoverKey = adminTrendChartMeta.hoverKey;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 14;
    var padR = 14;
    var padT = 12;
    var padB = 10;
    var edgeInset = 10;
    var chartW = w - padL - padR;
    var chartH = h - padT - padB;
    var x0 = padL;
    var y0 = padT;
    var baselineY = y0 + chartH;
    var plotL = x0 + edgeInset;
    var plotW = Math.max(40, chartW - edgeInset * 2);

    var maxBookings = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, m.bookings);
      }, 0)
    );

    drawProChartPlotBg(ctx, x0, y0, chartW, chartH);
    drawProChartGrid(ctx, x0, y0, chartW, chartH, 4);
    drawProChartBaseline(ctx, x0, y0, chartW, chartH);

    var bookingPts = months.map(function (m, idx) {
      var x =
        months.length === 1 ? plotL + plotW / 2 : plotL + (idx / (months.length - 1)) * plotW;
      var y = y0 + chartH - (m.bookings / maxBookings) * (chartH - 16);
      y = Math.max(y0 + 8, Math.min(y, baselineY - 8));
      return { x: x, y: y, index: idx, label: m.label, bookings: m.bookings, income: m.income };
    });

    fillSmoothWave(ctx, bookingPts, baselineY, CHART_GREEN_SOFT);
    strokeSmoothWave(ctx, bookingPts, CHART_GREEN);
    drawWavePoints(ctx, bookingPts, CHART_GREEN, hoverKey, "bookings");

    var monthsRow = document.getElementById("adminReportTrendMonths");
    if (monthsRow) {
      fillChartMonthsRow(monthsRow, months, w, plotL, plotW);
    }

    adminTrendChartMeta.layout = { w: w, h: h };
    adminTrendChartMeta.hit = bookingPts.map(function (p) {
      return {
        x: p.x,
        y: p.y,
        bar: p.bar || null,
        index: p.index,
        label: p.label,
        series: "bookings",
        seriesLabel: "Reservations",
        display: String(Math.round(p.bookings))
      };
    });
  }

  function drawAdminTrendChart(items) {
    var canvas = document.getElementById("adminReportTrendChart");
    if (!canvas) return;

    var months = buildMonthBuckets(12);
    var byKey = {};
    months.forEach(function (m) {
      byKey[m.key] = m;
    });

    (items || []).forEach(function (it) {
      var b = it.booking || it || {};
      var mk = monthKeyFromIso(b.checkIn || b.check_in || b.submittedAt || b.submitted_at);
      if (!mk || !byKey[mk]) return;
      byKey[mk].bookings += 1;
      if (normalizeStatus(b.status) === "Confirmed") {
        byKey[mk].income += bookingConfirmedIncome(b);
      }
    });

    adminTrendChartMeta = {
      months: months,
      hoverKey: adminTrendChartMeta ? adminTrendChartMeta.hoverKey : null,
      layout: null,
      hit: []
    };
    paintAdminTrendChart();
    bindAdminTrendInteractions();
    renderTrendInsights(months);
  }

  function drawAdminStatusChart(items) {
    var canvas = document.getElementById("adminReportStatusChart");
    var legend = document.getElementById("adminReportStatusLegend");
    if (!canvas) return;

    var counts = { Confirmed: 0, Pending: 0, Cancelled: 0, Completed: 0 };
    (items || []).forEach(function (it) {
      var b = it.booking || it || {};
      var label = reportDisplayStatus(b);
      if (label === "Completed") counts.Completed += 1;
      else if (label === "Confirmed") counts.Confirmed += 1;
      else if (label === "Cancelled") counts.Cancelled += 1;
      else counts.Pending += 1;
    });

    var slices = [
      {
        key: "Confirmed",
        label: "Confirmed",
        value: counts.Confirmed,
        color: "#7fc142",
        colorDeep: "#5f9e2e"
      },
      {
        key: "Pending",
        label: "Pending",
        value: counts.Pending,
        color: "#e0b03a",
        colorDeep: "#c4921a"
      },
      {
        key: "Cancelled",
        label: "Cancelled",
        value: counts.Cancelled,
        color: "#c46b82",
        colorDeep: "#a84f68"
      },
      {
        key: "Completed",
        label: "Completed",
        value: counts.Completed,
        color: "#6b7c93",
        colorDeep: "#4f5f73"
      }
    ].filter(function (s) {
      return s.value > 0;
    });
    if (!slices.length) {
      slices = [
        {
          key: "Empty",
          label: "No bookings yet",
          value: 1,
          color: "#e8e4ea",
          colorDeep: "#d5d0d8",
          empty: true
        }
      ];
    }

    var total = slices.reduce(function (a, s) {
      return a + s.value;
    }, 0);

    var prep = prepareChartContext(canvas, 280, 220, 190);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var cx = w / 2;
    var cy = h / 2 + 2;
    var outerR = Math.min(w, h) * 0.4;
    var ringW = Math.max(22, outerR * 0.38);
    var midR = outerR - ringW / 2;
    var gap = slices.length > 1 && !slices[0].empty ? 0.055 : 0;
    var start = -Math.PI / 2;

    /* Soft radial halo */
    ctx.save();
    var halo = ctx.createRadialGradient(cx, cy, midR * 0.35, cx, cy, outerR + 10);
    halo.addColorStop(0, "rgba(127, 193, 66, 0.08)");
    halo.addColorStop(0.55, "rgba(196, 107, 130, 0.05)");
    halo.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 10, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.restore();

    /* Track ring */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, midR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61, 51, 64, 0.07)";
    ctx.lineWidth = ringW;
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.restore();

    slices.forEach(function (s) {
      var sweep = (s.value / total) * Math.PI * 2;
      var a0 = start + gap / 2;
      var a1 = start + sweep - gap / 2;
      if (a1 <= a0) a1 = a0 + 0.02;

      var grad = ctx.createLinearGradient(
        cx + Math.cos(a0) * midR,
        cy + Math.sin(a0) * midR,
        cx + Math.cos(a1) * midR,
        cy + Math.sin(a1) * midR
      );
      grad.addColorStop(0, s.color);
      grad.addColorStop(1, s.colorDeep || s.color);

      /* Soft outer glow for larger segments */
      if (!s.empty && sweep > 0.2) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, midR, a0, a1);
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = ringW + 6;
        ctx.lineCap = slices.length === 1 ? "butt" : "round";
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, midR, a0, a1);
      ctx.strokeStyle = grad;
      ctx.lineWidth = ringW;
      ctx.lineCap = slices.length === 1 ? "butt" : "round";
      ctx.stroke();
      ctx.restore();

      start += sweep;
    });

    /* Inner disc + center copy */
    var innerR = midR - ringW / 2 - 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61, 51, 64, 0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();

    var centerTotal = slices[0].empty ? "0" : total.toLocaleString();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = CHART_TEXT;
    ctx.font = "800 26px Poppins, 'Segoe UI', sans-serif";
    ctx.fillText(centerTotal, cx, cy - 8);
    ctx.font = "600 11px Poppins, 'Segoe UI', sans-serif";
    ctx.fillStyle = CHART_MUTED;
    ctx.fillText("bookings", cx, cy + 14);

    if (legend) {
      legend.innerHTML = "";
      slices.forEach(function (s) {
        if (s.empty) {
          legend.innerHTML =
            '<li class="admin-report-donut-legend__empty">No booking records yet.</li>';
          return;
        }
        var pct = total ? Math.round((s.value / total) * 100) : 0;
        var li = document.createElement("li");
        li.innerHTML =
          '<span class="admin-report-donut-legend__swatch" style="background:linear-gradient(145deg,' +
          s.color +
          "," +
          (s.colorDeep || s.color) +
          ')"></span><span class="admin-report-donut-legend__meta"><span class="admin-report-donut-legend__label">' +
          s.label +
          '</span><span class="admin-report-donut-legend__count">' +
          s.value.toLocaleString() +
          ' bookings</span></span><span class="admin-report-donut-legend__value">' +
          pct +
          "%</span>";
        legend.appendChild(li);
      });
    }
  }

  function drawAdminFacilityChart(items) {
    var canvas = document.getElementById("adminReportFacilityChart");
    if (!canvas) return;

    var order = ["Rooms", "Entrance", "Event halls", "Events", "Cottages", "Other"];
    var counts = {};
    order.forEach(function (k) {
      counts[k] = 0;
    });
    (items || []).forEach(function (it) {
      var cat = facilityCategoryForBooking(it.booking || it || {});
      if (!counts.hasOwnProperty(cat)) counts[cat] = 0;
      counts[cat] += 1;
    });
    var rows = order
      .filter(function (k) {
        return counts[k] > 0;
      })
      .map(function (k) {
        return { label: k, value: counts[k] };
      });
    if (!rows.length) {
      rows = [{ label: "No facility data", value: 0 }];
    }

    var prep = prepareChartContext(canvas, 640, 230, 190);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 112;
    var padR = 52;
    var padT = 18;
    var padB = 18;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(40, h - padT - padB);
    var maxVal = Math.max(
      1,
      rows.reduce(function (a, r) {
        return Math.max(a, r.value);
      }, 0)
    );
    var rowH = chartH / rows.length;
    var barH = Math.max(12, Math.min(30, rowH * 0.58));

    drawProChartPlotBg(ctx, padL, padT, chartW, chartH);
    drawProChartGrid(ctx, padL, padT, chartW, chartH, 4);

    rows.forEach(function (r, idx) {
      var y = padT + idx * rowH + (rowH - barH) / 2;
      var bw = (r.value / maxVal) * chartW;
      var drawW = Math.max(r.value > 0 ? 6 : 0, bw);
      var top = idx % 2 === 0 ? CHART_GREEN : CHART_PINK;
      var deep = idx % 2 === 0 ? CHART_GREEN_DEEP : CHART_PINK_DEEP;

      /* Track behind bar */
      ctx.fillStyle = "rgba(61, 51, 64, 0.045)";
      fillRoundBar(ctx, padL, y, chartW, barH, 7);

      if (drawW > 0) {
        ctx.fillStyle = makeHorizontalBarGradient(ctx, padL, y, drawW, barH, top, deep);
        fillRoundBar(ctx, padL, y, drawW, barH, 7);
      }

      ctx.fillStyle = CHART_TEXT;
      ctx.font = "600 12px Poppins, 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, padL - 12, y + barH / 2);

      ctx.textAlign = "left";
      ctx.fillStyle = CHART_MUTED;
      ctx.font = "700 12px Poppins, 'Segoe UI', sans-serif";
      ctx.fillText(String(r.value), padL + drawW + 10, y + barH / 2);
    });
  }

  function hideAdminRevenueTooltip() {
    var tip = document.getElementById("adminReportRevenueTip");
    if (tip) tip.hidden = true;
    if (adminRevenueChartMeta && adminRevenueChartMeta.hoverIndex != null) {
      adminRevenueChartMeta.hoverIndex = null;
      paintAdminRevenueChart();
    }
  }

  function showAdminRevenueTooltip(point, clientX, clientY) {
    var tip = document.getElementById("adminReportRevenueTip");
    var canvas = document.getElementById("adminReportRevenueChart");
    if (!tip || !canvas || !point) return;
    var wrap = canvas.parentElement;
    if (!wrap) return;
    tip.innerHTML =
      '<p class="admin-report-chart-tooltip__month">' +
      point.label +
      "</p>" +
      '<p class="admin-report-chart-tooltip__value">' +
      point.display +
      "</p>" +
      '<p class="admin-report-chart-tooltip__kind admin-report-chart-tooltip__kind--pink">Confirmed revenue</p>';
    tip.hidden = false;
    var rect = wrap.getBoundingClientRect();
    var left = clientX - rect.left;
    var tipW = tip.offsetWidth || 120;
    left = Math.max(tipW / 2 + 4, Math.min(rect.width - tipW / 2 - 4, left));
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, clientY - rect.top) + "px";
  }

  function nearestAdminRevenueBar(mx, my) {
    if (!adminRevenueChartMeta || !adminRevenueChartMeta.hit.length) return null;
    var best = null;
    adminRevenueChartMeta.hit.forEach(function (p) {
      if (!p.bar) return;
      var pad = 4;
      var inside =
        mx >= p.bar.x - pad &&
        mx <= p.bar.x + p.bar.w + pad &&
        my >= Math.min(p.bar.y, p.bar.y + p.bar.h) - 8 &&
        my <= Math.max(p.bar.y + p.bar.h, adminRevenueChartMeta.layout.baselineY) + 4;
      if (inside) best = p;
    });
    return best;
  }

  function bindAdminRevenueInteractions() {
    var canvas = document.getElementById("adminReportRevenueChart");
    if (!canvas || canvas.getAttribute("data-revenue-bound") === "1") return;
    canvas.setAttribute("data-revenue-bound", "1");
    canvas.addEventListener("mousemove", function (evt) {
      if (!adminRevenueChartMeta || !adminRevenueChartMeta.layout) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * adminRevenueChartMeta.layout.w;
      var my = ((evt.clientY - rect.top) / rect.height) * adminRevenueChartMeta.layout.h;
      var point = nearestAdminRevenueBar(mx, my);
      if (!point) {
        hideAdminRevenueTooltip();
        return;
      }
      if (adminRevenueChartMeta.hoverIndex !== point.index) {
        adminRevenueChartMeta.hoverIndex = point.index;
        paintAdminRevenueChart();
      }
      showAdminRevenueTooltip(point, evt.clientX, evt.clientY);
    });
    canvas.addEventListener("mouseleave", hideAdminRevenueTooltip);
  }

  function paintAdminRevenueChart() {
    var canvas = document.getElementById("adminReportRevenueChart");
    if (!canvas || !adminRevenueChartMeta || !adminRevenueChartMeta.months) return;
    var months = adminRevenueChartMeta.months;
    var hoverIndex = adminRevenueChartMeta.hoverIndex;
    var peakIndex = adminRevenueChartMeta.peakIndex;

    var prep = prepareChartContext(canvas, 640, 250, 200);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    var padL = 54;
    var padR = 16;
    var padT = 22;
    var padB = 38;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(40, h - padT - padB);
    var maxIncome = Math.max(
      1,
      months.reduce(function (a, m) {
        return Math.max(a, Number(m.income) || 0);
      }, 0)
    );
    var baselineY = padT + chartH;

    drawProChartPlotBg(ctx, padL, padT, chartW, chartH);
    drawProChartGrid(ctx, padL, padT, chartW, chartH, 4);
    drawProChartBaseline(ctx, padL, padT, chartW, chartH);

    /* Y-axis peso labels */
    ctx.save();
    ctx.fillStyle = CHART_MUTED;
    ctx.font = CHART_FONT_AXIS;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var g;
    for (g = 0; g <= 4; g++) {
      var val = maxIncome * (1 - g / 4);
      var y = padT + (chartH * g) / 4;
      ctx.fillText(formatChartAxisPeso(val), padL - 8, y);
    }
    ctx.restore();

    var gap = 8;
    var barW = Math.max(10, (chartW - gap * (months.length + 1)) / months.length);
    var hit = [];
    var labelStep = chartMonthLabelStep(w, months.length);

    months.forEach(function (m, idx) {
      var income = Number(m.income) || 0;
      var bh = (income / maxIncome) * (chartH - 10);
      var x = padL + gap + idx * (barW + gap);
      var y = baselineY - bh;
      var isPeak = idx === peakIndex && income > 0;
      var isHover = hoverIndex === idx;
      var dimmed = hoverIndex != null && !isHover;

      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.38;

      if (bh > 0) {
        var topC = isPeak || isHover ? "#d47a90" : CHART_PINK;
        var botC = isPeak || isHover ? CHART_PINK_DEEP : "#d9a0b0";
        ctx.fillStyle = makeVerticalBarGradient(ctx, x, y, barW, Math.max(bh, 3), topC, botC);
        fillRoundTopBar(ctx, x, y, barW, Math.max(bh, 3), Math.min(8, barW / 2));

        if (isHover || isPeak) {
          ctx.strokeStyle = "rgba(168, 79, 104, 0.35)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(196, 107, 130, 0.28)";
        fillRoundTopBar(ctx, x, baselineY - 3, barW, 3, 2);
      }
      ctx.restore();

      if (idx % labelStep === 0 || idx === months.length - 1 || isPeak || isHover) {
        ctx.save();
        ctx.fillStyle = isPeak || isHover ? CHART_TEXT : CHART_MUTED;
        ctx.font = (isPeak || isHover ? "700 " : "600 ") + "10px Poppins, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(formatChartMonthAxisLabel(m.label, w), x + barW / 2, baselineY + 10);
        ctx.restore();
      }

      /* Peak value callout */
      if (isPeak && bh > 28) {
        ctx.save();
        ctx.fillStyle = CHART_PINK_DEEP;
        ctx.font = "700 10px Poppins, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(formatChartAxisPeso(income), x + barW / 2, y - 6);
        ctx.restore();
      }

      hit.push({
        index: idx,
        label: m.label,
        display: formatTrendPeso(income),
        income: income,
        bar: { x: x, y: y, w: barW, h: Math.max(bh, 3) }
      });
    });

    adminRevenueChartMeta.layout = { w: w, h: h, baselineY: baselineY };
    adminRevenueChartMeta.hit = hit;
  }

  function drawAdminRevenueChart(items) {
    var canvas = document.getElementById("adminReportRevenueChart");
    if (!canvas) return;

    var months = buildMonthBuckets(12);
    var byKey = {};
    months.forEach(function (m) {
      byKey[m.key] = m;
    });
    (items || []).forEach(function (it) {
      var b = it.booking || it || {};
      if (normalizeStatus(b.status) !== "Confirmed") return;
      var mk = monthKeyFromIso(b.checkIn || b.check_in || b.submittedAt || b.submitted_at);
      if (!mk || !byKey[mk]) return;
      byKey[mk].income += bookingConfirmedIncome(b);
    });

    var total = months.reduce(function (a, m) {
      return a + (Number(m.income) || 0);
    }, 0);
    var peakIndex = 0;
    months.forEach(function (m, idx) {
      if ((Number(m.income) || 0) > (Number(months[peakIndex].income) || 0)) peakIndex = idx;
    });
    var peak = months[peakIndex];
    var sub = document.getElementById("adminReportRevenueSub");
    if (sub) {
      sub.textContent =
        total > 0
          ? "Confirmed earnings by month (last 12). Peak: " +
            peak.label +
            " · " +
            formatTrendPeso(peak.income) +
            "."
          : "Confirmed earnings by month (last 12 months).";
    }

    adminRevenueChartMeta = {
      months: months,
      peakIndex: total > 0 ? peakIndex : -1,
      hoverIndex: adminRevenueChartMeta ? adminRevenueChartMeta.hoverIndex : null,
      layout: null,
      hit: []
    };
    paintAdminRevenueChart();
    bindAdminRevenueInteractions();
  }

  function renderReportsGuestReviews() {
    function paintFromKpis(kpis) {
      if (!kpis) return;
      var total = Number(kpis.total) || 0;
      var setText = function (id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      var setWidth = function (id, width) {
        var el = document.getElementById(id);
        if (el) el.style.width = width;
      };

      setText(
        "adminReportReviewsAvg",
        total && kpis.average ? Number(kpis.average).toFixed(1) + "/5" : "—"
      );
      setText("adminReportReviewsPos", total ? kpis.recommend + "%" : "—");
      setText("adminReportReviewsTotal", String(total));

      setText("adminReportPctPos", (kpis.pctPos || 0) + "%");
      setText("adminReportPctNeg", (kpis.pctNeg || 0) + "%");
      setText("adminReportPctNeu", (kpis.pctNeu || 0) + "%");
      setWidth("adminReportBarPos", (kpis.pctPos || 0) + "%");
      setWidth("adminReportBarNeg", (kpis.pctNeg || 0) + "%");
      setWidth("adminReportBarNeu", (kpis.pctNeu || 0) + "%");

      var sub = document.getElementById("adminReportReviewsSub");
      if (sub) {
        sub.textContent = total
          ? "Same totals as the home page — " +
            total.toLocaleString() +
            " review" +
            (total === 1 ? "" : "s") +
            " on file."
          : "Same totals as the home page. Charts update when new reviews are saved.";
      }

      drawSentimentStackedChart(
        "adminReportReviewsChart",
        kpis.buckets || buildSentimentMonthBuckets(6),
        {
          skipExample: true,
          compact: true,
          hideLegend: true,
          hideTitle: true,
          tipId: "adminReportReviewsTip"
        }
      );
      if (
        window.ElenestGuestFeedback &&
        typeof window.ElenestGuestFeedback.mountRecentReviewNames === "function"
      ) {
        window.ElenestGuestFeedback.mountRecentReviewNames(
          document.getElementById("adminReportGuestReviewsCard")
        );
      }
    }

    // Instant paint from cache / live estimate — never block the UI.
    if (homeReviewKpisCache) {
      paintFromKpis(homeReviewKpisCache);
    } else {
      var liveAcc = createEmptyReviewKpiAccumulator();
      var live = getLiveReviewRecordsForKpis();
      var i;
      for (i = 0; i < live.length; i++) accumulateReviewRow(liveAcc, live[i]);
      paintFromKpis(finalizeReviewKpiAccumulator(liveAcc));
    }

    // One shared background load; reuses cache after first success.
    loadHomeReviewKpis(false).then(paintFromKpis);
  }

  function formatTrendPeso(n) {
    return "₱" + Math.round(Number(n) || 0).toLocaleString();
  }

  function formatTrendMonthList(labels) {
    if (!labels || !labels.length) return "";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels[0] + " and " + labels[1];
    return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
  }

  function formatTrendPctChange(from, to) {
    var a = Number(from) || 0;
    var b = Number(to) || 0;
    if (a === 0) return null;
    var pct = Math.round(((b - a) / Math.abs(a)) * 100);
    if (pct === 0) return null;
    return (pct > 0 ? "+" : "") + pct + "%";
  }

  function buildTrendInsights(months) {
    var empty = [
      "There are no guest bookings in the last 12 months yet. This summary will appear automatically once reservations are saved."
    ];
    if (!months || !months.length) return empty;

    var totalBookings = 0;
    var peakBook = months[0];
    months.forEach(function (m) {
      totalBookings += Number(m.bookings) || 0;
      if ((Number(m.bookings) || 0) > (Number(peakBook.bookings) || 0)) peakBook = m;
    });

    if (totalBookings <= 0) return empty;

    var insights = [];
    var last = months[months.length - 1];
    var prev = months.length > 1 ? months[months.length - 2] : null;
    var peakBookCount = Math.round(Number(peakBook.bookings) || 0);
    var lastBookCount = Math.round(Number(last.bookings) || 0);

    insights.push(
      "Busiest month: " +
        peakBook.label +
        " with " +
        peakBookCount +
        " reservation" +
        (peakBookCount === 1 ? "" : "s") +
        " — the highest count in the last 12 months."
    );

    if (prev) {
      var prevBooks = Number(prev.bookings) || 0;
      var lastBooks = Number(last.bookings) || 0;
      var bookDelta = lastBooks - prevBooks;
      var bookPct = formatTrendPctChange(prevBooks, lastBooks);
      var bookChangeNote = bookPct ? " (" + bookPct + ")" : "";

      if (bookDelta < 0) {
        insights.push(
          "Compared with " +
            prev.label +
            ", " +
            last.label +
            " slowed to " +
            lastBookCount +
            " reservation" +
            (lastBookCount === 1 ? "" : "s") +
            bookChangeNote +
            "."
        );
      } else if (bookDelta > 0) {
        insights.push(
          "Growing versus " +
            prev.label +
            ": " +
            last.label +
            " reached " +
            lastBookCount +
            " reservation" +
            (lastBookCount === 1 ? "" : "s") +
            bookChangeNote +
            "."
        );
      } else {
        insights.push(
          last.label +
            " stayed level with " +
            prev.label +
            " at " +
            lastBookCount +
            " reservation" +
            (lastBookCount === 1 ? "" : "s") +
            "."
        );
      }
    }

    var peakIdx = months.indexOf(peakBook);
    if (peakIdx >= 0 && peakIdx < months.length - 1) {
      var afterPeak = months[peakIdx + 1];
      if (
        (Number(peakBook.bookings) || 0) > 0 &&
        (Number(afterPeak.bookings) || 0) <= (Number(peakBook.bookings) || 0) * 0.6
      ) {
        insights.push(
          "Bookings dropped after " +
            peakBook.label +
            ". Check promotions and availability starting " +
            afterPeak.label +
            "."
        );
      }
    }

    if (
      (Number(peakBook.bookings) || 0) > 0 &&
      last.label !== peakBook.label &&
      (Number(last.bookings) || 0) <= (Number(peakBook.bookings) || 0) * 0.45
    ) {
      insights.push(
        last.label +
          " is still well below the peak month (" +
          peakBook.label +
          "). Packages or events can help lift demand."
      );
    }

    return insights.slice(0, 3);
  }

  function renderTrendInsights(months) {
    var list = document.getElementById("adminReportTrendInsightsList");
    if (!list) return;
    list.textContent = "";
    var items = buildTrendInsights(months);
    items.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function classifySentimentFromStars(stars) {
    var s = Number(stars || 0);
    if (s >= 4) return "pos";
    if (s === 3) return "neu";
    if (s > 0 && s <= 2) return "neg";
    return "neu";
  }

  function mondayOfWeekContaining(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = x.getDay();
    var offset = dow === 0 ? -6 : 1 - dow;
    x.setDate(x.getDate() + offset);
    return x;
  }

  function weekStartKeyFromDate(d) {
    var mon = mondayOfWeekContaining(d);
    return mon.getFullYear() + "-" + pad2(mon.getMonth() + 1) + "-" + pad2(mon.getDate());
  }

  function formatWeekRangeLabel(weekStartDate) {
    var start = new Date(weekStartDate.getTime());
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    var fmt = { month: "short", day: "numeric" };
    return (
      start.toLocaleDateString(undefined, fmt) +
      " – " +
      end.toLocaleDateString(undefined, fmt)
    );
  }

  function getCurrentWeekStartDate() {
    return mondayOfWeekContaining(new Date());
  }

  /** Guest comments for the current Mon–Sun week (non-archived). */
  function getFeedbackForWeeklyRecommendation(allList) {
    var list = allList || getSentimentFeedback();
    return {
      list: list.slice(),
      weekLabel: formatWeekRangeLabel(getCurrentWeekStartDate()),
      count: list.length
    };
  }

  function buildSentimentMonthBuckets(monthCount) {
    var now = new Date();
    var months = [];
    for (var i = monthCount - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var mk = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      months.push({
        key: mk,
        label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        pos: 0,
        neu: 0,
        neg: 0
      });
    }
    return months;
  }

  function buildSentimentWeekBuckets(weekCount) {
    var today = new Date();
    var mon = mondayOfWeekContaining(today);
    var buckets = [];
    for (var i = weekCount - 1; i >= 0; i--) {
      var d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
      d.setDate(d.getDate() - i * 7);
      var key = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      buckets.push({
        key: key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        pos: 0,
        neu: 0,
        neg: 0
      });
    }
    return buckets;
  }

  function bucketFeedbackByPeriod(feedbackList, buckets, periodFn) {
    var idx = {};
    buckets.forEach(function (b, i) { idx[b.key] = i; });
    feedbackList.forEach(function (f) {
      var raw = f.createdAt;
      if (!raw) return;
      var dt = new Date(raw);
      if (isNaN(dt.getTime())) return;
      var key = periodFn(dt);
      if (key == null || idx[key] == null) return;
      var cl = classifySentimentFromStars(f.stars);
      if (cl === "pos") buckets[idx[key]].pos++;
      else if (cl === "neg") buckets[idx[key]].neg++;
      else buckets[idx[key]].neu++;
    });
  }

  function filterFeedbackMatchingBuckets(feedbackList, buckets, periodFn) {
    var idx = {};
    buckets.forEach(function (b) {
      idx[b.key] = true;
    });
    return feedbackList.filter(function (f) {
      var raw = f.createdAt;
      if (!raw) return false;
      var dt = new Date(raw);
      if (isNaN(dt.getTime())) return false;
      var key = periodFn(dt);
      return key != null && idx[key];
    });
  }

  function buildSentimentDayBuckets(dayCount) {
    var today = new Date();
    var buckets = [];
    for (var i = dayCount - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var key = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      buckets.push({
        key: key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        pos: 0,
        neu: 0,
        neg: 0
      });
    }
    return buckets;
  }

  var currentSentimentPeriod = "month";
  var sentimentPeriodFiltersBound = false;

  function getSentimentPeriodConfig(period) {
    if (period === "week") {
      return {
        buildBuckets: function () {
          return buildSentimentWeekBuckets(8);
        },
        periodFn: function (dt) {
          return weekStartKeyFromDate(dt);
        },
        sub:
          "Live from Supabase guest reviews — last 8 weeks (weeks start Monday). Stacked area shows positive, negative, and neutral counts."
      };
    }
    if (period === "day") {
      return {
        buildBuckets: function () {
          return buildSentimentDayBuckets(14);
        },
        periodFn: function (dt) {
          return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
        },
        sub:
          "Live from Supabase guest reviews — last 14 days. Stacked area shows positive, negative, and neutral (3-star) responses."
      };
    }
    return {
      buildBuckets: function () {
        return buildSentimentMonthBuckets(6);
      },
      periodFn: function (dt) {
        return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1);
      },
      sub:
        "Live from Supabase guest reviews — last 6 months. Stacked area fills the timeline (no large empty bar gaps)."
    };
  }

  function getFeedbackForSentimentView() {
    var all = getFeedback();
    if (!all.length) return all;
    var cfg = getSentimentPeriodConfig(currentSentimentPeriod);
    var buckets = cfg.buildBuckets();
    return filterFeedbackMatchingBuckets(all, buckets, cfg.periodFn);
  }

  function fillExampleSentimentBuckets(buckets) {
    var samples = [
      { pos: 12, neu: 3, neg: 1 },
      { pos: 15, neu: 2, neg: 0 },
      { pos: 10, neu: 4, neg: 2 },
      { pos: 14, neu: 3, neg: 1 },
      { pos: 11, neu: 5, neg: 1 },
      { pos: 16, neu: 2, neg: 1 },
      { pos: 9, neu: 3, neg: 2 },
      { pos: 13, neu: 2, neg: 1 }
    ];
    buckets.forEach(function (b, i) {
      var s = samples[i % samples.length];
      b.pos = s.pos;
      b.neu = s.neu;
      b.neg = s.neg;
    });
  }

  var sentimentChartMetaById = {};

  function appendSmoothPath(ctx, pts, startWithMove) {
    if (!pts || !pts.length) return;
    if (startWithMove !== false) ctx.moveTo(pts[0].x, pts[0].y);
    else ctx.lineTo(pts[0].x, pts[0].y);
    if (pts.length === 1) return;
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y
      );
    }
  }

  function fillSmoothBand(ctx, lowerPts, upperPts, fillStyle) {
    if (!upperPts || upperPts.length < 2 || !lowerPts || lowerPts.length < 2) return;
    ctx.beginPath();
    appendSmoothPath(ctx, upperPts, true);
    appendSmoothPath(ctx, lowerPts.slice().reverse(), false);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function strokeSmoothEdge(ctx, pts, color, width) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    appendSmoothPath(ctx, pts, true);
    ctx.strokeStyle = color;
    ctx.lineWidth = width == null ? 2.2 : width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function hideSentimentChartTooltip(canvasId) {
    var meta = sentimentChartMetaById[canvasId];
    if (!meta) return;
    if (meta.tip) meta.tip.hidden = true;
    if (meta.hoverIndex != null) {
      meta.hoverIndex = null;
      paintSentimentStackedChart(canvasId);
    }
  }

  function showSentimentChartTooltip(canvasId, point, clientX, clientY) {
    var meta = sentimentChartMetaById[canvasId];
    if (!meta || !meta.tip || !meta.canvas || !point) return;
    var wrap = meta.canvas.parentElement;
    if (!wrap) return;
    meta.tip.innerHTML =
      '<p class="admin-report-chart-tooltip__month">' +
      point.label +
      "</p>" +
      '<p class="admin-report-chart-tooltip__value">' +
      point.total +
      " review" +
      (point.total === 1 ? "" : "s") +
      "</p>" +
      '<p class="admin-report-chart-tooltip__kind">' +
      point.pos +
      " pos · " +
      point.neu +
      " neu · " +
      point.neg +
      " neg</p>";
    meta.tip.hidden = false;
    var rect = wrap.getBoundingClientRect();
    var left = clientX - rect.left;
    var tipW = meta.tip.offsetWidth || 140;
    left = Math.max(tipW / 2 + 4, Math.min(rect.width - tipW / 2 - 4, left));
    meta.tip.style.left = left + "px";
    meta.tip.style.top = Math.max(8, clientY - rect.top) + "px";
  }

  function bindSentimentChartInteractions(canvasId) {
    var meta = sentimentChartMetaById[canvasId];
    if (!meta || !meta.canvas || meta.bound) return;
    meta.bound = true;
    var canvas = meta.canvas;
    canvas.addEventListener("mousemove", function (evt) {
      var m = sentimentChartMetaById[canvasId];
      if (!m || !m.layout || !m.hit.length) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ((evt.clientX - rect.left) / rect.width) * m.layout.w;
      var best = null;
      var bestDist = 36;
      m.hit.forEach(function (p) {
        var d = Math.abs(p.x - mx);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      });
      if (!best) {
        hideSentimentChartTooltip(canvasId);
        return;
      }
      if (m.hoverIndex !== best.index) {
        m.hoverIndex = best.index;
        paintSentimentStackedChart(canvasId);
      }
      showSentimentChartTooltip(canvasId, best, evt.clientX, evt.clientY);
    });
    canvas.addEventListener("mouseleave", function () {
      hideSentimentChartTooltip(canvasId);
    });
  }

  function paintSentimentStackedChart(canvasId) {
    var meta = sentimentChartMetaById[canvasId];
    if (!meta || !meta.buckets) return;
    drawSentimentStackedChart(canvasId, meta.buckets, meta.options || {});
  }

  function drawSentimentStackedChart(canvasId, buckets, options) {
    var opts = options || {};
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var compact = !!opts.compact;
    var prep = prepareChartContext(canvas, compact ? 640 : 720, compact ? 210 : 240, compact ? 180 : 200);
    if (!prep) return;
    var ctx = prep.ctx;
    var w = prep.w;
    var h = prep.h;

    var working = (buckets || []).map(function (b) {
      return {
        key: b.key,
        label: b.label,
        pos: Number(b.pos) || 0,
        neu: Number(b.neu) || 0,
        neg: Number(b.neg) || 0
      };
    });

    var hasAny = working.some(function (b) {
      return b.pos + b.neu + b.neg > 0;
    });
    var useExample = !hasAny && !opts.skipExample;
    if (useExample) {
      fillExampleSentimentBuckets(working);
      hasAny = true;
    }

    var prev = sentimentChartMetaById[canvasId] || {};
    var tip =
      prev.tip ||
      document.getElementById(opts.tipId || "") ||
      (canvas.parentElement && canvas.parentElement.querySelector(".admin-report-chart-tooltip"));

    sentimentChartMetaById[canvasId] = {
      canvas: canvas,
      buckets: working,
      options: opts,
      tip: tip,
      hoverIndex: prev.hoverIndex != null ? prev.hoverIndex : null,
      bound: prev.bound || false,
      layout: null,
      hit: []
    };

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    var cPos = "#5f9e2e";
    var cNeu = "#7b7480";
    var cNeg = "#c46b82";
    var textInk = "#3d3340";
    var textMute = "#8a8490";
    var fontLegend = "600 11px Poppins, 'Segoe UI', sans-serif";
    var fontAxis = "600 11px Poppins, 'Segoe UI', sans-serif";
    var fontMeta = "600 10px Poppins, 'Segoe UI', sans-serif";

    var hideLegend = !!opts.hideLegend;
    var hideTitle = !!opts.hideTitle || compact;
    var padL = 42;
    var padR = 16;
    var legendTop = hideLegend ? 4 : 10;
    var legendH = hideLegend ? 0 : 22;
    var metaH = hideTitle ? 0 : 14;
    var xLabelH = 28;
    var padTop = legendTop + legendH + metaH + (compact ? 8 : 10);
    var padBottom = xLabelH + 4;
    var chartW = Math.max(40, w - padL - padR);
    var chartH = Math.max(70, h - padTop - padBottom);
    var x0 = padL;
    var y0 = padTop;
    var yBase = y0 + chartH;
    var plotH = Math.max(40, chartH - 4);

    if (!hideLegend) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = fontLegend;
      var lx = x0;
      var ly = legendTop + legendH / 2;
      var legItem = function (color, label, xStart) {
        ctx.beginPath();
        ctx.fillStyle = color;
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(xStart, ly - 4, 10, 10, 2);
          ctx.fill();
        } else {
          ctx.fillRect(xStart, ly - 4, 10, 10);
        }
        ctx.fillStyle = textInk;
        ctx.fillText(label, xStart + 14, ly);
        return xStart + 14 + ctx.measureText(label).width + 14;
      };
      lx = legItem(cPos, "Positive (4–5★)", lx);
      lx = legItem(cNeu, "Neutral (3★)", lx);
      legItem(cNeg, "Negative (1–2★)", lx);
    }

    if (!hideTitle) {
      ctx.save();
      ctx.font = fontMeta;
      ctx.fillStyle = textMute;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("Guest reviews over time", w - padR, legendTop + legendH + metaH / 2);
      ctx.restore();
    }

    var n = Math.max(1, working.length);
    var maxT = Math.max(
      1,
      working.reduce(function (a, b) {
        return Math.max(a, b.pos + b.neu + b.neg);
      }, 0)
    );
    // Nice y-axis ceiling
    var niceMax = maxT;
    if (maxT > 4) {
      var step = Math.ceil(maxT / 4);
      var mag = Math.pow(10, Math.max(0, String(step).length - 1));
      step = Math.ceil(step / mag) * mag;
      niceMax = step * 4;
    }

    // Soft plot background
    ctx.fillStyle = "rgba(61, 51, 64, 0.02)";
    ctx.fillRect(x0, y0, chartW, chartH);

    drawProChartGrid(ctx, x0, y0, chartW, chartH, 4);

    ctx.save();
    ctx.font = fontAxis;
    ctx.fillStyle = textMute;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var yTicks = 4;
    var yt;
    for (yt = 0; yt <= yTicks; yt++) {
      var yTick = y0 + (chartH * yt) / yTicks;
      var v = Math.round(niceMax * (1 - yt / yTicks));
      ctx.fillText(String(v), x0 - 8, yTick);
    }
    ctx.restore();

    function stackAt(b, i) {
      var x = n === 1 ? x0 + chartW / 2 : x0 + (i * chartW) / (n - 1);
      var neg = b.neg;
      var neu = b.neu;
      var pos = b.pos;
      return {
        x: x,
        yNeg: yBase - (neg / niceMax) * plotH,
        yNeu: yBase - ((neg + neu) / niceMax) * plotH,
        yPos: yBase - ((neg + neu + pos) / niceMax) * plotH,
        yBase: yBase,
        total: pos + neu + neg,
        pos: pos,
        neu: neu,
        neg: neg,
        label: b.label,
        index: i
      };
    }

    var pts = working.map(stackAt);
    var basePts = pts.map(function (p) {
      return { x: p.x, y: p.yBase };
    });
    var negPts = pts.map(function (p) {
      return { x: p.x, y: p.yNeg };
    });
    var neuPts = pts.map(function (p) {
      return { x: p.x, y: p.yNeu };
    });
    var posPts = pts.map(function (p) {
      return { x: p.x, y: p.yPos };
    });

    // Smooth stacked areas (neg → neu → pos)
    var negGrad = ctx.createLinearGradient(0, y0, 0, yBase);
    negGrad.addColorStop(0, "rgba(196, 107, 130, 0.28)");
    negGrad.addColorStop(1, "rgba(196, 107, 130, 0.06)");
    var neuGrad = ctx.createLinearGradient(0, y0, 0, yBase);
    neuGrad.addColorStop(0, "rgba(123, 116, 128, 0.24)");
    neuGrad.addColorStop(1, "rgba(123, 116, 128, 0.05)");
    var posGrad = ctx.createLinearGradient(0, y0, 0, yBase);
    posGrad.addColorStop(0, "rgba(127, 193, 66, 0.32)");
    posGrad.addColorStop(1, "rgba(127, 193, 66, 0.06)");

    fillSmoothBand(ctx, basePts, negPts, negGrad);
    fillSmoothBand(ctx, negPts, neuPts, neuGrad);
    fillSmoothBand(ctx, neuPts, posPts, posGrad);

    strokeSmoothEdge(ctx, negPts, cNeg, 2);
    strokeSmoothEdge(ctx, neuPts, cNeu, 2);
    strokeSmoothEdge(ctx, posPts, cPos, 2.4);

    var hoverIndex = sentimentChartMetaById[canvasId].hoverIndex;
    pts.forEach(function (p, idx) {
      var active = hoverIndex === idx;
      var r = active ? 5.2 : 3.6;
      // Vertical guide on hover
      if (active) {
        ctx.save();
        ctx.strokeStyle = "rgba(61, 51, 64, 0.12)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x, y0);
        ctx.lineTo(p.x, yBase);
        ctx.stroke();
        ctx.restore();
      }
      [
        { y: p.yNeg, color: cNeg },
        { y: p.yNeu, color: cNeu },
        { y: p.yPos, color: cPos }
      ].forEach(function (dot) {
        ctx.beginPath();
        ctx.arc(p.x, dot.y, r + 1.1, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, dot.y, r, 0, Math.PI * 2);
        ctx.fillStyle = dot.color;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      });
    });

    drawProChartBaseline(ctx, x0, y0, chartW, chartH);

    ctx.font = fontAxis;
    ctx.fillStyle = textInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    working.forEach(function (b, i) {
      var x = pts[i].x;
      var label = String(b.label || "");
      if (n > 8 && label.length > 6) label = label.slice(0, 6);
      else if (label.length > 10) label = label.replace(/\s+/g, " ").slice(0, 10);
      ctx.fillStyle = hoverIndex === i ? cPos : textMute;
      ctx.font = hoverIndex === i ? "700 11px Poppins, 'Segoe UI', sans-serif" : fontAxis;
      ctx.fillText(label, x, yBase + 8);
    });

    if (!hasAny) {
      ctx.fillStyle = textMute;
      ctx.font = "600 12px Poppins, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No guest reviews in this period yet", x0 + chartW / 2, y0 + chartH / 2);
    }

    sentimentChartMetaById[canvasId].layout = { w: w, h: h };
    sentimentChartMetaById[canvasId].hit = pts.map(function (p) {
      return {
        x: p.x,
        y: p.yPos,
        index: p.index,
        label: p.label,
        total: p.total,
        pos: p.pos,
        neu: p.neu,
        neg: p.neg
      };
    });
    bindSentimentChartInteractions(canvasId);
  }

  function updateSentimentPeriodButtonsUI() {
    document.querySelectorAll("[data-sentiment-period]").forEach(function (btn) {
      var on = btn.getAttribute("data-sentiment-period") === currentSentimentPeriod;
      btn.classList.toggle("sentiment-period-btn--active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function initSentimentPeriodFilters() {
    if (sentimentPeriodFiltersBound) return;
    var wrap = document.getElementById("sentimentPeriodFilters");
    if (!wrap) return;
    sentimentPeriodFiltersBound = true;
    wrap.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-sentiment-period]") : null;
      if (!btn || !wrap.contains(btn)) return;
      var p = btn.getAttribute("data-sentiment-period");
      if (p !== "month" && p !== "week" && p !== "day") return;
      if (p === currentSentimentPeriod) return;
      currentSentimentPeriod = p;
      updateSentimentPeriodButtonsUI();
      renderSentimentOverview();
    });
  }

  function sentimentPeriodLabelForRec(period) {
    if (period === "week") return "weekly";
    if (period === "day") return "daily";
    return "monthly";
  }

  function sentimentBucketTotal(b) {
    return (b.pos || 0) + (b.neu || 0) + (b.neg || 0);
  }

  function sentimentNegShareForBucket(b) {
    var t = sentimentBucketTotal(b);
    if (!t) return null;
    return (b.neg || 0) / t;
  }

  function sentimentTrendFromBuckets(buckets) {
    if (!buckets || buckets.length < 2) return null;
    var first = sentimentNegShareForBucket(buckets[0]);
    var last = sentimentNegShareForBucket(buckets[buckets.length - 1]);
    if (first == null || last == null) return null;
    var d = last - first;
    if (Math.abs(d) < 0.08) return "steady";
    return d > 0 ? "pressure" : "recovery";
  }

  function renderSentimentRecommendations(payload) {
    lastSentimentRecPayload = payload;
    // Share latest Admin recommendations so the Manager portal can display the same items.
    try {
      localStorage.setItem(
        "elenest_admin_recommendations_payload",
        JSON.stringify({ savedAt: new Date().toISOString(), payload: payload || null })
      );
    } catch (e) {}
    var headlineEl = document.getElementById("sentimentRecHeadline");
    var summaryEl = document.getElementById("sentimentRecSummary");
    var listEl = document.getElementById("sentimentRecList");
    var footEl = document.getElementById("sentimentRecFootnote");
    var exNote = document.getElementById("sentimentRecExampleNote");
    if (!listEl) return;

    if (headlineEl) headlineEl.textContent = payload.headline || "Weekly recommendation";
    if (summaryEl) {
      summaryEl.textContent = payload.summary || "";
      if (!(payload.summary && String(payload.summary).trim())) {
        summaryEl.setAttribute("hidden", "");
      } else {
        summaryEl.removeAttribute("hidden");
      }
    }
    listEl.textContent = "";

    if (exNote) {
      exNote.setAttribute("hidden", "");
      exNote.textContent = "";
    }

    var weekKey = payload.weekStartKey || getCurrentSentimentWeekKey();

    (payload.items || []).forEach(function (item) {
      var li = document.createElement("li");
      var recId = item.recId || "weekly-recommendation";
      var isAcc = isSentimentRecAccepted(recId, weekKey);
      li.className =
        "admin-sentiment-rec-item admin-sentiment-rec-item--" +
        (item.tone || "neutral") +
        (isAcc ? " admin-sentiment-rec-item--accepted" : "");
      var icon = document.createElement("span");
      icon.className = "admin-sentiment-rec-icon";
      icon.setAttribute("aria-hidden", "true");
      var body = document.createElement("div");
      body.className = "admin-sentiment-rec-body";
      if (item.category) {
        var cat = document.createElement("span");
        cat.className = "admin-sentiment-rec-category";
        cat.textContent = item.category;
        body.appendChild(cat);
      }
      if (item.title) {
        var st = document.createElement("strong");
        st.className = "admin-sentiment-rec-item-title";
        st.textContent = item.title;
        body.appendChild(st);
      }
      var tx = document.createElement("p");
      tx.className = "admin-sentiment-rec-item-text";
      tx.textContent = item.text || "";
      body.appendChild(tx);

      var actions = document.createElement("div");
      actions.className = "admin-sentiment-rec-actions";
      var accBtn = document.createElement("button");
      accBtn.type = "button";
      accBtn.className = "btn btn--outline btn--small sentiment-rec-accept";
      accBtn.setAttribute("data-rec-id", recId);
      accBtn.setAttribute("data-rec-week", weekKey);
      accBtn.textContent = isAcc ? "Accepted" : "Accept recommendation";
      accBtn.setAttribute("aria-pressed", isAcc ? "true" : "false");
      if (isAcc) {
        accBtn.classList.add("sentiment-rec-accept--accepted");
        accBtn.disabled = true;
        accBtn.setAttribute("aria-disabled", "true");
      }
      actions.appendChild(accBtn);
      body.appendChild(actions);

      li.appendChild(icon);
      li.appendChild(body);
      listEl.appendChild(li);
    });

    if (footEl) footEl.textContent = payload.footnote || "";
  }

  function initSentimentRecAcceptHandlers() {
    var panel = document.getElementById("sentimentRecommendationsPanel");
    if (!panel || panel.dataset.acceptBound === "1") return;
    panel.dataset.acceptBound = "1";
    panel.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".sentiment-rec-accept") : null;
      if (!btn || !panel.contains(btn) || btn.disabled || btn.classList.contains("is-loading")) {
        return;
      }
      var id = btn.getAttribute("data-rec-id");
      if (!id) return;
      var weekKey = btn.getAttribute("data-rec-week");
      var BL = window.ElenestButtonLoading;
      if (BL && typeof BL.set === "function") {
        BL.set(btn, true, "Please wait…");
      } else {
        btn.disabled = true;
        btn.textContent = "Please wait…";
      }
      setTimeout(function () {
        addAcceptedSentimentRecId(id, weekKey);
        if (lastSentimentRecPayload) {
          renderSentimentRecommendations(lastSentimentRecPayload);
        }
      }, 320);
    });
  }

  function buildSentimentRecommendationsPayload(options) {
    var allListLen = options.allListLen || 0;
    var recCount = options.recCount || 0;
    var weekLabel = options.weekLabel || "";
    var weekStartKey =
      options.weekStartKey || weekStartKeyFromDate(getCurrentWeekStartDate());
    var allList = options.allList || [];
    var footnote =
      "Accept records your acknowledgment. At week end this recommendation moves to the Recommendation Archive with your acceptance recorded.";

    var weekBuckets = buildSentimentWeekBuckets(8);
    bucketFeedbackByPeriod(allList, weekBuckets, weekStartKeyFromDate);
    var trend = sentimentTrendFromBuckets(weekBuckets);

    if (!allListLen) {
      var exampleWeek = formatWeekRangeLabel(getCurrentWeekStartDate());
      return {
        exampleMode: true,
        weekStartKey: weekStartKey,
        headline: "Weekly recommendation",
        summary:
          "Week of " +
          exampleWeek +
          " · Sample insight from guest comments submitted this week.",
        items: getExampleImprovementItems(),
        footnote: footnote
      };
    }

    if (!recCount) {
      return {
        exampleMode: false,
        weekStartKey: weekStartKey,
        headline: "Weekly recommendation",
        summary:
          "Week of " +
          weekLabel +
          ". No guest comments have been submitted yet for this week.",
        items: [
          {
            tone: "watch",
            title: "Collect guest feedback",
            recId: "weekly-no-comments",
            text:
              "Encourage guests to submit reviews after checkout so this week's recommendation can reflect real comments from their stay."
          }
        ],
        footnote: footnote
      };
    }

    var feedbackForVoice = options.feedbackForRecommendation || [];
    var voiceItems = buildImprovementRecommendations(feedbackForVoice, {
      scopeLabel: options.archiveMode ? "that week" : "this week"
    });
    var headline = "Weekly recommendation";
    var summaryParts = [
      "Week of " +
        weekLabel +
        " · Based on " +
        recCount +
        " guest comment" +
        (recCount === 1 ? "" : "s") +
        (options.archiveMode ? " from that week." : " submitted this week.")
    ];

    if (recCount < 5) {
      summaryParts.push(
        "Only " +
          recCount +
          " comment" +
          (recCount === 1 ? "" : "s") +
          " this week—treat this weekly suggestion as directional until volume grows."
      );
    }
    if (trend === "pressure") {
      summaryParts.push(
        "Recent weekly chart trend shows more negative share—compare timing with staffing, events, or maintenance."
      );
    } else if (trend === "recovery") {
      summaryParts.push(
        "Recent weekly chart trend looks stronger—note what changed operationally and keep those practices."
      );
    }

    if (!voiceItems.length && recCount > 0) {
      voiceItems = [
        {
          recId: "imp-none-weekly",
          tone: "neutral",
          title: "This week",
          text:
            "All guest comments this week are moderate or higher—no area-specific improvement themes were detected."
        }
      ];
    }

    return {
      exampleMode: false,
      weekStartKey: weekStartKey,
      headline: headline,
      summary: summaryParts.join(" "),
      items: voiceItems.slice(0, 1),
      footnote: footnote
    };
  }

  function renderSentimentOverview() {
    var cfg = getSentimentPeriodConfig(currentSentimentPeriod);
    var buckets = cfg.buildBuckets();
    var subEl = document.getElementById("sentimentChartSub");
    if (subEl) subEl.textContent = cfg.sub;

    var barPos = document.getElementById("sentimentBarPos");
    var barNeu = document.getElementById("sentimentBarNeu");
    var barNeg = document.getElementById("sentimentBarNeg");
    var pctPos = document.getElementById("sentimentPctPos");
    var pctNeu = document.getElementById("sentimentPctNeu");
    var pctNeg = document.getElementById("sentimentPctNeg");
    var totalEl = document.getElementById("sentimentTotalCount");

    var allList = getFeedback();
    var sentimentList = getSentimentFeedback();
    var weeklyRec = getFeedbackForWeeklyRecommendation(sentimentList);

    if (!allList.length) {
      // Empty state: real zeros — never show sample/hardcoded sentiment percentages.
      if (barPos) barPos.style.width = "0%";
      if (barNeu) barNeu.style.width = "0%";
      if (barNeg) barNeg.style.width = "0%";
      if (pctPos) pctPos.textContent = "0%";
      if (pctNeu) pctNeu.textContent = "0%";
      if (pctNeg) pctNeg.textContent = "0%";
      if (totalEl) totalEl.textContent = "0 reviews on file";

      bucketFeedbackByPeriod([], buckets, cfg.periodFn);
      drawSentimentStackedChart("adminSentimentPeriodChart", buckets, {
        skipExample: true,
        hideTitle: true,
        tipId: "adminSentimentPeriodTip"
      });
      renderSentimentRecommendations(
        buildSentimentRecommendationsPayload({
          allListLen: 0,
          recCount: 0,
          allList: []
        })
      );
      updateSentimentPeriodButtonsUI();
      return;
    }

    bucketFeedbackByPeriod(allList, buckets, cfg.periodFn);
    var filtered = filterFeedbackMatchingBuckets(allList, buckets, cfg.periodFn);

    var pos = 0;
    var neu = 0;
    var neg = 0;
    sentimentList.forEach(function (f) {
      var cl = classifySentimentFromStars(f.stars);
      if (cl === "pos") pos++;
      else if (cl === "neg") neg++;
      else neu++;
    });
    var t = sentimentList.length;
    var tAll = allList.length;
    var pPos;
    var pNeu;
    var pNeg;
    var totalMsg;

    if (!t) {
      pPos = 0;
      pNeu = 0;
      pNeg = 0;
      if (tAll) {
        totalMsg =
          "Current week (Mon–Sun): no comments yet. " +
          tAll +
          " total review" +
          (tAll === 1 ? "" : "s") +
          " on file—older weeks are in the Comment Archive.";
      } else {
        totalMsg = "";
      }
    } else {
      var tSafe = t;
      pPos = Math.round((pos / tSafe) * 100);
      pNeu = Math.round((neu / tSafe) * 100);
      pNeg = Math.max(0, 100 - pPos - pNeu);
      totalMsg =
        "Current week scope: " +
        t +
        " comment" +
        (t === 1 ? "" : "s") +
        " (" +
        formatWeekRangeLabel(getCurrentWeekStartDate()) +
        ").";
    }

    if (barPos) barPos.style.width = pPos + "%";
    if (barNeu) barNeu.style.width = pNeu + "%";
    if (barNeg) barNeg.style.width = pNeg + "%";
    if (pctPos) pctPos.textContent = pPos + "%";
    if (pctNeu) pctNeu.textContent = pNeu + "%";
    if (pctNeg) pctNeg.textContent = pNeg + "%";
    if (totalEl) totalEl.textContent = totalMsg;

    drawSentimentStackedChart("adminSentimentPeriodChart", buckets, {
      skipExample: true,
      hideTitle: true,
      tipId: "adminSentimentPeriodTip"
    });

    renderSentimentRecommendations(
      buildSentimentRecommendationsPayload({
        allListLen: sentimentList.length || allList.length,
        recCount: weeklyRec.count,
        weekLabel: weeklyRec.weekLabel,
        feedbackForRecommendation: weeklyRec.list,
        allList: allList
      })
    );

    updateSentimentPeriodButtonsUI();
  }

  function paintSentimentSection() {
    ensureWeeklySentimentArchive().then(function () {
      renderSentimentFeedbackList();
      renderSentimentOverview();
      initSentimentPeriodFilters();
      initSentimentRecAcceptHandlers();
      initSentimentArchiveModals();
    });
  }

  function renderSentimentSection() {
    paintSentimentSection();
    var GF = window.ElenestGuestFeedback;
    // One background pull from Supabase; realtime events re-paint via elenest-feedback-updated.
    if (GF && typeof GF.refresh === "function" && !renderSentimentSection._pulling) {
      renderSentimentSection._pulling = true;
      GF.refresh().finally(function () {
        renderSentimentSection._pulling = false;
      });
    }
  }

  function renderSentimentCommentArchive() {
    var listEl = document.getElementById("sentimentCommentArchiveList");
    if (!listEl) return;
    listEl.textContent = "";

    var GF = window.ElenestGuestFeedback;
    var weeks =
      GF && typeof GF.listArchivedCommentsByWeek === "function"
        ? GF.listArchivedCommentsByWeek()
        : [];

    if (!weeks.length) {
      var empty = document.createElement("p");
      empty.className = "sentiment-archive-empty";
      empty.textContent = "No archived comments yet. Past weeks are moved here automatically each Monday.";
      listEl.appendChild(empty);
      return;
    }

    weeks.forEach(function (week) {
      var details = document.createElement("details");
      details.className = "sentiment-archive-week";

      var summary = document.createElement("summary");
      summary.className = "sentiment-archive-week-summary";
      summary.textContent =
        "Week of " +
        week.weekLabel +
        " · " +
        week.comments.length +
        " comment" +
        (week.comments.length === 1 ? "" : "s");
      details.appendChild(summary);

      var ul = document.createElement("ul");
      ul.className = "sentiment-archive-comment-list";

      week.comments.forEach(function (f) {
        var li = document.createElement("li");
        li.className = "sentiment-archive-comment";

        var head = document.createElement("div");
        head.className = "sentiment-archive-comment-head";

        var nameEl = document.createElement("strong");
        nameEl.textContent = feedbackGuestName(f);

        var starsEl = document.createElement("span");
        starsEl.className = "sentiment-archive-comment-stars";
        starsEl.textContent = starsText(f.stars);

        head.appendChild(nameEl);
        head.appendChild(starsEl);

        var quote = document.createElement("blockquote");
        quote.textContent = String(f.comment || "No comment provided.");

        li.appendChild(head);
        li.appendChild(quote);
        ul.appendChild(li);
      });

      details.appendChild(ul);
      listEl.appendChild(details);
    });
  }

  function renderSentimentRecommendationArchive() {
    var listEl = document.getElementById("sentimentRecommendationArchiveList");
    if (!listEl) return;
    listEl.textContent = "";

    var GF = window.ElenestGuestFeedback;
    var rows =
      GF && typeof GF.listRecommendationArchive === "function"
        ? GF.listRecommendationArchive()
        : [];

    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "sentiment-archive-empty";
      empty.textContent =
        "No archived recommendations yet. Each week's recommendation is saved here when the week ends.";
      listEl.appendChild(empty);
      return;
    }

    rows.forEach(function (row) {
      var payload = row.payload || {};
      var card = document.createElement("article");
      card.className = "sentiment-archive-rec-card";

      var title = document.createElement("h4");
      title.className = "sentiment-archive-rec-title";
      title.textContent =
        "Week of " + (row.weekLabel || row.weekStartKey || "—");

      if (payload.wasAccepted) {
        var weekBadge = document.createElement("span");
        weekBadge.className = "sentiment-archive-rec-accepted-badge";
        weekBadge.textContent = "Accepted";
        title.appendChild(document.createTextNode(" "));
        title.appendChild(weekBadge);
      }

      var meta = document.createElement("p");
      meta.className = "sentiment-archive-rec-meta";
      meta.textContent =
        (row.commentCount || 0) +
        " comment" +
        (row.commentCount === 1 ? "" : "s") +
        " · Archived " +
        new Date(row.archivedAt || Date.now()).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric"
        });

      var summary = document.createElement("p");
      summary.className = "sentiment-archive-rec-summary";
      summary.textContent = payload.summary || payload.headline || "Weekly recommendation";

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(summary);

      (payload.items || []).forEach(function (item) {
        var itemEl = document.createElement("div");
        itemEl.className = "sentiment-archive-rec-item";
        if (item.title) {
          var st = document.createElement("strong");
          st.textContent = item.title;
          itemEl.appendChild(st);
        }
        if (item.accepted) {
          var itemBadge = document.createElement("span");
          itemBadge.className = "sentiment-archive-rec-item-accepted";
          itemBadge.textContent = "Accepted";
          itemEl.appendChild(itemBadge);
        }
        var tx = document.createElement("p");
        tx.textContent = item.text || "";
        itemEl.appendChild(tx);
        card.appendChild(itemEl);
      });

      listEl.appendChild(card);
    });
  }

  function initSentimentArchiveModals() {
    var commentOverlay = document.getElementById("sentimentCommentArchiveOverlay");
    var recOverlay = document.getElementById("sentimentRecommendationArchiveOverlay");
    var commentOpen = document.getElementById("sentimentCommentArchiveOpen");
    var recOpen = document.getElementById("sentimentRecommendationArchiveOpen");
    var commentClose = document.getElementById("sentimentCommentArchiveClose");
    var recClose = document.getElementById("sentimentRecommendationArchiveClose");

    if (commentOpen && commentOverlay && !commentOpen.dataset.bound) {
      commentOpen.dataset.bound = "1";
      commentOpen.addEventListener("click", function () {
        renderSentimentCommentArchive();
        setHidden(commentOverlay, false);
      });
    }
    if (commentClose && commentOverlay && !commentClose.dataset.bound) {
      commentClose.dataset.bound = "1";
      commentClose.addEventListener("click", function () {
        setHidden(commentOverlay, true);
      });
    }
    if (commentOverlay && !commentOverlay.dataset.bound) {
      commentOverlay.dataset.bound = "1";
      commentOverlay.addEventListener("click", function (e) {
        if (e.target === commentOverlay) setHidden(commentOverlay, true);
      });
    }

    if (recOpen && recOverlay && !recOpen.dataset.bound) {
      recOpen.dataset.bound = "1";
      recOpen.addEventListener("click", function () {
        renderSentimentRecommendationArchive();
        setHidden(recOverlay, false);
      });
    }
    if (recClose && recOverlay && !recClose.dataset.bound) {
      recClose.dataset.bound = "1";
      recClose.addEventListener("click", function () {
        setHidden(recOverlay, true);
      });
    }
    if (recOverlay && !recOverlay.dataset.bound) {
      recOverlay.dataset.bound = "1";
      recOverlay.addEventListener("click", function (e) {
        if (e.target === recOverlay) setHidden(recOverlay, true);
      });
    }
  }

  function renderManagerUser() {
    var u = window.ElenestAuth && window.ElenestAuth.getCurrentUser ? window.ElenestAuth.getCurrentUser() : null;

    var managerNameEl = document.getElementById("adminManagerName");
    if (managerNameEl) managerNameEl.textContent = (u && u.name) || "—";

    var managerEmailEl = document.getElementById("adminManagerEmail");
    if (managerEmailEl) managerEmailEl.textContent = (u && u.email) || "—";
  }

  function renderUserAccounts(options) {
    var host = document.getElementById("adminUsersList");
    var pager = document.getElementById("adminUsersPagination");
    if (!host) return;
    options = options || {};

    function normalizeUserRole(role) {
      var r = String(role || "").trim().toLowerCase();
      if (!r) return "guest";
      if (r === "administrator") return "admin";
      if (r === "reception") return "receptionist";
      if (r === "customer" || r === "user") return "guest";
      return r;
    }

    function localStaffUsers() {
      return getUsers().filter(function (u) {
        var r = normalizeUserRole(u && u.role);
        return r === "admin" || r === "manager" || r === "receptionist";
      });
    }

    function passwordLookup() {
      var map = readStaffPasswordMap();
      getUsers().forEach(function (u) {
        var email = normalizeEmail(u && u.email);
        var password = u && u.password ? String(u.password) : "";
        if (email && password && !map[email]) map[email] = password;
      });
      return map;
    }

    function setUsersLoading(on) {
      var el = document.getElementById("adminUsersLoading");
      if (!el) return;
      if (!on) {
        el.hidden = true;
        el.classList.remove("admin-users-loading--overlay");
        el.removeAttribute("aria-busy");
        return;
      }
      var hasTable = !!(host && host.querySelector("table"));
      el.classList.toggle("admin-users-loading--overlay", hasTable);
      el.hidden = false;
      el.setAttribute("aria-busy", "true");
    }

    function renderMessage(text, isError) {
      setUsersLoading(false);
      host.textContent = "";
      if (pager) renderPaginationControls(pager, null);
      var msg = document.createElement("p");
      msg.style.margin = "0";
      msg.style.color = isError ? "#b91c1c" : "#6b7280";
      msg.textContent = text;
      host.appendChild(msg);
    }

    function renderRows(staffUsers) {
      staffAccountsCache = Array.isArray(staffUsers) ? staffUsers.slice() : [];
      host.textContent = "";
      if (!staffAccountsCache.length) {
        adminListPages.userAccounts = 1;
        renderMessage("No staff user accounts have been created yet.", false);
        return;
      }

      var AuthRef = window.ElenestAuth;
      var currentUser = AuthRef && AuthRef.getCurrentUser ? AuthRef.getCurrentUser() : null;
      var currentId = currentUser && currentUser.id ? String(currentUser.id) : "";
      var currentEmail = currentUser && currentUser.email ? normalizeEmail(currentUser.email) : "";
      var passwords = passwordLookup();
      var pageState = paginateItems(
        staffAccountsCache,
        adminListPages.userAccounts,
        ADMIN_PAGE_SIZE
      );
      adminListPages.userAccounts = pageState.page;

      var table = document.createElement("table");
      table.className = "admin-users-table";

      var thead = document.createElement("thead");
      var headRow = document.createElement("tr");
      ["Name", "Email", "Password", "Job / Position", "Actions"].forEach(function (lab) {
        var th = document.createElement("th");
        th.textContent = lab;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      var tbody = document.createElement("tbody");
      pageState.items.forEach(function (u) {
        var tr = document.createElement("tr");
        var roleNorm = normalizeUserRole(u && u.role);
        var userId = u && u.id ? String(u.id) : "";
        var userEmail = u && u.email ? normalizeEmail(u.email) : "";
        var savedPassword =
          (u && u.password ? String(u.password) : "") || passwords[userEmail] || "";

        var tdName = document.createElement("td");
        tdName.textContent = u.name || "—";
        tr.appendChild(tdName);

        var tdEmail = document.createElement("td");
        tdEmail.textContent = u.email || "—";
        tr.appendChild(tdEmail);

        var tdPassword = document.createElement("td");
        tdPassword.className = "admin-users-password";
        if (roleNorm === "manager" || roleNorm === "receptionist") {
          tdPassword.textContent = savedPassword || "—";
        } else {
          tdPassword.textContent = "—";
        }
        tr.appendChild(tdPassword);

        var tdRole = document.createElement("td");
        tdRole.textContent = labelRole(u.role);
        tr.appendChild(tdRole);

        var tdActions = document.createElement("td");
        var canDelete =
          (roleNorm === "manager" || roleNorm === "receptionist") &&
          userId &&
          userId !== currentId &&
          userEmail !== currentEmail;

        if (canDelete) {
          var delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "btn btn--danger btn--small";
          delBtn.textContent = "Delete";
          delBtn.addEventListener("click", function () {
            swalConfirm({
              icon: "warning",
              title: "Delete user account?",
              text: "Are you sure you want to delete this user account?",
              confirmText: "Delete",
              cancelText: "Cancel",
              confirmColor: "#dc2626"
            }).then(function (ok) {
              if (!ok) return;

              var BL = window.ElenestButtonLoading;
              var work = function () {
                if (AuthRef && typeof AuthRef.deleteStaffAccount === "function") {
                  return AuthRef.deleteStaffAccount({
                    id: userId,
                    email: userEmail,
                    role: roleNorm
                  }).then(function (result) {
                    if (!result || !result.ok) {
                      return {
                        ok: false,
                        message: (result && result.message) || "Could not delete staff account."
                      };
                    }
                    staffAccountsCache = null;
                    renderUserAccounts();
                    return { ok: true };
                  });
                }

                var users = getUsers().filter(function (row) {
                  return normalizeEmail(row && row.email) !== userEmail;
                });
                saveUsers(users);
                staffAccountsCache = null;
                renderUserAccounts();
                return Promise.resolve({ ok: true });
              };

              function afterDelete(result) {
                if (!result || !result.ok) {
                  swalAlert({
                    icon: "error",
                    title: "Could not delete account",
                    text: (result && result.message) || "Could not delete staff account."
                  });
                  return;
                }
                swalAlert({
                  icon: "success",
                  title: "Account deleted",
                  text: "The user account was deleted."
                });
              }

              var run = BL ? BL.run(delBtn, work) : Promise.resolve(work());
              return Promise.resolve(run).then(afterDelete).catch(function (err) {
                swalAlert({
                  icon: "error",
                  title: "Could not delete account",
                  text: (err && err.message) || "Could not delete staff account."
                });
              });
            });
          });
          tdActions.appendChild(delBtn);
        } else {
          tdActions.textContent = "—";
        }
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      host.appendChild(table);
      setUsersLoading(false);
      renderPaginationControls(pager, pageState, function (page) {
        adminListPages.userAccounts = page;
        renderUserAccounts({ fromCache: true });
      });
    }

    if (options.fromCache && staffAccountsCache) {
      renderRows(staffAccountsCache);
      return;
    }

    if (staffAccountsCache && staffAccountsCache.length) {
      renderRows(staffAccountsCache);
    }

    setUsersLoading(true);

    var Auth = window.ElenestAuth;
    if (Auth && typeof Auth.listStaffProfiles === "function") {
      var loadChain = Auth.ready ? Auth.ready : Promise.resolve();
      loadChain
        .then(function () {
          return Auth.listStaffProfiles();
        })
        .then(function (result) {
          var fallback = localStaffUsers();
          if (!result || !result.ok) {
            if (fallback.length) {
              renderRows(fallback);
              return;
            }
            renderMessage(
              (result && result.message) || "Could not load staff accounts. Refresh and try again.",
              true
            );
            return;
          }
          var staffUsers = (result.users || []).filter(function (u) {
            var r = normalizeUserRole(u && u.role);
            return r === "admin" || r === "manager" || r === "receptionist";
          });
          if (!staffUsers.length && fallback.length) {
            renderRows(fallback);
            return;
          }
          renderRows(staffUsers);
        })
        .catch(function (err) {
          var fallback = localStaffUsers();
          if (fallback.length) {
            renderRows(fallback);
            return;
          }
          renderMessage(
            (err && err.message) || "Could not load staff accounts. Refresh and try again.",
            true
          );
        });
      return;
    }

    renderRows(localStaffUsers());
  }

  function initSentimentPopup() {
    var overlay = document.getElementById("adminSentimentOverlay");
    var titleEl = document.getElementById("adminSentimentTitle");
    var listEl = document.getElementById("adminSentimentList");
    var closeBtn = document.getElementById("adminSentimentCloseBtn");
    var exampleBanner = document.getElementById("adminSentimentExampleBanner");
    if (!overlay || !titleEl || !listEl || !closeBtn) return;

    function getDetailsFeedbackSource() {
      var all = getFeedback();
      if (all.length) {
        return { list: getSentimentFeedback(), exampleMode: false };
      }
      return { list: getAdminExampleFeedback(), exampleMode: true };
    }

    function openSentiment(type) {
      var key = type === "positive" || type === "neutral" || type === "negative" ? type : "positive";
      var src = getDetailsFeedbackSource();
      var source = src.list;
      var exampleMode = src.exampleMode;

      var rows = source.filter(function (f) {
        var s = Number(f.stars || 0);
        if (key === "positive") return s >= 4;
        if (key === "neutral") return s === 3;
        return s > 0 && s <= 2;
      });

      if (exampleBanner) {
        exampleBanner.setAttribute("hidden", "");
        exampleBanner.textContent = "";
      }

      listEl.textContent = "";

      if (!rows.length) {
        var empty = document.createElement("li");
        empty.className = "sentiment-detail-empty";
        if (exampleMode) {
          empty.textContent = "No guest feedback matched this category.";
        } else if (!getFeedback().length) {
          empty.textContent = "No guest feedback has been recorded.";
        } else if (!source.length) {
          empty.textContent =
            "No guest comments for the current week yet. Open the Comment Archive to view previous weeks.";
        } else {
          empty.textContent = "No responses in this category for the current week.";
        }
        listEl.appendChild(empty);
      } else {
        rows.forEach(function (f) {
          var li = document.createElement("li");
          li.className = "sentiment-detail-row";

          var head = document.createElement("div");
          head.className = "sentiment-detail-head";

          var nameEl = document.createElement("strong");
          nameEl.className = "sentiment-detail-name";
          nameEl.textContent = feedbackGuestName(f);

          var starsWrap = document.createElement("span");
          starsWrap.className = "sentiment-detail-stars";
          starsWrap.textContent = starsText(f.stars);

          head.appendChild(nameEl);
          head.appendChild(starsWrap);

          var quote = document.createElement("blockquote");
          quote.className = "sentiment-detail-quote";
          quote.textContent = String(f.comment || "No comment provided.");

          li.appendChild(head);
          li.appendChild(quote);
          listEl.appendChild(li);
        });
      }

      var title;
      if (key === "positive") title = "Positive — guest comments (4–5 stars)";
      else if (key === "neutral") title = "Neutral — guest comments (3 stars)";
      else title = "Negative — guest comments (1–2 stars)";
      titleEl.textContent = title;

      setHidden(overlay, false);
    }

    function closeSentiment() {
      setHidden(overlay, true);
    }

    closeBtn.addEventListener("click", function () {
      closeSentiment();
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSentiment();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hasAttribute("hidden")) {
        closeSentiment();
      }
    });

    // Bind after DOM is ready; callers should invoke this once from init().
    var buttons = document.querySelectorAll(".sentiment-view-btn");
    if (buttons && buttons.length) {
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var type = btn.getAttribute("data-sentiment") || "";
          openSentiment(type.toLowerCase());
        });
      });
    }
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function updateUserPassword(email, currentPassword, newPassword) {
    var users = getUsers();
    var targetEmail = normalizeEmail(email);
    var idx = -1;

    for (var i = 0; i < users.length; i++) {
      if (normalizeEmail(users[i].email) === targetEmail && users[i].password === currentPassword) {
        idx = i;
        break;
      }
    }

    if (idx === -1) return { ok: false, message: "Current password is incorrect." };

    users[idx].password = newPassword;
    saveUsers(users);
    return { ok: true };
  }

  function init() {
    var Auth = window.ElenestAuth;
    if (!Auth) return;

    function boot(user) {
      if (!Auth.assertPageAccess) {
        if (!user) {
          window.location.replace("login.html");
          return;
        }
        if ((Auth.normalizeRole ? Auth.normalizeRole(user.role) : "") !== "admin") {
          var otherHome = Auth.getHomePathForRole(user.role);
          if (/book\.html/i.test(String(otherHome))) otherHome = "login.html";
          window.location.replace(otherHome);
          return;
        }
        initDashboard(user);
        return;
      }
      Auth.assertPageAccess("admin").then(function (result) {
        if (!result || !result.ok) {
          var dest = (result && result.redirect) || "login.html";
          if (/book\.html/i.test(String(dest))) dest = "login.html";
          window.location.replace(dest);
          return;
        }
        initDashboard(result.user);
      });
    }

    if (Auth.ready) {
      Auth.ready.then(boot);
      return;
    }
    boot(Auth.getCurrentUser ? Auth.getCurrentUser() : null);
  }

  function initDashboard(sessionUser) {
    var Auth = window.ElenestAuth;
    var settingsToggle = document.getElementById("adminSettingsToggle");
    var settingsMenu = document.getElementById("adminSettingsMenu");
    var menuProfileBtn = document.getElementById("adminMenuProfile");
    var menuChangePasswordBtn = document.getElementById("adminMenuChangePassword");
    var menuLogoutBtn = document.getElementById("adminMenuLogout");

    if (settingsToggle) setHidden(settingsToggle, false);
    if (settingsMenu) setHidden(settingsMenu, true);

    var u = sessionUser;
    var name = (u && u.name) ? u.name : "";
    if (Auth && typeof Auth.applyStaffHeaderRole === "function") {
      Auth.applyStaffHeaderRole(u);
    }

    // Gate: user administration requires re-entering the admin password each time.
    var gateOverlay = document.getElementById("adminManageUsersGateOverlay");
    var gateForm = document.getElementById("adminManageUsersGateForm");
    var gatePasswordInput = document.getElementById("adminManageUsersGatePassword");
    var gateCancelBtn = document.getElementById("adminManageUsersGateCancel");
    var gateMsg = document.getElementById("adminManageUsersGateMsg");
    var pendingGateTargetSectionId = null;
    var manageUsersGateBypassCount = 0;

    function setGateMsg(ok, text) {
      if (!gateMsg) return;
      gateMsg.hidden = false;
      gateMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      gateMsg.textContent = text;
    }

    function resetGateForm() {
      if (gatePasswordInput) gatePasswordInput.value = "";
      if (gateMsg) {
        gateMsg.hidden = true;
        gateMsg.textContent = "";
        gateMsg.className = "auth-msg";
      }
    }

    function closeGate(cancelled) {
      if (!gateOverlay) return;
      setHidden(gateOverlay, true);
      if (cancelled) {
        try {
          if (String(window.location.hash || "") === "#section-manager-user") {
            window.location.hash = "#section-dashboard";
          }
        } catch (err) {}
      }
      pendingGateTargetSectionId = null;
    }

    function verifyAdminPassword(plainPassword) {
      if (Auth && typeof Auth.verifyCurrentPassword === "function") {
        return Auth.verifyCurrentPassword(plainPassword).then(function (result) {
          return !!(result && result.ok);
        });
      }
      if (!u || !u.email) return Promise.resolve(false);
      var users = getUsers();
      var email = normalizeEmail(u.email);
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i].email) === email && String(users[i].password || "") === String(plainPassword || "")) {
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    }

    function openGate(targetSectionId) {
      if (!gateOverlay) return;
      pendingGateTargetSectionId = String(targetSectionId || "section-manager-user");
      resetGateForm();
      setHidden(gateOverlay, false);
      if (gatePasswordInput) gatePasswordInput.focus();
    }

    if (gateCancelBtn) gateCancelBtn.addEventListener("click", function () { closeGate(true); });
    if (gateOverlay) {
      gateOverlay.addEventListener("click", function (e) {
        if (e.target === gateOverlay) closeGate(true);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && gateOverlay && !gateOverlay.hasAttribute("hidden")) {
        closeGate(true);
      }
    });
    if (gateForm) {
      gateForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var pass = gatePasswordInput ? String(gatePasswordInput.value || "") : "";
        if (!pass) {
          setGateMsg(false, "Please enter your password.");
          return;
        }
        var gateSubmitBtn = gateForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(gateSubmitBtn, true);
        else if (gateSubmitBtn) gateSubmitBtn.disabled = true;
        verifyAdminPassword(pass).then(function (valid) {
          if (BL) BL.set(gateSubmitBtn, false);
          else if (gateSubmitBtn) gateSubmitBtn.disabled = false;
          if (!valid) {
            setGateMsg(false, "Incorrect password. Please try again.");
            return;
          }
          var targetSectionId = pendingGateTargetSectionId || "section-manager-user";
          manageUsersGateBypassCount = 2;
          closeGate();
          try { window.location.hash = "#" + targetSectionId; } catch (err) {}
          showSection(targetSectionId);
        }).catch(function () {
          if (BL) BL.set(gateSubmitBtn, false);
          else if (gateSubmitBtn) gateSubmitBtn.disabled = false;
          setGateMsg(false, "Could not verify your password. Please try again.");
        });
      });
    }

    // Admin section navigation — register early so header/content stay clickable.
    var sectionIds = [
      "section-dashboard",
      "section-reports",
      "section-payments",
      "section-calendar-access",
      "section-activity-logs",
      "section-sentiment",
      "section-predictive",
      "section-manager-user"
    ];

    var isSectionIdValid = function (id) {
      return sectionIds.indexOf(id) !== -1;
    };

    function paymentsTabFromHash(h) {
      var raw = String(h || "");
      if (/section-bookings/i.test(raw) || /(?:\?|&)tab=bookings/i.test(raw)) return "bookings";
      if (/(?:\?|&)tab=settings/i.test(raw)) return "settings";
      return "";
    }

    function getSectionIdFromHash(h) {
      var id = String(h || "");
      if (id.charAt(0) === "#") id = id.slice(1);
      var q = id.indexOf("?");
      if (q >= 0) id = id.slice(0, q);
      var amp = id.indexOf("&");
      if (amp >= 0) id = id.slice(0, amp);
      // Backwards compatibility: old links used to point to #section-analytics.
      if (id === "section-analytics") return "section-reports";
      if (id === "section-bookings") return "section-payments";
      if (isSectionIdValid(id)) return id;
      return "section-dashboard";
    }

    function getBookingIdFromHash(h) {
      var raw = String(h || "");
      if (raw.charAt(0) === "#") raw = raw.slice(1);
      var match = raw.match(/(?:[?&]|^)booking=([^&]+)/i);
      if (!match) return "";
      try {
        return decodeURIComponent(match[1]);
      } catch (e) {
        return match[1];
      }
    }

    function openBookingFromHashIfPresent() {
      var bookingId = getBookingIdFromHash(window.location.hash);
      if (!bookingId) return;
      openAdminBookingById(bookingId);
    }

    var currentSectionId = null;
    var refreshActiveTimer = null;
    var predictiveScriptPromise = null;

    function ensurePredictiveAnalytics() {
      if (window.ElenestPredictiveAnalytics) {
        return Promise.resolve(window.ElenestPredictiveAnalytics);
      }
      if (predictiveScriptPromise) return predictiveScriptPromise;
      predictiveScriptPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "../js/predictive-analytics.js?v=20260922-ux1";
        s.async = true;
        s.onload = function () {
          resolve(window.ElenestPredictiveAnalytics || null);
        };
        s.onerror = function () {
          predictiveScriptPromise = null;
          reject(new Error("Failed to load predictive analytics"));
        };
        document.body.appendChild(s);
      });
      return predictiveScriptPromise;
    }

    function showPredictiveLoadError(message) {
      var bar = document.getElementById("paStatusBar");
      var msg = document.getElementById("paStatusMsg");
      var retry = document.getElementById("paStatusRetry");
      if (!bar || !msg) return;
      bar.hidden = false;
      bar.classList.add("is-error");
      bar.classList.remove("is-loading");
      msg.textContent =
        (message || "Could not load predictive analytics.") + " Tap Retry to try again.";
      if (retry) {
        retry.hidden = false;
        if (retry.getAttribute("data-bound") !== "1") {
          retry.setAttribute("data-bound", "1");
          retry.addEventListener("click", function () {
            bar.classList.remove("is-error");
            bar.classList.add("is-loading");
            msg.textContent = "Loading predictive analytics...";
            retry.hidden = true;
            ensurePredictiveAnalytics()
              .then(function (PA) {
                if (currentSectionId !== "section-predictive") return;
                if (PA && typeof PA.renderSection === "function") return PA.renderSection();
                throw new Error("Predictive analytics module is unavailable.");
              })
              .catch(function (err) {
                showPredictiveLoadError(
                  (err && err.message) || "Could not load predictive analytics."
                );
              });
          });
        }
      }
    }

    function refreshActiveSectionNow() {
      if (currentSectionId === "section-dashboard") {
        renderDashboard();
        renderAdminCalendar();
        refreshAdminReservationModalIfOpen();
      } else if (currentSectionId === "section-reports") {
        renderReports();
        renderAnalytics();
      } else if (currentSectionId === "section-payments") {
        renderPaymentsSection();
      } else if (currentSectionId === "section-calendar-access") {
        if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.renderOwnerSection) {
          window.ElenestCalendarAccess.renderOwnerSection();
        }
      } else if (currentSectionId === "section-activity-logs") {
        if (window.ElenestActivityLogs && window.ElenestActivityLogs.renderAdminSection) {
          window.ElenestActivityLogs.renderAdminSection();
        }
      } else if (currentSectionId === "section-sentiment") {
        paintSentimentSection();
      } else if (currentSectionId === "section-predictive") {
        var PA = window.ElenestPredictiveAnalytics;
        if (PA && typeof PA.refresh === "function") {
          PA.refresh({ persist: false, preferLocal: true, skipIfLoading: true });
        } else if (PA && typeof PA.renderSection === "function") {
          PA.renderSection();
        }
      } else if (currentSectionId === "section-manager-user") {
        renderManagerUser();
        renderUserAccounts();
      }
    }

    var lastAdminLiveSignature = "";
    function adminLiveSignature() {
      var items = [];
      try {
        items = listBookings() || [];
      } catch (e) {
        return "";
      }
      var parts = [];
      var i;
      for (i = 0; i < items.length; i++) {
        var b = items[i] && items[i].booking;
        if (!b || !b.id) continue;
        parts.push(
          [
            b.id,
            b.status,
            b.paymentStatus,
            b.workflow,
            b.verificationStage,
            b.arrivalStatus,
            b.checkIn,
            b.checkOut,
            b.fullName,
            b.totalEstimate,
            b.hasPaymentProof ? 1 : 0,
            b.paymentDeadlineAt || "",
            b.holdExpiresAt || ""
          ].join("~")
        );
      }
      return String(items.length) + "|" + parts.join(";");
    }

    function refreshActiveSection() {
      if (refreshActiveTimer) clearTimeout(refreshActiveTimer);
      refreshActiveTimer = setTimeout(function () {
        refreshActiveTimer = null;
        refreshActiveSectionNow();
      }, 1600);
    }

    function showSection(sectionId) {
      sectionId = getSectionIdFromHash(sectionId);
      if (sectionId === "section-manager-user") {
        if (manageUsersGateBypassCount > 0) {
          manageUsersGateBypassCount--;
        } else {
          openGate("section-manager-user");
          return;
        }
      }
      if (currentSectionId === sectionId) {
        if (sectionId === "section-dashboard") openBookingFromHashIfPresent();
        if (sectionId === "section-payments") {
          var sameTab = paymentsTabFromHash(window.location.hash);
          if (sameTab) setPaymentsTab(sameTab);
          else if (!bookingIdFromLocationHash()) setPaymentsTab("bookings");
          pendingPaymentFocusId = bookingIdFromLocationHash();
          applyPaymentFocus();
        }
        return;
      }
      currentSectionId = sectionId;

      // Switching away from Settings should remove its underline state.
      closeMenu();
      closeAdminNavDropdowns();
      if (settingsToggle) settingsToggle.classList.remove("active");

      sectionIds.forEach(function (sid) {
        var el = document.getElementById(sid);
        // If an element isn't present, ignore it.
        if (!el) return;
        setHidden(el, sid !== sectionId);
      });

      // Update green underline on the active nav item.
      setActiveSectionNav(sectionId);

      if (sectionId === "section-dashboard") {
        renderDashboard();
        renderAdminCalendar();
        openBookingFromHashIfPresent();
      } else if (sectionId === "section-reports") {
        renderReports();
        renderAnalytics();
      } else if (sectionId === "section-payments") {
        var openTab = paymentsTabFromHash(window.location.hash);
        if (openTab) setPaymentsTab(openTab);
        else if (!bookingIdFromLocationHash()) setPaymentsTab("bookings");
        pendingPaymentFocusId = bookingIdFromLocationHash();
        syncPaymentsSection();
      } else if (sectionId === "section-calendar-access") {
        if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.refresh) {
          window.ElenestCalendarAccess.refresh();
        } else if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.renderOwnerSection) {
          window.ElenestCalendarAccess.renderOwnerSection();
        }
      } else if (sectionId === "section-activity-logs") {
        if (window.ElenestActivityLogs && window.ElenestActivityLogs.refreshAdminSection) {
          window.ElenestActivityLogs.refreshAdminSection();
        } else if (window.ElenestActivityLogs && window.ElenestActivityLogs.renderAdminSection) {
          window.ElenestActivityLogs.renderAdminSection();
        }
      } else if (sectionId === "section-sentiment") {
        renderSentimentSection();
      } else if (sectionId === "section-predictive") {
        var statusBar = document.getElementById("paStatusBar");
        var statusMsg = document.getElementById("paStatusMsg");
        if (statusBar && statusMsg) {
          statusBar.hidden = false;
          statusBar.classList.add("is-loading");
          statusBar.classList.remove("is-error");
          statusMsg.textContent = "Loading predictive analytics...";
          var retryEarly = document.getElementById("paStatusRetry");
          if (retryEarly) retryEarly.hidden = true;
        }
        ensurePredictiveAnalytics()
          .then(function (PA) {
            if (currentSectionId !== "section-predictive") return;
            if (PA && typeof PA.renderSection === "function") return PA.renderSection();
            throw new Error("Predictive analytics module is unavailable.");
          })
          .catch(function (err) {
            showPredictiveLoadError(
              (err && err.message) || "Could not load predictive analytics."
            );
          });
      } else if (sectionId === "section-manager-user") {
        renderManagerUser();
        renderUserAccounts();
      }

      var target = document.getElementById(sectionId);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    // KPI cards -> jump to the requested admin section.
    function goToReports() {
      try {
        window.location.hash = "#section-reports";
      } catch (err) {}
      showSection("section-reports");
    }

    function goToSentiments() {
      try {
        window.location.hash = "#section-sentiment";
      } catch (err) {}
      showSection("section-sentiment");
    }

    function bindKpiCard(cardId, goFn) {
      var el = document.getElementById(cardId);
      if (!el) return;
      var handler = goFn || goToReports;
      el.addEventListener("click", handler);
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      });
    }

    bindKpiCard("adminKpiCardPending");
    bindKpiCard("adminKpiCardConfirmed");
    bindKpiCard("adminKpiCardCancelled");
    bindKpiCard("adminKpiCardTotalReviews", goToSentiments);

    initAdminReservationModal();

    // Calendar controls (dashboard only)
    var prevBtn = document.getElementById("adminCalPrev");
    var nextBtn = document.getElementById("adminCalNext");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        adminCalView.m--;
        if (adminCalView.m < 0) {
          adminCalView.m = 11;
          adminCalView.y--;
        }
        renderAdminCalendar();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        adminCalView.m++;
        if (adminCalView.m > 11) {
          adminCalView.m = 0;
          adminCalView.y++;
        }
        renderAdminCalendar();
      });
    }

    document.querySelectorAll('#adminNavManagementMenu a[href="#section-content"]').forEach(function (link) {
      link.remove();
    });
    var leftoverContentSection = document.getElementById("section-content");
    if (leftoverContentSection) leftoverContentSection.remove();

    // Nav links -> show sections
    var navLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
    var navDropdownToggles = document.querySelectorAll(".admin-nav-dropdown-toggle");
    var sectionNavGroups = {
      "section-bookings": "adminNavManagement",
      "section-payments": "adminNavManagement",
      "section-calendar-access": "adminNavManagement",
      "section-activity-logs": "adminNavManagement",
      "section-manager-user": "adminNavManagement",
      "section-reports": "adminNavAnalytics",
      "section-sentiment": "adminNavAnalytics",
      "section-predictive": "adminNavAnalytics"
    };
    var ADMIN_MOBILE_NAV_BP = 1500;

    function isAdminMobileNav() {
      return window.innerWidth <= ADMIN_MOBILE_NAV_BP;
    }

    function closeAdminNavDropdowns(exceptDropdown) {
      document.querySelectorAll(".admin-nav-dropdown.is-open").forEach(function (dropdown) {
        if (exceptDropdown && dropdown === exceptDropdown) return;
        dropdown.classList.remove("is-open");
        var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }

    function initAdminNavDropdowns() {
      document.querySelectorAll(".admin-nav-dropdown").forEach(function (dropdown) {
        var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
        var menu = dropdown.querySelector(".admin-nav-dropdown-menu");
        if (!toggle || !menu) return;

        toggle.addEventListener("click", function (e) {
          if (isAdminMobileNav()) return;
          e.preventDefault();
          e.stopPropagation();
          if (dropdown.classList.contains("is-open")) {
            closeAdminNavDropdowns();
            return;
          }
          closeAdminNavDropdowns(dropdown);
          closeMenu();
          if (settingsToggle) settingsToggle.classList.remove("active");
          dropdown.classList.add("is-open");
          toggle.setAttribute("aria-expanded", "true");
        });

        menu.querySelectorAll('a[href^="#section-"]').forEach(function (link) {
          link.addEventListener("click", function () {
            closeAdminNavDropdowns();
          });
        });
      });

      document.addEventListener("click", function (e) {
        if (isAdminMobileNav()) return;
        var insideDropdown = e.target && e.target.closest && e.target.closest(".admin-nav-dropdown");
        if (insideDropdown) return;
        closeAdminNavDropdowns();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeAdminNavDropdowns();
      });
    }

    function setActiveSectionNav(targetSectionId) {
      var targetHref = "#" + String(targetSectionId || "");
      navLinks.forEach(function (a) {
        var href = a.getAttribute("href") || "";
        if (href === targetHref) a.classList.add("active");
        else a.classList.remove("active");
      });

      navDropdownToggles.forEach(function (toggle) {
        toggle.classList.remove("active");
      });
      var groupId = sectionNavGroups[targetSectionId];
      if (groupId) {
        var groupEl = document.getElementById(groupId);
        if (groupEl) {
          var groupToggle = groupEl.querySelector(".admin-nav-dropdown-toggle");
          if (groupToggle) groupToggle.classList.add("active");
        }
      }
    }

    // Ensure underline matches the initial hash right away.
    setActiveSectionNav(getSectionIdFromHash(window.location.hash));
    initAdminNavDropdowns();
    navLinks.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var href = a.getAttribute("href") || "";
        var id = getSectionIdFromHash(href);
        e.preventDefault();
        if (id === "section-manager-user") {
          openGate("section-manager-user");
          return;
        }
        // Set hash for back/forward support.
        try {
          window.location.hash = id;
        } catch (err) {}
        showSection(id);
      });
    });

    window.addEventListener("hashchange", function () {
      showSection(window.location.hash);
    });

    // Keep Admin reports/analytics live across tabs.
    window.addEventListener("storage", function (e) {
      if (!e) return;
      if (e.key === "elenest_feedback" || e.key === "elenest_bookings" || e.key === "elenest_payment_methods" || e.key === "elenest_notifications" || e.key === "elenest_notification_broadcasts") refreshActiveSection();
    });
    window.addEventListener("elenest-bookings-updated", function () {
      var sig = adminLiveSignature();
      if (sig && sig === lastAdminLiveSignature) return;
      lastAdminLiveSignature = sig;
      refreshActiveSection();
    });
    window.addEventListener("elenest-calendar-access-updated", function () {
      if (currentSectionId === "section-calendar-access") {
        if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.renderOwnerSection) {
          window.ElenestCalendarAccess.renderOwnerSection();
        }
      } else if (currentSectionId === "section-dashboard") {
        renderAdminCalendar();
      }
    });
    window.addEventListener("elenest-activity-logs-updated", function () {
      if (currentSectionId === "section-activity-logs") {
        if (window.ElenestActivityLogs && window.ElenestActivityLogs.refreshAdminSection) {
          window.ElenestActivityLogs.refreshAdminSection();
        }
      }
    });
    window.addEventListener("elenest-manager-blocks-updated", function () {
      renderAdminCalendar.paintSig = "";
      if (currentSectionId === "section-dashboard") renderAdminCalendar();
      if (currentSectionId === "section-calendar-access" && window.ElenestCalendarAccess) {
        window.ElenestCalendarAccess.renderOwnerSection();
      }
    });
    window.addEventListener("elenest-payment-methods-updated", function () {
      refreshActiveSection();
    });
    window.addEventListener("elenest-feedback-updated", function () {
      // Soft refresh in background — do not clear cache until new KPIs are ready.
      loadHomeReviewKpis(true).then(function () {
        refreshActiveSection();
      });
    });
    window.addEventListener("elenest-review-names-updated", function () {
      var sentiment = document.getElementById("section-sentiment");
      if (sentiment && !sentiment.hidden) renderSentimentFeedbackList();
      if (
        window.ElenestGuestFeedback &&
        typeof window.ElenestGuestFeedback.mountRecentReviewNames === "function"
      ) {
        window.ElenestGuestFeedback.mountRecentReviewNames(
          document.getElementById("adminReportGuestReviewsCard")
        );
      }
    });

    // Dropdown open/close
    function openMenu() {
      if (!settingsMenu || !settingsToggle) return;
      setHidden(settingsMenu, false);
      settingsToggle.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      if (!settingsMenu || !settingsToggle) return;
      setHidden(settingsMenu, true);
      settingsToggle.setAttribute("aria-expanded", "false");
    }

    if (settingsToggle && settingsMenu) {
      settingsToggle.addEventListener("click", function (e) {
        e.preventDefault();
        if (settingsMenu.hasAttribute("hidden")) openMenu();
        else closeMenu();

        // "Settings" behaves like a tab: underline it and remove underline from section links.
        settingsToggle.classList.add("active");
        var sectionLinks = document.querySelectorAll('header .navlinks a[href^="#section-"]');
        sectionLinks.forEach(function (a) {
          a.classList.remove("active");
        });
        navDropdownToggles.forEach(function (toggle) {
          toggle.classList.remove("active");
        });
        closeAdminNavDropdowns();
      });

      document.addEventListener("click", function (e) {
        if (!settingsMenu || !settingsToggle) return;
        if (settingsMenu.hasAttribute("hidden")) return;
        if (settingsMenu.contains(e.target) || settingsToggle.contains(e.target)) return;
        closeMenu();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMenu();
      });
    }

    initSentimentPopup();
    initSentimentRecAcceptHandlers();
    initSentimentArchiveModals();
    registerSentimentArchiveBuilder();

    // Admin Profile overlay
    var profileOverlay = document.getElementById("adminProfileOverlay");
    var profileForm = document.getElementById("adminProfileForm");
    var profileCloseBtn = document.getElementById("adminProfileCloseBtn");
    var profileNameEl = document.getElementById("adminProfileName");
    var profileEmailEl = document.getElementById("adminProfileEmail");
    var profileMsg = document.getElementById("adminProfileMsg");

    function setProfileMsg(ok, text) {
      if (!profileMsg) return;
      profileMsg.hidden = !text;
      profileMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      profileMsg.textContent = text || "";
    }

    function hideProfileMsg() {
      if (!profileMsg) return;
      profileMsg.hidden = true;
      profileMsg.textContent = "";
      profileMsg.className = "auth-msg";
    }

    function applyUpdatedAdminUser(fresh) {
      if (!fresh) return;
      u = fresh;
      name = (u && u.name) ? u.name : "";
      if (Auth && typeof Auth.setCurrentUser === "function") Auth.setCurrentUser(u);
      if (Auth && typeof Auth.applyStaffHeaderRole === "function") Auth.applyStaffHeaderRole(u);
      if (menuLogoutBtn) menuLogoutBtn.textContent = name ? "Logout (" + name + ")" : "Logout";
      renderManagerUser();
    }

    function updateLocalAdminProfile(nextName, nextEmail) {
      if (!u) return { ok: false, message: "Session expired. Please sign in again." };
      var users = getUsers();
      var currentEmail = normalizeEmail(u.email);
      var found = false;
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i].email) === currentEmail || (u.id && users[i].id === u.id)) {
          users[i].name = nextName;
          users[i].email = nextEmail;
          found = true;
        }
      }
      if (found) saveUsers(users);
      u.name = nextName;
      u.email = nextEmail;
      return { ok: true, user: u, message: "Profile saved." };
    }

    function openProfile() {
      if (!profileOverlay) return;
      if (profileNameEl) profileNameEl.value = (u && u.name) ? u.name : "";
      if (profileEmailEl) profileEmailEl.value = (u && u.email) ? u.email : "";
      hideProfileMsg();
      setHidden(profileOverlay, false);
      closeMenu();
      if (profileNameEl) profileNameEl.focus();
    }

    function closeProfile() {
      if (!profileOverlay) return;
      setHidden(profileOverlay, true);
    }

    if (menuProfileBtn) menuProfileBtn.addEventListener("click", function () { openProfile(); });
    if (profileCloseBtn) profileCloseBtn.addEventListener("click", function () { closeProfile(); });
    if (profileOverlay) {
      profileOverlay.addEventListener("click", function (e) {
        if (e.target === profileOverlay) closeProfile();
      });
    }

    if (profileForm) {
      profileForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var nextName = profileNameEl ? String(profileNameEl.value || "").trim() : "";
        var nextEmail = profileEmailEl ? normalizeEmail(profileEmailEl.value) : "";

        if (!nextName) {
          setProfileMsg(false, "Please enter a name.");
          return;
        }
        if (!isValidEmail(nextEmail)) {
          setProfileMsg(false, "Please enter a valid email address.");
          return;
        }
        if (!u || !u.email) {
          setProfileMsg(false, "Session expired. Please sign in again.");
          return;
        }

        var profileSubmitBtn = profileForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(profileSubmitBtn, true);
        else if (profileSubmitBtn) profileSubmitBtn.disabled = true;

        function finishProfileSave(result) {
          if (BL) BL.set(profileSubmitBtn, false);
          else if (profileSubmitBtn) profileSubmitBtn.disabled = false;
          if (!result || !result.ok) {
            setProfileMsg(false, (result && result.message) || "Could not save profile.");
            return;
          }
          applyUpdatedAdminUser(result.user || Object.assign({}, u, { name: nextName, email: nextEmail }));
          setProfileMsg(true, result.message || "Profile saved.");
        }

        if (Auth && typeof Auth.updateStaffProfile === "function") {
          Auth.updateStaffProfile({ name: nextName, email: nextEmail })
            .then(finishProfileSave)
            .catch(function () {
              finishProfileSave({ ok: false, message: "Could not save profile." });
            });
          return;
        }

        finishProfileSave(updateLocalAdminProfile(nextName, nextEmail));
      });
    }

    // Change Password overlay
    var passwordOverlay = document.getElementById("adminPasswordOverlay");
    var passwordCloseBtn = document.getElementById("adminPasswordCloseBtn");
    var passwordForm = document.getElementById("adminChangePasswordForm");
    var passwordMsg = document.getElementById("adminChangePasswordMsg");
    var currentPasswordInput = document.getElementById("adminCurrentPassword");
    var newPasswordInput = document.getElementById("adminNewPassword");
    var confirmPasswordInput = document.getElementById("adminConfirmPassword");

    function setMsgOk() {
      if (!passwordMsg) return;
      passwordMsg.hidden = false;
      passwordMsg.className = "auth-msg auth-msg--ok";
    }

    function setMsgErr(text) {
      if (!passwordMsg) return;
      passwordMsg.hidden = false;
      passwordMsg.className = "auth-msg auth-msg--err";
      passwordMsg.textContent = text;
    }

    function resetPasswordForm() {
      if (currentPasswordInput) currentPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      if (confirmPasswordInput) confirmPasswordInput.value = "";
      if (passwordMsg) {
        passwordMsg.hidden = true;
        passwordMsg.textContent = "";
        passwordMsg.className = "auth-msg";
      }
    }

    function openPassword() {
      if (!passwordOverlay) return;
      resetPasswordForm();
      setHidden(passwordOverlay, false);
      closeMenu();
      if (currentPasswordInput) currentPasswordInput.focus();
    }

    function closePassword() {
      if (!passwordOverlay) return;
      setHidden(passwordOverlay, true);
    }

    if (menuChangePasswordBtn) menuChangePasswordBtn.addEventListener("click", function () { openPassword(); });
    if (passwordCloseBtn) passwordCloseBtn.addEventListener("click", function () { closePassword(); });
    if (passwordOverlay) {
      passwordOverlay.addEventListener("click", function (e) {
        if (e.target === passwordOverlay) closePassword();
      });
    }

    if (menuLogoutBtn) {
      menuLogoutBtn.textContent = name ? "Logout (" + name + ")" : "Logout";
      menuLogoutBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(menuLogoutBtn, true);
        window.ElenestAuth.logout().then(function () {
          try {
            window.location.replace("index.html");
          } catch (err) {}
        }).catch(function () {
          if (BL) BL.set(menuLogoutBtn, false);
        });
      });
    }

    if (passwordForm) {
      passwordForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var currentPassword = currentPasswordInput ? String(currentPasswordInput.value || "") : "";
        var newPassword = newPasswordInput ? String(newPasswordInput.value || "") : "";
        var confirmPassword = confirmPasswordInput ? String(confirmPasswordInput.value || "") : "";

        if (!currentPassword || !newPassword || !confirmPassword) {
          setMsgErr("Please fill in all password fields.");
          return;
        }

        if (newPassword.length < 6) {
          setMsgErr("New password must be at least 6 characters.");
          return;
        }

        if (newPassword !== confirmPassword) {
          setMsgErr("New password and confirmation do not match.");
          return;
        }

        if (!u || !u.email) {
          setMsgErr("Session expired. Please sign in again.");
          return;
        }

        var passwordSubmitBtn = passwordForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(passwordSubmitBtn, true);
        else if (passwordSubmitBtn) passwordSubmitBtn.disabled = true;

        function finishPasswordChange(result) {
          if (BL) BL.set(passwordSubmitBtn, false);
          else if (passwordSubmitBtn) passwordSubmitBtn.disabled = false;
          if (!result.ok) {
            setMsgErr(result.message || "Failed to update password.");
            return;
          }
          if (passwordMsg) {
            passwordMsg.hidden = false;
            passwordMsg.className = "auth-msg auth-msg--ok";
            passwordMsg.textContent = "Password updated successfully.";
          }
          if (currentPasswordInput) currentPasswordInput.value = "";
          if (newPasswordInput) newPasswordInput.value = "";
          if (confirmPasswordInput) confirmPasswordInput.value = "";
          setTimeout(function () {
            closePassword();
          }, 500);
        }

        if (Auth && typeof Auth.changePassword === "function") {
          Auth.changePassword(currentPassword, newPassword)
            .then(finishPasswordChange)
            .catch(function () {
              finishPasswordChange({
                ok: false,
                message: "Could not update password. Please try again."
              });
            });
          return;
        }

        finishPasswordChange(updateUserPassword(u.email, currentPassword, newPassword));
      });
    }

    initPaymentManagementHandlers();

    if (window.ElenestCalendarAccess && window.ElenestCalendarAccess.init) {
      window.ElenestCalendarAccess.init();
    }

    function bootDashboard() {
      showSection(getSectionIdFromHash(window.location.hash));
    }

    // Show UI immediately — do not block clicks waiting on feedback/bookings.
    // Full-screen boot overlay is cleared by staff-boot-loading.js when data is ready.
    bootDashboard();

    // Warm review KPI cache in the background so reports open without lag.
    setTimeout(function () {
      loadHomeReviewKpis(false);
    }, 800);

    if (window.ElenestBookings && window.ElenestBookings.ready) {
      window.ElenestBookings.ready.then(function () {
        if (currentSectionId === "section-payments") syncPaymentsSection();
        else refreshActiveSection();
      });
    }

    if (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready) {
      window.ElenestGuestFeedback.ready.then(function () {
        loadHomeReviewKpis(false).then(function () {
          if (
            currentSectionId === "section-dashboard" ||
            currentSectionId === "section-sentiment" ||
            currentSectionId === "section-reports"
          ) {
            refreshActiveSection();
          }
        });
      });
    }

    // Manage Users: create accounts and assign positions.
    var userForm = document.getElementById("adminUserForm");
    var userMsg = document.getElementById("adminUserMsg");
    var userNameInput = document.getElementById("adminUserName");
    var userEmailInput = document.getElementById("adminUserEmail");
    var userPasswordInput = document.getElementById("adminUserPassword");
    var userRoleSelect = document.getElementById("adminUserRole");

    function setUserMsg(ok, text) {
      if (!userMsg) return;
      userMsg.hidden = false;
      userMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      userMsg.textContent = text;
    }

    if (userForm) {
      userForm.addEventListener("submit", function (e) {
        e.preventDefault();

        var name = userNameInput ? String(userNameInput.value || "").trim() : "";
        var email = userEmailInput ? normalizeEmail(userEmailInput.value || "") : "";
        var password = userPasswordInput ? String(userPasswordInput.value || "") : "";
        var role = userRoleSelect ? String(userRoleSelect.value || "").trim().toLowerCase() : "";
        var submitBtn = userForm.querySelector('button[type="submit"]');

        if (!name || !email || !password || !role) {
          setUserMsg(false, "Please fill in all fields and select a job/position.");
          return;
        }

        if (!isValidEmail(email)) {
          setUserMsg(false, "Please enter a valid email address (must include @).");
          return;
        }

        if (password.length < 6) {
          setUserMsg(false, "Password must be at least 6 characters.");
          return;
        }

        if (role !== "manager" && role !== "receptionist") {
          setUserMsg(false, "Select Manager or Receptionist. Admin accounts use Admin Sign Up.");
          return;
        }

        if (!Auth || typeof Auth.createStaffAccount !== "function") {
          setUserMsg(false, "Staff account service is unavailable. Refresh and try again.");
          return;
        }

        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(submitBtn, true);
        else if (submitBtn) submitBtn.disabled = true;
        Auth.createStaffAccount({
          name: name,
          email: email,
          password: password,
          role: role
        }).then(function (result) {
          if (BL) BL.set(submitBtn, false);
          else if (submitBtn) submitBtn.disabled = false;
          if (!result || !result.ok) {
            setUserMsg(false, (result && result.message) || "Failed to create staff account.");
            return;
          }

          if (userNameInput) userNameInput.value = "";
          if (userEmailInput) userEmailInput.value = "";
          if (userPasswordInput) userPasswordInput.value = "";
          if (userRoleSelect) userRoleSelect.value = "";

          setUserMsg(
            true,
            "Account created in Supabase. Give " +
              name +
              " their email and password. They can use Sign In on the website; access is based on the role saved for their account."
          );
          adminListPages.userAccounts = 1;
          rememberStaffPassword(email, password);
          if (result.user) {
            var created = Object.assign({}, result.user, { password: password });
            var list = Array.isArray(staffAccountsCache) ? staffAccountsCache.slice() : [];
            list = list.filter(function (u) {
              return normalizeEmail(u && u.email) !== email;
            });
            list.unshift(created);
            staffAccountsCache = list;
          }
          renderUserAccounts();
        }).catch(function (err) {
          if (BL) BL.set(submitBtn, false);
          else if (submitBtn) submitBtn.disabled = false;
          setUserMsg(false, (err && err.message) || "Failed to create staff account.");
        });
      });
    }

    // Facilities room catalog management (shown in Facilities page for customers).
    var roomForm = document.getElementById("adminRoomCatalogForm");
    var roomMsg = document.getElementById("adminRoomCatalogMsg");
    var roomNameInput = document.getElementById("adminRoomName");
    var roomPriceInput = document.getElementById("adminRoomPrice");
    var roomPriceUnitSelect = document.getElementById("adminRoomPriceUnit");
    var roomImageInput = document.getElementById("adminRoomImage");
    var roomDescriptionInput = document.getElementById("adminRoomDescription");
    var roomListHost = document.getElementById("adminRoomCatalogList");

    function setRoomMsg(ok, text) {
      if (!roomMsg) return;
      roomMsg.hidden = false;
      roomMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      roomMsg.textContent = text;
    }

    function renderRoomCatalog() {
      if (!roomListHost) return;
      var list = getRoomCatalog();
      roomListHost.textContent = "";

      if (!list.length) {
        var empty = document.createElement("p");
        empty.style.margin = "0";
        empty.style.color = "#6b7280";
        empty.textContent = "No room catalog entries yet.";
        roomListHost.appendChild(empty);
        return;
      }

      var rowsHtml = list
        .map(function (r) {
          var unit = r.priceUnit === "day" ? "per day" : "per night";
          return (
            "<tr>" +
            "<td>" + escapeHtml(r.name) + "</td>" +
            "<td>" + fmtPHP(r.price) + " / " + unit + "</td>" +
            "<td>" + escapeHtml(r.image) + "</td>" +
            "<td>" +
            '<button type="button" class="btn btn--danger btn--small admin-room-remove" data-room-id="' + escapeHtml(r.id) + '">Remove</button>' +
            "</td>" +
            "</tr>"
          );
        })
        .join("");

      roomListHost.innerHTML =
        '<table class="admin-users-table">' +
        "<thead><tr><th>Room</th><th>Price</th><th>Image</th><th>Action</th></tr></thead>" +
        "<tbody>" + rowsHtml + "</tbody>" +
        "</table>";

      var removeBtns = roomListHost.querySelectorAll(".admin-room-remove");
      removeBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-room-id");
          var BL = window.ElenestButtonLoading;
          var work = function () {
            var next = getRoomCatalog().filter(function (item) {
              return String(item.id) !== String(id);
            });
            return Promise.resolve(saveRoomCatalog(next)).then(function () {
              renderRoomCatalog();
            });
          };
          if (BL) BL.run(btn, work);
          else work();
        });
      });
    }

    if (roomForm) {
      roomForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = roomNameInput ? String(roomNameInput.value || "").trim() : "";
        var price = roomPriceInput ? Number(roomPriceInput.value || 0) : 0;
        var priceUnit = roomPriceUnitSelect ? String(roomPriceUnitSelect.value || "night") : "night";
        var image = roomImageInput ? String(roomImageInput.value || "").trim() : "";
        var description = roomDescriptionInput ? String(roomDescriptionInput.value || "").trim() : "";

        if (!name || !image || !description || !price || price < 0) {
          setRoomMsg(false, "Please complete all room catalog fields.");
          return;
        }

        var submitBtn = roomForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(submitBtn, true);

        var list = getRoomCatalog();
        list.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: name,
          price: Math.round(price),
          priceUnit: priceUnit === "day" ? "day" : "night",
          image: image,
          description: description
        });
        Promise.resolve(saveRoomCatalog(list)).then(function () {
          if (roomNameInput) roomNameInput.value = "";
          if (roomPriceInput) roomPriceInput.value = "";
          if (roomPriceUnitSelect) roomPriceUnitSelect.value = "night";
          if (roomImageInput) roomImageInput.value = "";
          if (roomDescriptionInput) roomDescriptionInput.value = "";
          setRoomMsg(true, "Room added to facilities catalog.");
          renderRoomCatalog();
        }).catch(function () {
          setRoomMsg(false, "Could not save room. Please try again.");
        }).then(function () {
          if (BL) BL.set(submitBtn, false);
        });
      });
    }

    renderRoomCatalog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

