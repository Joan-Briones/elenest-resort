(function () {
  var STORAGE_KEY = "elenest_feedback";
  var REC_ARCHIVE_KEY = "elenest_sentiment_rec_archive";
  var cache = [];
  var historicalCache = [];
  var historicalLoaded = false;
  var historicalLoadPromise = null;
  var recArchiveCache = [];
  var readyResolve;
  var readyDone = false;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  var realtimeChannel = null;
  var reloadTimer = null;
  var archiveRunning = false;
  var archivePayloadBuilder = null;
  /** null = unknown; false = DB missing sentiment archive columns/table */
  var sentimentArchiveDbSupported = null;

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function rid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
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

  function getCurrentWeekStartKey() {
    return weekStartKeyFromDate(new Date());
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function getCurrentUser() {
    return window.ElenestAuth && window.ElenestAuth.getCurrentUser
      ? window.ElenestAuth.getCurrentUser()
      : null;
  }

  var bookingNameById = {};
  var feedbackNameById = {};

  function isPlaceholderGuestName(name) {
    var n = String(name || "")
      .trim()
      .toLowerCase();
    return !n || n === "guest";
  }

  function bookingRecordName(booking) {
    if (!booking) return "";
    var direct = String(
      booking.fullName || booking.full_name || booking.name || booking.guestName || ""
    ).trim();
    if (!isPlaceholderGuestName(direct)) return direct;
    var first = String(booking.firstName || booking.first_name || "").trim();
    var last = String(booking.lastName || booking.last_name || "").trim();
    var combined = (first + " " + last).trim();
    if (!isPlaceholderGuestName(combined)) return combined;
    return "";
  }

  function rememberBookingName(id, name) {
    var key = String(id || "").trim();
    var clean = String(name || "").trim();
    if (!key || isPlaceholderGuestName(clean)) return;
    bookingNameById[key] = clean;
  }

  function rememberFeedbackName(id, name) {
    var key = String(id || "").trim();
    var clean = String(name || "").trim();
    if (!key || isPlaceholderGuestName(clean)) return;
    feedbackNameById[key] = clean;
  }

  function refreshBookingNameMapFromBookings() {
    var B = window.ElenestBookings;
    if (!B || typeof B.listAll !== "function") return;
    (B.listAll() || []).forEach(function (item) {
      var booking = item && item.booking ? item.booking : item;
      if (!booking) return;
      rememberBookingName(booking.id, bookingRecordName(booking));
    });
  }

  function displayName(item) {
    var feedbackId = String((item && item.id) || "");
    if (feedbackId && feedbackNameById[feedbackId]) return feedbackNameById[feedbackId];
    var bookingId = String((item && (item.bookingId || item.booking_id)) || "");
    if (bookingId && bookingNameById[bookingId]) return bookingNameById[bookingId];
    var stored = String((item && (item.name || item.guest_name)) || "").trim();
    if (!isPlaceholderGuestName(stored)) return stored;
    return "Guest";
  }

  var savedReviewNameIds = {};

  function isStaffSession() {
    var user = getCurrentUser();
    if (!user || !user.role) return false;
    var role = String(user.role).trim().toLowerCase();
    return role === "admin" || role === "manager" || role === "receptionist" || role === "reception";
  }

  function persistResolvedGuestNames(rows) {
    if (!rows || !rows.length || !isStaffSession()) return;
    var sb = getClient();
    if (!sb || typeof sb.from !== "function") return;
    rows.forEach(function (row) {
      if (!row || !row.id || savedReviewNameIds[row.id]) return;
      savedReviewNameIds[row.id] = true;
      sb.from("guest_feedback")
        .update({ guest_name: row.name })
        .eq("id", row.id)
        .then(function (res) {
          if (res && res.error) delete savedReviewNameIds[row.id];
        })
        .catch(function () {
          delete savedReviewNameIds[row.id];
        });
    });
  }

  function applyResolvedNamesToCache() {
    var changed = false;
    var toSave = [];
    function walk(list) {
      (list || []).forEach(function (item) {
        if (!item) return;
        var next = displayName(item);
        if (isPlaceholderGuestName(next)) return;
        if (item.name !== next && isPlaceholderGuestName(item.name)) {
          item.name = next;
          changed = true;
          if (item.id && !isHistoricalFeedback(item)) {
            toSave.push({ id: item.id, name: next });
          }
        }
      });
    }
    walk(cache);
    walk(historicalCache);
    if (!changed) return;
    syncLegacyStorage();
    persistResolvedGuestNames(toSave);
    try {
      window.dispatchEvent(new CustomEvent("elenest-review-names-updated"));
    } catch (e) {}
  }

  function loadResolvedReviewNames() {
    refreshBookingNameMapFromBookings();
    var sb = getClient();
    if (!sb || typeof sb.rpc !== "function") {
      applyResolvedNamesToCache();
      return Promise.resolve();
    }
    return sb
      .rpc("list_guest_review_names")
      .then(function (res) {
        if (!res.error && Array.isArray(res.data)) {
          res.data.forEach(function (row) {
            if (!row) return;
            rememberBookingName(row.booking_id, row.display_name);
            rememberFeedbackName(row.feedback_id, row.display_name);
          });
        }
        applyResolvedNamesToCache();
      })
      .catch(function () {
        applyResolvedNamesToCache();
      });
  }

  function mountRecentReviewNames(card) {
    if (!card) return;
    var host = card.querySelector(".admin-report-review-names");
    if (!host) {
      host = document.createElement("div");
      host.className = "admin-report-review-names";
      host.setAttribute("aria-label", "Recent guest reviews");
      card.appendChild(host);
    }
    var rows = listLive()
      .slice()
      .sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      })
      .slice(0, 5);
    host.textContent = "";
    if (!rows.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    var heading = document.createElement("p");
    heading.className = "admin-report-review-names__heading";
    heading.textContent = "Recent reviews";
    host.appendChild(heading);
    rows.forEach(function (f) {
      var row = document.createElement("div");
      row.className = "admin-report-review-names__item";
      if (f.bookingId) row.setAttribute("data-booking-id", String(f.bookingId));
      var name = document.createElement("strong");
      name.className = "admin-report-review-names__name";
      name.textContent = displayName(f);
      var meta = document.createElement("span");
      meta.className = "admin-report-review-names__meta";
      var stars = Math.max(0, Math.min(5, Number(f.stars) || 0));
      var starTxt = "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
      meta.textContent = f.bookingId ? starTxt + " · " + String(f.bookingId) : starTxt;
      row.appendChild(name);
      row.appendChild(meta);
      host.appendChild(row);
    });
  }

  function finishReady() {
    if (!readyDone) {
      readyDone = true;
      readyResolve();
    }
  }

  function emitUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-feedback-updated"));
    } catch (e) {}
  }

  function syncLegacyStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function syncRecArchiveStorage() {
    try {
      localStorage.setItem(REC_ARCHIVE_KEY, JSON.stringify(recArchiveCache));
    } catch (e) {}
  }

  function loadRecArchiveFromLocalStorage() {
    try {
      var raw = localStorage.getItem(REC_ARCHIVE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) recArchiveCache = parsed;
    } catch (e) {
      recArchiveCache = [];
    }
  }

  function loadFromLocalStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed.filter(function (item) {
          return !isHistoricalFeedback(item);
        });
      }
    } catch (e) {
      cache = [];
    }
  }

  function feedbackWeekKey(item) {
    if (item && item.sentimentWeekKey) return item.sentimentWeekKey;
    if (item && item.createdAt) return weekStartKeyFromDate(new Date(item.createdAt));
    return getCurrentWeekStartKey();
  }

  function supabaseErrorMessage(err) {
    return String((err && err.message) || err || "");
  }

  function isMissingSentimentSchemaError(err) {
    var msg = supabaseErrorMessage(err);
    return (
      /sentiment_archived|sentiment_week_key|guest_sentiment_recommendation_archive/i.test(
        msg
      ) && /schema cache|could not find|PGRST/i.test(msg)
    );
  }

  function stripSentimentDbColumns(row) {
    var copy = Object.assign({}, row);
    delete copy.sentiment_archived;
    delete copy.sentiment_week_key;
    return copy;
  }

  function detectSentimentArchiveSupport(sb) {
    if (sentimentArchiveDbSupported !== null) {
      return Promise.resolve(sentimentArchiveDbSupported);
    }
    return sb
      .from("guest_feedback")
      .select("sentiment_archived")
      .limit(1)
      .then(function (res) {
        if (res.error && isMissingSentimentSchemaError(res.error)) {
          sentimentArchiveDbSupported = false;
        } else if (!res.error) {
          sentimentArchiveDbSupported = true;
        }
        return sentimentArchiveDbSupported;
      })
      .catch(function () {
        return sentimentArchiveDbSupported;
      });
  }

  function rowToFeedback(row) {
    var createdAt = row.created_at || new Date().toISOString();
    return {
      id: row.id,
      name: row.guest_name || "",
      email: row.guest_email || "",
      bookingId: row.booking_id || "",
      stars: row.stars != null ? row.stars : 0,
      // Mobile app maps stars → rating; keep both for predictive analytics parity.
      rating: row.rating != null ? row.rating : row.stars != null ? row.stars : 0,
      sentiment: row.sentiment || "",
      positiveAspects: row.positive_aspects || "",
      negativeAspects: row.negative_aspects || "",
      comment: row.comment || "",
      photo: row.photo_url || "",
      createdAt: createdAt,
      sentimentArchived: !!row.sentiment_archived,
      sentimentWeekKey:
        row.sentiment_week_key || weekStartKeyFromDate(new Date(createdAt))
    };
  }

  function entryToRow(entry) {
    var user = getCurrentUser();
    var createdAt = entry.createdAt || new Date().toISOString();
    var weekKey = entry.sentimentWeekKey || weekStartKeyFromDate(new Date(createdAt));
    return {
      id: entry.id,
      user_id: entry.user_id || (user && user.id) || null,
      guest_name: entry.name || (user && user.name) || "Guest",
      guest_email: normalizeEmail(entry.email || (user && user.email) || ""),
      booking_id: entry.bookingId || null,
      stars: Math.max(1, Math.min(5, Number(entry.stars) || 5)),
      comment: String(entry.comment || "").trim(),
      photo_url: String(entry.photo || ""),
      sentiment_archived: !!entry.sentimentArchived,
      sentiment_week_key: weekKey
    };
  }

  function applyRows(rows) {
    cache = (rows || []).map(rowToFeedback).filter(function (item) {
      return !isHistoricalFeedback(item);
    });
    if (sentimentArchiveDbSupported === false) {
      mergeLocalSentimentArchiveState();
    }
    syncLegacyStorage();
    emitUpdated();
  }

  function mergeLocalSentimentArchiveState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      var archivedById = {};
      parsed.forEach(function (item) {
        if (item && item.id && item.sentimentArchived) {
          archivedById[item.id] = item.sentimentWeekKey || null;
        }
      });
      cache.forEach(function (item) {
        if (!archivedById[item.id]) return;
        item.sentimentArchived = true;
        if (archivedById[item.id]) item.sentimentWeekKey = archivedById[item.id];
      });
    } catch (e) {}
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      reloadTimer = null;
      loadAll(true);
    }, 350);
  }

  function subscribeRealtime(sb) {
    if (realtimeChannel || !sb || !sb.channel) return;
    realtimeChannel = sb.channel("elenest-feedback-sync");
    realtimeChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "guest_feedback" },
      scheduleReload
    );
    realtimeChannel.subscribe(function (status) {
      if (status === "SUBSCRIBED") return;
      // If channel fails, keep polling via page refresh fallback.
      try {
        console.warn("[Elenest GuestFeedback] realtime status:", status);
      } catch (e) {}
    });
  }

  function ensureRealtime() {
    if (realtimeChannel) return;
    var sb = getClient();
    if (sb) subscribeRealtime(sb);
  }

  function loadRecArchiveFromSupabase(sb) {
    return sb
      .from("guest_sentiment_recommendation_archive")
      .select("*")
      .order("archived_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        recArchiveCache = (res.data || []).map(function (row) {
          return {
            weekStartKey: row.week_start_key,
            weekLabel: row.week_label || "",
            commentCount: row.comment_count || 0,
            payload: row.payload || {},
            archivedAt: row.archived_at || new Date().toISOString()
          };
        });
        syncRecArchiveStorage();
      })
      .catch(function (err) {
        if (isMissingSentimentSchemaError(err)) {
          sentimentArchiveDbSupported = false;
        }
        try {
          console.warn("[Elenest GuestFeedback] Rec archive load failed:", err);
        } catch (e) {}
        loadRecArchiveFromLocalStorage();
      });
  }

  function loadRecArchiveForCurrentSchema(sb) {
    if (sentimentArchiveDbSupported === false) {
      loadRecArchiveFromLocalStorage();
      return Promise.resolve();
    }
    return loadRecArchiveFromSupabase(sb);
  }

  function loadAll(isReload) {
    var sb = getClient();
    if (!sb) {
      loadFromLocalStorage();
      loadRecArchiveFromLocalStorage();
      finishReady();
      if (isReload) emitUpdated();
      return Promise.resolve();
    }

    return detectSentimentArchiveSupport(sb).then(function () {
      function fetchFeedbackPage(from, pageSize, acc) {
        return sb
          .from("guest_feedback")
          .select("*")
          .not("id", "like", "past-fb-%")
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1)
          .then(function (res) {
            if (res.error) throw res.error;
            var rows = res.data || [];
            var all = acc.concat(rows);
            if (rows.length === pageSize) {
              return fetchFeedbackPage(from + pageSize, pageSize, all);
            }
            return all;
          });
      }
      return Promise.all([
        fetchFeedbackPage(0, 1000, []).then(function (rows) {
          applyRows(rows || []);
        }),
        loadRecArchiveForCurrentSchema(sb)
      ]);
    })
      .then(function () {
        return loadResolvedReviewNames();
      })
      .then(function () {
        finishReady();
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest GuestFeedback] Supabase load failed:", err);
        } catch (e) {}
        if (!cache.length) loadFromLocalStorage();
        if (!recArchiveCache.length) loadRecArchiveFromLocalStorage();
        finishReady();
        if (isReload) emitUpdated();
      });
  }

  function errMessage(err) {
    if (!err) return "";
    return String(err.message || err.error_description || err.details || err || "");
  }

  function isRlsError(err) {
    return /row-level security|violates row-level|42501|rls/i.test(errMessage(err));
  }

  function persistViaRpc(payload) {
    var sb = getClient();
    if (!sb || typeof sb.rpc !== "function") {
      return Promise.reject(new Error("Supabase is not connected."));
    }
    return sb
      .rpc("submit_guest_feedback", {
        p_id: payload.id,
        p_guest_name: payload.guest_name,
        p_guest_email: payload.guest_email,
        p_booking_id: payload.booking_id || null,
        p_stars: payload.stars,
        p_comment: payload.comment,
        p_photo_url: payload.photo_url || "",
        p_sentiment_week_key: payload.sentiment_week_key || null
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return { data: res.data, error: null };
      });
  }

  function persistRow(row) {
    var sb = getClient();
    if (!sb) {
      try {
        var item = rowToFeedback(row);
        cache.unshift(item);
        syncLegacyStorage();
        emitUpdated();
        return Promise.resolve(item);
      } catch (e) {
        return Promise.reject(e);
      }
    }

    function insertFeedback(payload) {
      return sb.from("guest_feedback").insert(payload).select("*").single();
    }

    function finishFromResponse(res) {
      if (res.error) throw res.error;
      var item = rowToFeedback(res.data || row);
      cache.unshift(item);
      syncLegacyStorage();
      emitUpdated();
      return item;
    }

    var payload =
      sentimentArchiveDbSupported === false ? stripSentimentDbColumns(row) : row;

    // Prefer RPC (bypasses RLS) then fall back to direct insert.
    return persistViaRpc(payload)
      .catch(function (rpcErr) {
        var rpcMsg = errMessage(rpcErr);
        return insertFeedback(payload).then(function (res) {
          if (res.error && isMissingSentimentSchemaError(res.error)) {
            sentimentArchiveDbSupported = false;
            return insertFeedback(stripSentimentDbColumns(row));
          }
          return res;
        }).catch(function (insertErr) {
          var insertMsg = errMessage(insertErr);
          if (/could not find the function|PGRST202|404/i.test(rpcMsg)) {
            if (isRlsError(insertErr)) {
              throw new Error(
                'Run sql/ensure-guest-feedback-rls.sql in Supabase SQL Editor, then refresh this page.'
              );
            }
            throw insertErr;
          }
          if (isRlsError(insertErr) || isRlsError(rpcErr)) {
            throw new Error(
              'Run sql/ensure-guest-feedback-rls.sql in Supabase SQL Editor, then refresh this page.'
            );
          }
          throw new Error(insertMsg || rpcMsg || "Could not save feedback.");
        });
      })
      .then(finishFromResponse);
  }

  function isHistoricalFeedback(item) {
    if (!item) return false;
    var id = String(item.id || "");
    if (id.indexOf("past-fb-") === 0) return true;
    if (String(item.guest_email || item.email || "").indexOf("@imported.elenest.local") !== -1) return true;
    return false;
  }

  function ensureHistoricalLoaded(force) {
    if (force) {
      historicalLoaded = false;
      historicalLoadPromise = null;
      historicalCache = [];
    }
    if (historicalLoaded) return Promise.resolve(historicalCache);
    if (historicalLoadPromise) return historicalLoadPromise;

    function fetchJsonFile(url) {
      return fetch(url, { cache: "force-cache" }).then(function (res) {
        if (!res.ok) throw new Error("Could not load " + url);
        return res.json();
      });
    }

    function loadFromFiles() {
      var HD = window.ElenestHistoricalData;
      if (HD && typeof HD.loadFeedback === "function") {
        return HD.loadFeedback().then(function (result) {
          return (result && result.rows) || [];
        });
      }
      return fetchJsonFile("../data/historical-manifest.json")
        .then(function (manifest) {
          var urls = (manifest && manifest.feedback) || [];
          var i = 0;
          var acc = [];
          function next() {
            if (i >= urls.length) return Promise.resolve(acc);
            var url = urls[i++];
            return fetchJsonFile(url).then(function (rows) {
              acc = acc.concat(rows || []);
              return next();
            });
          }
          return next();
        })
        .catch(function () {
          return [];
        });
    }

    function fetchHistoricalPage(sb, from, pageSize, acc) {
      return sb
        .from("guest_feedback")
        .select("id,guest_name,guest_email,booking_id,stars,comment,photo_url,created_at,sentiment,positive_aspects,negative_aspects,sentiment_archived,sentiment_week_key")
        .like("id", "past-fb-%")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = res.data || [];
          var all = acc.concat(rows);
          if (rows.length === pageSize) {
            return fetchHistoricalPage(sb, from + pageSize, pageSize, all);
          }
          return all;
        });
    }

    function loadFromDatabase() {
      var sb = getClient();
      if (!sb) return Promise.resolve([]);
      return fetchHistoricalPage(sb, 0, 500, []).catch(function (err) {
        var msg = String((err && err.message) || err || "");
        if (/sentiment_archived|sentiment_week_key/i.test(msg)) {
          return sb
            .from("guest_feedback")
            .select("id,guest_name,guest_email,booking_id,stars,comment,photo_url,created_at,sentiment,positive_aspects,negative_aspects")
            .like("id", "past-fb-%")
            .order("created_at", { ascending: false })
            .range(0, 4999)
            .then(function (res) {
              if (res.error) throw res.error;
              return res.data || [];
            });
        }
        try {
          console.warn("[Elenest GuestFeedback] Historical database load failed:", err);
        } catch (e) {}
        return [];
      });
    }

    function mergeById(a, b) {
      var byId = {};
      (a || []).concat(b || []).forEach(function (item) {
        if (!item || !item.id) return;
        byId[String(item.id)] = item;
      });
      return Object.keys(byId).map(function (id) {
        return byId[id];
      });
    }

    historicalLoadPromise = Promise.all([loadFromFiles(), loadFromDatabase()])
      .then(function (parts) {
        var fromFiles = parts[0] || [];
        var fromDb = parts[1] || [];
        // Always merge files + DB (DB wins on same id) so KPI totals match the home page.
        var merged = mergeById(fromFiles, fromDb);
        historicalCache = merged.map(rowToFeedback).filter(Boolean);
        historicalLoaded = true;
        historicalLoadPromise = null;
        return historicalCache;
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest GuestFeedback] Historical load failed:", err);
        } catch (e) {}
        historicalLoaded = true;
        historicalLoadPromise = null;
        return historicalCache;
      });
    return historicalLoadPromise;
  }

  function listLive() {
    return cache.filter(function (item) {
      return !isHistoricalFeedback(item);
    });
  }

  function listForSentiment() {
    var currentKey = getCurrentWeekStartKey();
    return cache.filter(function (item) {
      if (item.sentimentArchived) return false;
      return feedbackWeekKey(item) === currentKey;
    });
  }

  function isPastWeekComment(item) {
    return feedbackWeekKey(item) < getCurrentWeekStartKey();
  }

  function listArchivedCommentsByWeek() {
    var groups = {};
    cache
      .filter(function (item) {
        return !!item.sentimentArchived || isPastWeekComment(item);
      })
      .forEach(function (item) {
        var key = feedbackWeekKey(item);
        if (!groups[key]) {
          var parts = key.split("-");
          var mon = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          groups[key] = {
            weekStartKey: key,
            weekLabel: formatWeekRangeLabel(mon),
            comments: []
          };
        }
        groups[key].comments.push(item);
      });

    return Object.keys(groups)
      .sort(function (a, b) {
        return b.localeCompare(a);
      })
      .map(function (key) {
        var g = groups[key];
        g.comments.sort(function (a, b) {
          return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        });
        return g;
      });
  }

  function listRecommendationArchive() {
    return recArchiveCache.slice().sort(function (a, b) {
      return String(b.weekStartKey || "").localeCompare(String(a.weekStartKey || ""));
    });
  }

  function hasRecommendationArchiveForWeek(weekKey) {
    return recArchiveCache.some(function (row) {
      return row.weekStartKey === weekKey;
    });
  }

  function saveRecommendationArchive(entry) {
    var row = {
      weekStartKey: entry.weekStartKey,
      weekLabel: entry.weekLabel || "",
      commentCount: entry.commentCount || 0,
      payload: entry.payload || {},
      archivedAt: entry.archivedAt || new Date().toISOString()
    };

    var sb = getClient();
    if (!sb) {
      var idx = recArchiveCache.findIndex(function (r) {
        return r.weekStartKey === row.weekStartKey;
      });
      if (idx >= 0) recArchiveCache[idx] = row;
      else recArchiveCache.unshift(row);
      syncRecArchiveStorage();
      return Promise.resolve(row);
    }

    return sb
      .from("guest_sentiment_recommendation_archive")
      .upsert(
        {
          week_start_key: row.weekStartKey,
          week_label: row.weekLabel,
          comment_count: row.commentCount,
          payload: row.payload,
          archived_at: row.archivedAt
        },
        { onConflict: "week_start_key" }
      )
      .then(function (res) {
        if (res.error) {
          if (isMissingSentimentSchemaError(res.error)) {
            sentimentArchiveDbSupported = false;
            var idx = recArchiveCache.findIndex(function (r) {
              return r.weekStartKey === row.weekStartKey;
            });
            if (idx >= 0) recArchiveCache[idx] = row;
            else recArchiveCache.unshift(row);
            syncRecArchiveStorage();
            return row;
          }
          throw res.error;
        }
        var existing = recArchiveCache.findIndex(function (r) {
          return r.weekStartKey === row.weekStartKey;
        });
        if (existing >= 0) recArchiveCache[existing] = row;
        else recArchiveCache.unshift(row);
        syncRecArchiveStorage();
        return row;
      });
  }

  function markCommentsArchived(ids, weekKey) {
    if (!ids || !ids.length) return Promise.resolve([]);

    var idSet = {};
    ids.forEach(function (id) {
      idSet[id] = true;
    });

    cache.forEach(function (item) {
      if (idSet[item.id]) {
        item.sentimentArchived = true;
        item.sentimentWeekKey = weekKey || feedbackWeekKey(item);
      }
    });
    syncLegacyStorage();

    var sb = getClient();
    if (!sb || sentimentArchiveDbSupported === false) {
      emitUpdated();
      return Promise.resolve(ids);
    }

    return sb
      .from("guest_feedback")
      .update({
        sentiment_archived: true,
        sentiment_week_key: weekKey
      })
      .in("id", ids)
      .then(function (res) {
        if (res.error && isMissingSentimentSchemaError(res.error)) {
          sentimentArchiveDbSupported = false;
          emitUpdated();
          return ids;
        }
        if (res.error) throw res.error;
        emitUpdated();
        return ids;
      });
  }

  function groupUnarchivedByWeek() {
    var groups = {};
    cache.forEach(function (item) {
      if (item.sentimentArchived) return;
      var key = feedbackWeekKey(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }

  function ensureWeeklyArchive(buildRecommendationPayload) {
    if (archiveRunning) return Promise.resolve(false);
    archiveRunning = true;

    var currentKey = getCurrentWeekStartKey();
    var groups = groupUnarchivedByWeek();
    var weekKeys = Object.keys(groups)
      .filter(function (key) {
        return key < currentKey;
      })
      .sort();

    if (!weekKeys.length) {
      archiveRunning = false;
      return Promise.resolve(false);
    }

    var chain = Promise.resolve();

    weekKeys.forEach(function (weekKey) {
      chain = chain.then(function () {
        var comments = groups[weekKey] || [];
        if (!comments.length) return null;

        var parts = weekKey.split("-");
        var mon = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        var weekLabel = formatWeekRangeLabel(mon);

        var recPromise;
        if (typeof buildRecommendationPayload === "function") {
          recPromise = Promise.resolve(
            buildRecommendationPayload(comments, weekLabel, weekKey)
          ).then(function (payload) {
            if (!payload) return null;
            return saveRecommendationArchive({
              weekStartKey: weekKey,
              weekLabel: weekLabel,
              commentCount: comments.length,
              payload: payload,
              archivedAt: new Date().toISOString()
            });
          });
        } else {
          recPromise = Promise.resolve(null);
        }

        return recPromise.then(function () {
          return markCommentsArchived(
            comments.map(function (c) {
              return c.id;
            }),
            weekKey
          );
        });
      });
    });

    return chain
      .then(function () {
        archiveRunning = false;
        return true;
      })
      .catch(function (err) {
        archiveRunning = false;
        try {
          console.warn("[Elenest GuestFeedback] Weekly archive failed:", err);
        } catch (e) {}
        return false;
      });
  }

  function setArchivePayloadBuilder(fn) {
    archivePayloadBuilder = typeof fn === "function" ? fn : null;
  }

  function scheduleArchiveRun() {
    ready.then(function () {
      if (archivePayloadBuilder) {
        ensureWeeklyArchive(archivePayloadBuilder);
      }
    });
  }

  loadAll(false);
  ensureRealtime();
  setTimeout(ensureRealtime, 1500);

  if (window.ElenestAuth && window.ElenestAuth.ready) {
    window.ElenestAuth.ready.then(function () {
      ensureRealtime();
      loadAll(true);
    });
  }

  var bookingNameTimer = null;
  window.addEventListener("elenest-bookings-updated", function () {
    if (bookingNameTimer) clearTimeout(bookingNameTimer);
    bookingNameTimer = setTimeout(function () {
      bookingNameTimer = null;
      refreshBookingNameMapFromBookings();
      applyResolvedNamesToCache();
    }, 200);
  });

  window.ElenestGuestFeedback = {
    ready: ready,

    listAll: function () {
      if (!historicalCache.length) return cache.slice();
      return cache.concat(historicalCache);
    },

    listLive: listLive,

    displayName: displayName,

    mountRecentReviewNames: mountRecentReviewNames,

    isHistoricalFeedback: isHistoricalFeedback,

    ensureHistoricalLoaded: ensureHistoricalLoaded,

    isHistoricalLoaded: function () {
      return historicalLoaded;
    },

    listForSentiment: listForSentiment,

    listArchivedCommentsByWeek: listArchivedCommentsByWeek,

    listRecommendationArchive: listRecommendationArchive,

    ensureWeeklyArchive: ensureWeeklyArchive,

    setArchivePayloadBuilder: setArchivePayloadBuilder,

    scheduleArchiveRun: scheduleArchiveRun,

    getCurrentWeekStartKey: getCurrentWeekStartKey,

    formatWeekRangeLabel: formatWeekRangeLabel,

    refresh: function () {
      ensureRealtime();
      return loadAll(true);
    },

    add: function (entry) {
      var id = (entry && entry.id) || rid();
      var bookingId = String((entry && entry.bookingId) || "").trim();
      if (!bookingId) {
        return Promise.reject(
          new Error("Reviews are only available from your post-stay email link.")
        );
      }
      var row = entryToRow(
        Object.assign(
          {
            id: id
          },
          entry || {}
        )
      );
      row.booking_id = bookingId;
      if (!row.comment) {
        return Promise.reject(new Error("Comment is required."));
      }

      var Photos = window.ElenestFeedbackPhotos;
      var photoPromise =
        Photos && typeof Photos.preparePhotoUrl === "function" && row.photo_url
          ? Photos.preparePhotoUrl(row.id, row.photo_url)
          : Promise.resolve(row.photo_url || "");

      return photoPromise.then(function (photoUrl) {
        row.photo_url = photoUrl || "";
        return persistRow(row);
      });
    }
  };
})();
