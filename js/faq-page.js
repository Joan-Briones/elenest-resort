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

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var lastSig = "";

  function render() {
    withPreservedScroll(function () {
    var S = window.ElenestContentStore;
    var host = document.getElementById("faqListHost");
    if (!host) return;

    var list = S && typeof S.getFaqs === "function" ? S.getFaqs() : [];
    var sig = JSON.stringify(list.map(function (item) {
      return [item.id, item.question, item.answer, item.sortOrder, item.ctaLabel, item.ctaHref];
    }));
    if (sig === lastSig) return;
    lastSig = sig;
    if (!list.length) {
      host.innerHTML = '<p class="faq-list__empty">No FAQs are available yet. Please check back soon.</p>';
      return;
    }

    host.innerHTML = list
      .map(function (item) {
        var cta =
          item.ctaLabel && item.ctaHref
            ? '<p class="faq-item__cta"><a class="btn" href="' + esc(item.ctaHref) + '">' + esc(item.ctaLabel) + "</a></p>"
            : "";
        return (
          '<details class="faq-item">' +
          '<summary class="faq-item__question">' +
          '<span class="faq-item__q-text">' +
          esc(item.question) +
          "</span>" +
          '<span class="faq-item__icon" aria-hidden="true"></span>' +
          "</summary>" +
          '<div class="faq-item__answer">' +
          "<p>" +
          esc(item.answer) +
          "</p>" +
          cta +
          "</div>" +
          "</details>"
        );
      })
      .join("");
    });
  }

  render();
  (window.ElenestContentStore && window.ElenestContentStore.ready
    ? window.ElenestContentStore.ready
    : Promise.resolve()
  ).then(render);
  window.addEventListener("elenest-content-updated", render);
})();
