(function () {
  var lastFacilitiesSig = "";
  var lastGallerySig = "";
  var lastActivitiesSig = "";
  var lastPoliciesSig = "";

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

  function listSig(list, pick) {
    return (list || [])
      .map(function (item) {
        return pick(item);
      })
      .join("\n");
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtPHP(n) {
    var v = Number(n);
    if (isNaN(v)) return "₱0";
    return "₱" + Math.round(v).toLocaleString();
  }

  function typeLabel(type) {
    if (type === "cottage") return "Cottages";
    if (type === "hall") return "Event Hall";
    return "Rooms";
  }

  function unitLabel(u) {
    if (u === "day") return "Per Day";
    if (u === "event") return "Per Event";
    return "Per Night";
  }

  function policyIcon(p) {
    if (String(p && p.kind || "").toLowerCase() === "pool") return "fa-solid fa-person-swimming";
    var title = String(p && p.title || "").toLowerCase();
    if (/check-in|check-out|check in|check out/.test(title)) return "fa-solid fa-key";
    if (/reservation|payment/.test(title)) return "fa-solid fa-credit-card";
    if (/pool|facilit/.test(title)) return "fa-solid fa-person-swimming";
    if (/food|beverage|drink/.test(title)) return "fa-solid fa-utensils";
    if (/quiet|conduct|noise|clean/.test(title)) return "fa-solid fa-volume-off";
    if (/pet|animal/.test(title)) return "fa-solid fa-paw";
    return "fa-solid fa-clipboard-list";
  }

  var FACILITY_FALLBACKS = [
    {
      type: "room",
      name: "Rooms",
      price: 2500,
      priceUnit: "night",
      image: "../Images/small-room-bed.jpg",
      description: "Comfortable rooms for restful stays."
    },
    {
      type: "cottage",
      name: "Cottages",
      price: 1000,
      priceUnit: "day",
      image: "../Images/gallery-5.png",
      description: "Shaded open-air cottages near the pool."
    },
    {
      type: "hall",
      name: "Event Hall",
      price: 10000,
      priceUnit: "event",
      image: "../Images/gallery-2.png",
      description: "Spacious halls for celebrations and events."
    }
  ];

  function destroyFacilitiesCarousel(host) {
    if (!window.jQuery || !window.jQuery.fn.owlCarousel) return;
    var $host = window.jQuery(host);
    if ($host.hasClass("owl-loaded")) {
      $host.trigger("destroy.owl.carousel");
    }
    host.removeAttribute("data-owl-init");
    host.className = "owl-carousel owl-carousel1 owl-theme";
  }

  function initFacilitiesCarousel(host) {
    if (!window.jQuery || !window.jQuery.fn.owlCarousel) return;
    if (host.getAttribute("data-owl-init")) return;
    host.setAttribute("data-owl-init", "1");
    window.jQuery(host).owlCarousel({
      loop: true,
      margin: 24,
      nav: true,
      dots: false,
      mouseDrag: true,
      touchDrag: true,
      pullDrag: true,
      slideBy: 1,
      smartSpeed: 450,
      navText: [
        "<i class='fa fa-chevron-left'></i>",
        "<i class='fa fa-chevron-right'></i>"
      ],
      responsive: {
        0: { items: 1, margin: 12 },
        768: { items: 2, margin: 14 },
        1000: { items: 3, margin: 18 }
      }
    });
  }

  function renderFacilitiesCarousel(list) {
    var host = document.getElementById("homeFacilitiesCarousel");
    if (!host) return;

    if (!list.length) list = FACILITY_FALLBACKS.slice();

    var sig = listSig(list, function (f) {
      return [f.type, f.name, f.price, f.priceUnit, facilityCoverSrc(f), f.description].join("|");
    });
    if (sig === lastFacilitiesSig && host.getAttribute("data-owl-init")) return;
    lastFacilitiesSig = sig;

    destroyFacilitiesCarousel(host);

    host.innerHTML = list
      .map(function (f) {
        var type = String(f.type || "room");
        var name = f.name || typeLabel(type);
        var ctaHref = type === "hall" ? "contact.html" : "login.html?next=book.html";
        var ctaText = type === "hall" ? "Inquire" : "Book now";
        return (
          '<div class="items">' +
          '<div class="image"><img src="' +
          esc(facilityCoverSrc(f)) +
          '" alt="' +
          esc(name) +
          '"><span class="rooms-card-type">' +
          esc(typeLabel(type)) +
          "</span></div>" +
          '<div class="text">' +
          "<h2>" +
          esc(name) +
          "</h2>" +
          '<div class="rate flex" aria-hidden="true"><i class="fa fa-star"></i><i class="fa fa-star"></i><i class="fa fa-star"></i><i class="fa fa-star"></i><i class="fa fa-star"></i></div>' +
          "<p>" +
          esc(f.description || "") +
          "</p>" +
          '<div class="button flex">' +
          '<a href="' +
          ctaHref +
          '" class="primary-btn">' +
          ctaText +
          "</a>" +
          "<h3>" +
          fmtPHP(f.price) +
          " <span>" +
          unitLabel(String(f.priceUnit || "night")) +
          "</span></h3>" +
          "</div></div></div>"
        );
      })
      .join("");

    initFacilitiesCarousel(host);
  }

  function renderPoliciesGrid(list) {
    var host = document.getElementById("homePoliciesGrid");
    if (!host || !list.length) return;
    var sig = listSig(list.slice(0, 4), function (p) {
      return [p.kind, p.title, p.description].join("|");
    });
    if (sig === lastPoliciesSig) return;
    lastPoliciesSig = sig;
    host.innerHTML = list
      .slice(0, 4)
      .map(function (p) {
        return (
          '<article class="card policy-card">' +
          '<div class="policy-card__icon-wrap" aria-hidden="true"><i class="' +
          esc(policyIcon(p)) +
          '"></i></div>' +
          "<h3>" +
          esc(p.title || "Policy") +
          "</h3>" +
          "<p>" +
          esc(p.description || "") +
          "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  var GALLERY_FALLBACKS = [
    { title: "Resort lounge", image: "../Images/gallery-1.png", imageAlt: "Elenest Resort lounge" },
    { title: "Poolside view", image: "../Images/gallery-2.png", imageAlt: "Poolside area at Elenest" },
    { title: "Ocean suite bath", image: "../Images/gallery-3.png", imageAlt: "Suite bathroom overlooking the water" },
    { title: "Living space", image: "../Images/gallery-4.png", imageAlt: "Comfortable living space" },
    { title: "Resort exterior", image: "../Images/gallery-5.png", imageAlt: "Elenest Resort exterior" },
    { title: "Event hall", image: "../Images/gallery-6.png", imageAlt: "Indoor event hall" }
  ];

  function destroyGalleryCarousel(host) {
    if (!window.jQuery || !window.jQuery.fn.owlCarousel) return;
    var $host = window.jQuery(host);
    if ($host.hasClass("owl-loaded")) {
      $host.trigger("destroy.owl.carousel");
    }
    host.removeAttribute("data-owl-init");
    host.className = "owl-carousel owl-gallery owl-theme";
  }

  function initGalleryCarousel(host) {
    if (!window.jQuery || !window.jQuery.fn.owlCarousel) return;
    if (host.getAttribute("data-owl-init")) return;
    host.setAttribute("data-owl-init", "1");
    window.jQuery(host).owlCarousel({
      loop: true,
      margin: 0,
      nav: true,
      dots: true,
      autoplay: true,
      autoplayTimeout: 4500,
      autoplayHoverPause: true,
      smartSpeed: 450,
      touchDrag: true,
      mouseDrag: true,
      navText: [
        "<i class='fa fa-chevron-left'></i>",
        "<i class='fa fa-chevron-right'></i>"
      ],
      responsive: {
        0: { items: 1, margin: 8, dots: true },
        576: { items: 2, margin: 8, dots: true },
        768: { items: 3, margin: 0, dots: false },
        1000: { items: 4, margin: 0, dots: false }
      }
    });
  }

  function renderGalleryCarousel(list) {
    var host = document.getElementById("homeGalleryCarousel");
    if (!host) return;

    if (!list || !list.length) list = GALLERY_FALLBACKS.slice();

    var sig = listSig(list, function (g) {
      return [g.title, g.image, g.imageAlt].join("|");
    });
    if (sig === lastGallerySig && host.getAttribute("data-owl-init")) return;
    lastGallerySig = sig;

    destroyGalleryCarousel(host);

    host.innerHTML = list
      .map(function (g) {
        var title = g.title || "Moments at Elenest";
        var alt = g.imageAlt || title;
        var src = g.image || "../Images/gallery-1.png";
        return (
          '<div class="items">' +
          '<div class="img">' +
          '<img src="' +
          esc(src) +
          '" alt="' +
          esc(alt) +
          '" loading="lazy">' +
          "</div>" +
          '<div class="overlay">' +
          '<span class="fa fa-plus" aria-hidden="true"></span>' +
          "<h3>" +
          esc(title) +
          "</h3>" +
          "</div>" +
          '<p class="gallery-caption">' +
          esc(title) +
          "</p>" +
          "</div>"
        );
      })
      .join("");

    initGalleryCarousel(host);
  }

  function facilityCoverSrc(f) {
    var S = window.ElenestContentStore;
    if (S && typeof S.getFacilityImages === "function") {
      var imgs = S.getFacilityImages(f);
      if (imgs && imgs[0]) return imgs[0];
    }
    return (f && f.image) || "../Images/room-1.png";
  }

  function typeOrder(type) {
    var t = String(type || "room");
    if (t === "room") return 1;
    if (t === "cottage") return 2;
    if (t === "hall") return 3;
    return 9;
  }

  function listHomeFacilities(facilities) {
    var list = (facilities || []).filter(function (f) {
      return f && f.active !== false;
    });
    if (!list.length) return FACILITY_FALLBACKS.slice();
    return list.slice().sort(function (a, b) {
      var d = typeOrder(a.type) - typeOrder(b.type);
      if (d) return d;
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    });
  }

  var ACTIVITIES_FALLBACKS = [
    {
      title: "Garden Wedding Package",
      type: "Wedding",
      date: "Promo — valid through Dec 2026",
      description:
        "Say “I do” beside our poolside event hall with floral arch setup, reserved guest cottages, and complimentary welcome drinks for up to 50 guests.",
      image: "../Images/gallery-2.png",
      imageAlt: "Poolside event hall set up for a garden wedding at Elenest Resort"
    },
    {
      title: "Kids Pool Party Special",
      type: "Birthday",
      date: "Weekends in summer 2026",
      description:
        "Celebrate with a private pool area, themed décor, and a function hall for cake-cutting and games. Perfect for debuts and family birthdays.",
      image: "../Images/blog-s1.png",
      imageAlt: "Swimming pool area decorated for a birthday celebration"
    },
    {
      title: "Team Building Day Tour",
      type: "Corporate",
      date: "Book 15+ participants",
      description:
        "Full-day access to resort facilities, air-conditioned meeting space, and catered lunch. Ideal for seminars, retreats, and company outings.",
      image: "../Images/service.png",
      imageAlt: "Corporate team building and meeting space at the resort"
    },
    {
      title: "Family Reunion Weekend",
      type: "Reunion",
      date: "Multi-room block rates",
      description:
        "Reserve multiple couple and big rooms plus cottages for extended family stays. Includes use of the upper hall for your program night.",
      image: "../Images/gallery-5.png",
      imageAlt: "Cottages and open-air spaces for a family reunion weekend"
    },
    {
      title: "Celebrate at Elenest",
      type: "Events",
      date: "Book your date",
      description:
        "From birthdays and reunions to corporate gatherings, our event hall and resort grounds give you a memorable place to celebrate together.",
      image: "../Images/blog-2.png",
      imageAlt: "Celebrations and events at Elenest Resort"
    }
  ];

  function excerpt(text, maxLen) {
    var s = String(text || "").trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
  }

  function renderHomeActivities(list) {
    var featuredHost = document.getElementById("homeActivitiesFeatured");
    var sideHost = document.getElementById("homeActivitiesSide");
    if (!featuredHost || !sideHost) return;

    var items = Array.isArray(list) && list.length ? list.slice() : ACTIVITIES_FALLBACKS.slice();
    // Keep Supabase photos first; only pad from fallbacks if fewer than 2 featured cards.
    while (items.length < 2) {
      items.push(ACTIVITIES_FALLBACKS[items.length % ACTIVITIES_FALLBACKS.length]);
    }

    var featured = items.slice(0, 2);
    var side = items.slice(2, 5);
    var sig = listSig(featured.concat(side), function (a) {
      return [a.title, a.image, a.date, a.type, a.description].join("|");
    });
    if (sig === lastActivitiesSig) return;
    lastActivitiesSig = sig;

    featuredHost.innerHTML = featured
      .map(function (a) {
        var title = a.title || "Activity";
        var img = a.image || "../Images/gallery-1.png";
        var alt = a.imageAlt || title;
        var meta = a.date || a.type || "Elenest Resort";
        return (
          '<div class="items">' +
          '<div class="image">' +
          '<img src="' +
          esc(img) +
          '" alt="' +
          esc(alt) +
          '" loading="lazy">' +
          "</div>" +
          '<div class="text">' +
          "<h2>" +
          esc(title) +
          "</h2>" +
          '<div class="admin flex">' +
          '<i class="fa fa-user" aria-hidden="true"></i>' +
          "<label>Elenest Team</label>" +
          '<i class="fa fa-calendar" aria-hidden="true"></i>' +
          "<label>" +
          esc(meta) +
          "</label>" +
          "</div>" +
          "<p>" +
          esc(excerpt(a.description, 160)) +
          "</p>" +
          "</div></div>"
        );
      })
      .join("");

    sideHost.innerHTML = side
      .map(function (a) {
        var title = a.title || "Activity";
        var img = a.image || "../Images/gallery-1.png";
        var alt = a.imageAlt || title;
        return (
          '<div class="box flex">' +
          '<div class="img">' +
          '<img src="' +
          esc(img) +
          '" alt="' +
          esc(alt) +
          '" loading="lazy">' +
          "</div>" +
          '<div class="stext">' +
          "<h2>" +
          esc(title) +
          "</h2>" +
          "<p>" +
          esc(excerpt(a.description, 110)) +
          "</p>" +
          "</div></div>"
        );
      })
      .join("");
  }

  function render() {
    withPreservedScroll(function () {
      var S = window.ElenestContentStore;
      if (!S) return;
      renderFacilitiesCarousel(listHomeFacilities(S.getFacilities()));
      renderGalleryCarousel(typeof S.getGallery === "function" ? S.getGallery() : []);
      renderHomeActivities(typeof S.getActivities === "function" ? S.getActivities() : []);
      renderPoliciesGrid(S.getPolicies());
    });
  }

  (window.ElenestContentStore.ready || Promise.resolve()).then(render);
  window.addEventListener("elenest-content-updated", render);
})();
