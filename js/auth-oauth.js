/**
 * Social login for Elenest Resort (Facebook + Google via Supabase Auth).
 *
 * Facebook: JS SDK popup → token exchange → book.html
 * Google: Google Identity Services → signInWithIdToken → book.html
 *   (avoids black supabase.co/auth/v1/callback JSON page)
 *
 * Paste googleClientId in supabase-config.js (Web Client ID from Google Cloud).
 * Supabase → Providers → Google: same Client ID + Client Secret.
 *
 * If redirect fallback still 500s, run: sql/DISABLE-TRIGGER-NOW.sql
 */
(function () {
  var FACEBOOK_PROVIDER = "facebook";
  var GOOGLE_PROVIDER = "google";
  var fbSdkPromise = null;
  var gisPromise = null;

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function getConfig() {
    return window.ElenestSupabaseConfig || {};
  }

  function getConfiguredHtmlBase() {
    var base = getConfig().siteHtmlBaseUrl || "http://localhost/Elenest_Resort/html/";
    return base.charAt(base.length - 1) === "/" ? base : base + "/";
  }

  function getFacebookAppId() {
    return String(getConfig().facebookAppId || "").trim();
  }

  function getGoogleClientId() {
    return String(getConfig().googleClientId || "").trim();
  }

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function parseJwtPayload(token) {
    try {
      var part = String(token || "").split(".")[1] || "";
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return JSON.parse(atob(b64));
    } catch (e) {
      return {};
    }
  }

  function loadGoogleIdentityServices() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve(window.google.accounts.id);
    }
    if (gisPromise) return gisPromise;

    gisPromise = new Promise(function (resolve, reject) {
      var settled = false;
      function done() {
        if (settled) return;
        if (window.google && window.google.accounts && window.google.accounts.id) {
          settled = true;
          resolve(window.google.accounts.id);
        }
      }
      function fail(err) {
        if (settled) return;
        settled = true;
        gisPromise = null;
        reject(err);
      }

      var existing = document.getElementById("elenest-google-gsi");
      if (existing) {
        var waits = 0;
        var timer = setInterval(function () {
          waits += 1;
          if (window.google && window.google.accounts && window.google.accounts.id) {
            clearInterval(timer);
            done();
          } else if (waits > 80) {
            clearInterval(timer);
            fail(new Error("Google Identity Services timed out."));
          }
        }, 50);
        return;
      }

      var script = document.createElement("script");
      script.id = "elenest-google-gsi";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = function () {
        var waits = 0;
        var timer = setInterval(function () {
          waits += 1;
          if (window.google && window.google.accounts && window.google.accounts.id) {
            clearInterval(timer);
            done();
          } else if (waits > 80) {
            clearInterval(timer);
            fail(new Error("Google Identity Services failed to initialize."));
          }
        }, 50);
      };
      script.onerror = function () {
        fail(new Error("Could not load Google Identity Services. Check your network."));
      };
      document.head.appendChild(script);

      setTimeout(function () {
        if (!settled) {
          fail(new Error("Google Identity Services timed out."));
        }
      }, 12000);
    });

    return gisPromise;
  }

  function closeGoogleChooserModal() {
    var el = document.getElementById("elenestGoogleChooser");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /** Official Google button in a small modal → returns ID token (JWT). */
  function requestGoogleIdToken(portalKey) {
    var clientId = getGoogleClientId();
    if (!clientId) {
      return Promise.reject(
        new Error(
          "Google Client ID missing. Open js/supabase-config.js and paste googleClientId from Google Cloud → Clients → Web client."
        )
      );
    }

    var chooserLead =
      "Choose your Google account below. After sign-in you will go to the area for your account.";

    return loadGoogleIdentityServices().then(function () {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function finish(err, credential) {
          if (settled) return;
          settled = true;
          closeGoogleChooserModal();
          if (err) reject(err);
          else resolve(credential);
        }

        closeGoogleChooserModal();
        var overlay = document.createElement("div");
        overlay.id = "elenestGoogleChooser";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText =
          "position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;" +
          "background:rgba(31,41,55,0.45);padding:16px;";
        overlay.innerHTML =
          '<div style="background:#fff;border-radius:16px;padding:22px 20px;max-width:360px;width:100%;' +
          "box-shadow:0 20px 40px rgba(0,0,0,0.18);text-align:center;font-family:Poppins,Segoe UI,sans-serif;\">" +
          '<p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#202124;">Continue with Google</p>' +
          '<p style="margin:0 0 16px;font-size:13px;color:#5f6368;line-height:1.4;">' +
          chooserLead +
          "</p>" +
          '<div id="elenestGisButtonHost" style="display:flex;justify-content:center;min-height:44px;"></div>' +
          '<button type="button" id="elenestGisCancel" style="margin-top:14px;background:none;border:none;' +
          'color:#5f6368;font-size:13px;cursor:pointer;text-decoration:underline;">Cancel</button>' +
          "</div>";
        document.body.appendChild(overlay);

        var cancelBtn = document.getElementById("elenestGisCancel");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", function () {
            finish(new Error("Google sign-in was cancelled."));
          });
        }
        overlay.addEventListener("click", function (e) {
          if (e.target === overlay) finish(new Error("Google sign-in was cancelled."));
        });

        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: function (response) {
              if (response && response.credential) {
                finish(null, response.credential);
              } else {
                finish(new Error("Google sign-in was cancelled."));
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
            context: "signin",
            ux_mode: "popup"
          });

          var host = document.getElementById("elenestGisButtonHost");
          window.google.accounts.id.renderButton(host, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width: 320
          });

          try {
            window.google.accounts.id.prompt();
          } catch (ePrompt) {}
        } catch (eInit) {
          finish(eInit || new Error("Could not start Google sign-in."));
        }
      });
    });
  }

  function signInWithGoogleGis(nextPage, portalKey) {
    var sb = getClient();
    var portal = String(portalKey || "").trim().toLowerCase();
    return requestGoogleIdToken(portal).then(function (credential) {
      var payload = parseJwtPayload(credential);
      return sb.auth
        .signInWithIdToken({
          provider: GOOGLE_PROVIDER,
          token: credential
        })
        .then(function (result) {
          if (result.error) throw result.error;
          var session = result.data && result.data.session;
          if (!session || !session.user) {
            throw new Error("No session after Google login.");
          }
          return finishLoggedInUser(
            session,
            {
              email: payload.email || "",
              full_name: payload.name || "",
              avatar_url: payload.picture || "",
              provider: GOOGLE_PROVIDER
            },
            nextPage,
            GOOGLE_PROVIDER,
            portal
          );
        });
    });
  }

  function currentHtmlFileName() {
    var path = window.location.pathname || "";
    var fileName = path.split("/").pop() || "book.html";
    if (!fileName || fileName.indexOf(".html") === -1) {
      return "book.html";
    }
    return fileName;
  }

  function redirectFilePageToLocalhost() {
    if (!isFileProtocol()) return false;
    var target =
      getConfiguredHtmlBase() +
      currentHtmlFileName() +
      (window.location.search || "") +
      (window.location.hash || "");
    window.location.replace(target);
    return true;
  }

  if (redirectFilePageToLocalhost()) {
    return;
  }

  function getHtmlBaseUrl() {
    if (isFileProtocol() || !window.location.origin || window.location.origin === "null") {
      return getConfiguredHtmlBase();
    }
    var path = window.location.pathname || "/";
    var htmlIdx = path.toLowerCase().lastIndexOf("/html/");
    if (htmlIdx !== -1) {
      return window.location.origin + path.substring(0, htmlIdx + 6);
    }
    if (path === "/" || /^\/[^/]+\.html$/i.test(path)) {
      return window.location.origin + "/html/";
    }
    var lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1) {
      return window.location.origin + "/html/";
    }
    return window.location.origin + path.substring(0, lastSlash + 1);
  }

  function buildOAuthRedirectUrl(nextPath) {
    var next = String(nextPath || "book.html").replace(/^\//, "");
    return getHtmlBaseUrl() + next;
  }

  function buildCallbackUrl(nextPath) {
    return buildOAuthRedirectUrl(nextPath);
  }

  function storeOAuthNext(nextPath) {
    try {
      sessionStorage.setItem("elenest_oauth_next", String(nextPath || "book.html").replace(/^\//, ""));
      sessionStorage.setItem("elenest_oauth_pending", "1");
    } catch (e) {}
  }

  function readStoredOAuthNext() {
    try {
      return sessionStorage.getItem("elenest_oauth_next") || "book.html";
    } catch (e) {
      return "book.html";
    }
  }

  function resolveNextUrl(nextPath) {
    var next = String(nextPath || readStoredOAuthNext() || "book.html").replace(/^\//, "");
    if (next.indexOf("://") !== -1) return next;
    return getHtmlBaseUrl() + next;
  }

  function parseOAuthErrorFromUrl() {
    var params = new URLSearchParams(window.location.search || "");
    var hash = String(window.location.hash || "").replace(/^#/, "");
    var hashParams = new URLSearchParams(hash);
    var code = params.get("error") || hashParams.get("error");
    if (!code) return null;
    return {
      code: code,
      description:
        params.get("error_description") ||
        hashParams.get("error_description") ||
        "Social sign-in was cancelled or failed."
    };
  }

  function storeOAuthProvider(provider) {
    try {
      sessionStorage.setItem("elenest_oauth_provider", String(provider || ""));
    } catch (e) {}
  }

  function readStoredOAuthProvider() {
    try {
      return sessionStorage.getItem("elenest_oauth_provider") || "";
    } catch (e) {
      return "";
    }
  }

  function storeOAuthPortal(portalKey) {
    try {
      var pk = String(portalKey || "").trim().toLowerCase();
      if (pk) sessionStorage.setItem("elenest_oauth_portal", pk);
      else sessionStorage.removeItem("elenest_oauth_portal");
    } catch (e) {}
  }

  function readStoredOAuthPortal() {
    try {
      return String(sessionStorage.getItem("elenest_oauth_portal") || "").trim().toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function detectAuthProvider(authUser, preferred) {
    var identities = (authUser && authUser.identities) || [];
    var preferredKey = String(preferred || readStoredOAuthProvider() || "").toLowerCase();
    var i;
    if (preferredKey) {
      for (i = 0; i < identities.length; i++) {
        if (identities[i] && identities[i].provider === preferredKey) {
          return preferredKey;
        }
      }
    }
    for (i = 0; i < identities.length; i++) {
      if (identities[i] && identities[i].provider === GOOGLE_PROVIDER) {
        return GOOGLE_PROVIDER;
      }
    }
    for (i = 0; i < identities.length; i++) {
      if (identities[i] && identities[i].provider === FACEBOOK_PROVIDER) {
        return FACEBOOK_PROVIDER;
      }
    }
    for (i = 0; i < identities.length; i++) {
      if (identities[i] && identities[i].provider && identities[i].provider !== "email") {
        return identities[i].provider;
      }
    }
    return preferredKey || "email";
  }

  function identityDataForProvider(authUser, provider) {
    var identities = (authUser && authUser.identities) || [];
    var i;
    for (i = 0; i < identities.length; i++) {
      if (identities[i] && identities[i].provider === provider) {
        return identities[i].identity_data || {};
      }
    }
    return {};
  }

  function extractUserInfo(authUser, preferredProvider) {
    if (!authUser) {
      return {
        id: "",
        email: "",
        full_name: "",
        avatar_url: "",
        provider: "",
        created_at: "",
        last_login_at: ""
      };
    }
    var provider = detectAuthProvider(authUser, preferredProvider);
    var meta = authUser.user_metadata || {};
    var idData = identityDataForProvider(authUser, provider);
    var picture = idData.picture || meta.picture || "";
    if (picture && typeof picture === "object") {
      picture = (picture.data && picture.data.url) || picture.url || "";
    }
    return {
      id: authUser.id || "",
      email: authUser.email || meta.email || idData.email || "",
      full_name:
        meta.full_name ||
        meta.name ||
        idData.full_name ||
        idData.name ||
        "",
      avatar_url:
        meta.avatar_url ||
        meta.picture ||
        meta.photo_url ||
        idData.avatar_url ||
        picture ||
        "",
      provider: provider,
      created_at: authUser.created_at || "",
      last_login_at: authUser.last_sign_in_at || new Date().toISOString()
    };
  }

  function upsertOAuthProfile(authUser, info) {
    var sb = getClient();
    if (!sb) {
      return Promise.reject(new Error("Supabase is not connected."));
    }

    var now = new Date().toISOString();
    var email = String(info.email || authUser.email || "").trim().toLowerCase();
    var baseRow = {
      id: authUser.id,
      email: email || authUser.email || "",
      name: info.full_name || info.email || "Guest",
      avatar_url: info.avatar_url || "",
      updated_at: now
    };
    var fullRow = Object.assign({}, baseRow, {
      auth_provider: info.provider || GOOGLE_PROVIDER,
      last_login_at: info.last_login_at || now
    });

    function tryUpsert(row) {
      return sb.from("profiles").upsert(row, { onConflict: "id" }).then(function (res) {
        return res;
      });
    }

    function syncByEmailIfNeeded() {
      if (!email) return Promise.resolve(null);
      return sb
        .from("profiles")
        .select("id, email")
        .ilike("email", email)
        .maybeSingle()
        .then(function (existing) {
          if (existing.error || !existing.data) return null;
          if (existing.data.id === authUser.id) return null;
          // Same email already linked to this auth user via Supabase identity merge.
          // Never overwrite another profile id; rely on Auth linking + id upsert.
          return null;
        })
        .catch(function () {
          return null;
        });
    }

    return tryUpsert(fullRow)
      .then(function (res) {
        if (res && res.error) {
          return tryUpsert(baseRow).then(function (res2) {
            if (res2 && res2.error) {
              return sb.rpc("sync_profile_from_metadata").then(function () {
                return syncByEmailIfNeeded();
              });
            }
            return syncByEmailIfNeeded();
          });
        }
        return syncByEmailIfNeeded();
      })
      .catch(function () {
        return sb
          .rpc("sync_profile_from_metadata")
          .then(function () {
            return null;
          })
          .catch(function () {
            return null;
          });
      });
  }

  function loadFacebookSdk() {
    var appId = getFacebookAppId();
    if (!appId) {
      return Promise.reject(
        new Error("Facebook App ID missing in supabase-config.js (facebookAppId).")
      );
    }

    if (window.FB && window.fbAsyncInitDone) {
      return Promise.resolve(window.FB);
    }

    if (fbSdkPromise) return fbSdkPromise;

    fbSdkPromise = new Promise(function (resolve, reject) {
      var settled = false;
      function done(fb) {
        if (settled) return;
        settled = true;
        window.fbAsyncInitDone = true;
        resolve(fb);
      }
      function fail(err) {
        if (settled) return;
        settled = true;
        fbSdkPromise = null;
        reject(err);
      }

      window.fbAsyncInit = function () {
        try {
          window.FB.init({
            appId: appId,
            cookie: true,
            xfbml: false,
            version: "v21.0"
          });
          done(window.FB);
        } catch (e) {
          fail(e);
        }
      };

      if (window.FB) {
        window.fbAsyncInit();
        return;
      }

      var script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.onerror = function () {
        fail(new Error("Could not load Facebook SDK. Check your network."));
      };
      document.head.appendChild(script);

      setTimeout(function () {
        if (!settled) {
          fail(new Error("Facebook SDK timed out. Allow localhost in Meta JS SDK domains."));
        }
      }, 12000);
    });

    return fbSdkPromise;
  }

  function facebookPopupLogin() {
    return loadFacebookSdk().then(function (FB) {
      return new Promise(function (resolve, reject) {
        FB.login(
          function (response) {
            if (!response || response.status !== "connected" || !response.authResponse) {
              reject(new Error("Facebook sign-in was cancelled."));
              return;
            }
            resolve(response.authResponse);
          },
          { scope: "email,public_profile", return_scopes: true }
        );
      });
    });
  }

  function fetchFacebookProfile(accessToken) {
    return new Promise(function (resolve) {
      if (!window.FB) {
        resolve({ email: "", full_name: "", avatar_url: "" });
        return;
      }
      window.FB.api("/me", { fields: "id,name,email,picture.type(large)" }, function (me) {
        if (!me || me.error) {
          resolve({ email: "", full_name: "", avatar_url: "" });
          return;
        }
        resolve({
          email: me.email || "",
          full_name: me.name || "",
          avatar_url: (me.picture && me.picture.data && me.picture.data.url) || ""
        });
      });
    });
  }

  /** Exchange Facebook access token for a Supabase session (no /auth/v1/callback page). */
  function exchangeFacebookAccessToken(accessToken) {
    var config = getConfig();
    var url = String(config.url || "").replace(/\/$/, "");
    var key = config.publishableKey || "";
    var sb = getClient();
    if (!url || !key) {
      return Promise.reject(new Error("Supabase config missing."));
    }

    function postGrant(grantType, body) {
      return fetch(url + "/auth/v1/token?grant_type=" + encodeURIComponent(grantType), {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (parsed) {
          return { ok: res.ok, status: res.status, body: parsed };
        });
      });
    }

    // 1) Newer Facebook access_token grant
    return postGrant("access_token", {
      provider: FACEBOOK_PROVIDER,
      access_token: accessToken
    }).then(function (r1) {
      if (r1.ok && r1.body && r1.body.access_token) return r1.body;

      // 2) OIDC-style id_token field (some docs pass the FB access token here)
      return postGrant("id_token", {
        provider: FACEBOOK_PROVIDER,
        id_token: accessToken
      }).then(function (r2) {
        if (r2.ok && r2.body && r2.body.access_token) return r2.body;

        // 3) JS client helper
        if (sb && sb.auth && typeof sb.auth.signInWithIdToken === "function") {
          return sb.auth
            .signInWithIdToken({ provider: FACEBOOK_PROVIDER, token: accessToken })
            .then(function (result) {
              if (result.error) throw result.error;
              var session = result.data && result.data.session;
              if (!session) throw new Error("No session from signInWithIdToken.");
              return {
                access_token: session.access_token,
                refresh_token: session.refresh_token || ""
              };
            });
        }

        var msg =
          (r1.body && (r1.body.error_description || r1.body.msg || r1.body.error)) ||
          (r2.body && (r2.body.error_description || r2.body.msg || r2.body.error)) ||
          "Could not verify Facebook with Supabase.";
        throw new Error(typeof msg === "string" ? msg : "Facebook token exchange failed.");
      });
    });
  }

  function setSupabaseSessionFromTokenResponse(tokenBody) {
    var sb = getClient();
    if (!sb) return Promise.reject(new Error("Supabase is not connected."));
    if (!tokenBody || !tokenBody.access_token) {
      return Promise.reject(new Error("Supabase did not return a session."));
    }
    return sb.auth.setSession({
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token || ""
    });
  }

  function finishLoggedInUser(session, extraProfile, nextPage, preferredProvider, portalKey) {
    var Auth = window.ElenestAuth;
    var authUser = session.user;
    var portal = String(portalKey || "").trim().toLowerCase();
    var info = extractUserInfo(authUser, preferredProvider);
    if (extraProfile) {
      if (extraProfile.email && !info.email) info.email = extraProfile.email;
      if (extraProfile.full_name && !info.full_name) info.full_name = extraProfile.full_name;
      if (extraProfile.avatar_url && !info.avatar_url) info.avatar_url = extraProfile.avatar_url;
      if (extraProfile.provider) info.provider = extraProfile.provider;
    }
    if (!info.last_login_at) {
      info.last_login_at = new Date().toISOString();
    }

    return upsertOAuthProfile(authUser, info)
      .then(function () {
        if (Auth && typeof Auth.hydrateSessionUser === "function") {
          return Auth.hydrateSessionUser(session);
        }
        return null;
      })
      .then(function (user) {
        var current =
          (Auth && Auth.getCurrentUser && Auth.getCurrentUser()) ||
          user || {
            id: authUser.id,
            email: info.email || authUser.email || "",
            name: info.full_name || info.email || "Guest",
            phone: "",
            role: "guest",
            gender: "",
            avatar_url: info.avatar_url || "",
            auth_provider: info.provider || "",
            last_login_at: info.last_login_at || ""
          };

        if (!current.auth_provider && info.provider) {
          current.auth_provider = info.provider;
        }
        if (!current.avatar_url && info.avatar_url) {
          current.avatar_url = info.avatar_url;
        }

        var role =
          Auth && typeof Auth.normalizeRole === "function"
            ? Auth.normalizeRole(current.role)
            : String(current.role || "guest").toLowerCase();

        if (Auth && typeof Auth.setCurrentUser === "function") {
          Auth.setCurrentUser(current);
        }

        try {
          sessionStorage.setItem("elenest_welcome", "1");
          if (role === "guest") {
            sessionStorage.setItem("elenest_booking_restart", "1");
          }
          sessionStorage.setItem("elenest_oauth_user", JSON.stringify(info));
          sessionStorage.removeItem("elenest_oauth_pending");
          sessionStorage.removeItem("elenest_oauth_provider");
          sessionStorage.removeItem("elenest_oauth_portal");
        } catch (e) {}

        var targetNext =
          Auth && typeof Auth.getPostLoginPath === "function"
            ? Auth.getPostLoginPath(current)
            : role === "admin"
              ? "admin.html"
              : role === "manager"
                ? "manager.html"
                : role === "receptionist"
                  ? "reception.html"
                  : nextPage || "book.html";
        var redirectTo = resolveNextUrl(targetNext);
        return { ok: true, redirectTo: redirectTo, user: current, oauth: info };
      });
  }

  function signInWithFacebookSdk(nextPage) {
    return facebookPopupLogin()
      .then(function (authResponse) {
        var token = authResponse.accessToken;
        return Promise.all([
          exchangeFacebookAccessToken(token),
          fetchFacebookProfile(token)
        ]);
      })
      .then(function (pair) {
        var tokenBody = pair[0];
        var fbProfile = pair[1];
        return setSupabaseSessionFromTokenResponse(tokenBody).then(function (sessionResult) {
          if (sessionResult.error) throw sessionResult.error;
          var session = sessionResult.data && sessionResult.data.session;
          if (!session || !session.user) {
            throw new Error("No session after Facebook login.");
          }
          return finishLoggedInUser(session, fbProfile, nextPage, FACEBOOK_PROVIDER);
        });
      });
  }

  function signInWithFacebookRedirect(nextPage) {
    var sb = getClient();
    var redirectTo = getHtmlBaseUrl() + "auth-callback.html";
    storeOAuthProvider(FACEBOOK_PROVIDER);
    return sb.auth
      .signInWithOAuth({
        provider: FACEBOOK_PROVIDER,
        options: {
          redirectTo: redirectTo,
          scopes: "email public_profile",
          skipBrowserRedirect: false,
          queryParams: {
            // Prefer account that matches an existing email when possible.
            auth_type: "rerequest"
          }
        }
      })
      .then(function (result) {
        if (result.error) {
          var errMsg = result.error.message || "Could not start Facebook sign-in.";
          if (/site url|improperly formatted/i.test(errMsg)) {
            errMsg =
              "Supabase Site URL / Redirect URLs must include this site’s /html/ path (local and production).";
          }
          return { ok: false, message: errMsg };
        }
        return { ok: true, redirecting: true };
      });
  }

  function signInWithGoogleRedirect(nextPage) {
    var sb = getClient();
    var redirectTo = getHtmlBaseUrl() + "auth-callback.html";
    storeOAuthProvider(GOOGLE_PROVIDER);
    return sb.auth
      .signInWithOAuth({
        provider: GOOGLE_PROVIDER,
        options: {
          redirectTo: redirectTo,
          scopes: "openid email profile",
          skipBrowserRedirect: false,
          queryParams: {
            access_type: "online",
            prompt: "select_account"
          }
        }
      })
      .then(function (result) {
        if (result.error) {
          var errMsg = result.error.message || "Could not start Google sign-in.";
          if (/provider is not enabled|validation_failed|unsupported provider/i.test(errMsg)) {
            errMsg =
              "Google sign-in is not enabled yet. In Supabase → Authentication → Providers, enable Google and paste your Google Client ID and Secret.";
          } else if (/site url|improperly formatted|redirect/i.test(errMsg)) {
            errMsg =
              "Supabase redirect URL is wrong. Add this site’s /html/ and /html/auth-callback.html to Site URL and Redirect URLs (local + production).";
          } else if (/unexpected_failure|500/i.test(errMsg)) {
            errMsg =
              "Supabase Google callback failed. Paste googleClientId in js/supabase-config.js (preferred), or run sql/DISABLE-TRIGGER-NOW.sql and re-check the Google Client Secret in Supabase.";
          }
          return { ok: false, message: errMsg };
        }
        return { ok: true, redirecting: true };
      });
  }

  function signInWithGoogle(options) {
    options = options || {};
    var sb = getClient();

    if (isFileProtocol()) {
      redirectFilePageToLocalhost();
      return Promise.resolve({ ok: true, redirecting: true });
    }

    if (!sb) {
      return Promise.resolve({
        ok: false,
        message: "Supabase is not connected. Refresh the page and try again."
      });
    }

    var portalKey = String(options.portalKey || "").trim().toLowerCase();
    if (portalKey && portalKey !== "admin") {
      return Promise.resolve({
        ok: false,
        message: "Google sign-in is only available for guest and Admin accounts."
      });
    }

    var nextPage = String(
      options.next || (portalKey === "admin" ? "admin.html" : "book.html")
    ).replace(/^\//, "");
    storeOAuthNext(nextPage);
    storeOAuthProvider(GOOGLE_PROVIDER);
    storeOAuthPortal(portalKey);

    // ONLY Google Identity Services → ID token → booking / admin.
    // Never use OAuth redirect (that hits the black supabase.co/auth/v1/callback page).
    if (!getGoogleClientId()) {
      return Promise.resolve({
        ok: false,
        message:
          "Google Client ID is missing. Open js/supabase-config.js and set googleClientId to your Web Client ID from Google Cloud → Clients (ends with .apps.googleusercontent.com). Then hard-refresh this page (Ctrl+F5)."
      });
    }

    return signInWithGoogleGis(nextPage, portalKey)
      .then(function (result) {
        return result;
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Google sign-in failed.";
        if (/cancelled/i.test(msg)) {
          return { ok: false, message: "Google sign-in was cancelled." };
        }
        if (/invalid.?client|origin|Unauthorized|403|400/i.test(msg)) {
          msg +=
            " In Google Cloud → your Web client, add Authorized JavaScript origin: http://localhost";
        }
        if (/provider|not enabled|id_token/i.test(msg)) {
          msg +=
            " In Supabase → Authentication → Providers → Google, enable it and paste the same Client ID + Client Secret.";
        }
        return { ok: false, message: msg };
      });
  }

  function signInWithFacebook(options) {
    options = options || {};
    var sb = getClient();

    if (isFileProtocol()) {
      redirectFilePageToLocalhost();
      return Promise.resolve({ ok: true, redirecting: true });
    }

    if (!sb) {
      return Promise.resolve({
        ok: false,
        message: "Supabase is not connected. Refresh the page and try again."
      });
    }

    if (options.portalKey) {
      return Promise.resolve({
        ok: false,
        message: "Facebook sign-in is only available for guest accounts."
      });
    }

    var nextPage = String(options.next || "book.html").replace(/^\//, "");
    storeOAuthNext(nextPage);
    storeOAuthProvider(FACEBOOK_PROVIDER);
    storeOAuthPortal("");

    // Primary: Facebook popup → token → booking (skips broken /auth/v1/callback page)
    if (getFacebookAppId()) {
      return signInWithFacebookSdk(nextPage).catch(function (err) {
        var msg = (err && err.message) || "Facebook sign-in failed.";
        if (/access_token|grant_type|not (enabled|supported)|400|401|403/i.test(msg)) {
          // Hosted Auth may not support access_token grant yet — fall back to redirect.
          return signInWithFacebookRedirect(nextPage);
        }
        if (/SDK|localhost|App ID|cancelled/i.test(msg)) {
          return { ok: false, message: msg };
        }
        return { ok: false, message: msg };
      });
    }

    return signInWithFacebookRedirect(nextPage);
  }

  function finishOAuthSession(sb) {
    var params = new URLSearchParams(window.location.search || "");
    var code = params.get("code");
    var hash = String(window.location.hash || "").replace(/^#/, "");

    function readSession() {
      return sb.auth.getSession().then(function (result) {
        if (result.error) throw result.error;
        return result;
      });
    }

    function waitForSession(attempt) {
      attempt = attempt || 0;
      return readSession().then(function (result) {
        var session = result.data && result.data.session;
        if (session && session.user) return result;
        if (attempt >= 20) return result;
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(waitForSession(attempt + 1));
          }, 150);
        });
      });
    }

    if (code) {
      return sb.auth
        .exchangeCodeForSession(code)
        .then(function (exchangeResult) {
          if (exchangeResult.error) {
            var msg = exchangeResult.error.message || "";
            if (/already|invalid|expired|used/i.test(msg)) {
              return waitForSession();
            }
            throw exchangeResult.error;
          }
          return readSession();
        })
        .catch(function () {
          return waitForSession();
        });
    }

    if (hash.indexOf("access_token=") !== -1 || hash.indexOf("refresh_token=") !== -1) {
      return waitForSession();
    }

    return waitForSession();
  }

  function handleOAuthCallback(options) {
    options = options || {};
    var sb = getClient();
    var Auth = window.ElenestAuth;

    if (!sb || !Auth) {
      return Promise.resolve({
        ok: false,
        message: "Authentication module failed to load. Refresh and try again."
      });
    }

    var urlError = parseOAuthErrorFromUrl();
    if (urlError) {
      return Promise.resolve({
        ok: false,
        message: urlError.description || "Social sign-in failed."
      });
    }

    var preferredProvider = options.provider || readStoredOAuthProvider() || "";

    return finishOAuthSession(sb)
      .then(function (result) {
        if (result.error) throw result.error;
        var session = result.data && result.data.session;
        if (!session || !session.user) {
          return {
            ok: false,
            message: "No active session after social sign-in. Please try again."
          };
        }
        return finishLoggedInUser(
          session,
          null,
          options.next || readStoredOAuthNext(),
          preferredProvider,
          options.portalKey || readStoredOAuthPortal()
        );
      })
      .catch(function (err) {
        return {
          ok: false,
          message: (err && err.message) || "Social sign-in failed."
        };
      });
  }

  function getStoredOAuthUserInfo() {
    try {
      var raw = sessionStorage.getItem("elenest_oauth_user");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function attachToAuth() {
    if (!window.ElenestAuth) return false;

    window.ElenestAuth.signInWithFacebook = signInWithFacebook;
    window.ElenestAuth.signInWithGoogle = signInWithGoogle;
    window.ElenestAuth.handleOAuthCallback = handleOAuthCallback;
    window.ElenestAuth.getOAuthUserInfo = function (authUser) {
      if (authUser) return extractUserInfo(authUser);
      var current = window.ElenestAuth.getCurrentUser();
      if (current && current.id) {
        return {
          id: current.id,
          email: current.email || "",
          full_name: current.name || "",
          avatar_url: current.avatar_url || "",
          provider: current.auth_provider || "",
          last_login_at: current.last_login_at || ""
        };
      }
      return (
        getStoredOAuthUserInfo() || {
          id: "",
          email: "",
          full_name: "",
          avatar_url: "",
          provider: "",
          last_login_at: ""
        }
      );
    };
    window.ElenestAuth.getOAuthCallbackUrl = buildCallbackUrl;

    return true;
  }

  if (!attachToAuth()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (attachToAuth() || attempts > 100) clearInterval(timer);
    }, 50);
  }
})();
