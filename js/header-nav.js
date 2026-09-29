(function () {
  // Admin has many long nav labels — collapse earlier so links stay usable.
  var MOBILE_BP = document.body && document.body.classList.contains("admin-app") ? 1500 : 1100;
  var menulist = document.getElementById("menulist");
  var toggle = document.getElementById("navMenuToggle");
  if (!menulist) return;

  function isMobileNav() {
    return window.innerWidth <= MOBILE_BP;
  }

  function setToggleState(open) {
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-active", open);
  }

  function closeMenu() {
    menulist.classList.remove("is-open");
    setToggleState(false);
    if (isMobileNav()) menulist.style.maxHeight = "0px";
    else menulist.style.maxHeight = "";
    menulist.querySelectorAll(".admin-nav-dropdown.is-open").forEach(function (dropdown) {
      dropdown.classList.remove("is-open");
      var toggle = dropdown.querySelector(".admin-nav-dropdown-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  }

  function openMenu() {
    menulist.classList.add("is-open");
    setToggleState(true);
    // Cap height so the panel cannot inflate into a huge blank region
    var next = menulist.scrollHeight || 0;
    var cap = Math.round(Math.min(window.innerHeight * 0.7, 520));
    menulist.style.maxHeight = Math.max(0, Math.min(next, cap)) + "px";
  }

  function syncViewport() {
    if (!isMobileNav()) {
      menulist.classList.remove("is-open");
      menulist.style.maxHeight = "";
      setToggleState(false);
      return;
    }
    if (menulist.classList.contains("is-open")) {
      var next = menulist.scrollHeight || 0;
      var cap = Math.round(Math.min(window.innerHeight * 0.7, 520));
      menulist.style.maxHeight = Math.max(0, Math.min(next, cap)) + "px";
    } else {
      menulist.style.maxHeight = "0px";
    }
  }

  function menutoggle() {
    if (!isMobileNav()) return;
    if (menulist.classList.contains("is-open")) closeMenu();
    else openMenu();
  }

  if (toggle) toggle.addEventListener("click", menutoggle);

  menulist.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      if (!isMobileNav()) return;
      var controls = link.getAttribute("aria-controls") || "";
      if (
        link.id === "staffSettingsToggle" ||
        link.id === "adminSettingsToggle" ||
        controls === "staffSettingsMenu" ||
        controls === "adminSettingsMenu"
      ) {
        return;
      }
      closeMenu();
    });
  });

  menulist.querySelectorAll(".admin-nav-dropdown-toggle").forEach(function (toggle) {
    toggle.addEventListener("click", function () {
      if (!isMobileNav()) return;
      var dropdown = toggle.closest(".admin-nav-dropdown");
      if (!dropdown) return;
      var willOpen = !dropdown.classList.contains("is-open");
      menulist.querySelectorAll(".admin-nav-dropdown.is-open").forEach(function (item) {
        if (item !== dropdown) {
          item.classList.remove("is-open");
          var otherToggle = item.querySelector(".admin-nav-dropdown-toggle");
          if (otherToggle) otherToggle.setAttribute("aria-expanded", "false");
        }
      });
      dropdown.classList.toggle("is-open", willOpen);
      toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (menulist.classList.contains("is-open")) {
        var next = menulist.scrollHeight || 0;
        var cap = Math.round(Math.min(window.innerHeight * 0.7, 520));
        menulist.style.maxHeight = Math.max(0, Math.min(next, cap)) + "px";
      }
    });
  });

  window.addEventListener("resize", syncViewport);
  syncViewport();
  window.menutoggle = menutoggle;
})();

(function () {
  var header = document.querySelector("header");
  if (!header) return;

  var display = 0;
  var target = 0;
  var running = false;
  var rafId = 0;
  var lastApplied = -1;
  var REDUCE = false;

  try {
    REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) {}

  function currentScrollY() {
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function range() {
    return window.innerWidth <= 1100 ? 96 : 168;
  }

  function cancelTick() {
    if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    rafId = 0;
    running = false;
  }

  function apply(value) {
    var progress = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
    var scrolled = currentScrollY() > 8;
    if (progress === lastApplied) {
      header.classList.toggle("is-scrolled", scrolled);
      return;
    }
    lastApplied = progress;
    header.style.setProperty("--header-progress", String(progress));
    header.classList.toggle("is-compact", progress >= 0.92);
    header.classList.toggle("is-scrolled", scrolled);
  }

  function tick() {
    rafId = 0;
    if (REDUCE) {
      display = target;
      running = false;
      apply(display);
      return;
    }
    var diff = target - display;
    if (Math.abs(diff) < 0.001) {
      display = target;
      running = false;
      apply(display);
      return;
    }
    display += diff * 0.28;
    apply(display);
    running = true;
    if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(tick);
    else running = false;
  }

  function sync(immediate) {
    var next = Math.min(1, Math.max(0, currentScrollY() / range()));
    if (immediate || REDUCE || Math.abs(next - display) > 0.45) {
      cancelTick();
      target = next;
      display = next;
      apply(display);
      return;
    }
    target = next;
    if (!running) {
      running = true;
      if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(tick);
      else {
        display = target;
        running = false;
        apply(display);
      }
    }
  }

  window.addEventListener("scroll", function () { sync(false); }, { passive: true });
  window.addEventListener("resize", function () { sync(true); });
  window.addEventListener("pageshow", function () { sync(true); });
  window.addEventListener("elenest-content-updated", function () { sync(true); });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { sync(true); });
  }
  window.addEventListener("load", function () { sync(true); });
  sync(true);
})();

(function () {
  // Remember each page's last scroll position across in-site navigation.
  // Instant restore only — no animated scrolling, and no layout/nav changes.
  var STORAGE_PREFIX = "elenest:scroll:";
  var lastX = 0;
  var lastY = 0;
  var restoring = false;
  var owlSavedX = 0;
  var owlSavedY = 0;
  var allowJumpUntil = 0;
  var userTookOver = false;
  var pendingRestore = null;
  var restoreUntil = 0;
  var saveTimer = 0;

  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch (err) {}

  function pageKey() {
    var path = String((window.location && window.location.pathname) || "").replace(/\\/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path.toLowerCase() || "/";
  }

  function storageKey() {
    return STORAGE_PREFIX + pageKey();
  }

  function currentX() {
    return window.pageXOffset || document.documentElement.scrollLeft || 0;
  }

  function currentY() {
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function maxScrollY() {
    var el = document.documentElement;
    var body = document.body;
    var height = Math.max(
      (el && el.scrollHeight) || 0,
      (body && body.scrollHeight) || 0
    );
    return Math.max(0, height - window.innerHeight);
  }

  function applyScroll(x, y) {
    restoring = true;
    try {
      window.scrollTo({ left: x, top: y, behavior: "auto" });
    } catch (err) {
      try {
        window.scrollTo(x, y);
      } catch (err2) {
        try {
          document.documentElement.scrollTop = y;
          document.documentElement.scrollLeft = x;
          if (document.body) {
            document.body.scrollTop = y;
            document.body.scrollLeft = x;
          }
        } catch (err3) {}
      }
    }
    restoring = false;
  }

  function hasIntentionalHash() {
    return String(window.location.hash || "").replace(/^#/, "").length > 0;
  }

  function readStored() {
    try {
      var raw = sessionStorage.getItem(storageKey());
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      var x = Number(data.x);
      var y = Number(data.y);
      if (!isFinite(x)) x = 0;
      if (!isFinite(y)) y = 0;
      return { x: x, y: y };
    } catch (err) {
      return null;
    }
  }

  function writeStored(x, y) {
    try {
      sessionStorage.setItem(storageKey(), JSON.stringify({ x: x, y: y }));
    } catch (err) {}
  }

  function remember() {
    if (restoring) return;
    lastX = currentX();
    lastY = currentY();
    writeStored(lastX, lastY);
  }

  function scheduleSave() {
    if (restoring || saveTimer) return;
    saveTimer = window.setTimeout(function () {
      saveTimer = 0;
      remember();
    }, 50);
  }

  function restoreTo(x, y) {
    applyScroll(x, y);
    lastX = x;
    lastY = y;
  }

  function restoreNow() {
    if (userTookOver) return true;
    if (Date.now() < allowJumpUntil) return false;
    if (hasIntentionalHash()) return true;
    var target = pendingRestore;
    if (!target || (target.x === 0 && target.y === 0)) return true;
    var maxY = maxScrollY();
    if (target.y > maxY + 8 && document.readyState === "loading") return false;
    var y = Math.min(target.y, maxY);
    var x = target.x || 0;
    restoreTo(x, y);
    return y >= target.y - 4 || maxY <= 0;
  }

  function startRestore() {
    if (hasIntentionalHash()) {
      pendingRestore = null;
      return;
    }
    var stored = readStored();
    if (!stored || (stored.x === 0 && stored.y === 0)) {
      pendingRestore = null;
      lastX = currentX();
      lastY = currentY();
      return;
    }
    pendingRestore = stored;
    lastX = stored.x;
    lastY = stored.y;
    userTookOver = false;
    restoreUntil = Date.now() + 2500;
    restoreNow();
  }

  window.ElenestPreserveScroll = function (fn) {
    var x = pendingRestore && !userTookOver ? pendingRestore.x : currentX();
    var y = pendingRestore && !userTookOver ? pendingRestore.y : currentY();
    if (!userTookOver && lastY > y) {
      x = lastX;
      y = lastY;
    }
    var result;
    try {
      result = typeof fn === "function" ? fn() : undefined;
    } finally {
      if (Date.now() >= allowJumpUntil) restoreTo(x, y);
    }
    return result;
  };

  window.addEventListener(
    "scroll",
    function () {
      if (restoring) return;
      var y = currentY();
      if (pendingRestore && !userTookOver && Date.now() < restoreUntil) {
        if (pendingRestore.y > 48 && y < 16) {
          restoreNow();
          return;
        }
        var targetY = Math.min(pendingRestore.y, maxScrollY());
        if (Math.abs(y - targetY) > 80) {
          userTookOver = true;
          pendingRestore = null;
        }
      }
      scheduleSave();
    },
    { passive: true }
  );

  function markUserScroll() {
    if (restoring) return;
    userTookOver = true;
    pendingRestore = null;
  }

  window.addEventListener("wheel", markUserScroll, { passive: true, capture: true });
  window.addEventListener("touchmove", markUserScroll, { passive: true, capture: true });
  window.addEventListener(
    "keydown",
    function (e) {
      var key = e.key || "";
      if (
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "PageUp" ||
        key === "PageDown" ||
        key === "Home" ||
        key === "End" ||
        key === " " ||
        key === "Spacebar"
      ) {
        markUserScroll();
      }
    },
    true
  );

  document.addEventListener(
    "click",
    function (e) {
      var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      remember();
      if (!link) return;
      var href = link.getAttribute("href") || "";
      if (href.charAt(0) === "#" && href.length > 1) allowJumpUntil = Date.now() + 1200;
    },
    true
  );

  window.addEventListener("hashchange", function () {
    allowJumpUntil = Date.now() + 1200;
    userTookOver = true;
    pendingRestore = null;
  });

  window.addEventListener("pagehide", remember);
  window.addEventListener("beforeunload", remember);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") remember();
  });

  function undoJumpToTop(x, y) {
    if (userTookOver) return;
    if (Date.now() < allowJumpUntil) return;
    if (hasIntentionalHash()) return;
    if (y > 48 && currentY() < 16) restoreTo(x, y);
  }

  window.addEventListener("elenest-content-updated", function () {
    var x = pendingRestore && !userTookOver ? pendingRestore.x : lastX;
    var y = pendingRestore && !userTookOver ? pendingRestore.y : lastY;
    restoreNow();
    undoJumpToTop(x, y);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        restoreNow();
        undoJumpToTop(x, y);
      });
    }
  });

  document.addEventListener(
    "focusin",
    function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest(".owl-carousel")) return;
      undoJumpToTop(owlSavedX || lastX, owlSavedY || lastY);
    },
    true
  );

  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      lastX = currentX();
      lastY = currentY();
      writeStored(lastX, lastY);
      return;
    }
    startRestore();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      startRestore();
    });
  }

  window.addEventListener("load", function () {
    restoreNow();
  });

  [50, 150, 300, 600, 1000, 1600, 2200].forEach(function (ms) {
    window.setTimeout(function () {
      if (!userTookOver && Date.now() <= restoreUntil) restoreNow();
    }, ms);
  });
  (function clearPendingWhenDone() {
    window.setTimeout(function () {
      if (Date.now() < restoreUntil) {
        clearPendingWhenDone();
        return;
      }
      if (!userTookOver) pendingRestore = null;
    }, 200);
  })();

  startRestore();

  if (!window.jQuery || !window.jQuery.fn) return;

  window.jQuery(document).on(
    "initialize.owl.carousel refresh.owl.carousel change.owl.carousel translate.owl.carousel",
    function () {
      owlSavedX = currentX();
      owlSavedY = currentY();
    }
  );

  window.jQuery(document).on(
    "initialized.owl.carousel refreshed.owl.carousel changed.owl.carousel translated.owl.carousel",
    function () {
      undoJumpToTop(owlSavedX, owlSavedY);
      if (pendingRestore && !userTookOver && Date.now() <= restoreUntil) restoreNow();
    }
  );
})();
