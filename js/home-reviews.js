(function () {
  var avgEl = document.getElementById("homeKpiAvgRating");
  var recEl = document.getElementById("homeKpiRecommendRate");
  var countEl = document.getElementById("homeKpiCount");
  if (!avgEl && !recEl && !countEl) return;

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

  function avg(list) {
    var withStars = (list || []).filter(function (f) {
      return Number(f.stars) > 0;
    });
    if (!withStars.length) return 0;
    var sum = withStars.reduce(function (a, c) {
      return a + Number(c.stars || 0);
    }, 0);
    return sum / withStars.length;
  }

  function isRecommendable(f) {
    var raw = String((f && (f.sentiment || f.sentimentLabel)) || "")
      .trim()
      .toLowerCase();
    if (/^(pos|positive)\b/.test(raw) || raw === "pos") return true;
    return Number(f && f.stars) >= 4;
  }

  function computeKpis(list) {
    var rows = list || [];
    var total = rows.length;
    var a = avg(rows);
    var recommend = total
      ? Math.round((rows.filter(isRecommendable).length / total) * 100)
      : 0;
    return { average: a, recommend: recommend, total: total };
  }

  function applyKpis(kpis) {
    var total = Number(kpis && kpis.total) || 0;
    var a = Number(kpis && kpis.average) || 0;
    var recommend = Number(kpis && kpis.recommend) || 0;
    if (avgEl) avgEl.textContent = total && a ? a.toFixed(1) + "/5" : "—";
    if (recEl) recEl.textContent = total ? recommend + "%" : "—";
    if (countEl) countEl.textContent = String(total);
  }

  function getAllFeedback() {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.listAll === "function") return api.listAll();
    if (api && typeof api.listLive === "function") return api.listLive();
    return [];
  }

  function loadKpis() {
    var api = window.ElenestGuestFeedback;
    var sb = getSupabase();

    function applyFromLists() {
      var kpis = computeKpis(getAllFeedback());
      applyKpis(kpis);
      return kpis;
    }

    var histPromise =
      api && typeof api.ensureHistoricalLoaded === "function"
        ? Promise.resolve(api.ensureHistoricalLoaded())
        : Promise.resolve();

    return histPromise
      .then(function () {
        applyFromLists();
        if (!sb || typeof sb.from !== "function") return applyFromLists();

        function fetchPage(from, pageSize, acc) {
          return sb
            .from("guest_feedback")
            .select("id, stars, sentiment")
            .order("created_at", { ascending: false })
            .range(from, from + pageSize - 1)
            .then(function (res) {
              if (res.error) throw res.error;
              var rows = res.data || [];
              var all = acc.concat(rows);
              if (rows.length === pageSize) {
                return fetchPage(from + pageSize, pageSize, all);
              }
              return all;
            });
        }

        return fetchPage(0, 1000, []).then(function (rows) {
          var byId = {};
          (rows || []).forEach(function (row) {
            var id = String(row.id || "");
            if (!id) return;
            byId[id] = {
              stars: row.stars != null ? row.stars : 0,
              sentiment: row.sentiment || ""
            };
          });
          (getAllFeedback() || []).forEach(function (item) {
            var id = String(item.id || "");
            if (!id || byId[id]) return;
            byId[id] = {
              stars: item.stars != null ? item.stars : 0,
              sentiment: item.sentiment || ""
            };
          });
          var mapped = Object.keys(byId).map(function (id) {
            return byId[id];
          });
          var kpis = computeKpis(mapped);
          applyKpis(kpis);
          return kpis;
        });
      })
      .catch(function () {
        return applyFromLists();
      });
  }

  loadKpis();
  (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready
    ? window.ElenestGuestFeedback.ready
    : Promise.resolve()
  ).then(loadKpis);

  window.addEventListener("elenest-feedback-updated", loadKpis);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    loadKpis();
  });
  setInterval(function () {
    if (typeof document !== "undefined" && document.hidden) return;
    loadKpis();
  }, 15000);
})();
