/**
 * Shared historical JSON loader for InfinityFree and local hosts.
 * Tries several public path candidates, validates JSON (rejects HTML error pages),
 * and rewrites manifest chunk URLs to match the working base.
 */
(function (global) {
  "use strict";

  var MANIFEST_NAME = "historical-manifest.json";
  var cacheByKind = {};
  var inflightByKind = {};
  var lastError = null;
  var resolvedBase = null;

  function pageDir() {
    try {
      var path = String((global.location && global.location.pathname) || "/");
      var i = path.lastIndexOf("/");
      return i >= 0 ? path.slice(0, i + 1) : "/";
    } catch (e) {
      return "/";
    }
  }

  function origin() {
    try {
      return String((global.location && global.location.origin) || "");
    } catch (e2) {
      return "";
    }
  }

  /** Candidate bases that can resolve to the /data folder on common layouts. */
  function candidateBases() {
    var o = origin();
    var dir = pageDir();
    var bases = [];
    function add(b) {
      if (!b) return;
      var s = String(b);
      if (s.slice(-1) !== "/") s += "/";
      if (bases.indexOf(s) === -1) bases.push(s);
    }
    // Relative to html/*.html → ../data/
    add("../data/");
    add("./data/");
    add("data/");
    // Site-root absolute
    add("/data/");
    if (o) {
      add(o + "/data/");
      // If app lives under /html/, data is sibling
      if (/\/html\/?$/i.test(dir.replace(/\/[^/]*$/, "/")) || /\/html\//i.test(dir)) {
        add(o + dir.replace(/\/html\/.*$/i, "/data/"));
        add(dir.replace(/\/html\/[^/]*$/i, "/data/"));
      }
      add(o + dir + "../data/");
      add(o + dir + "data/");
    }
    // XAMPP project folder layouts
    if (/\/Elenest_Resort\//i.test(dir) || /\/elenest_resort\//i.test(dir)) {
      add(dir.replace(/\/html\/.*$/i, "/data/"));
      add("/Elenest_Resort/data/");
    }
    return bases;
  }

  function joinUrl(base, name) {
    var b = String(base || "");
    var n = String(name || "").replace(/^\.\//, "");
    if (/^https?:\/\//i.test(n) || n.charAt(0) === "/") return n;
    if (n.indexOf("../data/") === 0) n = n.slice("../data/".length);
    if (n.indexOf("data/") === 0) n = n.slice("data/".length);
    if (b.slice(-1) !== "/") b += "/";
    return b + n.replace(/^\//, "");
  }

  function isProbablyHtml(text) {
    var t = String(text || "").trim().slice(0, 200).toLowerCase();
    return (
      t.charAt(0) === "<" ||
      t.indexOf("<!doctype") === 0 ||
      t.indexOf("<html") !== -1 ||
      t.indexOf("<body") !== -1
    );
  }

  function fetchJson(url, cacheMode) {
    return fetch(url, { cache: cacheMode || "no-store", credentials: "same-origin" }).then(
      function (res) {
        if (!res.ok) {
          var err = new Error("HTTP " + res.status);
          err.status = res.status;
          err.url = url;
          throw err;
        }
        return res.text().then(function (text) {
          if (isProbablyHtml(text)) {
            var htmlErr = new Error("Host returned HTML instead of JSON");
            htmlErr.url = url;
            throw htmlErr;
          }
          try {
            return JSON.parse(text);
          } catch (parseErr) {
            var bad = new Error("Invalid JSON");
            bad.url = url;
            throw bad;
          }
        });
      }
    );
  }

  function tryManifestBases() {
    var bases = candidateBases();
    var i = 0;
    function next() {
      if (i >= bases.length) {
        return Promise.reject(new Error("HISTORICAL_UNAVAILABLE"));
      }
      var base = bases[i++];
      var url = joinUrl(base, MANIFEST_NAME);
      return fetchJson(url, "no-store")
        .then(function (manifest) {
          if (!manifest || typeof manifest !== "object") {
            throw new Error("Invalid manifest");
          }
          if (!Array.isArray(manifest.bookings) && !Array.isArray(manifest.feedback)) {
            throw new Error("Invalid manifest shape");
          }
          resolvedBase = base;
          return { manifest: manifest, base: base };
        })
        .catch(function () {
          return next();
        });
    }
    return next();
  }

  function rewriteChunkUrl(url, base) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    var name = raw;
    var slash = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
    if (slash >= 0) name = raw.slice(slash + 1);
    return joinUrl(base, name);
  }

  function loadKind(kind, options) {
    options = options || {};
    var force = !!options.force;
    var k = kind === "feedback" ? "feedback" : "bookings";
    if (!force && cacheByKind[k]) {
      return Promise.resolve({ ok: true, rows: cacheByKind[k], base: resolvedBase });
    }
    if (!force && inflightByKind[k]) return inflightByKind[k];

    inflightByKind[k] = tryManifestBases()
      .then(function (pack) {
        var urls = (pack.manifest && pack.manifest[k]) || [];
        if (!urls.length) {
          cacheByKind[k] = [];
          lastError = null;
          return { ok: true, rows: [], base: pack.base };
        }
        return Promise.all(
          urls.map(function (url) {
            var chunkUrl = rewriteChunkUrl(url, pack.base);
            return fetchJson(chunkUrl, "force-cache")
              .then(function (rows) {
                return Array.isArray(rows) ? rows : [];
              })
              .catch(function (err) {
                try {
                  console.warn("[Elenest HistoricalData] chunk failed:", chunkUrl, err);
                } catch (e) {}
                return [];
              });
          })
        ).then(function (parts) {
          var acc = [];
          (parts || []).forEach(function (rows) {
            acc = acc.concat(rows);
          });
          cacheByKind[k] = acc;
          lastError = null;
          return { ok: true, rows: acc, base: pack.base };
        });
      })
      .then(function (result) {
        inflightByKind[k] = null;
        return result;
      })
      .catch(function (err) {
        inflightByKind[k] = null;
        lastError = friendlyUnavailable(err);
        return { ok: false, rows: [], error: lastError, base: null };
      });

    return inflightByKind[k];
  }

  function friendlyUnavailable(err) {
    return {
      code: "HISTORICAL_UNAVAILABLE",
      message:
        "Historical booking data could not be loaded. Please check that the /data folder is available, then try again.",
      detail: err && err.message ? String(err.message) : ""
    };
  }

  function clearCache() {
    cacheByKind = {};
    inflightByKind = {};
    lastError = null;
    resolvedBase = null;
  }

  global.ElenestHistoricalData = {
    loadBookings: function (opts) {
      return loadKind("bookings", opts);
    },
    loadFeedback: function (opts) {
      return loadKind("feedback", opts);
    },
    clearCache: clearCache,
    getLastError: function () {
      return lastError;
    },
    getResolvedBase: function () {
      return resolvedBase;
    },
    friendlyMessage: function () {
      return (
        (lastError && lastError.message) ||
        "Historical booking data could not be loaded. Please try again."
      );
    }
  };
})(typeof window !== "undefined" ? window : this);
