(function () {
  function withPreservedScroll(fn) {
    if (typeof window.ElenestPreserveScroll === "function") return window.ElenestPreserveScroll(fn);
    var x = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var result;
    try {
      result = typeof fn === "function" ? fn() : undefined;
    } finally {
      try { window.scrollTo(x, y); } catch (err) {}
    }
    return result;
  }

  function esc(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function policyIcon(p) {
    if (String(p.kind || "").toLowerCase() === "pool") return "fa-solid fa-person-swimming";
    var title = String(p.title || "").toLowerCase();
    if (/check-in|check-out|check in|check out/.test(title)) return "fa-solid fa-key";
    if (/reservation|payment/.test(title)) return "fa-solid fa-credit-card";
    if (/pool|facilit/.test(title)) return "fa-solid fa-person-swimming";
    if (/food|beverage|drink/.test(title)) return "fa-solid fa-utensils";
    if (/quiet|conduct|noise/.test(title)) return "fa-solid fa-volume-off";
    if (/pet|animal/.test(title)) return "fa-solid fa-paw";
    return "fa-solid fa-clipboard-list";
  }

  function renderPolicies(list) {
    var policyGrid = document.getElementById("policyCardsGrid");
    if (!policyGrid || !list.length) return;
    policyGrid.innerHTML = list.map(function (p) {
      return (
        '<article class="card policy-card policy-card--managed">' +
        '<div class="policy-card__icon-wrap" aria-hidden="true"><i class="' + policyIcon(p) + '"></i></div>' +
        "<h3>" + esc(p.title || "Policy") + "</h3>" +
        "<p>" + esc(p.description || "") + "</p>" +
        "</article>"
      );
    }).join("");
  }

  function render() {
    withPreservedScroll(function () {
    var S = window.ElenestContentStore;
    if (!S) return;
    renderPolicies(S.getPolicies());
    });
  }

  render();
  (window.ElenestContentStore && window.ElenestContentStore.ready
    ? window.ElenestContentStore.ready
    : Promise.resolve()
  ).then(render);
  window.addEventListener("elenest-content-updated", render);
})();
