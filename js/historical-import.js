/**
 * One-time import of past Google Sheet rows into Supabase.
 * Uses the signed-in admin session so SQL Editor size limits are avoided.
 */
(function () {
  "use strict";

  var MANIFEST_URL = "../data/historical-manifest.json";
  var BATCH = 40;
  var running = false;

  function $(id) {
    return document.getElementById(id);
  }

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function currentUser() {
    return window.ElenestAuth && window.ElenestAuth.getCurrentUser
      ? window.ElenestAuth.getCurrentUser()
      : null;
  }

  function setStatus(text, kind) {
    var el = $("adminHistoricalImportStatus");
    if (!el) return;
    el.textContent = text || "";
    el.setAttribute("data-kind", kind || "");
  }

  function setBusy(on) {
    var btn = $("adminHistoricalImportBtn");
    if (btn) {
      btn.disabled = !!on;
      btn.textContent = on ? "Importing…" : "Import past data";
    }
    running = !!on;
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + url);
      return res.json();
    });
  }

  function resolveManifestUrl() {
    var base =
      window.ElenestHistoricalData && window.ElenestHistoricalData.getResolvedBase
        ? window.ElenestHistoricalData.getResolvedBase()
        : null;
    if (base) {
      return String(base).replace(/\/?$/, "/") + "historical-manifest.json";
    }
    return MANIFEST_URL;
  }

  function upsertBatch(table, rows) {
    var sb = getClient();
    return sb.from(table).upsert(rows, { onConflict: "id" }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  function upsertAll(table, rows, label, done, total) {
    var i = 0;
    function next() {
      if (i >= rows.length) return Promise.resolve();
      var chunk = rows.slice(i, i + BATCH);
      i += chunk.length;
      setStatus(
        "Saving " + label + " " + Math.min(done + i, total) + " / " + total + "…",
        "progress"
      );
      return upsertBatch(table, chunk).then(next);
    }
    return next();
  }

  function refreshAfterImport() {
    var tasks = [];
    if (window.ElenestBookings && typeof window.ElenestBookings.refresh === "function") {
      tasks.push(window.ElenestBookings.refresh());
    }
    if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.refresh === "function") {
      tasks.push(window.ElenestGuestFeedback.refresh());
    } else if (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready) {
      tasks.push(window.ElenestGuestFeedback.ready);
    }
    return Promise.all(tasks).then(function () {
      var more = [];
      if (window.ElenestBookings && typeof window.ElenestBookings.ensureHistoricalLoaded === "function") {
        more.push(window.ElenestBookings.ensureHistoricalLoaded(true));
      }
      if (window.ElenestGuestFeedback && typeof window.ElenestGuestFeedback.ensureHistoricalLoaded === "function") {
        more.push(window.ElenestGuestFeedback.ensureHistoricalLoaded(true));
      }
      return Promise.all(more);
    }).then(function () {
      if (window.ElenestModelEvaluation && typeof window.ElenestModelEvaluation.render === "function") {
        window.ElenestModelEvaluation.render();
      }
      try {
        window.dispatchEvent(new CustomEvent("elenest-bookings-updated"));
        window.dispatchEvent(new CustomEvent("elenest-feedback-updated"));
      } catch (e) {}
    });
  }

  function stripOptionalFeedback(rows) {
    return rows.map(function (row) {
      var copy = {};
      Object.keys(row).forEach(function (k) {
        if (k === "sentiment_archived" || k === "sentiment_week_key") return;
        copy[k] = row[k];
      });
      return copy;
    });
  }

  function importFeedbackFiles(urls, done, total) {
    var i = 0;
    function nextFile() {
      if (i >= urls.length) return Promise.resolve();
      var url = urls[i++];
      return fetchJson(url).then(function (rows) {
        return upsertAll("guest_feedback", rows, "comments", done, total)
          .catch(function (err) {
            var msg = String((err && err.message) || err || "");
            if (/sentiment_archived|sentiment_week_key/i.test(msg)) {
              return upsertAll("guest_feedback", stripOptionalFeedback(rows), "comments", done, total);
            }
            throw err;
          })
          .then(function () {
            done += (rows || []).length;
          });
      }).then(nextFile);
    }
    return nextFile();
  }

  function importBookingFiles(urls, total) {
    var done = 0;
    var i = 0;
    function nextFile() {
      if (i >= urls.length) return Promise.resolve();
      var url = urls[i++];
      return fetchJson(url).then(function (rows) {
        return upsertAll("bookings", rows, "bookings", done, total).then(function () {
          done += (rows || []).length;
        });
      }).then(nextFile);
    }
    return nextFile();
  }

  function runImport() {
    if (running) return;
    if (!getClient()) {
      setStatus("Supabase is not connected.", "error");
      return;
    }
    if (!currentUser()) {
      setStatus("Sign in as Admin first, then click Import.", "error");
      return;
    }
    setBusy(true);
    setStatus("Loading past data files…", "progress");
    var ready =
      window.ElenestHistoricalData && typeof window.ElenestHistoricalData.loadBookings === "function"
        ? window.ElenestHistoricalData.loadBookings({ force: true }).catch(function () {
            return null;
          })
        : Promise.resolve(null);
    ready
      .then(function () {
        return fetchJson(resolveManifestUrl());
      })
      .then(function (manifest) {
        var bookingUrls = (manifest && manifest.bookings) || [];
        var feedbackUrls = (manifest && manifest.feedback) || [];
        var base =
          window.ElenestHistoricalData && window.ElenestHistoricalData.getResolvedBase
            ? window.ElenestHistoricalData.getResolvedBase()
            : null;
        if (base) {
          bookingUrls = bookingUrls.map(function (u) {
            var name = String(u || "").split("/").pop();
            return String(base).replace(/\/?$/, "/") + name;
          });
          feedbackUrls = feedbackUrls.map(function (u) {
            var name = String(u || "").split("/").pop();
            return String(base).replace(/\/?$/, "/") + name;
          });
        }
        var bookingTotal = bookingUrls.length * 500;
        var feedbackTotal = feedbackUrls.length * 500;
        return importBookingFiles(bookingUrls, bookingTotal).then(function () {
          return importFeedbackFiles(feedbackUrls, 0, feedbackTotal);
        });
      })
      .then(function () {
        setStatus("Saved. Refreshing analytics…", "progress");
        return refreshAfterImport();
      })
      .then(function () {
        setBusy(false);
        setStatus("Done. 3,000 past bookings and comments are in analytics.", "ok");
      })
      .catch(function (err) {
        setBusy(false);
        var msg = String((err && err.message) || err || "Import failed");
        if (/row-level security|not authorized|42501/i.test(msg)) {
          msg = "Sign in as Admin, then try Import again.";
        }
        setStatus(msg, "error");
      });
  }

  function bind() {
    var btn = $("adminHistoricalImportBtn");
    if (!btn || btn.getAttribute("data-bound") === "1") return;
    btn.setAttribute("data-bound", "1");
    btn.addEventListener("click", runImport);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
