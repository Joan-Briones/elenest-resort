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

  function fmtPHP(n) {
    var v = Number(n);
    if (isNaN(v)) return "₱0";
    return "₱" + Math.round(v).toLocaleString();
  }

  function capacityLabel(r) {
    var UA = window.ElenestUnitAvailability;
    if (UA && typeof UA.formatCapacityLabel === "function") {
      return UA.formatCapacityLabel(r);
    }
    var t = String((r && r.type) || "room");
    var kind = String((r && r.roomKind) || "").toLowerCase();
    if (t === "cottage") return "Up to 20 pax";
    if (t === "hall") return "60–150 pax";
    if (kind === "big") return "Up to 15 pax";
    return "Up to 4 pax";
  }

  var SMALL_ROOM_PHOTOS = [
    "../Images/small-room-bed.jpg",
    "../Images/small-room-bath.jpg",
    "../Images/small-room-tv.jpg"
  ];

  var BIG_ROOM_1_PHOTOS = [
    "../Images/big-room-1-bed.jpg",
    "../Images/big-room-1-living-tv.jpg",
    "../Images/big-room-1-living-sofa.jpg",
    "../Images/big-room-1-kitchen.jpg",
    "../Images/big-room-1-bath.jpg"
  ];

  var BIG_ROOM_2_PHOTOS = [
    "../Images/big-room-2-beds.jpg",
    "../Images/big-room-2-living-sofa.jpg",
    "../Images/big-room-2-tv.jpg",
    "../Images/big-room-2-bath.jpg"
  ];

  function isSmallRoom(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    var kind = String(r.roomKind || "").toLowerCase();
    if (kind === "small") return true;
    if (kind === "big") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase();
    return id.indexOf("small-room") === 0 || name.indexOf("small room") === 0;
  }

  function isFirstBigRoom(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-1") return true;
    return name === "family room 1" || name === "big room 1";
  }

  function isSecondBigRoom(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    var id = String(r.id || "").toLowerCase();
    var name = String(r.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-2") return true;
    return name === "family room 2" || name === "big room 2";
  }

  function facilityImages(r) {
    if (isFirstBigRoom(r)) return BIG_ROOM_1_PHOTOS.slice();
    if (isSecondBigRoom(r)) return BIG_ROOM_2_PHOTOS.slice();
    if (isSmallRoom(r)) return SMALL_ROOM_PHOTOS.slice();
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilityImages === "function") {
      var fromStore = S.getFacilityImages(r);
      if (fromStore.length) return fromStore;
    }
    var list = [];
    if (r && Array.isArray(r.images)) {
      r.images.forEach(function (src) {
        var s = String(src || "").trim();
        if (s && list.indexOf(s) === -1) list.push(s);
      });
    }
    var cover = r && r.image ? String(r.image).trim() : "";
    if (cover && list.indexOf(cover) === -1) list.unshift(cover);
    if (!list.length) list.push("../Images/room-1.png");
    return list;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSwipeGallery(name, images) {
    var S = window.ElenestContentStore;
    if (S && typeof S.renderFacilitySwipeElement === "function") {
      return S.renderFacilitySwipeElement(name, images).outerHTML;
    }
    var photos = images && images.length ? images : ["../Images/room-1.png"];
    var slides = photos
      .map(function (src, idx) {
        return (
          '<div class="facility-swipe__slide">' +
          '<img src="' +
          escapeHtml(src) +
          '" alt="' +
          escapeHtml(name) +
          " photo " +
          (idx + 1) +
          '" class="room-img">' +
          "</div>"
        );
      })
      .join("");
    var dots =
      photos.length > 1
        ? '<div class="facility-swipe__dots" role="tablist" aria-label="Photos">' +
          photos
            .map(function (_, idx) {
              return (
                '<button type="button" class="facility-swipe__dot' +
                (idx === 0 ? " is-active" : "") +
                '" data-swipe-dot="' +
                idx +
                '" aria-label="Show photo ' +
                (idx + 1) +
                '"></button>'
              );
            })
            .join("") +
          "</div>"
        : "";
    var nav =
      photos.length > 1
        ? '<button type="button" class="facility-swipe__prev" aria-label="Previous photo">‹</button>' +
          '<button type="button" class="facility-swipe__next" aria-label="Next photo">›</button>' +
          '<span class="facility-swipe__count">1 / ' +
          photos.length +
          "</span>"
        : "";
    return (
      '<div class="facility-swipe' +
      (photos.length < 2 ? " facility-swipe--single" : "") +
      '" data-facility-swipe data-facility-name="' +
      escapeHtml(name) +
      '">' +
      '<div class="facility-swipe__viewport">' +
      '<div class="facility-swipe__track">' +
      slides +
      "</div></div>" +
      nav +
      dots +
      "</div>"
    );
  }

  function bindSwipeGalleries(root) {
    if (!root) return;
    var S = window.ElenestContentStore;
    if (S && typeof S.bindFacilitySwipeGalleries === "function") {
      S.bindFacilitySwipeGalleries(root);
      return;
    }
    root.querySelectorAll("[data-facility-swipe]").forEach(function (wrap) {
      if (wrap.getAttribute("data-bound") === "1") return;
      var track = wrap.querySelector(".facility-swipe__track");
      var slides = wrap.querySelectorAll(".facility-swipe__slide");
      if (!track || slides.length < 2) return;
      wrap.setAttribute("data-bound", "1");
      var index = 0;
      var startX = 0;
      var deltaX = 0;
      var dragging = false;

      function goTo(next) {
        index = (next + slides.length) % slides.length;
        track.style.transform = "translateX(" + -index * 100 + "%)";
        wrap.querySelectorAll("[data-swipe-dot]").forEach(function (dot) {
          dot.classList.toggle("is-active", Number(dot.getAttribute("data-swipe-dot")) === index);
        });
        var count = wrap.querySelector(".facility-swipe__count");
        if (count) count.textContent = index + 1 + " / " + slides.length;
      }

      var prev = wrap.querySelector(".facility-swipe__prev");
      var next = wrap.querySelector(".facility-swipe__next");
      if (prev) prev.addEventListener("click", function (e) { e.preventDefault(); goTo(index - 1); });
      if (next) next.addEventListener("click", function (e) { e.preventDefault(); goTo(index + 1); });
      wrap.querySelectorAll("[data-swipe-dot]").forEach(function (dot) {
        dot.addEventListener("click", function () {
          goTo(Number(dot.getAttribute("data-swipe-dot")) || 0);
        });
      });

      function pointerDown(x) {
        dragging = true;
        startX = x;
        deltaX = 0;
        track.style.transition = "none";
      }
      function pointerMove(x) {
        if (!dragging) return;
        deltaX = x - startX;
        var pct = (deltaX / wrap.offsetWidth) * 100;
        track.style.transform = "translateX(" + (-index * 100 + pct) + "%)";
      }
      function pointerUp() {
        if (!dragging) return;
        dragging = false;
        track.style.transition = "";
        if (Math.abs(deltaX) > 40) goTo(deltaX < 0 ? index + 1 : index - 1);
        else goTo(index);
      }

      var viewport = wrap.querySelector(".facility-swipe__viewport");
      if (!viewport) return;
      viewport.addEventListener("touchstart", function (e) {
        if (!e.touches || !e.touches[0]) return;
        pointerDown(e.touches[0].clientX);
      }, { passive: true });
      viewport.addEventListener("touchmove", function (e) {
        if (!e.touches || !e.touches[0]) return;
        pointerMove(e.touches[0].clientX);
      }, { passive: true });
      viewport.addEventListener("touchend", pointerUp);
      viewport.addEventListener("mousedown", function (e) {
        pointerDown(e.clientX);
      });
      window.addEventListener("mousemove", function (e) {
        if (dragging) pointerMove(e.clientX);
      });
      window.addEventListener("mouseup", pointerUp);
    });
  }

  var ROOM_AMENITIES = [
    "Fast Wi-Fi and cable-ready TV",
    "Fresh linens and daily housekeeping",
    "Hot and cold shower",
    "Complimentary bottled water"
  ];

  var COTTAGE_AMENITIES = [
    "Open-air seating near the pool",
    "Shared resort Wi-Fi access",
    "Tables and chairs for groups",
    "Easy access to restrooms and pool deck"
  ];

  var HALL_AMENITIES = [
    "Event-ready floor space for programs",
    "Tables and chairs available on request",
    "Power outlets for sound and lighting",
    "Restroom access for guests"
  ];

  var ROOM_BOOKING_NOTES = [
    "Early check-in is subject to availability.",
    "Peak dates may require advance payment.",
    "Valid government ID is required upon check-in.",
    "Quiet hours typically apply from 10:00 PM to 7:00 AM."
  ];

  var COTTAGE_BOOKING_NOTES = [
    "Cottages are ideal for day-use barkada and family gatherings.",
    "Peak dates may require advance payment.",
    "Group bookings can request customized package rates.",
    "Valid government ID is required upon check-in."
  ];

  var HALL_BOOKING_NOTES = [
    "Event hall capacity depends on your seating and program setup.",
    "Peak dates and weekends may require a confirmation deposit.",
    "Inquire early for weddings, debuts, and corporate events.",
    "Outside catering rules may apply — ask when you inquire."
  ];

  var facilityCatalogById = {};

  function amenitiesForType(type) {
    var t = String(type || "room");
    if (t === "cottage") return COTTAGE_AMENITIES.slice();
    if (t === "hall") return HALL_AMENITIES.slice();
    return ROOM_AMENITIES.slice();
  }

  function bookingNotesForType(type) {
    var t = String(type || "room");
    if (t === "cottage") return COTTAGE_BOOKING_NOTES.slice();
    if (t === "hall") return HALL_BOOKING_NOTES.slice();
    return ROOM_BOOKING_NOTES.slice();
  }

  function amenitiesHtml(type) {
    var items = amenitiesForType(type);
    if (!items.length) return "";
    return (
      '<div class="facility-card__amenities">' +
      "<h4>Amenities</h4>" +
      '<ul class="facility-card__amenities-list">' +
      items
        .slice(0, 3)
        .map(function (item) {
          return "<li>" + escapeHtml(item) + "</li>";
        })
        .join("") +
      "</ul></div>"
    );
  }

  function listHtml(items, className) {
    return (
      '<ul class="' +
      className +
      '">' +
      (items || [])
        .map(function (item) {
          return "<li>" + escapeHtml(item) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function ensureFacilityDetailModal() {
    var existing = document.getElementById("facilityDetailOverlay");
    if (existing) {
      if (existing.getAttribute("data-fac-ui") === "resort4") return existing;
      existing.remove();
    }
    var overlay = document.createElement("div");
    overlay.id = "facilityDetailOverlay";
    overlay.className = "facility-detail-overlay";
    overlay.setAttribute("data-fac-ui", "resort4");
    overlay.setAttribute("hidden", "");
    overlay.innerHTML =
      '<div class="facility-detail-modal" role="dialog" aria-modal="true" aria-labelledby="facilityDetailTitle">' +
      '<button type="button" class="facility-detail-modal__close" id="facilityDetailClose" aria-label="Close facility details">&times;</button>' +
      '<div class="facility-detail-modal__hero">' +
      '<div class="facility-detail-modal__media" id="facilityDetailMedia"></div>' +
      "</div>" +
      '<div class="facility-detail-modal__body">' +
      '<div class="facility-detail-modal__intro">' +
      '<div class="facility-detail-modal__intro-top">' +
      '<div class="facility-detail-modal__intro-copy">' +
      '<p class="facility-detail-modal__eyebrow" id="facilityDetailType"></p>' +
      '<h2 class="facility-detail-modal__title" id="facilityDetailTitle"></h2>' +
      '<div class="facility-detail-modal__meta-row" id="facilityDetailMeta"></div>' +
      '<p class="facility-detail-modal__desc" id="facilityDetailDesc"></p>' +
      "</div>" +
      '<div class="facility-detail-modal__price-block" id="facilityDetailPrice"></div>' +
      "</div>" +
      "</div>" +
      '<div class="facility-detail-modal__panels">' +
      '<section class="facility-detail-modal__panel facility-detail-modal__panel--amenities">' +
      '<div class="facility-detail-modal__panel-head">' +
      '<span class="facility-detail-modal__panel-kicker">Comfort</span>' +
      "<h3>Amenities</h3>" +
      '<p class="facility-detail-modal__panel-sub">Included with your stay</p>' +
      "</div>" +
      '<div id="facilityDetailAmenities"></div>' +
      "</section>" +
      '<section class="facility-detail-modal__panel facility-detail-modal__panel--notes">' +
      '<div class="facility-detail-modal__panel-head">' +
      '<span class="facility-detail-modal__panel-kicker">Guest tips</span>' +
      "<h3>Good to know</h3>" +
      '<p class="facility-detail-modal__panel-sub">Before you reserve</p>' +
      "</div>" +
      '<div id="facilityDetailNotes"></div>' +
      "</section>" +
      "</div>" +
      '<div class="facility-detail-modal__actions">' +
      '<div class="facility-detail-modal__actions-copy">' +
      "<strong>Ready to reserve?</strong>" +
      "<span>Secure your preferred date in a few steps.</span>" +
      "</div>" +
      '<div class="facility-detail-modal__actions-btns">' +
      '<a class="btn facility-detail-modal__book" id="facilityDetailBookBtn" href="login.html?next=book.html">Book Now</a>' +
      '<button type="button" class="facility-detail-modal__dismiss" id="facilityDetailCloseBtn">Close</button>' +
      "</div>" +
      "</div>" +
      "</div></div>";
    document.body.appendChild(overlay);

    function close() {
      overlay.classList.remove("is-visible");
      window.setTimeout(function () {
        overlay.setAttribute("hidden", "");
        document.body.classList.remove("facility-detail-open");
      }, 220);
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    var closeX = document.getElementById("facilityDetailClose");
    var closeBtn = document.getElementById("facilityDetailCloseBtn");
    if (closeX) closeX.addEventListener("click", close);
    if (closeBtn) closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hasAttribute("hidden")) close();
    });
    overlay._closeFacilityDetail = close;
    return overlay;
  }

  function typeLabel(type) {
    var t = String(type || "room");
    if (t === "cottage") return "Cottage";
    if (t === "hall") return "Event Hall";
    return "Guest Room";
  }

  function typeEyebrow(type) {
    var t = String(type || "room");
    if (t === "cottage") return "Cottages";
    if (t === "hall") return "Event Spaces";
    return "Rooms & Suites";
  }

  function openFacilityDetail(facilityId, ctaHref, ctaText) {
    var r = facilityCatalogById[String(facilityId || "")];
    if (!r) return;
    var overlay = ensureFacilityDetailModal();
    var photos = facilityImages(r);
    if (isBigRoom(r)) {
      var id = String(r.id || "").toLowerCase();
      if (id === "big-room-1" || isFirstBigRoom(r)) photos = BIG_ROOM_1_PHOTOS.slice();
      else if (id === "big-room-2" || isSecondBigRoom(r)) photos = BIG_ROOM_2_PHOTOS.slice();
    }
    var name = String(r.name || "Facility");
    var unit =
      r.priceUnit === "day" ? "per day" : r.priceUnit === "event" ? "per event" : "per night";
    var media = document.getElementById("facilityDetailMedia");
    var title = document.getElementById("facilityDetailTitle");
    var typeEl = document.getElementById("facilityDetailType");
    var priceEl = document.getElementById("facilityDetailPrice");
    var meta = document.getElementById("facilityDetailMeta");
    var desc = document.getElementById("facilityDetailDesc");
    var amenitiesHost = document.getElementById("facilityDetailAmenities");
    var notesHost = document.getElementById("facilityDetailNotes");
    var bookBtn = document.getElementById("facilityDetailBookBtn");

    if (media) {
      media.innerHTML = renderSwipeGallery(name, photos);
      bindSwipeGalleries(media);
    }
    if (typeEl) typeEl.textContent = typeEyebrow(r.type);
    if (title) title.textContent = name;
    if (priceEl) {
      priceEl.innerHTML =
        '<span class="facility-detail-modal__price">' +
        escapeHtml(fmtPHP(r.price)) +
        "</span>" +
        '<span class="facility-detail-modal__price-unit">' +
        escapeHtml(unit) +
        "</span>";
    }
    if (meta) {
      meta.innerHTML =
        '<span class="facility-detail-meta-item">' +
        '<span class="facility-detail-meta-item__label">Capacity</span>' +
        '<span class="facility-detail-meta-item__value">' +
        escapeHtml(capacityLabel(r)) +
        "</span></span>" +
        '<span class="facility-detail-meta-item">' +
        '<span class="facility-detail-meta-item__label">Type</span>' +
        '<span class="facility-detail-meta-item__value">' +
        escapeHtml(typeLabel(r.type)) +
        "</span></span>";
    }
    if (desc) desc.textContent = r.description || "Details coming soon.";
    if (amenitiesHost) {
      amenitiesHost.innerHTML = listHtml(
        amenitiesForType(r.type),
        "facility-detail-modal__amenity-grid"
      );
    }
    if (notesHost) {
      notesHost.innerHTML = listHtml(bookingNotesForType(r.type), "facility-detail-modal__notes-list");
    }
    if (bookBtn) {
      bookBtn.href = ctaHref || "login.html?next=book.html";
      bookBtn.textContent = ctaText || "Book Now";
    }

    overlay.removeAttribute("hidden");
    document.body.classList.add("facility-detail-open");
    window.requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });
    var closeX = document.getElementById("facilityDetailClose");
    if (closeX) closeX.focus();
  }

  function isBigRoom(r) {
    if (!r || String(r.type || "room") !== "room") return false;
    if (isSmallRoom(r)) return false;
    var kind = String(r.roomKind || "").toLowerCase();
    if (kind === "big") return true;
    var name = String(r.name || "").toLowerCase();
    return name.indexOf("family room") === 0 || name.indexOf("big room") === 0;
  }

  function renderCards(host, list, ctaHref, ctaText) {
    if (!host) return;
    var bigRoomIndex = 0;
    host.innerHTML = list
      .map(function (r) {
        var photos = facilityImages(r);
        if (isBigRoom(r)) {
          bigRoomIndex += 1;
          if (bigRoomIndex === 1) photos = BIG_ROOM_1_PHOTOS.slice();
          else if (bigRoomIndex === 2) photos = BIG_ROOM_2_PHOTOS.slice();
        }
        var unit =
          r.priceUnit === "day" ? "per day" : r.priceUnit === "event" ? "per event" : "per night";
        var cap = capacityLabel(r);
        var name = String(r.name || "Facility");
        var fid = String(r.id || name);
        facilityCatalogById[fid] = r;
        return (
          '<article class="card facility-card" data-facility-id="' +
          escapeHtml(fid) +
          '">' +
          renderSwipeGallery(name, photos) +
          "<h3>" +
          escapeHtml(name) +
          "</h3>" +
          '<p class="facility-card__capacity"><strong>Capacity:</strong> ' +
          cap +
          "</p>" +
          "<p><strong>" +
          fmtPHP(r.price) +
          " " +
          unit +
          "</strong> — " +
          escapeHtml(r.description || "") +
          "</p>" +
          amenitiesHtml(r.type) +
          '<div class="facility-card__actions">' +
          '<a class="btn facility-card__book-btn" href="' +
          escapeHtml(ctaHref) +
          '">' +
          escapeHtml(ctaText) +
          "</a>" +
          '<button type="button" class="btn btn--outline facility-card__view-btn" data-facility-view="' +
          escapeHtml(fid) +
          '" data-facility-cta-href="' +
          escapeHtml(ctaHref) +
          '" data-facility-cta-text="' +
          escapeHtml(ctaText) +
          '">View</button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
    bindSwipeGalleries(host);
    bindFacilityViewButtons(host);
  }

  function bindFacilityViewButtons(root) {
    if (!root) return;
    root.querySelectorAll("[data-facility-view]").forEach(function (btn) {
      if (btn.getAttribute("data-bound") === "1") return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openFacilityDetail(
          btn.getAttribute("data-facility-view"),
          btn.getAttribute("data-facility-cta-href"),
          btn.getAttribute("data-facility-cta-text")
        );
      });
    });
  }

  function showFacilityTab(key) {
    var tabs = document.querySelectorAll("[data-facility-tab]");
    var panels = document.querySelectorAll("[data-facility-panel]");
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-facility-tab") === key;
      tab.classList.toggle("facilities-tab--active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach(function (panel) {
      var on = panel.getAttribute("data-facility-panel") === key;
      panel.hidden = !on;
    });
  }

  function bindTabs() {
    var nav = document.querySelector(".facilities-tabs");
    if (!nav || nav.getAttribute("data-bound") === "1") return;
    nav.setAttribute("data-bound", "1");
    nav.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-facility-tab]") : null;
      if (!btn) return;
      showFacilityTab(String(btn.getAttribute("data-facility-tab") || "rooms"));
    });
  }

  function render() {
    withPreservedScroll(function () {
    var S = window.ElenestContentStore;
    var catalog = S ? S.getFacilities() : [];
    var roomGrid = document.getElementById("facilityRoomsGrid");
    var cottageGrid = document.getElementById("facilityCottagesGrid");
    var hallGrid = document.getElementById("facilityHallsGrid");
    if (!roomGrid || !cottageGrid || !hallGrid) return;

    var roomList = catalog.filter(function (item) {
      return String(item.type || "room") === "room";
    });
    var cottageList = catalog.filter(function (item) {
      return String(item.type || "") === "cottage";
    });
    var hallList = catalog.filter(function (item) {
      return String(item.type || "") === "hall";
    });

    renderCards(roomGrid, roomList, "login.html?next=book.html", "Book Now");
    renderCards(cottageGrid, cottageList, "login.html?next=book.html", "Book Now");
    renderCards(hallGrid, hallList, "contact.html", "Inquire Now");
    bindTabs();
    });
  }

  render();
  (window.ElenestContentStore && window.ElenestContentStore.ready
    ? window.ElenestContentStore.ready
    : Promise.resolve()
  ).then(render);
  window.addEventListener("elenest-content-updated", render);
})();
