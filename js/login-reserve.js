/**
 * Sign In page — Reserve Your Stay tabs (Calendar + Activities)
 * and activity detail modal with Sign In / Sign Up CTAs.
 */
(function () {
  "use strict";

  var tabButtons = document.querySelectorAll("[data-login-reserve-tab]");
  var panels = document.querySelectorAll("[data-login-reserve-panel]");
  var activitiesHost = document.getElementById("loginReserveActivitiesHost");
  var detailModal = document.getElementById("loginActivityDetailModal");
  var detailBody = document.getElementById("loginActivityDetailBody");
  var detailTitle = document.getElementById("loginActivityDetailTitle");

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showTab(name) {
    tabButtons.forEach(function (btn) {
      var on = btn.getAttribute("data-login-reserve-tab") === name;
      btn.classList.toggle("login-reserve-tab--active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach(function (panel) {
      var on = panel.getAttribute("data-login-reserve-panel") === name;
      if (on) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  }

  function openActivityDetail(item) {
    if (!detailModal || !detailBody) return;
    if (detailTitle) detailTitle.textContent = item.title || "Activity";
    var imgSrc = item.image || "../Images/gallery-1.png";
    var imgAlt = item.imageAlt || item.title || "Activity at Elenest Resort";
    detailBody.innerHTML =
      '<div class="login-activity-detail__media">' +
      '<img src="' +
      escapeHtml(imgSrc) +
      '" alt="' +
      escapeHtml(imgAlt) +
      '" loading="lazy">' +
      "</div>" +
      '<p class="login-activity-detail__meta">' +
      escapeHtml(item.type || "Activity") +
      (item.date ? " · " + escapeHtml(item.date) : "") +
      "</p>" +
      '<p class="login-activity-detail__desc">' +
      escapeHtml(item.description || "Ask our team for the latest schedule and packages.") +
      "</p>" +
      '<div class="login-activity-detail__actions">' +
      '<a class="btn" href="#loginForm">Sign In to book</a>' +
      '<a class="btn btn--outline" href="register.html?next=' +
      encodeURIComponent("book.html") +
      '">Sign Up</a>' +
      "</div>";
    detailModal.hidden = false;
    detailModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("login-activity-detail-open");
  }

  function closeActivityDetail() {
    if (!detailModal) return;
    detailModal.hidden = true;
    detailModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("login-activity-detail-open");
  }

  function renderActivities() {
    if (!activitiesHost) return;
    var S = window.ElenestContentStore;
    var items = S && typeof S.getActivities === "function" ? S.getActivities() : [];
    activitiesHost.innerHTML = "";
    if (!items.length) {
      activitiesHost.innerHTML =
        '<p class="note">Activities will appear here when published by the resort.</p>';
      return;
    }
    items.forEach(function (item) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "login-activity-card";
      card.setAttribute("data-activity-id", item.id || "");
      var badge = escapeHtml(item.badge || "Promotion");
      var imgSrc = item.image || "../Images/gallery-1.png";
      card.innerHTML =
        '<span class="login-activity-card__media">' +
        '<img src="' +
        escapeHtml(imgSrc) +
        '" alt="" loading="lazy">' +
        '<span class="login-activity-card__badge">' +
        badge +
        "</span></span>" +
        '<span class="login-activity-card__body">' +
        '<span class="login-activity-card__type">' +
        escapeHtml(item.type || "Activity") +
        "</span>" +
        '<span class="login-activity-card__title">' +
        escapeHtml(item.title || "Untitled") +
        "</span>" +
        '<span class="login-activity-card__date">' +
        escapeHtml(item.date || "") +
        "</span>" +
        '<span class="login-activity-card__cta">View details</span>' +
        "</span>";
      card.addEventListener("click", function () {
        openActivityDetail(item);
      });
      activitiesHost.appendChild(card);
    });
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      showTab(btn.getAttribute("data-login-reserve-tab") || "calendar");
    });
  });

  if (detailModal) {
    detailModal.querySelectorAll("[data-login-activity-close]").forEach(function (el) {
      el.addEventListener("click", closeActivityDetail);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !detailModal.hidden) closeActivityDetail();
    });
  }

  document.querySelectorAll('a[href="#loginForm"]').forEach(function (link) {
    link.addEventListener("click", function () {
      closeActivityDetail();
    });
  });

  renderActivities();
  if (window.ElenestContentStore && window.ElenestContentStore.ready) {
    window.ElenestContentStore.ready.then(renderActivities);
  }
  window.addEventListener("elenest-content-updated", renderActivities);

  showTab("calendar");
})();
