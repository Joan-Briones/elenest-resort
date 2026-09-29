/**
 * User-facing error helpers for Elenest staff portals.
 * Keeps raw exceptions / stack traces out of the UI while logging details for debugging.
 */
(function (global) {
  "use strict";

  var TOAST_ID = "elenestErrorToast";
  var bound = false;

  function isDevHost() {
    try {
      var h = String((global.location && global.location.hostname) || "");
      return h === "localhost" || h === "127.0.0.1" || h.indexOf("192.168.") === 0;
    } catch (e) {
      return false;
    }
  }

  function logError(scope, err) {
    try {
      console.warn("[Elenest]", scope || "error", err);
    } catch (e2) {}
  }

  function friendlyMessage(err, fallback) {
    var fb = fallback || "Something went wrong. Please try again.";
    if (err == null) return fb;
    if (typeof err === "string") {
      var s = err.trim();
      if (!s) return fb;
      if (/HISTORICAL_UNAVAILABLE/i.test(s)) {
        return "Historical booking data could not be loaded. Please try again.";
      }
      if (/failed to fetch|networkerror|network request failed|load failed/i.test(s)) {
        return "Network problem. Check your connection and try again.";
      }
      if (/jwt|session|not authenticated|invalid login|auth/i.test(s)) {
        return "Your session expired or sign-in failed. Please sign in again.";
      }
      if (/permission|rls|row-level|forbidden|401|403/i.test(s)) {
        return "You do not have permission to complete this action.";
      }
      if (/timeout|timed out/i.test(s)) {
        return "The request timed out. Please try again.";
      }
      // Hide stack-like / path dumps from guests/staff UI
      if (/at\s+\S+\s+\(|\.js:\d+:\d+|TypeError:|ReferenceError:|SyntaxError:/i.test(s)) {
        return fb;
      }
      if (s.length > 180) return fb;
      return s;
    }
    if (typeof err === "object") {
      if (err.code === "HISTORICAL_UNAVAILABLE" && err.message) return String(err.message);
      var msg = err.message || err.error_description || err.error || err.details || "";
      var code = err.code || err.status || err.statusCode || "";
      if (code === "PGRST301" || code === 401 || code === "401") {
        return "Your session expired. Please sign in again.";
      }
      if (code === "42501" || code === 403 || code === "403") {
        return "You do not have permission to complete this action.";
      }
      return friendlyMessage(String(msg || code), fb);
    }
    return fb;
  }

  function ensureToast() {
    var el = document.getElementById(TOAST_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = TOAST_ID;
    el.className = "elenest-error-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.hidden = true;
    el.innerHTML =
      '<p class="elenest-error-toast__msg"></p>' +
      '<button type="button" class="elenest-error-toast__close" aria-label="Dismiss">×</button>';
    document.body.appendChild(el);
    var closeBtn = el.querySelector(".elenest-error-toast__close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        el.hidden = true;
      });
    }
    return el;
  }

  function toast(message, options) {
    options = options || {};
    if (!document.body) return;
    var el = ensureToast();
    var msg = el.querySelector(".elenest-error-toast__msg");
    if (msg) msg.textContent = friendlyMessage(message, options.fallback);
    el.hidden = false;
    el.classList.toggle("is-error", options.kind !== "info");
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.hidden = true;
    }, options.duration || 5200);
  }

  function renderInline(host, message, retryFn, options) {
    options = options || {};
    if (!host) return;
    var wrap = document.createElement("div");
    wrap.className = "elenest-inline-error";
    wrap.setAttribute("role", "alert");
    var p = document.createElement("p");
    p.className = "elenest-inline-error__msg";
    p.textContent = friendlyMessage(message, options.fallback);
    wrap.appendChild(p);
    if (typeof retryFn === "function") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline btn--small elenest-inline-error__retry";
      btn.textContent = options.retryLabel || "Retry";
      btn.addEventListener("click", function () {
        try {
          retryFn();
        } catch (e) {
          logError("retry", e);
        }
      });
      wrap.appendChild(btn);
    }
    host.textContent = "";
    host.appendChild(wrap);
  }

  function bindGlobalHandlers() {
    if (bound) return;
    bound = true;
    global.addEventListener("error", function (ev) {
      logError("window.error", (ev && ev.error) || (ev && ev.message) || ev);
      // Do not surface raw script errors to staff; optional quiet toast on staff portals only.
      if (
        document.body &&
        (document.body.classList.contains("admin-app") ||
          document.body.getAttribute("data-staff-portal") ||
          document.body.classList.contains("elenest-role-gated"))
      ) {
        // Avoid noisy toasts for every script error — only toast when explicitly flagged.
        if (ev && ev.error && ev.error.__elenestToast) {
          toast(friendlyMessage(ev.error));
        }
      }
    });
    global.addEventListener("unhandledrejection", function (ev) {
      var reason = ev && ev.reason;
      logError("unhandledrejection", reason);
      if (reason && reason.__elenestToast) {
        toast(friendlyMessage(reason));
      }
      // Prevent some browsers from dumping rejection to the console as an uncaught crash banner.
      try {
        if (ev && typeof ev.preventDefault === "function" && !isDevHost()) ev.preventDefault();
      } catch (e3) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindGlobalHandlers);
  } else {
    bindGlobalHandlers();
  }

  global.ElenestErrors = {
    friendlyMessage: friendlyMessage,
    toast: toast,
    renderInline: renderInline,
    log: logError,
    bind: bindGlobalHandlers
  };
})(typeof window !== "undefined" ? window : this);
