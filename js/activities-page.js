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

  function typeClass(type) {
    return "activities-card--" + String(type || "other").toLowerCase().replace(/\s+/g, "-");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderCard(item, variant) {
    var card = document.createElement("article");
    var isPast = variant === "past";
    card.className =
      "card activities-card " +
      typeClass(item.type) +
      (isPast ? " activities-card--past" : " activities-card--promo");
    card.setAttribute("role", "listitem");
    var badge = escapeHtml(item.badge || (isPast ? "Past event" : "Promotion"));
    var mediaHtml = "";
    if (!isPast) {
      var imgSrc = item.image || "../Images/gallery-1.png";
      var imgAlt = item.imageAlt || item.title + " at Elenest Resort";
      mediaHtml =
        '<div class="activities-card__media">' +
        '<img class="activities-card__img" src="' +
        escapeHtml(imgSrc) +
        '" alt="' +
        escapeHtml(imgAlt) +
        '" loading="lazy" decoding="async">' +
        '<span class="activities-card__badge">' +
        badge +
        "</span></div>";
    }
    card.innerHTML =
      mediaHtml +
      '<div class="activities-card__body">' +
      (isPast ? '<span class="activities-card__badge activities-card__badge--inline">' + badge + "</span>" : "") +
      '<p class="activities-card__type">' +
      escapeHtml(item.type) +
      "</p>" +
      "<h3 class=\"activities-card__title\">" +
      escapeHtml(item.title) +
      "</h3>" +
      '<p class="activities-card__date">' +
      escapeHtml(item.date) +
      "</p>" +
      '<p class="activities-card__desc">' +
      escapeHtml(item.description) +
      "</p></div>";
    return card;
  }

  function renderList(hostId, items, variant) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = "";
    items.forEach(function (item) {
      host.appendChild(renderCard(item, variant));
    });
  }

  function render() {
    withPreservedScroll(function () {
      var S = window.ElenestContentStore;
      if (!S) return;
      renderList("activitiesPromoHost", S.getActivities(), "promo");
      renderList("activitiesPastHost", S.getEvents(), "past");
    });
  }

  render();
  (window.ElenestContentStore && window.ElenestContentStore.ready
    ? window.ElenestContentStore.ready
    : Promise.resolve()
  ).then(function () {
    render();
  });
  window.addEventListener("elenest-content-updated", render);
})();
