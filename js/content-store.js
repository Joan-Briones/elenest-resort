/**
 * Centralized informational content for Elenest Resort (Supabase + memory cache + realtime).
 */
(function () {
  var cacheAbout = null;
  var cacheFaqs = null;
  var cacheActivities = null;
  var cacheEvents = null;
  var cacheFacilities = null;
  var cachePolicies = null;
  var cacheGallery = null;
  var aboutSchemaMode = null; // "legacy" (kind/title/body rows) | "json" (id=1 + data jsonb)
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  var realtimeChannel = null;
  var reloadTimer = null;
  var loadDepth = 0;
  var MAX_LOAD_DEPTH = 8;
  var loadToken = 0;
  var ABOUT_SNAP_KEY = "elenest_about_content";
  var FAQ_SNAP_KEY = "elenest_faqs_content";

  function uid() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getClient() {
    return window.ElenestSupabase || null;
  }

  var DEFAULT_ABOUT = {
    heroTitle: "About Elenest Resort",
    heroLead:
      "Elenest Resort is a nature-inspired destination in Mataasnakahoy, Batangas where comfort, warm service, and memorable moments come together for every guest.",
    storyCards: [
      { id: "story", title: "Our Story", body: "Elenest started as a quiet family retreat and grew into a full-service resort that welcomes guests from nearby cities and provinces. We built the property with a focus on fresh air, open spaces, and peaceful surroundings." },
      { id: "mission", title: "Our Mission", body: "To deliver heartfelt hospitality and dependable service, while creating a calm environment where guests can recharge, celebrate milestones, and feel at home." },
      { id: "vision", title: "Our Vision", body: "To become one of Batangas' most trusted and loved resort destinations known for quality accommodations, thoughtful amenities, and genuine Filipino care." }
    ],
    credentialsLead: "Elenest Resort is a duly registered tourism business. We maintain clear permits and standards so guests can book with confidence.",
    credentialCards: [
      { id: "dti", title: "DTI-Registered Business", body: "Legally registered with the Department of Trade and Industry (DTI), operating under compliant business naming and trade regulations.", image: "../Images/about.png", imageAlt: "Elenest Resort property and facilities" },
      { id: "lgu", title: "LGU Business Permit", body: "Valid mayor's / business permit and local clearances for Mataasnakahoy, Batangas, renewed in line with municipal requirements.", image: "../Images/service.png", imageAlt: "Resort service and guest care" },
      { id: "safety", title: "Guest Safety & Standards", body: "Regular upkeep of pools, rooms, and common areas; trained staff; and alignment with local health, safety, and tourism office guidance.", image: "../Images/gallery-1.png", imageAlt: "Pool and amenities at Elenest Resort" }
    ],
    highlights: [
      { id: "love", title: "What Guests Love", body: "Guests choose Elenest for its relaxing atmosphere, clean rooms, and friendly team. Our location gives the perfect balance of convenience and calm.", pills: ["Serene Ambience", "Family Friendly", "Private Events", "Comfortable Rooms"] },
      { id: "why", title: "Why Choose Us", body: "We provide complete stay packages, flexible room options, and responsive guest support from inquiry to checkout. Whether for short breaks or celebrations, we tailor the experience to your needs.", ctaLabel: "Sign In", ctaHref: "login.html" }
    ],
    mapEmbed: "https://maps.google.com/maps?q=Elenest%20Resort%2C%20Mataasnakahoy%2C%20Batangas&t=&z=15&ie=UTF8&iwloc=&output=embed",
    findUsLead: "Visit Elenest Resort at Mataasnakahoy, Batangas. Use the map below for directions and nearby landmarks.",
    homeStats: {
      customers: 2500,
      satisfiedCustomers: 1250
    }
  };

  var DEFAULT_FAQS = [
    { id: "faq1", question: "What time is check-in and check-out?", answer: "Check-in is 2:00 PM and check-out is 12:00 PM.", sortOrder: 1 },
    { id: "faq2", question: "Do you accept walk-in guests?", answer: "Yes, but we recommend booking in advance, especially on weekends.", sortOrder: 2 },
    { id: "faq3", question: "Are pets allowed?", answer: "Please contact us first for our latest pet policy.", sortOrder: 3 },
    { id: "faq4", question: "Do room rates include breakfast?", answer: "Some room packages include breakfast. Please check promotion details.", sortOrder: 4 },
    { id: "faq5", question: "Can we book for private events?", answer: "Yes. We host birthdays, reunions, and corporate gatherings. Contact us for event packages and availability.", sortOrder: 5 },
    { id: "faq6", question: "What payment methods are accepted?", answer: "We accept cash, bank transfer, and selected e-wallet options for reservation and onsite payment.", sortOrder: 6 },
    { id: "faq7", question: "How do we secure a reservation?", answer: "Sign in with your account, then complete your booking details. Our team will confirm availability and reservation steps.", sortOrder: 7, ctaLabel: "Sign In", ctaHref: "login.html" }
  ];

  var DEFAULT_ACTIVITIES = [
    { id: "promo1", type: "Wedding", title: "Garden Wedding Package", date: "Promo — valid through Dec 2026", description: "Say “I do” beside our poolside event hall with floral arch setup, reserved guest cottages, and complimentary welcome drinks for up to 50 guests.", badge: "Promotion", image: "../Images/gallery-2.png", imageAlt: "Poolside event hall set up for a garden wedding at Elenest Resort" },
    { id: "promo2", type: "Birthday", title: "Kids Pool Party Special", date: "Weekends in summer 2026", description: "Celebrate with a private pool area, themed décor, and a function hall for cake-cutting and games. Perfect for debuts and family birthdays.", badge: "Promotion", image: "../Images/blog-s1.png", imageAlt: "Swimming pool area decorated for a birthday celebration" },
    { id: "promo3", type: "Corporate", title: "Team Building Day Tour", date: "Book 15+ participants", description: "Full-day access to resort facilities, air-conditioned meeting space, and catered lunch. Ideal for seminars, retreats, and company outings.", badge: "Promotion", image: "../Images/service.png", imageAlt: "Corporate team building and meeting space at the resort" },
    { id: "promo4", type: "Reunion", title: "Family Reunion Weekend", date: "Multi-room block rates", description: "Reserve multiple couple and big rooms plus cottages for extended family stays. Includes use of the upper hall for your program night.", badge: "Promotion", image: "../Images/gallery-5.png", imageAlt: "Cottages and open-air spaces for a family reunion weekend" }
  ];

  var DEFAULT_EVENTS = [
    { id: "past1", type: "Wedding", title: "Reyes–Santos Nuptials", date: "March 2025", description: "An intimate garden ceremony followed by a reception at the poolside event hall with live acoustic music and candlelit dinner.", badge: "Past event", image: "../Images/blog-2.png", imageAlt: "Wedding reception and celebration at Elenest Resort" },
    { id: "past2", type: "Birthday", title: "Miguel's 7th Birthday", date: "January 2025", description: "A colorful pool-party theme with balloon décor, mascot appearance, and a dedicated cottage area for the celebrant's family.", badge: "Past event", image: "../Images/gallery-1.png", imageAlt: "Colorful birthday party setup with balloons at the resort" },
    { id: "past3", type: "Corporate", title: "Northfield Logistics Annual Planning", date: "November 2024", description: "Two-day corporate retreat using the air-conditioned event hall for workshops and team activities around the resort grounds.", badge: "Past event", image: "../Images/gallery-3.png", imageAlt: "Corporate planning retreat in the resort function area" },
    { id: "past4", type: "Reunion", title: "Del Rosario Clan Grand Reunion", date: "August 2024", description: "Three generations gathered for a weekend stay, talent night at the upper hall, and a heritage photo exhibit in the function area.", badge: "Past event", image: "../Images/gallery-6.png", imageAlt: "Extended family gathered for a grand reunion at the resort" },
    { id: "past5", type: "Celebration", title: "Silver Wedding Anniversary", date: "June 2024", description: "A surprise anniversary dinner for Mr. and Mrs. Villanueva with custom table settings and a slideshow of 25 years together.", badge: "Past event", image: "../Images/gallery-4.png", imageAlt: "Elegant anniversary dinner with custom table settings" },
    { id: "past6", type: "Swimming", title: "Barangay Sports Fest", date: "April 2024", description: "Community swimming competition and day-tour packages for participating teams, with poolside refreshments and awards ceremony.", badge: "Past event", image: "../Images/blog-s2.png", imageAlt: "Community swimming competition and day-tour event at the pool" }
  ];

  function defaultCapacityForFacility(type, roomKind) {
    var t = String(type || "room");
    if (t === "cottage") return { capacity: 20, capacityMin: null };
    if (t === "hall") return { capacity: 150, capacityMin: 60 };
    if (String(roomKind || "").toLowerCase() === "big") return { capacity: 15, capacityMin: null };
    return { capacity: 4, capacityMin: null };
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

  function buildDefaultFacilities() {
    var list = [];
    var n;
    for (n = 1; n <= 8; n++) {
      list.push({
        id: "small-room-" + n,
        type: "room",
        roomKind: "small",
        name: "Small Room " + n,
        price: 2500,
        priceUnit: "night",
        image: SMALL_ROOM_PHOTOS[0],
        images: SMALL_ROOM_PHOTOS.slice(),
        description: "Cozy standard room for up to 4 persons (4 pax), ideal for couples or small groups.",
        capacity: 4,
        capacityMin: null,
        sortOrder: n,
        active: true
      });
    }
    for (n = 1; n <= 2; n++) {
      list.push({
        id: "big-room-" + n,
        type: "room",
        roomKind: "big",
        name: "Family Room " + n,
        price: 7500,
        priceUnit: "night",
        image: n === 1 ? BIG_ROOM_1_PHOTOS[0] : BIG_ROOM_2_PHOTOS[0],
        images: n === 1 ? BIG_ROOM_1_PHOTOS.slice() : BIG_ROOM_2_PHOTOS.slice(),
        description: "Spacious family room for up to 15 persons (15 pax), with more floor area and comfort.",
        capacity: 15,
        capacityMin: null,
        sortOrder: 8 + n,
        active: true
      });
    }
    for (n = 1; n <= 10; n++) {
      list.push({
        id: "cottage-" + n,
        type: "cottage",
        roomKind: "",
        name: "Cottage " + n,
        price: 1000,
        priceUnit: "day",
        image: n % 2 === 0 ? "../Images/gallery-4.png" : "../Images/gallery-5.png",
        description: "Open-air cottage near the pool for up to 20 persons (20 pax) — great for barkada and family day-use.",
        capacity: 20,
        capacityMin: null,
        sortOrder: 10 + n,
        active: true
      });
    }
    list.push(
      { id: "hall-poolside", type: "hall", roomKind: "", name: "Poolside Hall", price: 10000, priceUnit: "event", image: "../Images/gallery-2.png", description: "Event hall for 60–150 persons (60–150 pax) depending on setup — scenic poolside celebrations.", capacity: 150, capacityMin: 60, sortOrder: 21, active: true },
      { id: "hall-upper", type: "hall", roomKind: "", name: "Upper Hall", price: 15000, priceUnit: "event", image: "../Images/gallery-3.png", description: "Event hall for 60–150 persons (60–150 pax) depending on setup — elevated celebrations.", capacity: 150, capacityMin: 60, sortOrder: 22, active: true },
      { id: "hall-function", type: "hall", roomKind: "", name: "New Function Hall", price: 15000, priceUnit: "event", image: "../Images/gallery-1.png", description: "Event hall for 60–150 persons (60–150 pax) depending on setup — weddings and corporate events.", capacity: 150, capacityMin: 60, sortOrder: 23, active: true },
      { id: "hall-ac", type: "hall", roomKind: "", name: "Air-conditioned Hall", price: 8500, priceUnit: "event", image: "../Images/gallery-6.png", description: "Indoor cooled hall for 60–150 persons (60–150 pax) depending on setup — starts at 5 hours.", capacity: 150, capacityMin: 60, sortOrder: 24, active: true }
    );
    return list;
  }

  var DEFAULT_FACILITIES = buildDefaultFacilities();
  var DEFAULT_POLICIES = [
    { id: "pol-checkin", kind: "general", title: "Check-in & check-out", description: "Present a valid government ID at reception. Late checkout may be arranged subject to availability and a modest fee.", image: "../Images/gallery-2.png", sortOrder: 1 },
    { id: "pol-payment", kind: "general", title: "Reservations & payment", description: "A deposit may be required to confirm your dates. Accepted methods include cash and major cards as posted at the front desk.", image: "../Images/gallery-3.png", sortOrder: 2 },
    { id: "pol-pool", kind: "pool", title: "Pool & facilities", description: "Swimming pool hours: 8:00 AM to 10:00 PM only. Children under 12 must have an adult present at the pool deck.", image: "../Images/gallery-1.png", sortOrder: 3 },
    { id: "pol-food", kind: "general", title: "Food & beverage", description: "Outside food and beverages may be limited in certain venues or packages—ask reservations when booking events or catered stays.", image: "../Images/gallery-4.png", sortOrder: 4 },
    { id: "pol-quiet", kind: "general", title: "Quiet hours & conduct", description: "Quiet hours: typically 10:00 PM–7:00 AM. Keep music and gatherings at considerate levels.", image: "../Images/gallery-5.png", sortOrder: 5 },
    { id: "pol-pets", kind: "general", title: "Pets & service animals", description: "Pet policy varies by cottage or room category. Contact us before booking so we can confirm availability, fees, and house rules.", image: "../Images/gallery-6.png", sortOrder: 6 }
  ];

  var DEFAULT_GALLERY = [
    { id: "gal-1", title: "Resort lounge", image: "../Images/gallery-1.png", imageAlt: "Elenest Resort lounge", sortOrder: 1, active: true },
    { id: "gal-2", title: "Poolside view", image: "../Images/gallery-2.png", imageAlt: "Poolside area at Elenest", sortOrder: 2, active: true },
    { id: "gal-3", title: "Ocean suite bath", image: "../Images/gallery-3.png", imageAlt: "Suite bathroom overlooking the water", sortOrder: 3, active: true },
    { id: "gal-4", title: "Living space", image: "../Images/gallery-4.png", imageAlt: "Comfortable living space", sortOrder: 4, active: true },
    { id: "gal-5", title: "Resort exterior", image: "../Images/gallery-5.png", imageAlt: "Elenest Resort exterior", sortOrder: 5, active: true },
    { id: "gal-6", title: "Event hall", image: "../Images/gallery-6.png", imageAlt: "Indoor event hall", sortOrder: 6, active: true }
  ];

  function readLocalStorageJson(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function faqFromRow(row) { return { id: row.id, question: row.question || "", answer: row.answer || "", sortOrder: row.sort_order != null ? row.sort_order : 0, ctaLabel: row.cta_label || "", ctaHref: row.cta_href || "" }; }
  function faqToRow(item) { return { id: item.id, question: item.question || "", answer: item.answer || "", sort_order: item.sortOrder != null ? item.sortOrder : 0, cta_label: item.ctaLabel || "", cta_href: item.ctaHref || "", updated_at: new Date().toISOString() }; }
  function showcaseFromRow(row) { return { id: row.id, type: row.type || "Event", title: row.title || "", date: row.date || "", description: row.description || "", badge: row.badge || "", image: row.image || "", imageAlt: row.image_alt || "" }; }
  function activityToRow(item) { return { id: item.id, type: item.type || "Event", title: item.title || "", date: item.date || "", description: item.description || "", badge: item.badge || "Promotion", category: "promo", image: item.image || "", image_alt: item.imageAlt || "", updated_at: new Date().toISOString() }; }
  function eventToRow(item) { return { id: item.id, type: item.type || "Event", title: item.title || "", date: item.date || "", description: item.description || "", badge: item.badge || "Past event", image: item.image || "", image_alt: item.imageAlt || "", updated_at: new Date().toISOString() }; }
  function parseFacilityImages(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map(function (src) {
          return String(src || "").trim();
        })
        .filter(Boolean);
    }
    if (typeof value === "string") {
      var s = value.trim();
      if (!s) return [];
      if (s.charAt(0) === "[") {
        try {
          return parseFacilityImages(JSON.parse(s));
        } catch (e) {}
      }
      return [s];
    }
    return [];
  }

  function normalizeFacilityImages(item) {
    var list = parseFacilityImages(item && item.images);
    var cover = item && item.image ? String(item.image).trim() : "";
    if (cover && list.indexOf(cover) === -1) list.unshift(cover);
    return list;
  }

  function isSmallRoomFacility(item) {
    if (!item || String(item.type || "room") !== "room") return false;
    var kind = String(item.roomKind || "").toLowerCase();
    if (kind === "small") return true;
    if (kind === "big") return false;
    var id = String(item.id || "").toLowerCase();
    var name = String(item.name || "").toLowerCase();
    return id.indexOf("small-room") === 0 || name.indexOf("small room") === 0;
  }

  function isFirstBigRoomFacility(item) {
    if (!item || String(item.type || "room") !== "room") return false;
    var id = String(item.id || "").toLowerCase();
    var name = String(item.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-1") return true;
    return name === "family room 1" || name === "big room 1";
  }

  function isSecondBigRoomFacility(item) {
    if (!item || String(item.type || "room") !== "room") return false;
    var id = String(item.id || "").toLowerCase();
    var name = String(item.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (id === "big-room-2") return true;
    return name === "family room 2" || name === "big room 2";
  }

  function withSmallRoomPhotos(item) {
    if (!isSmallRoomFacility(item)) return item;
    var next = {};
    Object.keys(item).forEach(function (key) {
      next[key] = item[key];
    });
    next.images = SMALL_ROOM_PHOTOS.slice();
    next.image = SMALL_ROOM_PHOTOS[0];
    return next;
  }

  function withBigRoom1Photos(item) {
    if (!isFirstBigRoomFacility(item)) return item;
    var next = {};
    Object.keys(item).forEach(function (key) {
      next[key] = item[key];
    });
    next.images = BIG_ROOM_1_PHOTOS.slice();
    next.image = BIG_ROOM_1_PHOTOS[0];
    return next;
  }

  function withBigRoom2Photos(item) {
    if (!isSecondBigRoomFacility(item)) return item;
    var next = {};
    Object.keys(item).forEach(function (key) {
      next[key] = item[key];
    });
    next.images = BIG_ROOM_2_PHOTOS.slice();
    next.image = BIG_ROOM_2_PHOTOS[0];
    return next;
  }

  function applyFacilityStockPhotos(item) {
    return withBigRoom2Photos(withBigRoom1Photos(withSmallRoomPhotos(item || {})));
  }

  function getFacilityImages(item) {
    return normalizeFacilityImages(applyFacilityStockPhotos(item || {}));
  }

  function escapeFacilityAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  var EXPAND_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M3 9V3h6v2H5v4H3zm16-4h-4V3h6v6h-2V5zM5 19h4v2H3v-6h2v4zm14-4h2v6h-6v-2h4v-4z"/>' +
    "</svg>";

  function renderFacilitySwipeElement(name, images) {
    var photos = images && images.length ? images.slice() : [];
    if (!photos.length) photos.push("../Images/room-1.png");
    var wrap = document.createElement("div");
    wrap.className = "facility-swipe" + (photos.length < 2 ? " facility-swipe--single" : "");
    wrap.setAttribute("data-facility-swipe", "");
    wrap.setAttribute("data-facility-name", name || "Facility");
    wrap.setAttribute("data-swipe-index", "0");
    var slides = photos
      .map(function (src, idx) {
        return (
          '<div class="facility-swipe__slide">' +
          '<img src="' +
          escapeFacilityAttr(src) +
          '" alt="' +
          escapeFacilityAttr(name) +
          " photo " +
          (idx + 1) +
          '" class="room-img" loading="lazy" decoding="async">' +
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
    wrap.innerHTML =
      '<div class="facility-swipe__viewport">' +
      '<div class="facility-swipe__track">' +
      slides +
      "</div></div>" +
      nav +
      dots +
      '<button type="button" class="facility-swipe__expand" aria-label="View photos larger">' +
      EXPAND_ICON +
      "</button>";
    return wrap;
  }

  var facilityLightbox = {
    photos: [],
    name: "",
    index: 0,
    lastFocus: null,
    bound: false
  };

  function photosFromSwipe(wrap) {
    var list = [];
    if (!wrap) return list;
    wrap.querySelectorAll(".facility-swipe__slide img").forEach(function (img) {
      var src = img.getAttribute("src");
      if (src) list.push(src);
    });
    return list;
  }

  function currentSwipeIndex(wrap) {
    var n = Number(wrap && wrap.getAttribute("data-swipe-index"));
    return isNaN(n) ? 0 : n;
  }

  function ensureFacilityLightbox() {
    var box = document.getElementById("facilityPhotoLightbox");
    if (box) {
      bindFacilityLightbox(box);
      return box;
    }
    box = document.createElement("div");
    box.id = "facilityPhotoLightbox";
    box.className = "facility-lightbox";
    box.hidden = true;
    box.setAttribute("aria-hidden", "true");
    box.innerHTML =
      '<div class="facility-lightbox__backdrop" data-lightbox-close></div>' +
      '<div class="facility-lightbox__dialog" role="dialog" aria-modal="true" aria-labelledby="facilityLightboxTitle">' +
      '<button type="button" class="facility-lightbox__close" data-lightbox-close aria-label="Close photos">&times;</button>' +
      '<p id="facilityLightboxTitle" class="facility-lightbox__title"></p>' +
      '<div class="facility-lightbox__stage">' +
      '<button type="button" class="facility-lightbox__prev" aria-label="Previous photo">‹</button>' +
      '<img class="facility-lightbox__img" alt="">' +
      '<button type="button" class="facility-lightbox__next" aria-label="Next photo">›</button>' +
      "</div>" +
      '<p class="facility-lightbox__count"></p>' +
      '<div class="facility-lightbox__thumbs" role="tablist" aria-label="All photos"></div>' +
      "</div>";
    document.body.appendChild(box);
    bindFacilityLightbox(box);
    return box;
  }

  function renderFacilityLightboxView() {
    var box = document.getElementById("facilityPhotoLightbox");
    if (!box) return;
    var photos = facilityLightbox.photos;
    var index = facilityLightbox.index;
    var title = box.querySelector(".facility-lightbox__title");
    var img = box.querySelector(".facility-lightbox__img");
    var count = box.querySelector(".facility-lightbox__count");
    var thumbs = box.querySelector(".facility-lightbox__thumbs");
    var prev = box.querySelector(".facility-lightbox__prev");
    var next = box.querySelector(".facility-lightbox__next");
    var many = photos.length > 1;
    if (title) title.textContent = facilityLightbox.name || "Facility";
    if (img) {
      img.src = photos[index] || "";
      img.alt = (facilityLightbox.name || "Facility") + " photo " + (index + 1);
    }
    if (count) count.textContent = photos.length ? index + 1 + " / " + photos.length : "";
    box.classList.toggle("facility-lightbox--single", !many);
    if (prev) prev.hidden = !many;
    if (next) next.hidden = !many;
    if (thumbs) {
      thumbs.hidden = !many;
      thumbs.innerHTML = photos
        .map(function (src, idx) {
          return (
            '<button type="button" class="facility-lightbox__thumb' +
            (idx === index ? " is-active" : "") +
            '" data-lightbox-thumb="' +
            idx +
            '" aria-label="Show photo ' +
            (idx + 1) +
            '">' +
            '<img src="' +
            escapeFacilityAttr(src) +
            '" alt="">' +
            "</button>"
          );
        })
        .join("");
    }
  }

  function goFacilityLightbox(next) {
    var total = facilityLightbox.photos.length;
    if (total < 1) return;
    facilityLightbox.index = (next + total) % total;
    renderFacilityLightboxView();
  }

  function closeFacilityLightbox() {
    var box = document.getElementById("facilityPhotoLightbox");
    if (!box || box.hidden) return;
    box.hidden = true;
    box.setAttribute("aria-hidden", "true");
    document.body.classList.remove("facility-lightbox-open");
    var focusEl = facilityLightbox.lastFocus;
    facilityLightbox.lastFocus = null;
    if (focusEl && typeof focusEl.focus === "function") {
      try {
        focusEl.focus();
      } catch (err) {}
    }
  }

  function openFacilityLightbox(name, photos, startIndex) {
    var list = (photos || []).filter(Boolean);
    if (!list.length) return;
    var box = ensureFacilityLightbox();
    facilityLightbox.name = name || "Facility";
    facilityLightbox.photos = list;
    facilityLightbox.index = Math.max(0, Math.min(Number(startIndex) || 0, list.length - 1));
    facilityLightbox.lastFocus = document.activeElement;
    box.hidden = false;
    box.setAttribute("aria-hidden", "false");
    document.body.classList.add("facility-lightbox-open");
    renderFacilityLightboxView();
    var closeBtn = box.querySelector(".facility-lightbox__close");
    if (closeBtn) closeBtn.focus();
  }

  function bindFacilityLightbox(box) {
    if (!box || box.getAttribute("data-bound") === "1") return;
    box.setAttribute("data-bound", "1");
    box.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-lightbox-close]")) {
        e.preventDefault();
        closeFacilityLightbox();
        return;
      }
      if (t.closest(".facility-lightbox__prev")) {
        e.preventDefault();
        goFacilityLightbox(facilityLightbox.index - 1);
        return;
      }
      if (t.closest(".facility-lightbox__next")) {
        e.preventDefault();
        goFacilityLightbox(facilityLightbox.index + 1);
        return;
      }
      var thumb = t.closest("[data-lightbox-thumb]");
      if (thumb) {
        e.preventDefault();
        goFacilityLightbox(Number(thumb.getAttribute("data-lightbox-thumb")) || 0);
      }
    });

    var stage = box.querySelector(".facility-lightbox__stage");
    var startX = 0;
    var deltaX = 0;
    if (stage) {
      stage.addEventListener("touchstart", function (e) {
        if (!e.touches || !e.touches[0]) return;
        startX = e.touches[0].clientX;
        deltaX = 0;
      }, { passive: true });
      stage.addEventListener("touchmove", function (e) {
        if (!e.touches || !e.touches[0]) return;
        deltaX = e.touches[0].clientX - startX;
      }, { passive: true });
      stage.addEventListener("touchend", function () {
        if (Math.abs(deltaX) < 40) return;
        goFacilityLightbox(deltaX < 0 ? facilityLightbox.index + 1 : facilityLightbox.index - 1);
      });
    }

    if (!facilityLightbox.bound) {
      facilityLightbox.bound = true;
      document.addEventListener("keydown", function (e) {
        var open = document.getElementById("facilityPhotoLightbox");
        if (!open || open.hidden) return;
        if (e.key === "Escape") {
          e.preventDefault();
          closeFacilityLightbox();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          goFacilityLightbox(facilityLightbox.index - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          goFacilityLightbox(facilityLightbox.index + 1);
        }
      });
    }
  }

  function bindFacilitySwipeGalleries(root) {
    if (!root) return;
    root.querySelectorAll("[data-facility-swipe]").forEach(function (wrap) {
      if (wrap.getAttribute("data-bound") === "1") return;
      wrap.setAttribute("data-bound", "1");

      function stopLabelToggle(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      var expand = wrap.querySelector(".facility-swipe__expand");
      var mediaHost = wrap.closest(".book-facility-card__media");
      if (expand && mediaHost && expand.parentNode !== mediaHost) {
        mediaHost.appendChild(expand);
      }
      if (expand) {
        expand.addEventListener("click", function (e) {
          stopLabelToggle(e);
          openFacilityLightbox(
            wrap.getAttribute("data-facility-name") || "Facility",
            photosFromSwipe(wrap),
            currentSwipeIndex(wrap)
          );
        });
      }

      var track = wrap.querySelector(".facility-swipe__track");
      var slides = wrap.querySelectorAll(".facility-swipe__slide");
      if (!track || slides.length < 2) return;
      var index = 0;
      var startX = 0;
      var deltaX = 0;
      var dragging = false;
      var suppressClick = false;

      function goTo(next) {
        index = (next + slides.length) % slides.length;
        track.style.transform = "translateX(" + -index * 100 + "%)";
        wrap.querySelectorAll("[data-swipe-dot]").forEach(function (dot) {
          dot.classList.toggle("is-active", Number(dot.getAttribute("data-swipe-dot")) === index);
        });
        var count = wrap.querySelector(".facility-swipe__count");
        if (count) count.textContent = index + 1 + " / " + slides.length;
        wrap.setAttribute("data-swipe-index", String(index));
      }

      var prev = wrap.querySelector(".facility-swipe__prev");
      var next = wrap.querySelector(".facility-swipe__next");
      if (prev) {
        prev.addEventListener("click", function (e) {
          stopLabelToggle(e);
          goTo(index - 1);
        });
      }
      if (next) {
        next.addEventListener("click", function (e) {
          stopLabelToggle(e);
          goTo(index + 1);
        });
      }
      wrap.querySelectorAll("[data-swipe-dot]").forEach(function (dot) {
        dot.addEventListener("click", function (e) {
          stopLabelToggle(e);
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
        if (Math.abs(deltaX) > 40) {
          suppressClick = true;
          goTo(deltaX < 0 ? index + 1 : index - 1);
        } else {
          goTo(index);
        }
      }

      var viewport = wrap.querySelector(".facility-swipe__viewport");
      if (!viewport) return;
      viewport.addEventListener("click", function (e) {
        if (!suppressClick) return;
        stopLabelToggle(e);
        suppressClick = false;
      });
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

  function facilityFromRow(row) {
    var caps = defaultCapacityForFacility(row.type, row.room_kind);
    var capacity = row.capacity != null ? Number(row.capacity) : caps.capacity;
    if (!capacity || capacity <= 0) capacity = caps.capacity;
    var capacityMin = row.capacity_min != null ? Number(row.capacity_min) : caps.capacityMin;
    if (String(row.type || "") === "hall") {
      if (!capacityMin || capacityMin <= 0) capacityMin = 60;
    } else {
      capacityMin = null;
    }
    var images = normalizeFacilityImages({ image: row.image, images: row.images });
    return {
      id: row.id,
      type: row.type || "room",
      roomKind: row.room_kind || "",
      name: row.name || "",
      price: row.price != null ? Number(row.price) : 0,
      priceUnit: row.price_unit || "night",
      image: images[0] || row.image || "",
      images: images,
      description: row.description || "",
      capacity: capacity,
      capacityMin: capacityMin,
      sortOrder: row.sort_order != null ? row.sort_order : 0,
      active: row.active !== false
    };
  }
  function facilityToRow(item) {
    var caps = defaultCapacityForFacility(item.type, item.roomKind);
    var capacity = item.capacity != null ? Number(item.capacity) : caps.capacity;
    if (!capacity || capacity <= 0) capacity = caps.capacity;
    var capacityMin = String(item.type || "") === "hall"
      ? (item.capacityMin != null ? Number(item.capacityMin) : caps.capacityMin || 60)
      : null;
    var images = normalizeFacilityImages(item);
    var row = {
      id: item.id,
      type: item.type || "room",
      room_kind: item.roomKind || null,
      name: item.name || "",
      price: item.price != null ? item.price : 0,
      price_unit: item.priceUnit || "night",
      image: images[0] || item.image || "",
      description: item.description || "",
      capacity: capacity,
      capacity_min: capacityMin,
      sort_order: item.sortOrder != null ? item.sortOrder : 0,
      active: item.active !== false,
      updated_at: new Date().toISOString()
    };
    if (!persistFacilities._noImagesColumn) row.images = images;
    return row;
  }
  function policyFromRow(row) { return { id: row.id, kind: row.kind === "pool" ? "pool" : "general", title: row.title || "", description: row.description || "", image: row.image || "", sortOrder: row.sort_order != null ? row.sort_order : 0 }; }
  function policyToRow(item) { return { id: item.id, kind: item.kind === "pool" ? "pool" : "general", title: item.title || "", description: item.description || "", image: item.image || "", sort_order: item.sortOrder != null ? item.sortOrder : 0, updated_at: new Date().toISOString() }; }
  function galleryFromRow(row) {
    return {
      id: row.id,
      title: row.title || "",
      image: row.image || "",
      imageAlt: row.image_alt || row.title || "Moments at Elenest",
      sortOrder: row.sort_order != null ? row.sort_order : 0,
      active: row.active !== false
    };
  }
  /** Matches live content_gallery columns: id, title, image, sort_order, updated_at */
  function galleryToRow(item) {
    return {
      id: item.id,
      title: item.title || "",
      image: item.image || "",
      sort_order: item.sortOrder != null ? item.sortOrder : 0,
      updated_at: new Date().toISOString()
    };
  }

  function syncActivitiesToShowcase(list) {
    try {
      var combined = (list || []).concat(cacheEvents || []);
      localStorage.setItem("elenest_activities", JSON.stringify(combined.slice(0, 10).map(function (item) { return { title: item.title || "", type: item.type || "", date: item.date || "", description: item.description || "", image: item.image || "" }; })));
    } catch (e) {}
  }
  function mergeLocalFacilityImages(list) {
    var local = [];
    try {
      var raw = localStorage.getItem("elenest_room_catalog");
      if (raw) local = JSON.parse(raw) || [];
    } catch (e) {}
    if (!Array.isArray(local) || !local.length) return list;
    var byId = {};
    local.forEach(function (item) {
      if (item && item.id) byId[String(item.id)] = item;
    });
    return (list || []).map(function (item) {
      var images = normalizeFacilityImages(item);
      if (images.length > 1) return item;
      var prev = byId[String(item.id)];
      var prevImages = normalizeFacilityImages(prev);
      if (prevImages.length > images.length) {
        item.images = prevImages;
        item.image = prevImages[0] || item.image;
      }
      return item;
    });
  }

  function syncFacilitiesToLegacyStorage(list) { try { localStorage.setItem("elenest_room_catalog", JSON.stringify(list || [])); } catch (e) {} }
  function syncPoliciesToLegacyStorage(list) { try { localStorage.setItem("elenest_policies", JSON.stringify(list || [])); } catch (e) {} }
  function syncGalleryToLegacyStorage(list) { try { localStorage.setItem("elenest_gallery", JSON.stringify(list || [])); } catch (e) {} }

  function galleryList() {
    return cacheGallery && cacheGallery.length ? cacheGallery : DEFAULT_GALLERY.slice();
  }

  function applyDefaultsToCache() {
    if (!cacheAbout) cacheAbout = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
    if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
    cacheActivities = DEFAULT_ACTIVITIES.slice();
    cacheEvents = DEFAULT_EVENTS.slice();
    cacheFacilities = DEFAULT_FACILITIES.slice();
    cachePolicies = DEFAULT_POLICIES.slice();
    cacheGallery = DEFAULT_GALLERY.slice();
    syncActivitiesToShowcase(cacheActivities);
    syncFacilitiesToLegacyStorage(cacheFacilities);
    syncPoliciesToLegacyStorage(cachePolicies);
    syncGalleryToLegacyStorage(cacheGallery);
  }

  function localSeedOverrides() {
    var fac = readLocalStorageJson("elenest_room_catalog");
    var pol = readLocalStorageJson("elenest_policies");
    return {
      facilities: fac && fac.length ? fac.map(function (item, idx) {
        var caps = defaultCapacityForFacility(item.type, item.roomKind);
        var capacity = item.capacity != null ? Number(item.capacity) : caps.capacity;
        if (!capacity || capacity <= 0) capacity = caps.capacity;
        var capacityMin = String(item.type || "") === "hall"
          ? (item.capacityMin != null ? Number(item.capacityMin) : caps.capacityMin || 60)
          : null;
        return {
          id: item.id || uid(),
          type: item.type || "room",
          roomKind: item.roomKind || "",
          name: item.name || "",
          price: item.price != null ? item.price : 0,
          priceUnit: item.priceUnit || "night",
          image: item.image || "",
          description: item.description || "",
          capacity: capacity,
          capacityMin: capacityMin,
          sortOrder: idx + 1,
          active: item.active !== false
        };
      }) : null,
      policies: pol && pol.length ? pol.map(function (item, idx) { return { id: item.id || uid(), kind: item.kind === "pool" ? "pool" : "general", title: item.title || "", description: item.description || "", image: item.image || "", sortOrder: idx + 1 }; }) : null
    };
  }

  function facilitiesList() {
    var list = cacheFacilities && cacheFacilities.length ? cacheFacilities : DEFAULT_FACILITIES.slice();
    return list.map(applyFacilityStockPhotos);
  }

  function readJsonSnap(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeJsonSnap(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function aboutSnapIsValid(data) {
    return !!(data && typeof data === "object" && !Array.isArray(data) && (data.heroTitle || data.heroLead || (data.storyCards && data.storyCards.length)));
  }

  function faqSnapIsValid(list) {
    return Array.isArray(list) && list.some(function (item) {
      return item && (item.question || item.answer);
    });
  }

  function normalizeFaqs(list) {
    var seen = {};
    return (list || []).filter(function (item) {
      if (!item) return false;
      var id = String(item.id || "");
      if (id && seen[id]) return false;
      if (id) seen[id] = true;
      return !!(item.question || item.answer);
    }).map(function (item) {
      return {
        id: item.id,
        question: item.question || "",
        answer: item.answer || "",
        sortOrder: item.sortOrder != null ? Number(item.sortOrder) : 0,
        ctaLabel: item.ctaLabel || "",
        ctaHref: item.ctaHref || ""
      };
    }).sort(function (a, b) {
      var order = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (order) return order;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function rememberAbout(data) {
    if (!aboutSnapIsValid(data)) return;
    cacheAbout = data;
    writeJsonSnap(ABOUT_SNAP_KEY, data);
  }

  function rememberFaqs(list) {
    var normalized = normalizeFaqs(list);
    if (!normalized.length) return;
    cacheFaqs = normalized;
    writeJsonSnap(FAQ_SNAP_KEY, normalized);
  }

  function hydrateAboutFaqSnapshots() {
    var aboutSnap = readJsonSnap(ABOUT_SNAP_KEY);
    var faqSnap = readJsonSnap(FAQ_SNAP_KEY);
    if (aboutSnapIsValid(aboutSnap)) cacheAbout = aboutSnap;
    if (faqSnapIsValid(faqSnap)) cacheFaqs = normalizeFaqs(faqSnap);
  }

  function faqsList() {
    return cacheFaqs && cacheFaqs.length ? cacheFaqs : DEFAULT_FAQS.slice();
  }

  function policiesList() {
    return cachePolicies && cachePolicies.length ? cachePolicies : DEFAULT_POLICIES.slice();
  }

  function mergeAboutDefaults(data) {
    var base = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
    if (!data || typeof data !== "object") return base;
    Object.keys(data).forEach(function (key) {
      if (data[key] !== undefined && data[key] !== null) base[key] = data[key];
    });
    if (!base.homeStats || typeof base.homeStats !== "object") {
      base.homeStats = JSON.parse(JSON.stringify(DEFAULT_ABOUT.homeStats));
    } else {
      base.homeStats = {
        customers: Number(base.homeStats.customers) || DEFAULT_ABOUT.homeStats.customers,
        satisfiedCustomers: Number(base.homeStats.satisfiedCustomers) || DEFAULT_ABOUT.homeStats.satisfiedCustomers
      };
    }
    return base;
  }

  function parseAboutPayload(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    return typeof raw === "object" ? raw : null;
  }

  function detectAboutSchema(rows) {
    var list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (!list.length) return aboutSchemaMode || "legacy";
    var hasLegacy = list.some(function (row) {
      return row && row.kind != null && String(row.kind) !== "";
    });
    var hasJson = list.some(function (row) {
      return row && row.data != null && (row.kind == null || String(row.kind) === "");
    });
    if (hasLegacy) return "legacy";
    if (hasJson) return "json";
    return aboutSchemaMode || "legacy";
  }

  function aboutFromLegacyRows(rows) {
    var about = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
    var story = [];
    var cred = [];
    var highlights = [];
    (rows || []).slice().sort(function (a, b) {
      var order = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (order) return order;
      return String(a.id || "").localeCompare(String(b.id || ""));
    }).forEach(function (row) {
      if (!row) return;
      var kind = String(row.kind || "").toLowerCase();
      if (kind === "profile") {
        if (row.name || row.title) about.heroTitle = row.name || row.title;
        if (row.tagline || row.body) about.heroLead = row.tagline || row.body;
      } else if (kind === "story") {
        story.push({ id: row.id, title: row.title || "", body: row.body || "" });
      } else if (kind === "credential") {
        cred.push({
          id: row.id,
          title: row.title || "",
          body: row.body || "",
          image: row.image || "",
          imageAlt: row.title || "Credential"
        });
      } else if (kind === "highlight") {
        var pills = [];
        try {
          if (row.tagline) pills = JSON.parse(row.tagline);
        } catch (e) {
          pills = [];
        }
        highlights.push({
          id: row.id,
          title: row.title || "",
          body: row.body || "",
          pills: Array.isArray(pills) ? pills : [],
          ctaLabel: row.phone || "",
          ctaHref: row.email || ""
        });
      } else if (kind === "credentials_lead" || kind === "credentials-lead") {
        if (row.body) about.credentialsLead = row.body;
      } else if (kind === "findus" || kind === "find_us") {
        if (row.body) about.findUsLead = row.body;
        if (row.image) about.mapEmbed = row.image;
      } else if (kind === "page" || kind === "meta") {
        var meta = parseAboutPayload(row.body);
        if (meta) {
          if (meta.credentialsLead) about.credentialsLead = meta.credentialsLead;
          if (meta.findUsLead) about.findUsLead = meta.findUsLead;
          if (meta.mapEmbed) about.mapEmbed = meta.mapEmbed;
          if (meta.highlights) about.highlights = meta.highlights;
          if (meta.storyCards) about.storyCards = meta.storyCards;
          if (meta.heroTitle) about.heroTitle = meta.heroTitle;
          if (meta.heroLead) about.heroLead = meta.heroLead;
        }
      }
    });
    if (story.length) about.storyCards = story;
    if (cred.length) about.credentialCards = cred;
    if (highlights.length) about.highlights = highlights;
    return about;
  }

  function aboutToLegacyRows(data) {
    var now = new Date().toISOString();
    var rows = [
      {
        id: "profile",
        kind: "profile",
        name: (data && data.heroTitle) || "",
        tagline: (data && data.heroLead) || "",
        title: "",
        body: "",
        image: "",
        location: "",
        phone: "",
        email: "",
        sort_order: 0,
        updated_at: now
      },
      {
        id: "credentials-lead",
        kind: "credentials_lead",
        name: "",
        tagline: "",
        title: "Credentials",
        body: (data && data.credentialsLead) || "",
        image: "",
        location: "",
        phone: "",
        email: "",
        sort_order: 0,
        updated_at: now
      },
      {
        id: "find-us",
        kind: "findus",
        name: "",
        tagline: "",
        title: "Find Us",
        body: (data && data.findUsLead) || "",
        image: (data && data.mapEmbed) || "",
        location: "",
        phone: "",
        email: "",
        sort_order: 200,
        updated_at: now
      }
    ];
    ((data && data.storyCards) || []).forEach(function (card, idx) {
      rows.push({
        id: card.id || uid(),
        kind: "story",
        name: "",
        tagline: "",
        title: card.title || "",
        body: card.body || "",
        image: "",
        location: "",
        phone: "",
        email: "",
        sort_order: idx + 1,
        updated_at: now
      });
    });
    ((data && data.credentialCards) || []).forEach(function (card, idx) {
      rows.push({
        id: card.id || uid(),
        kind: "credential",
        name: "",
        tagline: "",
        title: card.title || "",
        body: card.body || "",
        image: card.image || "",
        location: "",
        phone: "",
        email: "",
        sort_order: idx + 1,
        updated_at: now
      });
    });
    ((data && data.highlights) || []).forEach(function (item, idx) {
      rows.push({
        id: item.id || uid(),
        kind: "highlight",
        name: "",
        tagline: JSON.stringify(item.pills || []),
        title: item.title || "",
        body: item.body || "",
        image: "",
        location: "",
        phone: item.ctaLabel || "",
        email: item.ctaHref || "",
        sort_order: idx + 1,
        updated_at: now
      });
    });
    return rows;
  }

  function seedMissingTables(sb, results) {
    var tasks = [];
    if (!results[1].error && !(results[1].data || []).length) {
      tasks.push(sb.from("content_faqs").upsert(DEFAULT_FAQS.map(faqToRow)));
    }
    if (!results[2].error && !(results[2].data || []).length) {
      tasks.push(sb.from("content_activities").upsert(DEFAULT_ACTIVITIES.map(activityToRow)));
    }
    if (!results[3].error && !(results[3].data || []).length) {
      tasks.push(sb.from("content_events").upsert(DEFAULT_EVENTS.map(eventToRow)));
    }
    // Facilities use public.room_catalog only — never auto-seed demo rows into it.
    if (!results[5].error && !(results[5].data || []).length) {
      tasks.push(sb.from("content_policies").upsert(DEFAULT_POLICIES.map(policyToRow)));
    }
    if (results[6] && !results[6].error && !(results[6].data || []).length) {
      tasks.push(sb.from("content_gallery").upsert(DEFAULT_GALLERY.map(galleryToRow)));
    }
    if (!tasks.length) return Promise.resolve(false);
    return Promise.all(tasks).then(function (responses) {
      return responses.some(function (res) { return res && !res.error; });
    });
  }

  function seedSupabase(sb) {
    var local = localSeedOverrides();
    var aboutSeed =
      aboutSchemaMode === "json"
        ? sb.from("content_about").upsert({ id: 1, data: DEFAULT_ABOUT, updated_at: new Date().toISOString() })
        : sb.from("content_about").upsert(aboutToLegacyRows(DEFAULT_ABOUT), { onConflict: "id" });
    return aboutSeed
      .then(function () { return sb.from("content_faqs").upsert(DEFAULT_FAQS.map(faqToRow)); })
      .then(function () { return sb.from("content_activities").upsert(DEFAULT_ACTIVITIES.map(activityToRow)); })
      .then(function () { return sb.from("content_events").upsert(DEFAULT_EVENTS.map(eventToRow)); })
      .then(function () { return sb.from("content_policies").upsert((local.policies || DEFAULT_POLICIES).map(policyToRow)); })
      .then(function () { return sb.from("content_gallery").upsert(DEFAULT_GALLERY.map(galleryToRow)); });
  }

  function migratePastActivities(sb, rows) {
    var past = (rows || []).filter(function (row) { return row && row.category === "past"; });
    if (!past.length) return Promise.resolve();
    return sb.from("content_events").upsert(past.map(showcaseFromRow).map(eventToRow)).then(function () {
      return sb.from("content_activities").delete().in("id", past.map(function (row) { return row.id; }));
    });
  }

  function applyAboutResult(aboutRes) {
    if (aboutRes && aboutRes.error) {
      try { console.warn("[Elenest ContentStore] About load skipped:", aboutRes.error.message || aboutRes.error); } catch (e) {}
      if (!cacheAbout) cacheAbout = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
      return;
    }
    var rows = aboutRes && aboutRes.data;
    if (rows && !Array.isArray(rows)) rows = [rows];
    rows = (rows || []).slice().sort(function (a, b) {
      return String(a && a.id || "").localeCompare(String(b && b.id || ""));
    });
    aboutSchemaMode = detectAboutSchema(rows);

    if (aboutSchemaMode === "json") {
      var jsonRow = null;
      rows.forEach(function (row) {
        if (row && row.data != null && (row.kind == null || String(row.kind) === "")) jsonRow = row;
      });
      var parsed = jsonRow ? parseAboutPayload(jsonRow.data) : null;
      if (parsed) rememberAbout(mergeAboutDefaults(parsed));
      else if (!cacheAbout) rememberAbout(JSON.parse(JSON.stringify(DEFAULT_ABOUT)));
      return;
    }

    if (rows.length) {
      rememberAbout(aboutFromLegacyRows(rows));
      return;
    }
    if (!cacheAbout) rememberAbout(JSON.parse(JSON.stringify(DEFAULT_ABOUT)));
  }

  function applyQueryResults(aboutRes, faqsRes, activitiesRes, eventsRes, facilitiesRes, policiesRes, galleryRes) {
    applyAboutResult(aboutRes);

    if (faqsRes && faqsRes.error) {
      try { console.warn("[Elenest ContentStore] FAQ load failed:", faqsRes.error.message || faqsRes.error); } catch (e) {}
      if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
    } else {
      var loadedFaqs = normalizeFaqs((faqsRes.data || []).map(faqFromRow));
      if (loadedFaqs.length) rememberFaqs(loadedFaqs);
      else if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
    }

    if (activitiesRes && activitiesRes.error) {
      try { console.warn("[Elenest ContentStore] Activities load failed:", activitiesRes.error.message || activitiesRes.error); } catch (e) {}
      cacheActivities = DEFAULT_ACTIVITIES.slice();
    } else {
      cacheActivities = (activitiesRes.data || []).filter(function (row) { return row.category !== "past"; }).map(showcaseFromRow);
    }

    if (eventsRes && eventsRes.error) {
      try { console.warn("[Elenest ContentStore] Events load failed:", eventsRes.error.message || eventsRes.error); } catch (e) {}
      cacheEvents = DEFAULT_EVENTS.slice();
    } else {
      cacheEvents = (eventsRes.data || []).map(showcaseFromRow);
    }

    if (facilitiesRes && facilitiesRes.error) {
      try { console.warn("[Elenest ContentStore] Facilities load failed:", facilitiesRes.error.message || facilitiesRes.error); } catch (e) {}
      cacheFacilities = DEFAULT_FACILITIES.slice();
    } else {
      cacheFacilities = mergeLocalFacilityImages((facilitiesRes.data || []).map(facilityFromRow));
    }

    if (policiesRes && policiesRes.error) {
      try { console.warn("[Elenest ContentStore] Policies load failed:", policiesRes.error.message || policiesRes.error); } catch (e) {}
      cachePolicies = DEFAULT_POLICIES.slice();
    } else {
      cachePolicies = (policiesRes.data || []).map(policyFromRow);
      if (!cachePolicies.length) cachePolicies = DEFAULT_POLICIES.slice();
    }

    if (galleryRes && galleryRes.error) {
      try { console.warn("[Elenest ContentStore] Gallery load failed:", galleryRes.error.message || galleryRes.error); } catch (e) {}
      cacheGallery = DEFAULT_GALLERY.slice();
    } else if (galleryRes) {
      cacheGallery = (galleryRes.data || []).map(galleryFromRow);
      if (!cacheGallery.length) cacheGallery = DEFAULT_GALLERY.slice();
    } else {
      cacheGallery = DEFAULT_GALLERY.slice();
    }

    syncActivitiesToShowcase(cacheActivities);
    syncFacilitiesToLegacyStorage(facilitiesList());
    syncPoliciesToLegacyStorage(policiesList());
    syncGalleryToLegacyStorage(galleryList());
  }

  function finishLoad(isReload) {
    if (!isReload) readyResolve();
    notifyContentUpdated();
  }

  function loadFromSupabase(isReload, fromRecurse) {
    if (!isReload && !fromRecurse) loadDepth = 0;
    var token = ++loadToken;
    function stillCurrent() { return token === loadToken; }

    if (loadDepth >= MAX_LOAD_DEPTH) {
      if (!cacheAbout) cacheAbout = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
      if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
      applyDefaultsToCache();
      finishLoad(isReload);
      try { console.warn("[Elenest ContentStore] Load depth limit reached; using cached defaults."); } catch (e) {}
      return Promise.resolve();
    }
    loadDepth += 1;

    var sb = getClient();
    if (!sb) {
      if (!cacheAbout) cacheAbout = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
      if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
      applyDefaultsToCache();
      finishLoad(isReload);
      return Promise.resolve();
    }
    return Promise.all([
      sb.from("content_about").select("*").order("id"),
      sb.from("content_faqs").select("*").order("sort_order", { ascending: true }).order("id", { ascending: true }),
      sb.from("content_activities").select("*"),
      sb.from("content_events").select("*"),
      sb.from("room_catalog").select("*").order("sort_order"),
      sb.from("content_policies").select("*").order("sort_order"),
      sb.from("content_gallery").select("*").order("sort_order")
    ]).then(function (results) {
      if (!stillCurrent()) return null;
      var activitiesRows = (results[2] && results[2].data) || [];
      return migratePastActivities(sb, activitiesRows).then(function () {
        return results;
      });
    }).then(function (results) {
      if (!stillCurrent() || !results) return;
      return seedMissingTables(sb, results).then(function (didSeed) {
        if (!stillCurrent()) return;
        if (didSeed) return loadFromSupabase(isReload, true);
        applyQueryResults(results[0], results[1], results[2], results[3], results[4], results[5], results[6]);
        finishLoad(isReload);
      });
    }).catch(function (err) {
      if (!stillCurrent()) return;
      if (!cacheAbout) cacheAbout = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
      if (!cacheFaqs || !cacheFaqs.length) cacheFaqs = DEFAULT_FAQS.slice();
      applyDefaultsToCache();
      finishLoad(isReload);
      try { console.warn("[Elenest ContentStore] Supabase load failed:", err); } catch (e) {}
    });
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { reloadTimer = null; loadFromSupabase(true); }, 350);
  }

  function subscribeRealtime(sb) {
    if (realtimeChannel || !sb || !sb.channel) return;
    var tables = ["content_about", "content_faqs", "content_activities", "content_events", "room_catalog", "content_policies", "content_gallery"];
    realtimeChannel = sb.channel("elenest-content-sync");
    tables.forEach(function (table) {
      realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: table }, scheduleReload);
    });
    realtimeChannel.subscribe();
  }

  function notifyContentUpdated() { try { window.dispatchEvent(new CustomEvent("elenest-content-updated")); } catch (e) {} }

  function persistAbout(data) {
    rememberAbout(data);
    cacheAbout = data;
    var sb = getClient();
    if (!sb) return Promise.resolve(true);

    if (aboutSchemaMode === "json") {
      return sb
        .from("content_about")
        .upsert({ id: 1, data: data, updated_at: new Date().toISOString() })
        .then(function (res) {
          if (!res.error) notifyContentUpdated();
          return !res.error;
        })
        .catch(function () {
          return false;
        });
    }

    // Legacy row-based content_about (kind/title/body) — your live schema
    aboutSchemaMode = "legacy";
    var rows = aboutToLegacyRows(data);
    var keepIds = rows.map(function (row) {
      return row.id;
    });
    return sb
      .from("content_about")
      .upsert(rows, { onConflict: "id" })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.from("content_about").select("id,kind");
      })
      .then(function (res) {
        if (res.error) throw res.error;
        var existing = res.data || [];
        var toDelete = existing
          .filter(function (row) {
            return keepIds.indexOf(row.id) === -1;
          })
          .map(function (row) {
            return row.id;
          });
        if (!toDelete.length) return { error: null };
        return sb.from("content_about").delete().in("id", toDelete);
      })
      .then(function (res) {
        if (!res || !res.error) notifyContentUpdated();
        return !(res && res.error);
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest ContentStore] About save failed:", err);
        } catch (e) {}
        return false;
      });
  }
  function persistFaqs(list) { rememberFaqs(list); cacheFaqs = normalizeFaqs(list); var sb = getClient(); if (!sb) return Promise.resolve(true); return sb.from("content_faqs").upsert(cacheFaqs.map(faqToRow)).then(function (res) { if (!res.error) notifyContentUpdated(); return !res.error; }).catch(function () { return false; }); }
  function persistActivities(list) { cacheActivities = list.slice(); syncActivitiesToShowcase(list); var sb = getClient(); if (!sb) return Promise.resolve(true); return sb.from("content_activities").upsert(list.map(activityToRow)).then(function (res) { if (!res.error) notifyContentUpdated(); return !res.error; }).catch(function () { return false; }); }
  function persistEvents(list) { cacheEvents = list.slice(); syncActivitiesToShowcase(cacheActivities); var sb = getClient(); if (!sb) return Promise.resolve(true); return sb.from("content_events").upsert(list.map(eventToRow)).then(function (res) { if (!res.error) notifyContentUpdated(); return !res.error; }).catch(function () { return false; }); }
  function persistFacilities(list) {
    cacheFacilities = list.slice();
    syncFacilitiesToLegacyStorage(list);
    var sb = getClient();
    if (!sb) return Promise.resolve(true);
    function upsert(rows) {
      return sb.from("room_catalog").upsert(rows).then(function (res) {
        if (res.error) throw res.error;
        notifyContentUpdated();
        return true;
      });
    }
    return upsert(list.map(facilityToRow)).catch(function (err) {
      var msg = String((err && err.message) || "");
      if (/images|column|schema cache/i.test(msg)) {
        persistFacilities._noImagesColumn = true;
        return upsert(list.map(facilityToRow)).catch(function () {
          return false;
        });
      }
      return false;
    });
  }
  function persistPolicies(list) { cachePolicies = list.slice(); syncPoliciesToLegacyStorage(list); var sb = getClient(); if (!sb) return Promise.resolve(true); return sb.from("content_policies").upsert(list.map(policyToRow)).then(function (res) { if (!res.error) notifyContentUpdated(); return !res.error; }).catch(function () { return false; }); }
  function persistGallery(list) { cacheGallery = list.slice(); syncGalleryToLegacyStorage(list); var sb = getClient(); if (!sb) return Promise.resolve(true); return sb.from("content_gallery").upsert(list.map(galleryToRow)).then(function (res) { if (!res.error) notifyContentUpdated(); return !res.error; }).catch(function () { return false; }); }

  function getAbout() { return cacheAbout || JSON.parse(JSON.stringify(DEFAULT_ABOUT)); }
  function saveAbout(data) { cacheAbout = data; return persistAbout(data); }
  function getFaqs() { return normalizeFaqs(faqsList()); }
  function saveFaqs(list) { cacheFaqs = list.slice(); return persistFaqs(list); }
  function getActivities() { return (cacheActivities || DEFAULT_ACTIVITIES.slice()).slice(); }
  function saveActivities(list) { cacheActivities = list.slice(); syncActivitiesToShowcase(list); return persistActivities(list); }
  function getEvents() { return (cacheEvents || DEFAULT_EVENTS.slice()).slice(); }
  function saveEvents(list) { cacheEvents = list.slice(); syncActivitiesToShowcase(cacheActivities); return persistEvents(list); }
  function getFacilities() { return facilitiesList().filter(function (item) { return item.active !== false; }).slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }); }
  function getFacilitiesAll() { return facilitiesList().slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }); }
  function saveFacilities(list) { cacheFacilities = list.slice(); syncFacilitiesToLegacyStorage(list); return persistFacilities(list); }
  function getPolicies() { return policiesList().slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }); }
  function savePolicies(list) { cachePolicies = list.slice(); syncPoliciesToLegacyStorage(list); return persistPolicies(list); }
  function getGallery() {
    return galleryList()
      .filter(function (item) { return item.active !== false; })
      .slice()
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }
  function getGalleryAll() {
    return galleryList().slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }
  function saveGallery(list) { cacheGallery = list.slice(); syncGalleryToLegacyStorage(list); return persistGallery(list); }

  function upsertActivity(record) {
    var list = getActivities(); var id = record.id || uid();
    var next = { id: id, type: String(record.type || "Event").trim(), title: String(record.title || "").trim(), date: String(record.date || "").trim(), description: String(record.description || "").trim(), badge: String(record.badge || "Promotion").trim(), image: String(record.image || "").trim(), imageAlt: String(record.imageAlt || "").trim() };
    var found = false; list = list.map(function (item) { if (String(item.id) === String(id)) { found = true; return next; } return item; });
    if (!found) list.unshift(next);
    return Promise.resolve(saveActivities(list)).then(function () { return next; });
  }
  function deleteActivity(id) {
    return Promise.resolve(saveActivities(getActivities().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("content_activities").delete().eq("id", id);
    });
  }
  function upsertEvent(record) {
    var list = getEvents(); var id = record.id || uid();
    var next = { id: id, type: String(record.type || "Event").trim(), title: String(record.title || "").trim(), date: String(record.date || "").trim(), description: String(record.description || "").trim(), badge: String(record.badge || "Past event").trim(), image: String(record.image || "").trim(), imageAlt: String(record.imageAlt || "").trim() };
    var found = false; list = list.map(function (item) { if (String(item.id) === String(id)) { found = true; return next; } return item; });
    if (!found) list.unshift(next);
    return Promise.resolve(saveEvents(list)).then(function () { return next; });
  }
  function deleteEvent(id) {
    return Promise.resolve(saveEvents(getEvents().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("content_events").delete().eq("id", id);
    });
  }
  function upsertFacility(record) {
    var list = getFacilitiesAll(); var id = record.id || uid();
    var type = record.type === "cottage" ? "cottage" : record.type === "hall" ? "hall" : "room";
    var roomKind = type === "room" ? (record.roomKind || "") : "";
    var caps = defaultCapacityForFacility(type, roomKind);
    var capacity = record.capacity != null ? Number(record.capacity) : caps.capacity;
    if (!capacity || capacity <= 0 || isNaN(capacity)) capacity = caps.capacity;
    var capacityMin = null;
    if (type === "hall") {
      capacityMin = record.capacityMin != null ? Number(record.capacityMin) : caps.capacityMin || 60;
      if (!capacityMin || capacityMin <= 0 || isNaN(capacityMin)) capacityMin = 60;
    }
    var images = normalizeFacilityImages(record);
    var next = {
      id: id,
      type: type,
      roomKind: roomKind,
      name: String(record.name || "").trim(),
      price: Math.round(Number(record.price || 0)),
      priceUnit: record.priceUnit || "night",
      image: images[0] || "",
      images: images,
      description: String(record.description || "").trim(),
      capacity: capacity,
      capacityMin: capacityMin,
      sortOrder: Number(record.sortOrder) || list.length + 1,
      active: record.active !== false
    };
    var found = false; list = list.map(function (item) { if (String(item.id) === String(id)) { found = true; return next; } return item; });
    if (!found) list.push(next);
    return Promise.resolve(saveFacilities(list)).then(function () { return next; });
  }
  function deleteFacility(id) {
    return Promise.resolve(saveFacilities(getFacilitiesAll().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("room_catalog").delete().eq("id", id);
    });
  }
  function upsertPolicy(record) {
    var list = getPolicies(); var id = record.id || uid();
    var next = { id: id, kind: record.kind === "pool" ? "pool" : "general", title: String(record.title || "").trim(), description: String(record.description || "").trim(), image: String(record.image || "").trim(), sortOrder: Number(record.sortOrder) || list.length + 1 };
    var found = false; list = list.map(function (item) { if (String(item.id) === String(id)) { found = true; return next; } return item; });
    if (!found) list.push(next);
    return Promise.resolve(savePolicies(list)).then(function () { return next; });
  }
  function deletePolicy(id) {
    return Promise.resolve(savePolicies(getPolicies().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("content_policies").delete().eq("id", id);
    });
  }
  function upsertGalleryItem(record) {
    var list = getGalleryAll();
    var id = record.id || uid();
    var next = {
      id: id,
      title: String(record.title || "").trim(),
      image: String(record.image || "").trim(),
      imageAlt: String(record.imageAlt || record.title || "").trim(),
      sortOrder: Number(record.sortOrder) || list.length + 1,
      active: record.active !== false
    };
    var found = false;
    list = list.map(function (item) {
      if (String(item.id) === String(id)) {
        found = true;
        return next;
      }
      return item;
    });
    if (!found) list.push(next);
    return Promise.resolve(saveGallery(list)).then(function () { return next; });
  }
  function deleteGalleryItem(id) {
    return Promise.resolve(saveGallery(getGalleryAll().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("content_gallery").delete().eq("id", id);
    });
  }
  function upsertFaq(record) {
    var list = getFaqs(); var id = record.id || uid();
    var next = { id: id, question: String(record.question || "").trim(), answer: String(record.answer || "").trim(), sortOrder: Number(record.sortOrder) || list.length + 1, ctaLabel: record.ctaLabel ? String(record.ctaLabel).trim() : "", ctaHref: record.ctaHref ? String(record.ctaHref).trim() : "" };
    var found = false; list = list.map(function (item) { if (String(item.id) === String(id)) { found = true; return next; } return item; });
    if (!found) list.push(next);
    return Promise.resolve(saveFaqs(list)).then(function () { return next; });
  }
  function deleteFaq(id) {
    return Promise.resolve(saveFaqs(getFaqs().filter(function (item) { return String(item.id) !== String(id); }))).then(function () {
      var sb = getClient();
      if (sb) return sb.from("content_faqs").delete().eq("id", id);
    });
  }

  hydrateAboutFaqSnapshots();
  loadFromSupabase(false);
  subscribeRealtime(getClient());

  window.ElenestContentStore = {
    ready: ready,
    reload: function () { return loadFromSupabase(true); },
    getAbout: getAbout, saveAbout: saveAbout,
    getFaqs: getFaqs, saveFaqs: saveFaqs, upsertFaq: upsertFaq, deleteFaq: deleteFaq,
    getActivities: getActivities, saveActivities: saveActivities, upsertActivity: upsertActivity, deleteActivity: deleteActivity,
    getEvents: getEvents, saveEvents: saveEvents, upsertEvent: upsertEvent, deleteEvent: deleteEvent,
    getFacilities: getFacilities, getFacilitiesAll: getFacilitiesAll, saveFacilities: saveFacilities, upsertFacility: upsertFacility, deleteFacility: deleteFacility,
    getFacilityImages: getFacilityImages,
    renderFacilitySwipeElement: renderFacilitySwipeElement,
    bindFacilitySwipeGalleries: bindFacilitySwipeGalleries,
    openFacilityLightbox: openFacilityLightbox,
    closeFacilityLightbox: closeFacilityLightbox,
    getPolicies: getPolicies, savePolicies: savePolicies, upsertPolicy: upsertPolicy, deletePolicy: deletePolicy,
    getGallery: getGallery, getGalleryAll: getGalleryAll, saveGallery: saveGallery,
    upsertGalleryItem: upsertGalleryItem, deleteGalleryItem: deleteGalleryItem,
    uid: uid
  };
})();
