/**
 * Wires "Continue with Facebook" / "Continue with Google" buttons.
 * Load after auth.js and auth-oauth.js.
 */
(function () {
  function setButtonLoading(btn, loading, label) {
    var BL = window.ElenestButtonLoading;
    if (BL && typeof BL.set === "function") {
      BL.set(btn, loading, label);
      return;
    }
    if (!btn) return;
    btn.disabled = !!loading;
    btn.setAttribute("aria-busy", loading ? "true" : "false");
    if (loading) {
      btn.classList.add("is-loading");
    } else {
      btn.classList.remove("is-loading");
    }
    if (label && !loading) btn.textContent = label;
  }

  function showMessage(msgEl, ok, text) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    msgEl.textContent = text;
  }

  function bindSocialButton(btn, options) {
    if (!btn || btn.getAttribute("data-oauth-bound") === "1") return;
    btn.setAttribute("data-oauth-bound", "1");
    btn.removeAttribute("disabled");
    btn.classList.remove("is-loading");
    btn.style.pointerEvents = "auto";
    btn.style.cursor = "pointer";

    var provider = String(options.provider || "facebook").toLowerCase();
    var methodName = provider === "google" ? "signInWithGoogle" : "signInWithFacebook";
    var providerLabel = provider === "google" ? "Google" : "Facebook";
    var defaultLabel = btn.getAttribute("data-default-label") || btn.textContent.trim();
    btn.setAttribute("data-default-label", defaultLabel);
    var msgEl = options.msgEl;

    btn.addEventListener("click", function (event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      var Auth = window.ElenestAuth;
      if (!Auth || typeof Auth[methodName] !== "function") {
        showMessage(
          msgEl,
          false,
          providerLabel + " sign-in is not ready yet. Wait a moment and try again."
        );
        return;
      }

      setButtonLoading(btn, true, "Please wait…");
      if (msgEl) msgEl.hidden = true;

      if (window.location.protocol === "file:") {
        showMessage(
          msgEl,
          false,
          "Opening the site on localhost so " + providerLabel + " can sign you in…"
        );
      }

      Promise.resolve(
        Auth[methodName]({
          next: options.next || "book.html",
          portalKey: options.portalKey
        })
      )
        .then(function (result) {
          result = result || {};
          if (!result.ok) {
            setButtonLoading(btn, false, defaultLabel);
            var message = result.message || providerLabel + " sign-in failed.";
            if (provider === "facebook") {
              if (/app not active/i.test(message)) {
                message +=
                  " Add your Facebook account as a Developer/Test user in Meta for Developers, or set the app to Live mode.";
              }
              if (/localhost|JavaScript SDK|domain/i.test(message)) {
                message +=
                  " In Meta → Facebook Login → Settings, add http://localhost/ under Allowed Domains for the JavaScript SDK.";
              }
            } else if (provider === "google") {
              if (/missing|googleClientId|Client ID/i.test(message)) {
                message += " Open google-setup.html for step-by-step help.";
              } else if (/not enabled|Secret|id_token/i.test(message)) {
                message +=
                  " Enable Google in Supabase → Authentication → Providers and paste Client ID + Secret.";
              }
            }
            showMessage(msgEl, false, message);
            return;
          }
          if (result.redirectTo) {
            window.location.replace(result.redirectTo);
            return;
          }
          if (!result.redirecting) {
            setButtonLoading(btn, false, defaultLabel);
          }
        })
        .catch(function (err) {
          setButtonLoading(btn, false, defaultLabel);
          showMessage(
            msgEl,
            false,
            (err && err.message) || providerLabel + " sign-in failed."
          );
        });
    });
  }

  function bindPair(facebookId, googleId, options) {
    bindSocialButton(document.getElementById(facebookId), {
      provider: "facebook",
      next: options.next,
      portalKey: options.portalKey,
      msgEl: options.msgEl
    });
    bindSocialButton(document.getElementById(googleId), {
      provider: "google",
      next: options.next,
      portalKey: options.portalKey,
      msgEl: options.msgEl
    });
  }

  window.ElenestAuthSocialUi = {
    initLogin: function (config) {
      config = config || {};
      var section = document.getElementById("guestOAuthSection");
      if (section) {
        section.hidden = false;
      }
      bindPair("facebookLoginBtn", "googleLoginBtn", {
        next: config.next,
        portalKey: "",
        msgEl: document.getElementById("loginMsg")
      });
    },
    initRegister: function (config) {
      config = config || {};
      bindPair("facebookRegisterBtn", "googleRegisterBtn", {
        next: config.next || "book.html",
        msgEl: document.getElementById("regMsg")
      });
    },
    initBookGate: function (config) {
      config = config || {};
      bindPair("facebookBookGateBtn", "googleBookGateBtn", {
        next: config.next || "book.html",
        msgEl: document.getElementById("bookGateMsg")
      });
    }
  };
})();
