(function () {
  var cachedFeedback = [];

  function withPreservedScroll(fn) {
    if (typeof window.ElenestPreserveScroll === "function") return window.ElenestPreserveScroll(fn);
    var x = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var result;
    try {
      result = typeof fn === "function" ? fn() : undefined;
    } finally {
      try {
        window.scrollTo(x, y);
      } catch (err) {}
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

  function starsText(n) {
    var s = Math.max(0, Math.min(5, Number(n) || 0));
    return "★★★★★".slice(0, s) + "☆☆☆☆☆".slice(0, 5 - s);
  }

  function classifySentiment(f) {
    var raw = String((f && (f.sentiment || f.sentimentLabel)) || "")
      .trim()
      .toLowerCase();
    if (/^(pos|positive)\b/.test(raw) || raw === "pos") return "pos";
    if (/^(neg|negative|needs)\b/.test(raw) || raw === "neg") return "neg";
    if (/^(neu|neutral)\b/.test(raw) || raw === "neu") return "neu";
    var s = Number(f && f.stars) || 0;
    if (s >= 4) return "pos";
    if (s === 3) return "neu";
    if (s > 0 && s <= 2) return "neg";
    return "";
  }

  function sentimentPercents(list) {
    var positive = 0;
    var neutral = 0;
    var negative = 0;
    (list || []).forEach(function (f) {
      var c = classifySentiment(f);
      if (c === "pos") positive += 1;
      else if (c === "neu") neutral += 1;
      else if (c === "neg") negative += 1;
    });
    var total = positive + neutral + negative;
    if (!total) {
      return { positive: 0, neutral: 0, negative: 0, total: 0 };
    }
    var parts = [
      { key: "positive", count: positive },
      { key: "neutral", count: neutral },
      { key: "negative", count: negative }
    ];
    parts.forEach(function (p) {
      var exact = (p.count / total) * 100;
      p.floor = Math.floor(exact);
      p.frac = exact - p.floor;
    });
    var used = parts.reduce(function (sum, p) {
      return sum + p.floor;
    }, 0);
    var remain = 100 - used;
    parts
      .slice()
      .sort(function (a, b) {
        return b.frac - a.frac;
      })
      .forEach(function (p, idx) {
        if (idx < remain) p.floor += 1;
      });
    var out = { positive: 0, neutral: 0, negative: 0, total: total };
    parts.forEach(function (p) {
      out[p.key] = p.floor;
    });
    return out;
  }

  function getFeedbackList() {
    var api = window.ElenestGuestFeedback;
    var list = [];
    if (api && typeof api.listLive === "function") list = api.listLive();
    else if (api && typeof api.listAll === "function") {
      list = api.listAll().filter(function (item) {
        return !api.isHistoricalFeedback || !api.isHistoricalFeedback(item);
      });
    }
    return (list || []).slice().sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  var REVIEWS_PAGE_SIZE = 12;
  var reviewsPage = 1;

  function photoFor(f, i) {
    return f.photo || ["../Images/blog-s1.png", "../Images/blog-s2.png", "../Images/blog-s3.png"][i % 3];
  }

  function reviewGuestName(f) {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.displayName === "function") return api.displayName(f);
    var name = String((f && f.name) || "").trim();
    if (!name || name.toLowerCase() === "guest") return "Guest";
    return name;
  }

  function reviewCardHtml(f, i) {
    var name = reviewGuestName(f);
    var img = photoFor(f, i);
    var stars = Number(f.stars) || 0;
    return (
      '<article class="card review-card reviews-card">' +
      '<img src="' +
      esc(img) +
      '" alt="' +
      esc(name) +
      '" class="review-img">' +
      '<div class="reviews-card__body">' +
      '<div class="reviews-card__top">' +
      "<h3>" +
      esc(name) +
      "</h3>" +
      '<p class="stars" aria-label="' +
      esc(stars) +
      ' star rating">' +
      starsText(stars) +
      "</p>" +
      "</div>" +
      '<p class="reviews-card__comment">"' +
      esc(f.comment || "No comment.") +
      '"</p>' +
      "</div>" +
      "</article>"
    );
  }

  function applySentimentBars(sentiment) {
    var pos = Number(sentiment.positive) || 0;
    var neu = Number(sentiment.neutral) || 0;
    var neg = Number(sentiment.negative) || 0;
    var barPos = document.getElementById("reviewsSentimentBarPos");
    var barNeu = document.getElementById("reviewsSentimentBarNeu");
    var barNeg = document.getElementById("reviewsSentimentBarNeg");
    var pctPos = document.getElementById("reviewsSentimentPctPos");
    var pctNeu = document.getElementById("reviewsSentimentPctNeu");
    var pctNeg = document.getElementById("reviewsSentimentPctNeg");
    if (barPos) barPos.style.width = pos + "%";
    if (barNeu) barNeu.style.width = neu + "%";
    if (barNeg) barNeg.style.width = neg + "%";
    if (pctPos) pctPos.textContent = pos + "%";
    if (pctNeu) pctNeu.textContent = neu + "%";
    if (pctNeg) pctNeg.textContent = neg + "%";
  }

  function render() {
    withPreservedScroll(function () {
      var realFeedback = getFeedbackList();
      var hasReal = realFeedback.length > 0;
      cachedFeedback = realFeedback;

      var reviewsGrid = document.getElementById("reviewsGrid");
      var pager = document.getElementById("reviewsPagination");
      var prevBtn = document.getElementById("reviewsPrevBtn");
      var nextBtn = document.getElementById("reviewsNextBtn");
      var pageLabel = document.getElementById("reviewsPageLabel");

      if (reviewsGrid) {
        if (!hasReal) {
          reviewsGrid.innerHTML =
            '<p class="reviews-empty">No guest reviews yet. Reviews appear here after completed stays.</p>';
          if (pager) pager.hidden = true;
        } else {
          var totalPages = Math.max(1, Math.ceil(realFeedback.length / REVIEWS_PAGE_SIZE));
          if (reviewsPage > totalPages) reviewsPage = totalPages;
          if (reviewsPage < 1) reviewsPage = 1;
          var start = (reviewsPage - 1) * REVIEWS_PAGE_SIZE;
          var visible = realFeedback.slice(start, start + REVIEWS_PAGE_SIZE);
          reviewsGrid.innerHTML = visible.map(reviewCardHtml).join("");

          if (pager) {
            pager.hidden = totalPages <= 1;
            if (pageLabel) pageLabel.textContent = "Page " + reviewsPage;
            if (prevBtn) prevBtn.disabled = reviewsPage <= 1;
            if (nextBtn) nextBtn.disabled = reviewsPage >= totalPages;
          }
        }
      }

      var sentiment = hasReal
        ? sentimentPercents(realFeedback)
        : { positive: 0, neutral: 0, negative: 0, total: 0 };
      applySentimentBars(sentiment);
    });
  }

  function refreshFromServer() {
    var api = window.ElenestGuestFeedback;
    if (api && typeof api.refresh === "function") {
      return Promise.resolve(api.refresh())
        .then(function () {
          render();
        })
        .catch(function () {
          render();
        });
    }
    render();
    return Promise.resolve();
  }

  function queryParam(name) {
    try {
      var search = window.location.search || "";
      var params = new URLSearchParams(search);
      var fromSearch = String(params.get(name) || "").trim();
      if (fromSearch) return fromSearch;
      var hash = String(window.location.hash || "").replace(/^#/, "");
      var qIndex = hash.indexOf("?");
      var query = qIndex >= 0 ? hash.slice(qIndex + 1) : hash;
      if (query.indexOf("=") === -1) return "";
      return String(new URLSearchParams(query).get(name) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function normalizeStatus(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ");
  }

  function isEligibleReviewStatus(status, booking) {
    var st = normalizeStatus(status);
    if (st === "checked out" || st === "completed") return true;
    if (booking && (booking.checkedOutAt || booking.checked_out_at)) return true;
    var payload = booking && booking.payload;
    if (payload && typeof payload === "object") {
      if (payload.checkedOutAt || payload.checked_out_at) return true;
      var pst = normalizeStatus(payload.status);
      if (pst === "checked out" || pst === "completed") return true;
    }
    return false;
  }

  function getSupabase() {
    try {
      if (
        window.ElenestSupabaseHelpers &&
        typeof window.ElenestSupabaseHelpers.getClient === "function"
      ) {
        return window.ElenestSupabaseHelpers.getClient();
      }
    } catch (e) {}
    return window.ElenestSupabase || null;
  }

  function alreadyReviewedBooking(bookingId) {
    var id = String(bookingId || "");
    if (!id) return false;
    return (cachedFeedback || []).some(function (f) {
      return String(f.bookingId || f.booking_id || "") === id;
    });
  }

  function fetchReviewContext(bookingId, email) {
    var sb = getSupabase();
    if (!sb || typeof sb.rpc !== "function") {
      return Promise.resolve(null);
    }
    return sb
      .rpc("get_review_invite_context", {
        p_booking_id: bookingId,
        p_email: email || null
      })
      .then(function (res) {
        if (res.error) throw res.error;
        var data = res.data || null;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch (e) {
            data = null;
          }
        }
        if (Array.isArray(data)) data = data[0] || null;
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function inviteGuestName(ctx, bookingId) {
    var raw = ctx && (ctx.name || ctx.display_name);
    var resolved = reviewGuestName({
      name: raw,
      bookingId: (ctx && (ctx.booking_id || ctx.bookingId)) || bookingId,
      id: ctx && ctx.feedback_id
    });
    if (resolved && resolved !== "Guest") return resolved;
    var fromLink = queryParam("name");
    if (fromLink && fromLink.toLowerCase() !== "guest") return fromLink;
    return resolved || "Guest";
  }

  function setReviewMsg(ok, text) {
    var el = document.getElementById("guestReviewMsg");
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function clearReviewMsg() {
    var el = document.getElementById("guestReviewMsg");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    el.className = "auth-msg";
  }

  function closeGuestReviewModal() {
    var overlay = document.getElementById("guestReviewOverlay");
    if (!overlay) return;
    overlay.setAttribute("hidden", "");
    document.body.classList.remove("guest-review-open");
  }

  function openGuestReviewModal(ctx) {
    var overlay = document.getElementById("guestReviewOverlay");
    var form = document.getElementById("guestReviewForm");
    var nameEl = document.getElementById("guestReviewName");
    var emailEl = document.getElementById("guestReviewEmail");
    var bookingEl = document.getElementById("guestReviewBookingId");
    var commentEl = document.getElementById("guestReviewComment");
    var lede = document.getElementById("guestReviewModalLede");
    var starsEl = document.getElementById("guestReviewStars");
    if (!overlay || !form) return;

    if (form) form.hidden = false;
    var title = document.getElementById("guestReviewModalTitle");
    if (title) title.textContent = "Review Your Activity";
    var guestName = inviteGuestName(ctx, ctx && ctx.bookingId);
    if (nameEl) nameEl.value = guestName;
    if (emailEl) emailEl.value = ctx.email || "";
    if (bookingEl) bookingEl.value = ctx.bookingId || "";
    if (commentEl && !String(commentEl.value || "").trim()) commentEl.value = "";
    if (lede) {
      lede.textContent =
        guestName && guestName !== "Guest"
          ? "Hi " + guestName + " — thank you for your stay. Please leave a rating and comment."
          : "Thank you for your stay. Please share a quick rating and comment.";
    }
    if (starsEl) {
      starsEl.querySelectorAll(".feedback-star").forEach(function (b) {
        b.classList.remove("is-active");
        b.setAttribute("aria-checked", "false");
      });
    }
    form.setAttribute("data-selected-stars", "0");
    clearReviewMsg();
    overlay.removeAttribute("hidden");
    document.body.classList.add("guest-review-open");
    var closeBtn = document.getElementById("guestReviewModalClose");
    if (closeBtn) closeBtn.focus();
  }

  function showReviewPreparing() {
    var overlay = document.getElementById("guestReviewOverlay");
    var form = document.getElementById("guestReviewForm");
    var lede = document.getElementById("guestReviewModalLede");
    var title = document.getElementById("guestReviewModalTitle");
    if (!overlay) return;
    if (title) title.textContent = "Review Your Activity";
    if (form) form.hidden = true;
    if (lede) lede.textContent = "Opening your review…";
    clearReviewMsg();
    overlay.removeAttribute("hidden");
    document.body.classList.add("guest-review-open");
  }

  function showReviewBlocked(message, ok) {
    var overlay = document.getElementById("guestReviewOverlay");
    var form = document.getElementById("guestReviewForm");
    var lede = document.getElementById("guestReviewModalLede");
    var title = document.getElementById("guestReviewModalTitle");
    if (!overlay) return;
    if (title) title.textContent = "Review Your Activity";
    if (form) form.hidden = true;
    if (lede) lede.textContent = message || "This review link is not available.";
    setReviewMsg(!!ok, message || "This review link is not available.");
    overlay.removeAttribute("hidden");
    document.body.classList.add("guest-review-open");
  }

  function refreshOpenInviteName() {
    var overlay = document.getElementById("guestReviewOverlay");
    var bookingEl = document.getElementById("guestReviewBookingId");
    var nameEl = document.getElementById("guestReviewName");
    if (!overlay || overlay.hasAttribute("hidden") || !bookingEl) return;
    var bookingId = String(bookingEl.value || "").trim();
    if (!bookingId) return;
    var next = reviewGuestName({
      name: nameEl ? nameEl.value : "",
      bookingId: bookingId
    });
    if (!next || next === "Guest") return;
    if (nameEl && nameEl.value !== next) nameEl.value = next;
    var lede = document.getElementById("guestReviewModalLede");
    var form = document.getElementById("guestReviewForm");
    if (lede && form && !form.hidden) {
      lede.textContent =
        "Hi " + next + " — thank you for your stay. Please leave a rating and comment.";
    }
  }

  function initGuestReviewModal() {
    var overlay = document.getElementById("guestReviewOverlay");
    var form = document.getElementById("guestReviewForm");
    if (!overlay || !form) return;

    var starsEl = document.getElementById("guestReviewStars");
    var closeX = document.getElementById("guestReviewModalClose");
    var dismiss = document.getElementById("guestReviewModalDismiss");

    function close() {
      closeGuestReviewModal();
    }

    if (closeX) closeX.addEventListener("click", close);
    if (dismiss) dismiss.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hasAttribute("hidden")) close();
    });

    if (starsEl) {
      starsEl.querySelectorAll(".feedback-star").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var score = Number(btn.getAttribute("data-star") || 0);
          form.setAttribute("data-selected-stars", String(score > 0 ? score : 0));
          starsEl.querySelectorAll(".feedback-star").forEach(function (b) {
            var v = Number(b.getAttribute("data-star") || 0);
            var on = v <= score;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", on ? "true" : "false");
          });
          clearReviewMsg();
        });
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var bookingId = String(
        (document.getElementById("guestReviewBookingId") || {}).value || ""
      ).trim();
      var name = String((document.getElementById("guestReviewName") || {}).value || "").trim();
      var email = String((document.getElementById("guestReviewEmail") || {}).value || "").trim();
      var comment = String(
        (document.getElementById("guestReviewComment") || {}).value || ""
      ).trim();
      var selectedStars = Number(form.getAttribute("data-selected-stars") || 0);

      if (!bookingId) {
        setReviewMsg(false, "This review link is missing a booking reference.");
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setReviewMsg(false, "A valid guest email is required for this review.");
        return;
      }
      if (!selectedStars || !comment) {
        setReviewMsg(false, "Please provide a star rating and comment.");
        return;
      }
      if (alreadyReviewedBooking(bookingId)) {
        setReviewMsg(false, "A review was already submitted for this stay. Thank you!");
        return;
      }

      var feedbackApi = window.ElenestGuestFeedback;
      if (!feedbackApi || typeof feedbackApi.add !== "function") {
        setReviewMsg(false, "Feedback service is unavailable. Refresh and try again.");
        return;
      }

      var submitBtn = document.getElementById("guestReviewSubmit");
      var BL = window.ElenestButtonLoading;
      if (BL) BL.set(submitBtn, true);
      else if (submitBtn) submitBtn.disabled = true;

      feedbackApi
        .add({
          name: reviewGuestName({ name: name, bookingId: bookingId }),
          email: email,
          stars: selectedStars,
          comment: comment,
          bookingId: bookingId,
          requireCompletedBooking: true
        })
        .then(function () {
          setReviewMsg(true, "Thank you! Your review has been submitted.");
          render();
          setTimeout(function () {
            close();
            try {
              var grid = document.getElementById("reviewsGrid");
              if (grid && grid.scrollIntoView) {
                grid.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            } catch (err) {}
          }, 1200);
        })
        .catch(function (err) {
          setReviewMsg(
            false,
            (err && err.message) || "Could not save your review. Please try again."
          );
        })
        .finally(function () {
          if (BL) BL.set(submitBtn, false);
          else if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  var inviteFlowStarted = false;

  function whenSupabaseReady() {
    if (getSupabase()) return Promise.resolve(getSupabase());
    return new Promise(function (resolve) {
      var tries = 0;
      var timer = setInterval(function () {
        tries += 1;
        var sb = getSupabase();
        if (sb || tries > 40) {
          clearInterval(timer);
          resolve(sb || null);
        }
      }, 50);
    });
  }

  function maybeOpenReviewFromInvite() {
    if (inviteFlowStarted) return;
    var bookingId = queryParam("booking");
    var email = queryParam("email");
    var reviewFlag = String(queryParam("review") || "").toLowerCase();
    var hash = String(window.location.hash || "");
    var wantsReview =
      reviewFlag === "1" ||
      reviewFlag === "true" ||
      reviewFlag === "yes" ||
      hash === "#guest-review" ||
      hash.indexOf("#guest-review") === 0 ||
      hash === "#give-feedback";

    if (!wantsReview || !bookingId) return;
    inviteFlowStarted = true;
    showReviewPreparing();

    function openWith(ctx) {
      var msg = String((ctx && ctx.message) || "");
      var emailMismatch = /does not match the guest email/i.test(msg);
      if (ctx && ctx.already_reviewed) {
        showReviewBlocked("You already submitted a review for this stay. Thank you!", true);
        return;
      }
      if (ctx && ctx.ok === false && /could not find this booking/i.test(msg)) {
        showReviewBlocked(msg);
        return;
      }
      if (ctx && ctx.eligible === false && !emailMismatch) {
        showReviewBlocked(
          msg || "Reviews are only available after checkout or when your booking is completed."
        );
        return;
      }
      openGuestReviewModal({
        bookingId: (ctx && ctx.booking_id) || bookingId,
        email: (ctx && ctx.email) || email,
        name: inviteGuestName(ctx, bookingId)
      });
    }

    whenSupabaseReady().then(function () {
      return fetchReviewContext(bookingId, email);
    }).then(function (ctx) {
      if (ctx && typeof ctx === "object") {
        openWith(ctx);
        return;
      }
      if (alreadyReviewedBooking(bookingId)) {
        showReviewBlocked("You already submitted a review for this stay. Thank you!", true);
        return;
      }
      openGuestReviewModal({
        bookingId: bookingId,
        email: email,
        name: inviteGuestName(null, bookingId)
      });
    });
  }

  render();
  initGuestReviewModal();
  maybeOpenReviewFromInvite();

  var prevBtn = document.getElementById("reviewsPrevBtn");
  var nextBtn = document.getElementById("reviewsNextBtn");
  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      if (reviewsPage <= 1) return;
      reviewsPage -= 1;
      render();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      reviewsPage += 1;
      render();
    });
  }

  (window.ElenestGuestFeedback && window.ElenestGuestFeedback.ready
    ? window.ElenestGuestFeedback.ready
    : Promise.resolve()
  ).then(function () {
    render();
    maybeOpenReviewFromInvite();
  });

  window.addEventListener("elenest-feedback-updated", function () {
    render();
    refreshOpenInviteName();
  });

  window.addEventListener("elenest-review-names-updated", function () {
    render();
    refreshOpenInviteName();
  });

  window.addEventListener("storage", function (e) {
    if (!e || e.key === "elenest_feedback") render();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    refreshFromServer();
  });

  setInterval(function () {
    if (typeof document !== "undefined" && document.hidden) return;
    refreshFromServer();
  }, 8000);
})();
