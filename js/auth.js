(function () {
  var STORAGE_SESSION = "elenest_session";
  var STORAGE_ROLE = "elenest_role_cache";
  var STORAGE_USERS = "elenest_users";
  var STORAGE_STAFF_PASSWORDS = "elenest_staff_passwords";
  var sessionUser = null;
  var staffCreateLock = 0;
  var staffCreateAdminId = null;
  var hydrateInFlight = null;
  var hydrateTimer = null;
  var authChangeBound = false;

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function isSupabaseReady() {
    return !!(getClient() && window.ElenestSupabaseHelpers && window.ElenestSupabaseHelpers.isReady());
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function isValidGuestEmail(email) {
    return /^[^\s@]+@gmail\.com$/i.test(normalizeEmail(email));
  }

  var MIN_GUEST_PASSWORD_LENGTH = 6;

  function isValidGuestPassword(password) {
    return String(password || "").length >= MIN_GUEST_PASSWORD_LENGTH;
  }

  function guestPasswordHint() {
    return "Password must be at least " + MIN_GUEST_PASSWORD_LENGTH + " characters.";
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizeRole(role) {
    var r = String(role || "").trim().toLowerCase();
    if (r === "admin" || r === "administrator") return "admin";
    if (r === "manager") return "manager";
    if (r === "reception" || r === "receptionist") return "receptionist";
    if (r === "guest" || r === "customer" || r === "user") return "guest";
    if (!r) return "guest";
    return r;
  }

  function headerRoleLabel(role) {
    var r = normalizeRole(role);
    if (r === "admin") return "Admin";
    if (r === "manager") return "Manager";
    if (r === "receptionist") return "Receptionist";
    return "";
  }

  function knownNameForRole(role) {
    var r = normalizeRole(role);
    if (r === "admin") return "Elenita Absulio";
    if (r === "manager") return "Emma Robianes";
    if (r === "receptionist") return "Jenny Acar";
    return "";
  }

  function isPlaceholderAccountName(name) {
    var n = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!n) return true;
    if (/^elenest(\s+resort)?(\s+(events|inc\.?|event center))?$/.test(n)) return true;
    if (/^(owner|admin|administrator|manager|receptionist|staff|guest)$/.test(n)) return true;
    return false;
  }

  function accountDisplayName(user) {
    if (!user) return "";
    var known = knownNameForRole(user && user.role);
    var name = String((user && user.name) || "").trim();
    if (known && isPlaceholderAccountName(name)) return known;
    if (name && !isPlaceholderAccountName(name)) return name;
    if (known) return known;
    var email = String((user && user.email) || "").trim();
    if (email) {
      var at = email.indexOf("@");
      var local = at > 0 ? email.slice(0, at) : email;
      if (known && isPlaceholderAccountName(local)) return known;
      return local;
    }
    return name || "";
  }

  function applyStaffHeaderRole(user) {
    var el = document.getElementById("staffHeaderRole");
    var item = document.getElementById("staffHeaderRoleItem");
    if (!el) return "";
    var role = headerRoleLabel(user && user.role);
    var name = accountDisplayName(user);
    el.textContent = "";
    if (!role && !name) {
      if (item) item.setAttribute("hidden", "");
      return "";
    }
    var icon = document.createElement("span");
    icon.className = "staff-header-user__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      '<circle cx="12" cy="8" r="4"/>' +
      '<path d="M4 20v-1a8 8 0 0 1 16 0v1"/>' +
      "</svg>";
    el.appendChild(icon);

    var meta = document.createElement("span");
    meta.className = "staff-header-user__meta";
    if (name) {
      var nameEl = document.createElement("strong");
      nameEl.className = "staff-header-user__name";
      nameEl.textContent = name;
      meta.appendChild(nameEl);
    }
    if (role) {
      var roleEl = document.createElement("span");
      roleEl.className = "staff-header-user__role";
      roleEl.textContent = role;
      meta.appendChild(roleEl);
    }
    el.appendChild(meta);

    var label = [name, role].filter(Boolean).join(" · ");
    if (item) {
      item.removeAttribute("hidden");
      item.setAttribute("title", label);
      item.setAttribute("data-staff-name", name || "");
      item.setAttribute("data-staff-role", role || "");
    }
    el.setAttribute("aria-label", label || "Staff profile");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    ensureStaffIdentityPopover(item, name, role);
    return label;
  }

  function ensureStaffIdentityPopover(item, name, role) {
    if (!item) return;
    var pop = document.getElementById("staffIdentityPopover");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "staffIdentityPopover";
      pop.className = "staff-identity-popover";
      pop.setAttribute("hidden", "");
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "Signed-in staff");
      pop.innerHTML =
        '<p class="staff-identity-popover__name" id="staffIdentityName"></p>' +
        '<p class="staff-identity-popover__role" id="staffIdentityRole"></p>';
      document.body.appendChild(pop);
    }
    var nameNode = document.getElementById("staffIdentityName");
    var roleNode = document.getElementById("staffIdentityRole");
    if (nameNode) nameNode.textContent = name || "Staff";
    if (roleNode) roleNode.textContent = role || "";

    if (item.getAttribute("data-identity-bound") === "1") return;
    item.setAttribute("data-identity-bound", "1");

    function closePop() {
      pop.setAttribute("hidden", "");
      item.classList.remove("is-identity-open");
    }

    function openPop() {
      var latest = sessionUser || (typeof getCurrentUser === "function" ? getCurrentUser() : null);
      var n = accountDisplayName(latest);
      if (!n) n = (item.getAttribute("data-staff-name") || name || "").trim();
      if (!n && latest && latest.email) {
        var em = String(latest.email);
        var at = em.indexOf("@");
        n = at > 0 ? em.slice(0, at) : em;
      }
      if (!n) n = "Staff";
      var r =
        headerRoleLabel(latest && latest.role) ||
        (item.getAttribute("data-staff-role") || role || "").trim();
      if (nameNode) nameNode.textContent = n;
      if (roleNode) {
        roleNode.textContent = r;
        roleNode.hidden = !r;
      }
      pop.removeAttribute("hidden");
      item.classList.add("is-identity-open");
      var rect = item.getBoundingClientRect();
      var pad = 8;
      var top = Math.round(rect.bottom + 8);
      var left = Math.round(Math.min(window.innerWidth - 220 - pad, Math.max(pad, rect.right - 200)));
      pop.style.top = top + "px";
      pop.style.left = left + "px";
    }

    function togglePop(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (pop.hasAttribute("hidden")) openPop();
      else closePop();
    }

    item.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".staff-notif-wrap")) return;
      togglePop(e);
    });
    elKeyboard(item, togglePop);

    document.addEventListener("click", function (e) {
      if (pop.hasAttribute("hidden")) return;
      if (pop.contains(e.target) || item.contains(e.target)) return;
      closePop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePop();
    });
    window.addEventListener("resize", closePop);
    window.addEventListener("scroll", closePop, true);
  }

  function elKeyboard(node, fn) {
    if (!node || node.getAttribute("data-key-bound") === "1") return;
    node.setAttribute("data-key-bound", "1");
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn(e);
      }
    });
  }

  function portalRequiresRole(portalKey) {
    var pk = String(portalKey || "").trim().toLowerCase();
    if (pk === "admin") return "admin";
    if (pk === "manager") return "manager";
    if (pk === "reception") return "receptionist";
    if (pk === "staff") return "staff";
    return null;
  }

  function isStaffRole(role) {
    var r = normalizeRole(role);
    return r === "admin" || r === "manager" || r === "receptionist";
  }

  function cacheUser(user, opts) {
    opts = opts || {};
    var clean = null;
    if (user) {
      clean = Object.assign({}, user);
      delete clean._roleAuthoritative;
      delete clean._profileMissing;
      if (clean.role) clean.role = normalizeRole(clean.role);
    }
    sessionUser = clean;
    try {
      if (clean) sessionStorage.setItem(STORAGE_SESSION, JSON.stringify(clean));
      else sessionStorage.removeItem(STORAGE_SESSION);
    } catch (e) {}
    if (clean && clean.id && isStaffRole(clean.role)) {
      writeRoleCache(clean);
    } else if (clean && clean.id && opts.fromAuthoritative && normalizeRole(clean.role) === "guest") {
      var rc = readRoleCache();
      if (rc && String(rc.id) === String(clean.id)) clearRoleCache();
    }
  }

  function writeRoleCache(user) {
    if (!user || !user.id) return;
    try {
      localStorage.setItem(
        STORAGE_ROLE,
        JSON.stringify({
          id: String(user.id),
          email: normalizeEmail(user.email),
          role: normalizeRole(user.role),
          name: String(user.name || ""),
          at: Date.now()
        })
      );
    } catch (e) {}
  }

  function readRoleCache() {
    try {
      var raw = localStorage.getItem(STORAGE_ROLE);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.id) return null;
      if (parsed.at && Date.now() - Number(parsed.at) > 30 * 24 * 60 * 60 * 1000) {
        return null;
      }
      parsed.role = normalizeRole(parsed.role);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearRoleCache() {
    try {
      localStorage.removeItem(STORAGE_ROLE);
    } catch (e) {}
  }

  function readCachedSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_SESSION);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.role) parsed.role = normalizeRole(parsed.role);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function authIdentitiesMatch(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    var ae = normalizeEmail(a.email);
    var be = normalizeEmail(b.email);
    return !!(ae && be && ae === be);
  }

  function bestCachedIdentity(identity) {
    var sessionCached = readCachedSession();
    if (sessionCached && (!identity || authIdentitiesMatch(sessionCached, identity))) {
      return sessionCached;
    }
    var roleCached = readRoleCache();
    if (roleCached && isStaffRole(roleCached.role) && (!identity || authIdentitiesMatch(roleCached, identity))) {
      return {
        id: roleCached.id,
        email: roleCached.email,
        name: roleCached.name || "",
        role: roleCached.role,
        phone: "",
        gender: "",
        avatar_url: ""
      };
    }
    return sessionCached || null;
  }

  /**
   * Keep a previously authenticated staff role when a transient profile fetch
   * returns a non-authoritative guest fallback. Authoritative DB roles win.
   */
  function preferStableRole(candidate, cached) {
    if (!candidate) return cached || null;
    var prior = cached || null;
    if (!prior || !authIdentitiesMatch(candidate, prior)) {
      prior = bestCachedIdentity(candidate);
    }
    if (!prior || !authIdentitiesMatch(candidate, prior)) {
      return candidate;
    }
    if (candidate._roleAuthoritative) {
      return candidate;
    }
    var cachedRole = normalizeRole(prior.role);
    var candidateRole = normalizeRole(candidate.role);
    if (isStaffRole(cachedRole) && (!candidateRole || candidateRole === "guest")) {
      return Object.assign({}, candidate, {
        role: cachedRole,
        name:
          candidate.name && !isPlaceholderAccountName(candidate.name)
            ? candidate.name
            : prior.name || candidate.name,
        phone: candidate.phone || prior.phone || "",
        gender: candidate.gender || prior.gender || "",
        avatar_url: candidate.avatar_url || prior.avatar_url || ""
      });
    }
    return candidate;
  }

  function clearPersistedAuth() {
    cacheUser(null);
    clearRoleCache();
    try {
      sessionStorage.removeItem("elenest_role_hop");
      sessionStorage.removeItem("elenest_staff_gate_deny");
    } catch (e) {}
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("sb-") === 0 && k.indexOf("-auth-token") !== -1) {
          keys.push(k);
        }
      }
      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (e) {}
  }

  function profileToUser(profile, email) {
    return {
      id: profile.id || "",
      email: profile.email || email || "",
      name: profile.name || "",
      phone: profile.phone || "",
      role: profile.role || "guest",
      gender: profile.gender || "",
      avatar_url: profile.avatar_url || "",
      auth_provider: profile.auth_provider || "",
      last_login_at: profile.last_login_at || ""
    };
  }

  function userFromAuthSession(session) {
    if (!session || !session.user) return null;
    var authUser = session.user;
    var meta = authUser.user_metadata || {};
    var metaRole = normalizeRole(meta.role || meta.app_role || "");
    var base = profileToUser(
      {
        id: authUser.id,
        email: authUser.email || meta.email || "",
        name: meta.full_name || meta.name || meta.email || "Guest",
        phone: meta.phone || "",
        role: isStaffRole(metaRole) ? metaRole : "guest",
        gender: meta.gender || "",
        avatar_url: meta.avatar_url || meta.picture || ""
      },
      authUser.email
    );
    base._roleAuthoritative = false;
    return preferStableRole(base, readCachedSession());
  }

  function hydrateSessionUser(session, opts) {
    opts = opts || {};
    var doSync = !!opts.sync;

    if (!session || !session.user) {
      cacheUser(null);
      return Promise.resolve(null);
    }

    var sessionIdentity = {
      id: session.user.id,
      email: session.user.email
    };
    var cached = bestCachedIdentity(sessionIdentity);
    if (cached && authIdentitiesMatch(cached, sessionIdentity)) {
      sessionUser = Object.assign({}, sessionUser || {}, cached);
    }

    function finishWith(user) {
      var merged = preferStableRole(user, cached || bestCachedIdentity(sessionIdentity));
      cacheUser(merged, { fromAuthoritative: !!(user && user._roleAuthoritative) });
      return sessionUser;
    }

    var work = fetchProfile(session.user.id, session.user.email).then(function (user) {
      if (!doSync) {
        return finishWith(user);
      }
      return syncProfileFromMetadataSafe()
        .then(function () {
          return fetchProfile(session.user.id, session.user.email);
        })
        .catch(function () {
          return user;
        })
        .then(function (freshUser) {
          if (freshUser && freshUser.id) return finishWith(freshUser);
          return finishWith(userFromAuthSession(session));
        });
    }).catch(function () {
      var prior = cached || bestCachedIdentity(sessionIdentity);
      if (prior && authIdentitiesMatch(prior, sessionIdentity) && isStaffRole(prior.role)) {
        cacheUser(prior);
        return sessionUser;
      }
      return finishWith(userFromAuthSession(session));
    });

    hydrateInFlight = work;
    return work.finally(function () {
      if (hydrateInFlight === work) hydrateInFlight = null;
    });
  }

  function scheduleHydrateFromAuthChange(event, session) {
    if (hydrateTimer) {
      clearTimeout(hydrateTimer);
      hydrateTimer = null;
    }
    // Skip noisy token refresh storms; INITIAL_SESSION / SIGNED_IN still hydrate.
    if (event === "TOKEN_REFRESHED" && sessionUser && sessionUser.id) {
      return;
    }
    hydrateTimer = setTimeout(function () {
      hydrateTimer = null;
      if (!session || !session.user) {
        cacheUser(null);
        if (event === "SIGNED_OUT") clearRoleCache();
        applyStaffHeaderRole(null);
        try {
          window.dispatchEvent(
            new CustomEvent("elenest-auth-change", { detail: { event: event, user: null } })
          );
        } catch (e) {}
        return;
      }
      // Do not re-run metadata sync on every auth event — that caused reload storms.
      hydrateSessionUser(session, { sync: false }).then(function (user) {
        applyStaffHeaderRole(user);
        try {
          window.dispatchEvent(
            new CustomEvent("elenest-auth-change", { detail: { event: event, user: user } })
          );
        } catch (e) {}
      });
    }, 50);
  }

  function fetchProfile(userId, email) {
    var sb = getClient();
    if (!sb) {
      var offline = preferStableRole(
        profileToUser({ id: userId, email: email, role: "guest" }, email),
        readCachedSession()
      );
      if (offline) offline._roleAuthoritative = false;
      return Promise.resolve(offline);
    }

    function query(columns) {
      return sb
        .from("profiles")
        .select(columns)
        .eq("id", userId)
        .maybeSingle();
    }

    return query("id, name, phone, email, role, gender, avatar_url, auth_provider, last_login_at")
      .then(function (res) {
        if (res.error) {
          // Older schemas may not have auth_provider / last_login_at yet.
          return query("id, name, phone, email, role, gender, avatar_url");
        }
        return res;
      })
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data) {
          var user = profileToUser(res.data, email);
          user.role = normalizeRole(res.data.role);
          user._roleAuthoritative = true;
          return user;
        }
        var missing = profileToUser({ id: userId, email: email, role: "guest" }, email);
        missing._roleAuthoritative = false;
        missing._profileMissing = true;
        return preferStableRole(missing, readCachedSession());
      });
  }

  function upsertProfile(userId, fields) {
    var sb = getClient();
    if (!sb) return Promise.resolve();

    var safeFields = Object.assign({}, fields || {});
    delete safeFields.role;

    return sb
      .from("profiles")
      .upsert(
        Object.assign(
          {
            id: userId,
            updated_at: new Date().toISOString()
          },
          safeFields
        ),
        { onConflict: "id" }
      )
      .then(function (res) {
        if (res.error) throw res.error;
      });
  }

  function syncProfileFromMetadata() {
    var sb = getClient();
    if (!sb) return Promise.resolve();
    return sb.rpc("sync_profile_from_metadata").then(function (res) {
      if (res.error) throw res.error;
    });
  }

  function syncProfileFromMetadataSafe() {
    return syncProfileFromMetadata().catch(function () {
      return null;
    });
  }

  function hasOAuthReturnInUrl() {
    var params = new URLSearchParams(window.location.search || "");
    if (params.get("code")) return true;
    var hash = String(window.location.hash || "");
    return hash.indexOf("access_token=") !== -1 || hash.indexOf("refresh_token=") !== -1;
  }

  function cleanOAuthUrlParams() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      url.searchParams.delete("error_code");
      var clean = url.pathname + url.search + url.hash.replace(/access_token=[^&]+&?/g, "").replace(/refresh_token=[^&]+&?/g, "");
      if (clean.indexOf("#") === clean.length - 1) clean = clean.slice(0, -1);
      window.history.replaceState({}, document.title, clean || url.pathname);
    } catch (e) {
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e2) {}
    }
  }

  function completeOAuthReturnIfNeeded(sb) {
    if (!sb || !hasOAuthReturnInUrl()) {
      return Promise.resolve(null);
    }

    var params = new URLSearchParams(window.location.search || "");
    var code = params.get("code");

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
        if (session && session.user) return session;
        if (attempt >= 25) return null;
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(waitForSession(attempt + 1));
          }, 200);
        });
      });
    }

    function afterOAuthSession(session) {
      if (!session || !session.user) return null;

      try {
        if (sessionStorage.getItem("elenest_oauth_pending") === "1") {
          sessionStorage.removeItem("elenest_oauth_pending");
          sessionStorage.setItem("elenest_welcome", "1");
          sessionStorage.setItem("elenest_booking_restart", "1");
        }
      } catch (e) {}

      cleanOAuthUrlParams();
      return syncProfileFromMetadataSafe().then(function () {
        return session;
      });
    }

    if (code) {
      return sb.auth
        .exchangeCodeForSession(code)
        .then(function (exchangeResult) {
          if (exchangeResult.error) {
            return sessionFromUrlTokens(sb).then(function (session) {
              if (session && session.user) return afterOAuthSession(session);
              return waitForSession().then(afterOAuthSession);
            });
          }
          return readSession().then(function (result) {
            return afterOAuthSession(result.data && result.data.session);
          });
        })
        .catch(function () {
          return sessionFromUrlTokens(sb).then(function (session) {
            if (session && session.user) return afterOAuthSession(session);
            return waitForSession().then(afterOAuthSession);
          });
        });
    }

    return sessionFromUrlTokens(sb).then(function (session) {
      if (session && session.user) return afterOAuthSession(session);
      return waitForSession().then(afterOAuthSession);
    });
  }

  function sessionFromUrlTokens(sb) {
    if (!sb) return Promise.resolve(null);
    var params = recoveryParams();
    if (!params.accessToken || !params.refreshToken) return Promise.resolve(null);
    return sb.auth
      .setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken
      })
      .then(function (result) {
        if (result.error) return null;
        return (result.data && result.data.session) || null;
      })
      .catch(function () {
        return null;
      });
  }

  function initSession() {
    var cached = readCachedSession();
    if (cached) sessionUser = cached;
    else sessionUser = null;

    var sb = getClient();
    if (!sb) {
      return Promise.resolve(sessionUser);
    }

    return completeOAuthReturnIfNeeded(sb)
      .then(function () {
        return sb.auth.getSession();
      })
      .then(function (result) {
        if (result.error) throw result.error;
        var session = result.data && result.data.session;
        if (!session || !session.user) {
          cacheUser(null);
          return null;
        }
        return hydrateSessionUser(session, { sync: false });
      })
      .catch(function () {
        var prior = bestCachedIdentity(null);
        if (prior && isStaffRole(prior.role)) {
          sessionUser = prior;
          cacheUser(prior);
          return prior;
        }
        if (prior) {
          sessionUser = prior;
          return prior;
        }
        cacheUser(null);
        return null;
      });
  }

  var readyPromise = initSession().then(function (user) {
    applyStaffHeaderRole(user);
    var sb = getClient();
    if (sb && !authChangeBound) {
      authChangeBound = true;
      sb.auth.onAuthStateChange(function (event, session) {
        if (staffCreateLock > 0) {
          var sid = session && session.user && session.user.id;
          if (!session || !session.user) return;
          if (staffCreateAdminId && sid && sid !== staffCreateAdminId) return;
        }
        scheduleHydrateFromAuthChange(event, session);
      });
    }
    return user;
  });

  function validateRegister(data) {
    var name = String(data.name || "").trim();
    var phone = String(data.phone || "").trim();
    var email = normalizeEmail(data.email);
    var password = String(data.password || "");
    var role = String(data.role || "").trim().toLowerCase() || "guest";

    if (!name || !phone || !email || !password) {
      return { ok: false, message: "Please fill in all fields." };
    }

    if (normalizeRole(role) === "guest") {
      if (!isValidGuestEmail(email)) {
        return { ok: false, message: "Please enter a valid email address." };
      }
      if (!isValidGuestPassword(password)) {
        return { ok: false, message: guestPasswordHint() };
      }
      if (digitsOnly(phone).length !== 11) {
        return { ok: false, message: "Please enter a valid phone number." };
      }
    } else if (!isValidEmail(email)) {
      return { ok: false, message: "Please enter a valid email address (must include @)." };
    }

    if (normalizeRole(role) === "manager" || normalizeRole(role) === "receptionist") {
      return {
        ok: false,
        message: "Manager and Receptionist accounts can only be created by an administrator."
      };
    }

    return {
      ok: true,
      name: name,
      phone: phone,
      email: email,
      password: password,
      role: normalizeRole(role),
      gender: String(data.gender || "").trim().toLowerCase()
    };
  }

  function register(data) {
    var validated = validateRegister(data);
    if (!validated.ok) return Promise.resolve(validated);

    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Supabase is not connected. Refresh the page and try again." });
    }

    return sb.auth
      .signUp({
        email: validated.email,
        password: validated.password,
        options: {
          data: {
            name: validated.name,
            phone: validated.phone,
            role: validated.role,
            gender: validated.gender
          }
        }
      })
      .then(function (result) {
        if (result.error) {
          var msg = result.error.message || "Registration failed.";
          if (/already registered|already exists/i.test(msg)) {
            msg = "An account with this email already exists.";
          }
          return { ok: false, message: msg };
        }

        var user = result.data && result.data.user;
        if (!user) return { ok: false, message: "Registration failed." };

        var session = result.data && result.data.session;
        var profileSetup = Promise.resolve();
        if (session && session.user) {
          profileSetup = syncProfileFromMetadata().catch(function () {
            return upsertProfile(user.id, {
              email: validated.email,
              name: validated.name,
              phone: validated.phone,
              gender: validated.gender
            });
          });
        }

        return profileSetup
          .then(function () {
            if (session && session.user) {
              return sb.auth.signOut().then(function () {
                clearPersistedAuth();
                return { ok: true, autoLoggedIn: false, requiresSignIn: true };
              });
            }
            return { ok: true, autoLoggedIn: false, requiresSignIn: true };
          })
          .catch(function (err) {
            return {
              ok: false,
              message: (err && err.message) || "Account created but profile setup failed. Try signing in."
            };
          });
      });
  }

  function restoreAuthSession(session) {
    var sb = getClient();
    if (!sb || !session || !session.access_token) return Promise.resolve(null);
    return sb.auth
      .setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      })
      .then(function (result) {
        if (result.error) throw result.error;
        var authUser = (result.data && result.data.session && result.data.session.user) || session.user;
        if (!authUser) return null;
        return fetchProfile(authUser.id, authUser.email)
          .then(function (user) {
            var next = user && user.id ? user : profileToUser(
              { id: authUser.id, email: authUser.email || "", role: "admin" },
              authUser.email
            );
            cacheUser(next);
            return next;
          })
          .catch(function () {
            var fallback =
              sessionUser && sessionUser.id === authUser.id
                ? sessionUser
                : profileToUser(
                    {
                      id: authUser.id,
                      email: authUser.email || "",
                      name: (sessionUser && sessionUser.name) || "",
                      role: "admin"
                    },
                    authUser.email
                  );
            cacheUser(fallback);
            return fallback;
          });
      });
  }

  function restoreAuthSessionRetry(session, attempt) {
    attempt = attempt || 0;
    return restoreAuthSession(session).catch(function (err) {
      if (attempt >= 4) throw err;
      return wait(200).then(function () {
        return restoreAuthSessionRetry(session, attempt + 1);
      });
    });
  }

  function validateStaffCreate(data) {
    var name = String(data.name || "").trim();
    var email = normalizeEmail(data.email);
    var password = String(data.password || "");
    var role = normalizeRole(data.role);

    if (normalizeRole(sessionUser && sessionUser.role) !== "admin") {
      return { ok: false, message: "Only administrators can create staff accounts." };
    }

    if (!name || !email || !password || !role) {
      return { ok: false, message: "Please fill in all fields and select a position." };
    }

    if (!isValidEmail(email)) {
      return { ok: false, message: "Please enter a valid email address (must include @)." };
    }

    if (password.length < 6) {
      return { ok: false, message: "Password must be at least 6 characters." };
    }

    if (role !== "manager" && role !== "receptionist") {
      return {
        ok: false,
        message: "Only Manager or Receptionist accounts can be created here."
      };
    }

    return {
      ok: true,
      name: name,
      email: email,
      password: password,
      role: role,
      phone: ""
    };
  }

  function isMissingRpcError(err) {
    var msg = String((err && err.message) || err || "");
    return /Could not find the function|PGRST202|admin_set_user_role|admin_delete_staff_user/i.test(msg);
  }

  function readLocalUsers() {
    try {
      var raw = localStorage.getItem(STORAGE_USERS);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocalUsers(users) {
    try {
      localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    } catch (e) {}
  }

  function readStaffPasswordMap() {
    try {
      var raw = localStorage.getItem(STORAGE_STAFF_PASSWORDS);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeStaffPasswordMap(map) {
    try {
      localStorage.setItem(STORAGE_STAFF_PASSWORDS, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function rememberStaffPassword(email, password) {
    var key = normalizeEmail(email);
    var value = password != null ? String(password) : "";
    if (!key || !value) return;
    var map = readStaffPasswordMap();
    map[key] = value;
    writeStaffPasswordMap(map);
  }

  function lookupStaffPassword(email) {
    var key = normalizeEmail(email);
    if (!key) return "";
    var mapped = readStaffPasswordMap()[key];
    return mapped ? String(mapped) : "";
  }

  function staffRecord(user) {
    var rec = {
      id: (user && user.id) || "",
      name: (user && user.name) || "",
      email: normalizeEmail(user && user.email),
      role: normalizeRole(user && user.role),
      created_at: (user && user.created_at) || null
    };
    var password = user && user.password != null ? String(user.password) : "";
    if (!password) password = lookupStaffPassword(rec.email);
    if (password) rec.password = password;
    return rec;
  }

  function localStaffUsers() {
    return readLocalUsers()
      .map(staffRecord)
      .filter(function (u) {
        return u.email && isStaffRole(u.role);
      });
  }

  function rememberLocalStaffUser(user) {
    var next = staffRecord(user);
    if (!next.email || !isStaffRole(next.role)) return;
    var users = readLocalUsers();
    var found = false;
    users = users.map(function (row) {
      var sameEmail = normalizeEmail(row && row.email) === next.email;
      var sameId = next.id && row && row.id && String(row.id) === String(next.id);
      if (!sameEmail && !sameId) return row;
      found = true;
      var merged = Object.assign({}, row, {
        id: next.id || row.id || "",
        name: next.name || row.name || "",
        email: next.email,
        role: next.role,
        created_at: next.created_at || row.created_at || null
      });
      merged.password = next.password || row.password || merged.password || "";
      if (!merged.password) delete merged.password;
      return merged;
    });
    if (!found) users.push(next);
    if (next.password) rememberStaffPassword(next.email, next.password);
    writeLocalUsers(users);
  }

  function mergeStaffUsers(remote, local) {
    var byId = {};
    var byEmail = {};
    var out = [];

    function add(u) {
      var rec = staffRecord(u);
      if (!rec.email || !isStaffRole(rec.role)) return;
      var existing =
        (rec.id && byId[rec.id]) ||
        (rec.email && byEmail[rec.email]) ||
        null;
      if (existing) {
        existing.id = rec.id || existing.id;
        existing.name = rec.name || existing.name;
        existing.email = rec.email || existing.email;
        existing.role = rec.role || existing.role;
        existing.created_at = rec.created_at || existing.created_at;
        existing.password = rec.password || existing.password;
        if (existing.id) byId[existing.id] = existing;
        if (existing.email) byEmail[existing.email] = existing;
        return;
      }
      out.push(rec);
      if (rec.id) byId[rec.id] = rec;
      byEmail[rec.email] = rec;
    }

    (local || []).forEach(add);
    (remote || []).forEach(add);
    out.sort(function (a, b) {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    return out;
  }

  function removeLocalStaffUser(email) {
    var target = normalizeEmail(email);
    if (!target) return;
    writeLocalUsers(
      readLocalUsers().filter(function (u) {
        return normalizeEmail(u && u.email) !== target;
      })
    );
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function waitForProfileRow(userId, attempt) {
    var sb = getClient();
    if (!sb) return Promise.reject(new Error("Supabase is not connected."));
    attempt = attempt || 0;
    if (attempt > 12) {
      return Promise.reject(new Error("Profile was not created yet. Try again in a moment."));
    }
    return sb
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data && res.data.id) return res.data;
        return wait(250).then(function () {
          return waitForProfileRow(userId, attempt + 1);
        });
      });
  }

  function applyStaffAccountDetails(userId, validated) {
    var sb = getClient();
    var payload = {
      name: validated.name,
      email: validated.email,
      updated_at: new Date().toISOString()
    };
    if (validated.password) payload.staff_password = validated.password;
    return sb
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .then(function (res) {
        if (res.error && /staff_password|column/i.test(String(res.error.message || ""))) {
          delete payload.staff_password;
          return sb.from("profiles").update(payload).eq("id", userId).then(function (retry) {
            if (retry.error) throw retry.error;
          });
        }
        if (res.error) throw res.error;
      });
  }

  function applyStaffAccountProfile(userId, validated) {
    var sb = getClient();
    return sb
      .from("profiles")
      .update({
        role: validated.role,
        name: validated.name,
        email: validated.email,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId)
      .then(function (res) {
        if (res.error) throw res.error;
      });
  }

  function upsertOwnGuestProfile(userId, validated) {
    var sb = getClient();
    return sb
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: validated.email,
          name: validated.name,
          phone: "",
          role: "guest",
          updated_at: new Date().toISOString()
        },
        { onConflict: "id" }
      )
      .then(function (res) {
        if (res.error) throw res.error;
      });
  }

  function assignStaffRole(userId, validated, attempt) {
    var sb = getClient();
    attempt = attempt || 0;
    return sb
      .rpc("admin_set_user_role", {
        target_user_id: userId,
        new_role: validated.role
      })
      .then(function (rpcRes) {
        if (!rpcRes.error) return;
        var msg = String(rpcRes.error.message || "");
        if (isMissingRpcError(rpcRes.error)) {
          return applyStaffAccountProfile(userId, validated);
        }
        if ((/Profile not found/i.test(msg) || /Only administrators/i.test(msg)) && attempt < 12) {
          return wait(250).then(function () {
            return assignStaffRole(userId, validated, attempt + 1);
          });
        }
        throw rpcRes.error;
      });
  }

  function ensureStaffProfile(userId, validated) {
    return assignStaffRole(userId, validated).then(function () {
      return applyStaffAccountDetails(userId, validated).catch(function () {
        return null;
      });
    });
  }

  function staffSignUpPayload(validated) {
    return {
      email: validated.email,
      password: validated.password,
      options: {
        data: {
          name: validated.name,
          full_name: validated.name,
          phone: validated.phone || "",
          role: validated.role,
          created_by_admin: true,
          staff_password: validated.password
        }
      }
    };
  }

  function signUpStaffUser(sb, validated, adminSession) {
    var payload = staffSignUpPayload(validated);
    var adminId = adminSession && adminSession.user && adminSession.user.id;

    function normalizeResult(result) {
      if (result.error) return result;
      var user = result.data && result.data.user;
      if (!user) return { error: { message: "Failed to create staff account." }, data: result.data };
      if (user.identities && user.identities.length === 0) {
        return { error: { message: "An account with this email already exists." }, data: result.data };
      }
      if (adminId && user.id === adminId) {
        return { error: { message: "RETRY_AFTER_LOCAL_SIGNOUT" }, data: null };
      }
      if (normalizeEmail(user.email) !== validated.email) {
        return { error: { message: "RETRY_AFTER_LOCAL_SIGNOUT" }, data: null };
      }
      return result;
    }

    return sb.auth.signUp(payload).then(normalizeResult).then(function (result) {
      if (!result.error || result.error.message !== "RETRY_AFTER_LOCAL_SIGNOUT") {
        return result;
      }
      return Promise.resolve(sb.auth.signOut({ scope: "local" }))
        .catch(function () {
          return null;
        })
        .then(function () {
          return sb.auth.signUp(payload).then(normalizeResult);
        });
    });
  }

  function createStaffAccount(data) {
    var validated = validateStaffCreate(data);
    if (!validated.ok) return Promise.resolve(validated);

    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Supabase is not connected. Refresh the page and try again." });
    }

    var adminSession = null;
    var adminSnapshot = sessionUser;
    var locked = false;

    function restoreAdmin() {
      return restoreAuthSessionRetry(adminSession)
        .then(function (user) {
          if (user && user.id) cacheUser(user);
          else if (adminSnapshot) cacheUser(adminSnapshot);
          applyStaffHeaderRole(sessionUser);
          return sessionUser;
        })
        .catch(function () {
          if (adminSnapshot) cacheUser(adminSnapshot);
          applyStaffHeaderRole(sessionUser);
          return sessionUser;
        });
    }

    function finish(result) {
      if (locked) {
        staffCreateLock = Math.max(0, staffCreateLock - 1);
        staffCreateAdminId = null;
        locked = false;
      }
      return restoreAdmin().then(function () {
        return result;
      });
    }

    return sb.auth
      .getSession()
      .then(function (sessionResult) {
        adminSession = sessionResult.data && sessionResult.data.session;
        if (!adminSession || !adminSession.user) {
          return { ok: false, message: "Not signed in." };
        }

        staffCreateAdminId = adminSession.user.id;
        staffCreateLock += 1;
        locked = true;

        return signUpStaffUser(sb, validated, adminSession).then(function (result) {
          if (result.error) {
            var msg = result.error.message || "Failed to create staff account.";
            if (/already registered|already exists/i.test(msg)) {
              msg = "An account with this email already exists.";
            }
            return { ok: false, message: msg };
          }

          var user = result.data && result.data.user;
          if (!user) {
            return { ok: false, message: "Failed to create staff account." };
          }

          var newSession = result.data && result.data.session;
          var prepareProfile = Promise.resolve();
          if (newSession && newSession.user && newSession.user.id === user.id) {
            prepareProfile = upsertOwnGuestProfile(user.id, validated).catch(function () {
              return null;
            });
          }

          return prepareProfile
            .then(function () {
              return restoreAdmin();
            })
            .then(function () {
              return ensureStaffProfile(user.id, validated);
            })
            .then(function () {
              var created = {
                id: user.id,
                name: validated.name,
                email: validated.email,
                role: validated.role,
                password: validated.password,
                created_at: new Date().toISOString()
              };
              rememberStaffPassword(validated.email, validated.password);
              rememberLocalStaffUser(created);
              return { ok: true, user: created };
            })
            .catch(function (err) {
              return {
                ok: false,
                message: (err && err.message) || "Account created but role assignment failed."
              };
            });
        });
      })
      .then(function (result) {
        return finish(result);
      })
      .catch(function (err) {
        return finish({
          ok: false,
          message: (err && err.message) || "Failed to create staff account."
        });
      });
  }

  function mapStaffProfileRow(row) {
    var rec = staffRecord(row);
    var fromDb = row && row.staff_password ? String(row.staff_password) : "";
    if (fromDb) {
      rec.password = fromDb;
      rememberStaffPassword(rec.email, fromDb);
    } else if (!rec.password) {
      rec.password = lookupStaffPassword(rec.email);
    }
    return rec;
  }

  function fetchStaffProfilesFromDb(sb) {
    function fetchProfiles(columns, orderColumn) {
      var q = sb.from("profiles").select(columns);
      if (orderColumn) {
        q = q.order(orderColumn, { ascending: orderColumn === "name" });
      }
      return q;
    }

    var withPassword = "id, name, email, role, created_at, staff_password";
    var withoutPassword = "id, name, email, role, created_at";

    return fetchProfiles(withPassword, "created_at")
      .then(function (res) {
        var msg = String((res && res.error && res.error.message) || "");
        if (res.error && /staff_password|column/i.test(msg)) {
          return fetchProfiles(withoutPassword, "created_at");
        }
        if (res.error && /created_at|column/i.test(msg)) {
          return fetchProfiles(withoutPassword, "name");
        }
        if (res.error) throw res.error;
        return res;
      })
      .then(function (res) {
        if (res.error && /created_at|column/i.test(String(res.error.message || ""))) {
          return fetchProfiles(withoutPassword, "name");
        }
        if (res.error) throw res.error;
        return res;
      })
      .then(function (res) {
        if (res.error) throw res.error;
        var users = (res.data || [])
          .map(mapStaffProfileRow)
          .filter(function (u) {
            return isStaffRole(u.role);
          })
          .sort(function (a, b) {
            return String(b.created_at || "").localeCompare(String(a.created_at || ""));
          });
        return { ok: true, users: users };
      });
  }

  function listStaffProfiles() {
    var sb = getClient();
    var local = localStaffUsers();
    if (!sb) {
      return Promise.resolve({
        ok: local.length > 0,
        message: local.length ? "" : "Supabase is not connected.",
        users: local
      });
    }

    function withMerged(remote) {
      var users = mergeStaffUsers(remote || [], local);
      users.forEach(function (u) {
        if (!u.password) u.password = lookupStaffPassword(u.email);
        rememberLocalStaffUser(u);
      });
      return { ok: true, users: users };
    }

    return sb.auth
      .getSession()
      .then(function (sessionResult) {
        var session = sessionResult.data && sessionResult.data.session;
        if (!session || !session.user) {
          if (local.length) return { ok: true, users: local };
          return { ok: false, message: "Not signed in.", users: [] };
        }

        function loadFromDb() {
          return fetchStaffProfilesFromDb(sb).then(function (result) {
            return withMerged((result && result.users) || []);
          });
        }

        var cachedRole = normalizeRole(sessionUser && sessionUser.role);
        if (cachedRole === "admin") {
          return loadFromDb();
        }

        return hydrateSessionUser(session).then(function (user) {
          if (normalizeRole(user && user.role) !== "admin") {
            if (local.length) return { ok: true, users: local };
            return { ok: false, message: "Not authorized.", users: [] };
          }
          return loadFromDb();
        });
      })
      .catch(function (err) {
        if (local.length) return { ok: true, users: local };
        return { ok: false, message: err.message || "Could not load staff accounts.", users: [] };
      });
  }

  function revokeStaffAccess(userId, email) {
    var sb = getClient();
    if (!sb) {
      removeLocalStaffUser(email);
      return Promise.resolve({ ok: true, message: "Staff access removed." });
    }
    return sb
      .rpc("admin_set_user_role", {
        target_user_id: userId,
        new_role: "guest"
      })
      .then(function (res) {
        if (res.error) throw res.error;
        removeLocalStaffUser(email);
        return { ok: true, message: "Staff access removed." };
      });
  }

  function deleteStaffAccount(data) {
    var userId = data && data.id ? String(data.id) : "";
    var email = normalizeEmail(data && data.email);
    var role = normalizeRole(data && data.role);

    if (normalizeRole(sessionUser && sessionUser.role) !== "admin") {
      return Promise.resolve({ ok: false, message: "Only administrators can delete staff accounts." });
    }
    if (sessionUser && userId && sessionUser.id === userId) {
      return Promise.resolve({ ok: false, message: "You cannot delete your own account." });
    }
    if (role !== "manager" && role !== "receptionist") {
      return Promise.resolve({
        ok: false,
        message: "Only Manager or Receptionist accounts can be deleted here."
      });
    }

    var sb = getClient();
    if (!sb) {
      removeLocalStaffUser(email);
      return Promise.resolve({ ok: true, message: "Staff account removed." });
    }
    if (!userId) {
      return Promise.resolve({ ok: false, message: "Missing user id." });
    }

    return sb
      .rpc("admin_delete_staff_user", { target_user_id: userId })
      .then(function (res) {
        if (res.error) {
          if (isMissingRpcError(res.error)) {
            return revokeStaffAccess(userId, email);
          }
          throw res.error;
        }
        removeLocalStaffUser(email);
        return { ok: true, message: "Staff account deleted." };
      })
      .catch(function (err) {
        return {
          ok: false,
          message: (err && err.message) || "Could not delete staff account."
        };
      });
  }

  function login(email, password) {
    var e = normalizeEmail(email);
    var p = String(password || "");

    if (!isValidEmail(e)) {
      return Promise.resolve({ ok: false, message: "Please enter a valid email address." });
    }
    if (!p) {
      return Promise.resolve({ ok: false, message: "Please enter your password." });
    }

    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Supabase is not connected. Refresh the page and try again." });
    }

    return sb.auth.signInWithPassword({ email: e, password: p }).then(function (result) {
      if (result.error) {
        return { ok: false, message: "Invalid email or password." };
      }

      var authUser = result.data && result.data.user;
      if (!authUser) {
        return { ok: false, message: "Invalid email or password." };
      }

      return fetchProfile(authUser.id, authUser.email)
        .then(function () {
          return syncProfileFromMetadataSafe();
        })
        .then(function () {
          return fetchProfile(authUser.id, authUser.email);
        })
        .catch(function () {
          return fetchProfile(authUser.id, authUser.email);
        })
        .then(function (user) {
          if (!user || !user.id) {
            sb.auth.signOut();
            cacheUser(null);
            return { ok: false, message: "Could not load your account profile." };
          }
          var merged = preferStableRole(user, bestCachedIdentity(user));
          cacheUser(user._roleAuthoritative ? user : merged, {
            fromAuthoritative: !!user._roleAuthoritative
          });
          try {
            sessionStorage.removeItem("elenest_role_hop");
            sessionStorage.removeItem("elenest_staff_gate_deny");
          } catch (e) {}
          return {
            ok: true,
            homePath: postLoginPathForUser(sessionUser),
            role: normalizeRole(sessionUser && sessionUser.role)
          };
        });
    });
  }

  function logout() {
    clearPersistedAuth();
    try {
      if (window.ElenestStaffAccessPin && typeof window.ElenestStaffAccessPin.clearUnlock === "function") {
        window.ElenestStaffAccessPin.clearUnlock();
      }
    } catch (e) {}
    var sb = getClient();
    if (!sb) return Promise.resolve({ ok: true });

    return sb.auth
      .signOut()
      .then(function (result) {
        clearPersistedAuth();
        try {
          if (window.ElenestStaffAccessPin && typeof window.ElenestStaffAccessPin.clearUnlock === "function") {
            window.ElenestStaffAccessPin.clearUnlock();
          }
        } catch (e2) {}
        if (result.error) {
          return { ok: false, message: result.error.message || "Logout failed." };
        }
        return { ok: true };
      })
      .catch(function (err) {
        clearPersistedAuth();
        try {
          if (window.ElenestStaffAccessPin && typeof window.ElenestStaffAccessPin.clearUnlock === "function") {
            window.ElenestStaffAccessPin.clearUnlock();
          }
        } catch (e3) {}
        return { ok: false, message: err.message || "Logout failed." };
      });
  }

  function verifyCurrentPassword(password) {
    var sb = getClient();
    if (!sb || !sessionUser || !sessionUser.email) {
      return Promise.resolve({ ok: false, message: "Not signed in." });
    }

    return sb.auth
      .signInWithPassword({
        email: normalizeEmail(sessionUser.email),
        password: String(password || "")
      })
      .then(function (result) {
        if (result.error) {
          return { ok: false, message: "Incorrect password." };
        }
        var session = result.data && result.data.session;
        if (session && session.user) {
          return hydrateSessionUser(session).then(function () {
            return { ok: true };
          });
        }
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, message: "Incorrect password." };
      });
  }

  function isPrivateOrLocalHost(hostname) {
    var h = String(hostname || "").toLowerCase();
    if (!h || h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    return false;
  }

  function publicHtmlBaseUrl() {
    var cfg = window.ElenestSupabaseConfig || {};
    var publicBase = String(cfg.publicSiteHtmlBaseUrl || "https://elenest-resort.onrender.com/html/").trim();
    if (publicBase.charAt(publicBase.length - 1) !== "/") publicBase += "/";
    try {
      var loc = window.location;
      if (
        loc &&
        (loc.protocol === "http:" || loc.protocol === "https:") &&
        loc.origin &&
        loc.origin !== "null" &&
        !isPrivateOrLocalHost(loc.hostname)
      ) {
        var path = loc.pathname || "/";
        var htmlIdx = path.toLowerCase().lastIndexOf("/html/");
        if (htmlIdx !== -1) return loc.origin + path.substring(0, htmlIdx + 6);
        if (path === "/" || path === "/index.html") return loc.origin + "/html/";
      }
    } catch (e) {}
    return publicBase;
  }

  function passwordResetRedirectUrl() {
    return publicHtmlBaseUrl() + "reset-password.html";
  }

  function roleMayResetOwnPassword(role) {
    var r = normalizeRole(role);
    return r === "admin" || r === "guest";
  }

  function sendRecoveryEmail(email) {
    var cfg = window.ElenestSupabaseConfig || {};
    var base = String(cfg.url || "").replace(/\/$/, "");
    var key = cfg.publishableKey || "";
    if (!base || !key) {
      return Promise.resolve({ ok: false, message: "Sign-in is unavailable right now. Please try again." });
    }
    var redirectTo = passwordResetRedirectUrl();
    function recoveryFailureMessage(raw) {
      var sdkMsg = raw || "Could not send the reset email. Please try again.";
      if (/redirect|not allowed|invalid url/i.test(sdkMsg)) {
        return (
          "The reset link address is not allowed yet. In Supabase → Authentication → URL Configuration, add " +
          redirectTo +
          " to Redirect URLs."
        );
      }
      return sdkMsg;
    }
    // A separate implicit client so the email link is not locked to this browser.
    // The main client uses PKCE, which fails when the email is opened on a phone.
    if (window.supabase && typeof window.supabase.createClient === "function") {
      var recoveryClient = window.supabase.createClient(base, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          flowType: "implicit",
          storageKey: "elenest-password-recovery"
        }
      });
      return recoveryClient.auth.resetPasswordForEmail(email, { redirectTo: redirectTo }).then(function (result) {
        if (!result.error) return { ok: true };
        return { ok: false, message: recoveryFailureMessage(result.error.message) };
      });
    }
    return fetch(base + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: "Bearer " + key
      },
      body: JSON.stringify({ email: email })
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch (e) {}
          if (!res.ok) {
            var msg =
              (body && (body.msg || body.message || body.error_description || body.error)) ||
              "Could not send the reset email. Please try again.";
            return { ok: false, message: recoveryFailureMessage(String(msg)) };
          }
          return { ok: true };
        });
      })
      .catch(function () {
        return { ok: false, message: "Could not send the reset email. Check your connection and try again." };
      });
  }

  function emailInboxUrl(email) {
    var e = normalizeEmail(email);
    var at = e.lastIndexOf("@");
    if (at < 1) return "";
    var domain = e.slice(at + 1);
    var urls = {
      "gmail.com": "https://mail.google.com/mail/u/0/#inbox",
      "googlemail.com": "https://mail.google.com/mail/u/0/#inbox",
      "outlook.com": "https://outlook.live.com/mail/0/inbox",
      "hotmail.com": "https://outlook.live.com/mail/0/inbox",
      "live.com": "https://outlook.live.com/mail/0/inbox",
      "msn.com": "https://outlook.live.com/mail/0/inbox",
      "yahoo.com": "https://mail.yahoo.com/",
      "ymail.com": "https://mail.yahoo.com/",
      "rocketmail.com": "https://mail.yahoo.com/",
      "icloud.com": "https://www.icloud.com/mail",
      "me.com": "https://www.icloud.com/mail",
      "mac.com": "https://www.icloud.com/mail",
      "aol.com": "https://mail.aol.com/",
      "proton.me": "https://mail.proton.me/u/0/inbox",
      "protonmail.com": "https://mail.proton.me/u/0/inbox",
      "pm.me": "https://mail.proton.me/u/0/inbox",
      "zoho.com": "https://mail.zoho.com/zm/#mail/folder/inbox"
    };
    return urls[domain] || "";
  }

  function openEmailInbox(email) {
    var url = emailInboxUrl(email);
    if (!url) return false;
    window.location.assign(url);
    return true;
  }

  function checkPasswordResetEligibility(email) {
    var e = normalizeEmail(email);
    if (!isValidEmail(e)) {
      return Promise.resolve({
        ok: false,
        email: e,
        status: "invalid",
        eligible: false,
        message: "Please enter a valid email address."
      });
    }
    var sb = getClient();
    if (!sb || !isSupabaseReady()) {
      return Promise.resolve({
        ok: false,
        email: e,
        status: "unavailable",
        eligible: false,
        message: "Sign-in is unavailable right now. Please try again."
      });
    }
    return sb
      .rpc("password_reset_eligibility", { target_email: e })
      .then(function (res) {
        if (res.error) {
          return {
            ok: false,
            email: e,
            status: "unavailable",
            eligible: false,
            message: "Password reset is unavailable right now. Please try again later."
          };
        }
        var status = String(res.data || "").trim().toLowerCase();
        if (status === "eligible") {
          return { ok: true, email: e, status: "eligible", eligible: true, message: "" };
        }
        if (status === "denied") {
          return {
            ok: false,
            email: e,
            status: "denied",
            eligible: false,
            denied: true,
            message: "Password reset is only available for Customer and Admin accounts."
          };
        }
        return {
          ok: false,
          email: e,
          status: "unknown",
          eligible: false,
          message: "No Customer or Admin account was found for that email."
        };
      })
      .catch(function () {
        return {
          ok: false,
          email: e,
          status: "unavailable",
          eligible: false,
          message: "Could not start password reset. Please try again."
        };
      });
  }

  function requestPasswordReset(email) {
    return checkPasswordResetEligibility(email).then(function (check) {
      if (!check.eligible) return check;
      return sendRecoveryEmail(check.email).then(function (sent) {
        if (!sent.ok) return sent;
        var inbox = emailInboxUrl(check.email);
        return {
          ok: true,
          email: check.email,
          inboxUrl: inbox,
          message: inbox
            ? "A link to reset your Elenest Resort password was sent to " +
              check.email +
              ". Opening your inbox so you can read that email. Your Google, Gmail, and other account passwords are not changed."
            : "A link to reset your Elenest Resort password was sent to " +
              check.email +
              ". Open that email and choose a new Elenest Resort password. Your Google, Gmail, and other account passwords are not changed."
        };
      });
    });
  }

  function recoveryParams() {
    var preset = window.ElenestRecoverySnapshot || {};
    var search = new URLSearchParams(window.location.search || "");
    var hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    function first() {
      for (var i = 0; i < arguments.length; i++) {
        if (arguments[i]) return String(arguments[i]);
      }
      return "";
    }
    return {
      type: first(preset.type, search.get("type"), hash.get("type")),
      tokenHash: first(
        preset.tokenHash,
        search.get("token_hash"),
        hash.get("token_hash"),
        search.get("token"),
        hash.get("token")
      ),
      code: first(preset.code, search.get("code")),
      accessToken: first(preset.accessToken, hash.get("access_token"), search.get("access_token")),
      refreshToken: first(preset.refreshToken, hash.get("refresh_token"), search.get("refresh_token")),
      error: first(
        preset.error,
        search.get("error_description"),
        hash.get("error_description"),
        search.get("error"),
        hash.get("error")
      )
    };
  }

  function urlHasRecoveryGrant() {
    var p = recoveryParams();
    return !!(p.tokenHash || p.accessToken || p.code || p.type === "recovery");
  }

  function rejectRecoverySession() {
    var sb = getClient();
    cacheUser(null);
    var done = sb ? sb.auth.signOut() : Promise.resolve();
    return done.catch(function () {}).then(function () {
      return {
        ok: false,
        denied: true,
        message: "Password reset is only available for Customer and Admin accounts."
      };
    });
  }

  function assertRecoveryAccount(session) {
    var userId = session && session.user && session.user.id;
    var email = session && session.user && session.user.email;
    if (!userId) {
      return Promise.resolve({ ok: false, message: "This reset link is invalid or has expired." });
    }
    return fetchProfile(userId, email)
      .then(function (user) {
        if (user && user._roleAuthoritative && roleMayResetOwnPassword(user.role)) {
          return { ok: true, user: user };
        }
        return rejectRecoverySession();
      })
      .catch(function () {
        return rejectRecoverySession();
      });
  }

  function establishPasswordRecovery() {
    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Sign-in is unavailable right now. Please try again." });
    }
    var params = recoveryParams();
    if (params.error) {
      return Promise.resolve({
        ok: false,
        message: String(params.error).replace(/\+/g, " ")
      });
    }
    if (!urlHasRecoveryGrant()) {
      return Promise.resolve({
        ok: false,
        message: "Open the password reset link from your email to choose a new password."
      });
    }

    function sessionOrTokens() {
      return sb.auth.getSession().then(function (result) {
        if (result.error) throw result.error;
        var existing = result.data && result.data.session;
        if (existing && existing.user) return existing;
        return sessionFromUrlTokens(sb);
      });
    }

    var ready = Promise.resolve();
    if (params.tokenHash) {
      ready = sb.auth
        .verifyOtp({ token_hash: params.tokenHash, type: "recovery" })
        .then(function (result) {
          if (result.error) throw result.error;
          return result.data && result.data.session;
        });
    } else if (params.code) {
      ready = sb.auth.exchangeCodeForSession(params.code).then(function (result) {
        if (!result.error && result.data && result.data.session) {
          return result.data.session;
        }
        return sessionOrTokens().then(function (session) {
          if (session && session.user) return session;
          throw result.error || new Error("This reset link is invalid or has expired. Request a new one.");
        });
      });
    } else {
      ready = sessionOrTokens();
    }

    return ready
      .then(function (session) {
        if (!session || !session.user) {
          return { ok: false, message: "This reset link is invalid or has expired. Request a new one." };
        }
        return assertRecoveryAccount(session);
      })
      .catch(function (err) {
        var msg = (err && err.message) || "This reset link is invalid or has expired. Request a new one.";
        if (/code verifier|pkce|different browser/i.test(msg)) {
          msg =
            "This reset link was opened in a different browser. Request a new password reset on this phone, then open that new email here.";
        }
        return { ok: false, message: msg };
      });
  }

  function completePasswordReset(newPassword, confirmPassword) {
    var next = String(newPassword || "");
    var confirm = String(confirmPassword || "");
    if (next.length < MIN_GUEST_PASSWORD_LENGTH) {
      return Promise.resolve({ ok: false, message: guestPasswordHint() });
    }
    if (next !== confirm) {
      return Promise.resolve({ ok: false, message: "Passwords do not match." });
    }
    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Sign-in is unavailable right now. Please try again." });
    }
    if (!urlHasRecoveryGrant()) {
      return Promise.resolve({
        ok: false,
        message: "Open the password reset link from your email to choose a new password."
      });
    }
    return sb.auth
      .getSession()
      .then(function (result) {
        if (result.error) throw result.error;
        return assertRecoveryAccount(result.data && result.data.session);
      })
      .then(function (check) {
        if (!check.ok) return check;
        return sb.auth.updateUser({ password: next }).then(function (updated) {
          if (updated.error) {
            return { ok: false, message: updated.error.message || "Could not update the Elenest Resort password." };
          }
          cacheUser(null);
          return sb.auth.signOut().catch(function () {}).then(function () {
            return {
              ok: true,
              message:
                "Your Elenest Resort password was replaced. Sign in with that new password. Your Google, Gmail, and other account passwords were not changed."
            };
          });
        });
      })
      .catch(function (err) {
        return { ok: false, message: (err && err.message) || "Could not update the password." };
      });
  }

  function changePassword(currentPassword, newPassword) {
    var sb = getClient();
    if (!sb || !sessionUser || !sessionUser.email) {
      return Promise.resolve({ ok: false, message: "Not signed in." });
    }
    if (String(newPassword || "").length < 6) {
      return Promise.resolve({ ok: false, message: "New password must be at least 6 characters." });
    }

    return verifyCurrentPassword(currentPassword).then(function (check) {
      if (!check.ok) {
        return { ok: false, message: check.message || "Current password is incorrect." };
      }
      return sb.auth.updateUser({ password: newPassword }).then(function (result) {
        if (result.error) {
          return { ok: false, message: result.error.message || "Failed to update password." };
        }
        return { ok: true };
      });
    });
  }

  function setAccountPassword(newPassword) {
    var sb = getClient();
    if (!sb || !sessionUser) {
      return Promise.resolve({ ok: false, message: "Not signed in." });
    }
    if (String(newPassword || "").length < 6) {
      return Promise.resolve({ ok: false, message: "Password must be at least 6 characters." });
    }

    return sb.auth.updateUser({ password: newPassword }).then(function (result) {
      if (result.error) {
        return { ok: false, message: result.error.message || "Failed to set password." };
      }
      return { ok: true };
    });
  }

  function getUserAuthProviders() {
    var sb = getClient();
    if (!sb) return Promise.resolve([]);

    return sb.auth.getUser().then(function (result) {
      var user = result.data && result.data.user;
      if (!user || !user.identities || !user.identities.length) return [];
      var providers = [];
      for (var i = 0; i < user.identities.length; i++) {
        if (user.identities[i] && user.identities[i].provider) {
          providers.push(user.identities[i].provider);
        }
      }
      return providers;
    }).catch(function () {
      return [];
    });
  }

  function canChangePassword() {
    return getUserAuthProviders().then(function (providers) {
      return providers.indexOf("email") !== -1;
    });
  }

  function updateCurrentUserProfile(data) {
    var name = String((data && data.name) || "").trim();
    var email = normalizeEmail(data && data.email);

    if (!name) {
      return Promise.resolve({ ok: false, message: "Please enter a name." });
    }
    if (!isValidEmail(email)) {
      return Promise.resolve({ ok: false, message: "Please enter a valid email address." });
    }

    var sb = getClient();
    if (!sb || !sessionUser || !sessionUser.id) {
      return Promise.resolve({ ok: false, message: "Not signed in." });
    }

    var emailChanged = normalizeEmail(sessionUser.email) !== email;
    var updatePayload = {
      data: {
        name: name,
        full_name: name
      }
    };
    if (emailChanged) updatePayload.email = email;

    return sb.auth
      .updateUser(updatePayload)
      .then(function (result) {
        if (result.error) throw result.error;
        var authEmail =
          (result.data && result.data.user && result.data.user.email) ||
          sessionUser.email ||
          email;
        return upsertProfile(sessionUser.id, {
          name: name,
          email: emailChanged ? email : authEmail,
          phone: sessionUser.phone || "",
          gender: sessionUser.gender || ""
        }).then(function () {
          var confirmedEmail = normalizeEmail(authEmail);
          var needsEmailConfirm = emailChanged && confirmedEmail && confirmedEmail !== email;
          return { needsEmailConfirm: needsEmailConfirm, requestedEmail: email };
        });
      })
      .then(function (emailState) {
        return syncProfileFromMetadataSafe().then(function () {
          return emailState;
        });
      })
      .then(function (emailState) {
        return fetchProfile(sessionUser.id, emailState.requestedEmail || sessionUser.email).then(function (freshUser) {
          if (freshUser && emailState && emailState.requestedEmail) {
            freshUser.email = emailState.requestedEmail;
            freshUser.name = name;
          }
          cacheUser(freshUser);
          try {
            window.dispatchEvent(
              new CustomEvent("elenest-auth-change", { detail: { event: "PROFILE_UPDATED", user: freshUser } })
            );
          } catch (e) {}
          var message = "Profile saved.";
          if (emailState && emailState.needsEmailConfirm) {
            message =
              "Name saved. Check " +
              emailState.requestedEmail +
              " to confirm your new sign-in email.";
          }
          return { ok: true, user: freshUser, message: message };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          message: (err && err.message) || "Could not update profile."
        };
      });
  }

  function updateGuestProfile(data) {
    var name = String((data && data.name) || "").trim();
    var phone = digitsOnly(data && data.phone);
    var gender = normalizeGender((data && data.gender) || "");

    if (!name) {
      return Promise.resolve({ ok: false, message: "Please enter your name." });
    }
    if (phone.length !== 11) {
      return Promise.resolve({ ok: false, message: "Please enter a valid 11-digit phone number." });
    }

    var sb = getClient();
    if (!sb || !sessionUser || !sessionUser.id) {
      return Promise.resolve({ ok: false, message: "Not signed in." });
    }

    return sb.auth
      .updateUser({
          data: {
            name: name,
            full_name: name,
            phone: phone,
            gender: gender
          }
      })
      .then(function (result) {
        if (result.error) throw result.error;
        return upsertProfile(sessionUser.id, {
          name: name,
          phone: phone,
          gender: gender,
          email: sessionUser.email || ""
        });
      })
      .then(function () {
        return syncProfileFromMetadataSafe();
      })
      .then(function () {
        return fetchProfile(sessionUser.id, sessionUser.email);
      })
      .then(function (freshUser) {
        cacheUser(freshUser);
        try {
          window.dispatchEvent(
            new CustomEvent("elenest-auth-change", { detail: { event: "PROFILE_UPDATED", user: freshUser } })
          );
        } catch (e) {}
        return { ok: true, user: freshUser };
      })
      .catch(function (err) {
        return {
          ok: false,
          message: (err && err.message) || "Could not update profile."
        };
      });
  }

  function homePathForRole(role) {
    var r = normalizeRole(role);
    if (r === "admin") return "admin.html";
    if (r === "manager") return "manager.html";
    if (r === "receptionist") return "reception.html";
    return "book.html";
  }

  function postLoginPathForUser(user) {
    if (!user) return "login.html";
    return homePathForRole(user.role);
  }

  function fetchAuthoritativeUser() {
    var sb = getClient();
    if (!sb) {
      return Promise.resolve(sessionUser || readCachedSession());
    }
    return sb.auth
      .getSession()
      .then(function (result) {
        if (result.error) throw result.error;
        var session = result.data && result.data.session;
        if (!session || !session.user) {
          cacheUser(null);
          return null;
        }
        var cached = readCachedSession();
        if (cached && authIdentitiesMatch(cached, { id: session.user.id, email: session.user.email })) {
          sessionUser = cached;
        }
        return fetchProfile(session.user.id, session.user.email)
          .then(function (user) {
            var merged = preferStableRole(user, cached || readCachedSession());
            cacheUser(merged);
            return sessionUser;
          })
          .catch(function () {
            var prior = cached || readCachedSession();
            if (prior && authIdentitiesMatch(prior, { id: session.user.id, email: session.user.email })) {
              cacheUser(prior);
              return sessionUser;
            }
            var fallback = preferStableRole(userFromAuthSession(session), prior);
            cacheUser(fallback);
            return sessionUser;
          });
      })
      .catch(function () {
        var prior = sessionUser || readCachedSession();
        if (prior) return prior;
        return null;
      });
  }

  function loginUrl() {
    return "login.html";
  }

  function denialRedirectForRole(requiredRole, resolvedRole) {
    var allowed = String(requiredRole || "").trim().toLowerCase();
    if (allowed === "reception") allowed = "receptionist";
    var role = normalizeRole(resolvedRole);
    // Staff portals must never bounce to the customer book page — that caused
    // admin ↔ book reload loops and Out-of-Memory crashes in Edge.
    if (isStaffRole(allowed)) {
      if (isStaffRole(role) && role !== allowed) return homePathForRole(role);
      return loginUrl();
    }
    return homePathForRole(role);
  }

  function assertPageAccess(requiredRole) {
    var allowed = String(requiredRole || "").trim().toLowerCase();
    if (allowed === "client" || allowed === "customer" || allowed === "user") {
      allowed = "guest";
    }
    if (allowed === "reception") allowed = "receptionist";

    return fetchAuthoritativeUser().then(function (user) {
      function tryCachedStaff() {
        var cached = bestCachedIdentity(user || null);
        if (cached && normalizeRole(cached.role) === allowed) {
          if (user && authIdentitiesMatch(user, cached)) {
            cacheUser(Object.assign({}, user, { role: allowed, name: user.name || cached.name }));
          } else {
            cacheUser(cached);
          }
          return { ok: true, user: sessionUser, role: allowed };
        }
        return null;
      }

      if (!user) {
        var fromCache = tryCachedStaff();
        if (fromCache) return fromCache;
        return { ok: false, redirect: loginUrl() };
      }

      var role = normalizeRole(user.role);
      if (role === allowed) {
        try {
          sessionStorage.removeItem("elenest_role_hop");
          sessionStorage.removeItem("elenest_staff_gate_deny");
        } catch (e) {}
        return { ok: true, user: user, role: role };
      }

      var restored = tryCachedStaff();
      if (restored) return restored;

      return {
        ok: false,
        redirect: denialRedirectForRole(allowed, role),
        role: role,
        user: user
      };
    });
  }

  window.ElenestAuth = {
    ready: readyPromise,
    isSupabaseReady: isSupabaseReady,
    normalizeRole: normalizeRole,
    headerRoleLabel: headerRoleLabel,
    applyStaffHeaderRole: applyStaffHeaderRole,
    isStaffRole: isStaffRole,

    getHomePathForRole: homePathForRole,

    getPostLoginPath: postLoginPathForUser,

    getLoginUrlForPortal: function () {
      return loginUrl();
    },
    assertPageAccess: assertPageAccess,
    fetchAuthoritativeUser: fetchAuthoritativeUser,

    register: register,
    validateRegister: validateRegister,
    createStaffAccount: createStaffAccount,
    listStaffProfiles: listStaffProfiles,
    deleteStaffAccount: deleteStaffAccount,
    login: login,
    logout: logout,
    refreshSession: function () {
      return initSession();
    },
    hydrateSessionUser: function (session) {
      return hydrateSessionUser(session);
    },
    verifyCurrentPassword: verifyCurrentPassword,
    checkPasswordResetEligibility: checkPasswordResetEligibility,
    emailInboxUrl: emailInboxUrl,
    openEmailInbox: openEmailInbox,
    requestPasswordReset: requestPasswordReset,
    establishPasswordRecovery: establishPasswordRecovery,
    completePasswordReset: completePasswordReset,
    passwordResetRedirectUrl: passwordResetRedirectUrl,
    roleMayResetOwnPassword: roleMayResetOwnPassword,
    changePassword: changePassword,
    setAccountPassword: setAccountPassword,
    getUserAuthProviders: getUserAuthProviders,
    canChangePassword: canChangePassword,
    updateCurrentUserProfile: updateCurrentUserProfile,
    updateStaffProfile: updateCurrentUserProfile,
    updateGuestProfile: updateGuestProfile,

    getCurrentUser: function () {
      if (sessionUser) return sessionUser;
      var cached = readCachedSession();
      if (cached) {
        sessionUser = cached;
        return sessionUser;
      }
      return null;
    },

    setCurrentUser: function (user) {
      cacheUser(user);
      return user;
    },

    isLoggedIn: function () {
      return sessionUser !== null;
    },

    normalizeGender: function (value) {
      var g = String(value || "").trim().toLowerCase();
      if (g === "male" || g === "m") return "male";
      if (g === "female" || g === "f") return "female";
      return "neutral";
    }
  };
})();
