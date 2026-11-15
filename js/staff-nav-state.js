(function (window, document) {
  // One parent/child active state for Admin, Manager, and Reception.
  // The current hash (or the section id a dashboard passes in) decides which
  // top-level item or submenu is current. The submenu's parent stays selected
  // and expanded; every other parent is cleared.
  var SIDEBAR_BP = 900;
  var ALIASES = {
    "section-analytics": "section-reports",
    "section-bookings": "section-payments"
  };

  function sectionIdFromHref(href) {
    var id = String(href || "");
    var hashAt = id.indexOf("#");
    if (hashAt >= 0) id = id.slice(hashAt + 1);
    var q = id.indexOf("?");
    if (q >= 0) id = id.slice(0, q);
    var amp = id.indexOf("&");
    if (amp >= 0) id = id.slice(0, amp);
    return id;
  }

  function navRoot() {
    if (!document.body || !document.body.classList.contains("staff-app")) return null;
    return document.querySelector("body.staff-app > header") || document.querySelector("header");
  }

  function sectionLinks(root) {
    return root.querySelectorAll('#menulist a[href*="#section-"]');
  }

  function hasLink(root, sectionId) {
    var links = sectionLinks(root);
    for (var i = 0; i < links.length; i++) {
      if (sectionIdFromHref(links[i].getAttribute("href") || "") === sectionId) return true;
    }
    return false;
  }

  function resolveSectionId(sectionId, root) {
    var id = sectionIdFromHref(sectionId);
    if (!id || !root) return id;
    if (hasLink(root, id)) return id;
    var alias = ALIASES[id];
    if (alias && hasLink(root, alias)) return alias;
    return id;
  }

  function sync(sectionId) {
    var root = navRoot();
    if (!root) return "";
    var target = resolveSectionId(sectionId, root);
    if (!target) return "";

    var matchedParent = null;
    var links = sectionLinks(root);
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var on = sectionIdFromHref(link.getAttribute("href") || "") === target;
      link.classList.toggle("active", on);
      if (on) {
        link.setAttribute("aria-current", "page");
        var parent = link.closest(".admin-nav-dropdown");
        if (parent) matchedParent = parent;
      } else {
        link.removeAttribute("aria-current");
      }
    }

    var dropdowns = root.querySelectorAll(".admin-nav-dropdown");
    for (var d = 0; d < dropdowns.length; d++) {
      var dropdown = dropdowns[d];
      var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
      var owns = dropdown === matchedParent;
      if (toggle) toggle.classList.toggle("active", owns);
      dropdown.classList.toggle("is-open", owns);
      if (toggle) toggle.setAttribute("aria-expanded", owns ? "true" : "false");
    }

    return target;
  }

  function closeInactive(exceptDropdown) {
    var root = navRoot();
    if (!root) return;
    var open = root.querySelectorAll(".admin-nav-dropdown.is-open");
    for (var i = 0; i < open.length; i++) {
      var dropdown = open[i];
      if (exceptDropdown && dropdown === exceptDropdown) continue;
      var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
      if (toggle && toggle.classList.contains("active")) continue;
      dropdown.classList.remove("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
  }

  function isMobileNav() {
    return window.innerWidth <= SIDEBAR_BP;
  }

  function bootFromLocation() {
    var hash = window.location && window.location.hash ? window.location.hash : "";
    if (hash.indexOf("section-") === -1) return;
    sync(hash);
  }

  window.ElenestStaffNav = {
    SIDEBAR_BP: SIDEBAR_BP,
    sectionIdFromHref: sectionIdFromHref,
    sync: sync,
    closeInactive: closeInactive,
    isMobileNav: isMobileNav
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootFromLocation);
  } else {
    bootFromLocation();
  }

  window.addEventListener("hashchange", function () {
    bootFromLocation();
  });
})(window, document);
