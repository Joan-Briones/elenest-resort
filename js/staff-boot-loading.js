/**
 * Full-screen loading overlay for admin / manager / reception
 * while auth + dashboard data finish loading.
 */
(function () {
  var OVERLAY_ID = "staffBootLoading";
  var MIN_MS = 180;
  var MAX_MS = 1200;
  var startedAt = Date.now();
  var hidden = false;
  var hideTimer = null;

  function portalTitle() {
    var body = document.body;
    if (!body) return "Staff Portal";
    if (body.classList.contains("admin-app") || body.getAttribute("data-required-role") === "admin") {
      return "Admin Portal";
    }
    var portal = String(body.getAttribute("data-staff-portal") || "").toLowerCase();
    if (portal === "manager") return "Manager Portal";
    if (portal === "reception") return "Reception Desk";
    var role = String(body.getAttribute("data-required-role") || "").toLowerCase();
    if (role === "manager") return "Manager Portal";
    if (role === "receptionist" || role === "reception") return "Reception Desk";
    return "Staff Portal";
  }

  function portalLabel() {
    return portalTitle().toLowerCase();
  }

  function overlayMarkup(title) {
    return (
      '<div class="staff-boot-loading__card" role="status">' +
      '<div class="staff-boot-loading__spinner" aria-hidden="true">' +
      '<span class="staff-boot-loading__ring"></span>' +
      '<span class="staff-boot-loading__ring staff-boot-loading__ring--soft"></span>' +
      "</div>" +
      '<p class="staff-boot-loading__kicker">Elenest Resort</p>' +
      '<p class="staff-boot-loading__title">' +
      title +
      "</p>" +
      '<p class="staff-boot-loading__sub">Preparing your workspace</p>' +
      '<div class="staff-boot-loading__bar" aria-hidden="true"><span></span></div>' +
      "</div>"
    );
  }

  function isStaffPortalPage() {
    var body = document.body;
    if (!body) return false;
    if (body.classList.contains("admin-app")) return true;
    var portal = String(body.getAttribute("data-staff-portal") || "").toLowerCase();
    if (portal === "manager" || portal === "reception") return true;
    var role = String(body.getAttribute("data-required-role") || "").toLowerCase();
    return role === "admin" || role === "manager" || role === "receptionist" || role === "reception";
  }

  function ensureOverlay() {
    var title = portalTitle();
    var el = document.getElementById(OVERLAY_ID);
    if (!document.body) return el || null;
    document.body.classList.add("staff-boot-loading-active");
    if (el) {
      el.classList.add("staff-boot-loading--active");
      el.setAttribute("aria-busy", "true");
      el.setAttribute("aria-label", "Loading " + title);
      el.removeAttribute("aria-hidden");
      el.removeAttribute("hidden");
      if (!el.querySelector(".staff-boot-loading__card") || el.querySelector(".staff-boot-loading__brand")) {
        el.innerHTML = overlayMarkup(title);
      }
      return el;
    }

    el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.className = "staff-boot-loading staff-boot-loading--active";
    el.setAttribute("aria-busy", "true");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Loading " + title);
    el.innerHTML = overlayMarkup(title);
    document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function hide() {
    if (hidden) return;
    hidden = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    var el = document.getElementById(OVERLAY_ID);
    if (document.body) document.body.classList.remove("staff-boot-loading-active");
    if (!el) return;
    el.classList.remove("staff-boot-loading--active");
    el.setAttribute("aria-busy", "false");
    el.setAttribute("aria-hidden", "true");
    window.setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 420);
  }

  function hideAfterMin() {
    var left = Math.max(0, MIN_MS - (Date.now() - startedAt));
    window.setTimeout(hide, left);
  }

  function asSettled(p) {
    if (!p || typeof p.then !== "function") return Promise.resolve();
    return Promise.resolve(p).then(
      function () {},
      function () {}
    );
  }

  function withCap(p, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve();
      }
      window.setTimeout(done, ms);
      asSettled(p).then(done, done);
    });
  }

  function start() {
    if (!isStaffPortalPage() || hidden) return;
    ensureOverlay();

    // Sign-in is the only step worth covering. Bookings, reviews, and messages
    // keep loading after the portal is on screen.
    var authP =
      window.ElenestAuth && window.ElenestAuth.ready
        ? window.ElenestAuth.ready
        : Promise.resolve();
    withCap(authP, 700).then(hideAfterMin);
  }

  window.ElenestStaffBootLoading = {
    hide: hide,
    show: ensureOverlay,
    start: start
  };

  hideTimer = window.setTimeout(hide, MAX_MS);

  function bootWhenReady() {
    // Let sibling scripts finish defining .ready promises.
    window.setTimeout(start, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureOverlay();
      bootWhenReady();
    });
  } else {
    ensureOverlay();
    bootWhenReady();
  }

  window.addEventListener("load", function () {
    if (!hidden) bootWhenReady();
  });
})();
