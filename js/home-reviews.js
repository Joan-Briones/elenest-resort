(function () {
  var gridEl = document.getElementById("homeReviewsGrid");
  var summaryEl = document.getElementById("homeReviewsSummary");
  var scoreEl = document.getElementById("homeReviewsScore");
  var starsEl = document.getElementById("homeReviewsStars");
  var countEl = document.getElementById("homeReviewsCount");
  if (!gridEl) return;

  var FEATURED_LIMIT = 3;
  var lastSignature = "";

  function getSupabase() {
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

  function esc(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function guestName(item) {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.displayName === "function") {
      var named = api.displayName(item);
      if (named) return named;
    }
    var stored = String((item && (item.name || item.guest_name)) || "").trim();
    if (!stored || stored.toLowerCase() === "guest") return "Guest";
    return stored;
  }

  function isSkipped(item) {
    if (!item) return true;
    var id = String(item.id || "");
    if (id.indexOf("test-fb-") === 0) return true;
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.isTestFeedback === "function" && api.isTestFeedback(item)) return true;
    if (api && typeof api.isHistoricalFeedback === "function" && api.isHistoricalFeedback(item)) return true;
    var email = String(item.email || item.guest_email || "").toLowerCase();
    if (email.indexOf("@test.elenest.local") !== -1) return true;
    if (email.indexOf("@imported.elenest.local") !== -1) return true;
    if (id.indexOf("past-fb-") === 0) return true;
    return false;
  }

  function normalize(row) {
    if (!row) return null;
    return {
      id: row.id || "",
      name: row.name || row.guest_name || "",
      email: row.email || row.guest_email || "",
      bookingId: row.bookingId || row.booking_id || "",
      stars: row.stars != null ? row.stars : 0,
      comment: String(row.comment || "").replace(/\s+/g, " ").trim(),
      createdAt: row.createdAt || row.created_at || ""
    };
  }

  function starsMarkup(n) {
    var value = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    var html = "";
    var i;
    for (i = 1; i <= 5; i++) {
      html +=
        '<span class="home-reviews__star ' +
        (i <= value ? "is-on" : "is-off") +
        '" aria-hidden="true">★</span>';
    }
    return html;
  }

  function average(list) {
    var rated = (list || []).filter(function (item) {
      return Number(item.stars) > 0;
    });
    if (!rated.length) return 0;
    var sum = rated.reduce(function (total, item) {
      return total + Number(item.stars || 0);
    }, 0);
    return sum / rated.length;
  }

  function cardHtml(item) {
    var name = guestName(item);
    var stars = Number(item.stars) || 0;
    var comment = item.comment || "Shared a stay at Elenest.";
    return (
      '<article class="home-review-card">' +
      '<span class="home-review-card__mark" aria-hidden="true">&ldquo;</span>' +
      '<p class="home-review-card__text">' +
      esc(comment) +
      "</p>" +
      '<div class="home-review-card__foot">' +
      '<p class="home-review-card__stars" aria-label="' +
      esc(stars) +
      ' out of 5 stars">' +
      starsMarkup(stars) +
      "</p>" +
      '<p class="home-review-card__name">' +
      esc(name) +
      "</p>" +
      "</div>" +
      "</article>"
    );
  }

  function render(list) {
    var rows = (list || [])
      .map(normalize)
      .filter(function (item) {
        return item && !isSkipped(item);
      });
    var signature = rows
      .map(function (item) {
        return [item.id, item.stars, item.comment, guestName(item), item.createdAt].join("~");
      })
      .join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;

    var total = rows.length;
    var avg = average(rows);
    if (summaryEl) summaryEl.hidden = total < 1;
    if (scoreEl) {
      scoreEl.textContent = total && avg ? avg.toFixed(1) : "—";
      scoreEl.setAttribute(
        "aria-label",
        total && avg ? "Average rating " + avg.toFixed(1) + " out of 5" : "Average rating unavailable"
      );
    }
    if (starsEl) starsEl.innerHTML = total && avg ? starsMarkup(avg) : "";
    if (countEl) {
      countEl.textContent =
        total === 1 ? "1 guest review" : total + " guest reviews";
    }

    var commented = rows
      .filter(function (item) {
        return item.comment.length > 0;
      })
      .sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
    var featured = [];
    var seenNames = {};
    commented.forEach(function (item) {
      if (featured.length >= FEATURED_LIMIT) return;
      var key = guestName(item).toLowerCase();
      if (seenNames[key]) return;
      seenNames[key] = true;
      featured.push(item);
    });
    commented.forEach(function (item) {
      if (featured.length >= FEATURED_LIMIT) return;
      if (featured.indexOf(item) !== -1) return;
      featured.push(item);
    });

    if (!featured.length) {
      gridEl.innerHTML =
        '<p class="home-reviews__empty">Guest reviews will appear here after completed stays.</p>';
      return;
    }
    gridEl.innerHTML = featured.map(cardHtml).join("");
  }

  function fromApi() {
    var api = window.ElenestGuestFeedback;
    var list = [];
    if (api && typeof api.listLive === "function") list = api.listLive();
    else if (api && typeof api.listAll === "function") list = api.listAll();
    return list || [];
  }

  function fetchRemote() {
    var sb = getSupabase();
    if (!sb || typeof sb.from !== "function") return Promise.resolve([]);

    function fetchPage(from, pageSize, acc) {
      return sb
        .from("guest_feedback")
        .select("id, guest_name, guest_email, booking_id, stars, comment, created_at")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1)
        .then(function (res) {
          if (res.error) throw res.error;
          var batch = res.data || [];
          var all = acc.concat(batch);
          if (batch.length === pageSize) return fetchPage(from + pageSize, pageSize, all);
          return all;
        });
    }

    return fetchPage(0, 1000, []);
  }

  function mergeLists(remote, local) {
    var byId = {};
    var extra = [];
    (remote || []).concat(local || []).forEach(function (item) {
      if (!item) return;
      var id = String(item.id || "");
      if (!id) {
        extra.push(item);
        return;
      }
      byId[id] = Object.assign({}, byId[id] || {}, item);
    });
    return Object.keys(byId)
      .map(function (id) {
        return byId[id];
      })
      .concat(extra);
  }

  function load() {
    return fetchRemote()
      .then(function (rows) {
        render(mergeLists(rows, fromApi()));
      })
      .catch(function () {
        render(fromApi());
      });
  }

  load();
  (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready
    ? window.ElenestGuestFeedback.ready
    : Promise.resolve()
  ).then(load);

  window.addEventListener("elenest-feedback-updated", load);
  window.addEventListener("elenest-review-names-updated", function () {
    lastSignature = "";
    load();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    load();
  });
  setInterval(function () {
    if (typeof document !== "undefined" && document.hidden) return;
    load();
  }, 15000);
})();
