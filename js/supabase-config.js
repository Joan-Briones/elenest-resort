/**
 * Supabase + social auth config (publishable key — safe for browser).
 *
 * Facebook: JS SDK popup → token exchange (fallback: OAuth redirect).
 * Google: Google Identity Services → signInWithIdToken → book.html
 *   (does NOT use the black supabase.co/auth/v1/callback page)
 *
 * CRITICAL — Supabase → Authentication → URL Configuration:
 *   Site URL + Redirect URLs must include BOTH local and production hosts, e.g.:
 *     http://localhost/Elenest_Resort/html/
 *     https://elenestresort.infinityfreeapp.com/html/
 *     http://localhost/Elenest_Resort/html/auth-callback.html
 *     https://elenestresort.infinityfreeapp.com/html/auth-callback.html
 *     https://elenestresort.infinityfreeapp.com/html/reset-password.html
 *     elenest://auth/callback
 *
 * Google Cloud → Web client:
 *   Authorized JavaScript origins: http://localhost AND your production origin
 *   Authorized redirect URI:
 *     https://wstgqfcdpfifkqyrclkx.supabase.co/auth/v1/callback
 *
 * Checklist page: html/google-setup.html
 *
 * siteHtmlBaseUrl auto-detects the live /html/ base when served over http(s)
 * so InfinityFree does not depend on a localhost path. file:// still falls back
 * to the local XAMPP URL below.
 */
(function () {
  function detectHtmlBaseUrl() {
    try {
      if (
        typeof window !== "undefined" &&
        window.location &&
        (window.location.protocol === "http:" || window.location.protocol === "https:") &&
        window.location.origin &&
        window.location.origin !== "null"
      ) {
        var path = window.location.pathname || "/";
        var htmlIdx = path.toLowerCase().lastIndexOf("/html/");
        if (htmlIdx !== -1) {
          return window.location.origin + path.substring(0, htmlIdx + 6);
        }
        if (path === "/" || /^\/[^/]+$/i.test(path)) {
          return window.location.origin + "/html/";
        }
        var lastSlash = path.lastIndexOf("/");
        if (lastSlash !== -1) {
          return window.location.origin + path.substring(0, lastSlash + 1);
        }
        return window.location.origin + "/html/";
      }
    } catch (e) {}
    return "http://localhost/Elenest_Resort/html/";
  }

  var detectedBase = detectHtmlBaseUrl();
  if (detectedBase.charAt(detectedBase.length - 1) !== "/") detectedBase += "/";

  window.ElenestSupabaseConfig = {
    url: "https://wstgqfcdpfifkqyrclkx.supabase.co",
    publishableKey: "sb_publishable_LkJj-v8_MMzLnxyM3lNvxQ_ITCI5lTo",
    /** From Meta → App settings → Basic → App ID */
    facebookAppId: "3670417496460895",
    /**
     * Google Cloud → Clients → Web application → Client ID
     * Required for Continue with Google (popup → booking).
     */
    googleClientId: "849459780856-ga9krvsq3e00ls4fjrpmll24p0grpojv.apps.googleusercontent.com",
    siteHtmlBaseUrl: detectedBase,
    /**
     * Public guest-facing site (emails, SMS, share links).
     * Always use this when the staff machine is on localhost/XAMPP so phones
     * open InfinityFree instead of an unreachable localhost URL.
     */
    publicSiteHtmlBaseUrl: "https://elenest-resort.onrender.com/html/",
    oauthRedirectAllowlist: [
      detectedBase + "**",
      detectedBase + "auth-callback.html",
      "http://localhost/Elenest_Resort/html/**",
      "http://localhost/Elenest_Resort/html/auth-callback.html",
      "http://localhost/Elenest_Resort/html/reset-password.html",
      "https://elenest-resort.onrender.com/html/**",
      "https://elenest-resort.onrender.com/html/auth-callback.html",
      "https://elenest-resort.onrender.com/html/reset-password.html",
      "https://elenestresort.infinityfreeapp.com/html/**",
      "https://elenestresort.infinityfreeapp.com/html/auth-callback.html",
      "https://elenestresort.infinityfreeapp.com/html/reset-password.html",
      "elenest://auth/callback"
    ],
    mobileOAuthRedirectUrl: "elenest://auth/callback"
  };
})();
