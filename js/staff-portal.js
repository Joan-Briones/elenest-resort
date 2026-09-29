(function () {
  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function init() {
    var Auth = window.ElenestAuth;
    if (!Auth || !Auth.normalizeRole || !Auth.getHomePathForRole) return;

    var portal = String(document.body.getAttribute("data-staff-portal") || "").toLowerCase();
    var required =
      portal === "manager" ? "manager" : portal === "reception" ? "receptionist" : "";
    if (!required) return;

    function boot() {
      if (typeof Auth.assertPageAccess === "function") {
        Auth.assertPageAccess(required).then(function (result) {
          if (!result || !result.ok) {
            var dest = (result && result.redirect) || "login.html";
            if (/book\.html/i.test(String(dest))) dest = "login.html";
            window.location.replace(dest);
            return;
          }
          initStaffPortal(result.user);
        });
        return;
      }
      var user = Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      if (!user) {
        window.location.replace("login.html");
        return;
      }
      var r = Auth.normalizeRole(user.role);
      if (r !== required) {
        window.location.replace(Auth.getHomePathForRole(user.role));
        return;
      }
      initStaffPortal(user);
    }

    if (Auth.ready) {
      Auth.ready.then(boot);
      return;
    }
    boot();
  }

  function staffProfileTitle() {
    var portal = String(document.body.getAttribute("data-staff-portal") || "").toLowerCase();
    return portal === "manager" ? "Manager Profile" : "Reception Profile";
  }

  function ensureStaffProfileUi() {
    var menu = document.getElementById("staffSettingsMenu");
    var logoutBtn = document.getElementById("staffMenuLogout");
    var profileBtn = document.getElementById("staffMenuProfile");
    if (menu && !profileBtn) {
      profileBtn = document.createElement("button");
      profileBtn.type = "button";
      profileBtn.id = "staffMenuProfile";
      profileBtn.className = "admin-settings-item";
      profileBtn.setAttribute("role", "menuitem");
      profileBtn.textContent = staffProfileTitle();
      if (logoutBtn) menu.insertBefore(profileBtn, logoutBtn);
      else menu.appendChild(profileBtn);
    } else if (profileBtn) {
      profileBtn.textContent = staffProfileTitle();
      profileBtn.removeAttribute("hidden");
      profileBtn.style.display = "";
    }

    if (document.getElementById("staffProfileOverlay")) return;

    var overlay = document.createElement("div");
    overlay.id = "staffProfileOverlay";
    overlay.className = "admin-settings-overlay";
    overlay.setAttribute("hidden", "");
    overlay.innerHTML =
      '<div class="admin-settings-modal" role="dialog" aria-modal="true" aria-labelledby="staffProfileTitle">' +
      "<h3 id=\"staffProfileTitle\">" +
      staffProfileTitle() +
      "</h3>" +
      '<form id="staffProfileForm" class="form-grid" autocomplete="off">' +
      '<div class="full"><label for="staffProfileName">Name</label>' +
      '<input id="staffProfileName" type="text" required autocomplete="name" placeholder="Full name"></div>' +
      '<div class="full"><label for="staffProfileEmail">Email</label>' +
      '<input id="staffProfileEmail" type="email" required autocomplete="email" placeholder="staff@example.com"></div>' +
      '<div class="full"><button class="btn" type="submit">Save changes</button>' +
      '<p id="staffProfileMsg" class="auth-msg" hidden></p></div>' +
      "</form>" +
      '<div class="admin-settings-modal__actions">' +
      '<button type="button" id="staffProfileCloseBtn" class="btn btn--outline">Close</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
  }

  function initStaffPortal(u) {
    var Auth = window.ElenestAuth;
    ensureStaffProfileUi();
    var nameEl = document.getElementById("staffDashboardName");
    if (nameEl && u) nameEl.textContent = u.name || "—";
    if (Auth && typeof Auth.applyStaffHeaderRole === "function") {
      Auth.applyStaffHeaderRole(u);
    }

    var settingsToggle = document.getElementById("staffSettingsToggle");
    var settingsMenu = document.getElementById("staffSettingsMenu");
    var menuLogoutBtn = document.getElementById("staffMenuLogout");

    if (settingsToggle) setHidden(settingsToggle, false);
    if (settingsMenu) setHidden(settingsMenu, true);

    function syncOpenMenulistHeight() {
      var menulist = document.getElementById("menulist");
      if (!menulist || !menulist.classList.contains("is-open")) return;
      menulist.style.maxHeight = menulist.scrollHeight + "px";
    }

    function openMenu() {
      if (!settingsMenu || !settingsToggle) return;
      setHidden(settingsMenu, false);
      settingsToggle.setAttribute("aria-expanded", "true");
      syncOpenMenulistHeight();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(syncOpenMenulistHeight);
      }
    }

    function closeMenu() {
      if (!settingsMenu || !settingsToggle) return;
      setHidden(settingsMenu, true);
      settingsToggle.setAttribute("aria-expanded", "false");
      settingsToggle.classList.remove("active");
      syncOpenMenulistHeight();
    }

    if (settingsToggle && settingsMenu) {
      settingsToggle.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (settingsMenu.hasAttribute("hidden")) openMenu();
        else closeMenu();
      });

      document.addEventListener("click", function (e) {
        if (settingsMenu.hasAttribute("hidden")) return;
        if (settingsMenu.contains(e.target) || settingsToggle.contains(e.target)) return;
        closeMenu();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMenu();
      });
    }

    function applyUpdatedStaffUser(fresh) {
      if (!fresh) return;
      u = fresh;
      if (Auth && typeof Auth.setCurrentUser === "function") Auth.setCurrentUser(u);
      if (Auth && typeof Auth.applyStaffHeaderRole === "function") Auth.applyStaffHeaderRole(u);
      if (nameEl) nameEl.textContent = (u && u.name) || "—";
      if (menuLogoutBtn) {
        var nextName = u && u.name ? String(u.name).trim() : "";
        menuLogoutBtn.textContent = nextName ? "Logout (" + nextName + ")" : "Logout";
      }
    }

    if (menuLogoutBtn) {
      var displayName = u && u.name ? String(u.name).trim() : "";
      if (displayName) menuLogoutBtn.textContent = "Logout (" + displayName + ")";
      menuLogoutBtn.addEventListener("click", function () {
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(menuLogoutBtn, true);
        Auth.logout().then(function () {
          try {
            window.location.replace("index.html");
          } catch (e) {}
        }).catch(function () {
          if (BL) BL.set(menuLogoutBtn, false);
        });
      });
    }

    var menuProfileBtn = document.getElementById("staffMenuProfile");
    var profileOverlay = document.getElementById("staffProfileOverlay");
    var profileForm = document.getElementById("staffProfileForm");
    var profileCloseBtn = document.getElementById("staffProfileCloseBtn");
    var profileNameEl = document.getElementById("staffProfileName");
    var profileEmailEl = document.getElementById("staffProfileEmail");
    var profileMsg = document.getElementById("staffProfileMsg");

    function normalizeEmail(email) {
      return String(email || "").trim().toLowerCase();
    }

    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
    }

    function setProfileMsg(ok, text) {
      if (!profileMsg) return;
      profileMsg.hidden = !text;
      profileMsg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      profileMsg.textContent = text || "";
    }

    function hideProfileMsg() {
      if (!profileMsg) return;
      profileMsg.hidden = true;
      profileMsg.textContent = "";
      profileMsg.className = "auth-msg";
    }

    function openProfile() {
      if (!profileOverlay) return;
      if (profileNameEl) profileNameEl.value = (u && u.name) ? u.name : "";
      if (profileEmailEl) profileEmailEl.value = (u && u.email) ? u.email : "";
      hideProfileMsg();
      setHidden(profileOverlay, false);
      closeMenu();
      if (profileNameEl) profileNameEl.focus();
    }

    function closeProfile() {
      if (!profileOverlay) return;
      setHidden(profileOverlay, true);
    }

    if (menuProfileBtn) menuProfileBtn.addEventListener("click", openProfile);
    if (profileCloseBtn) profileCloseBtn.addEventListener("click", closeProfile);
    if (profileOverlay) {
      profileOverlay.addEventListener("click", function (e) {
        if (e.target === profileOverlay) closeProfile();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !profileOverlay.hasAttribute("hidden")) closeProfile();
      });
    }

    if (profileForm) {
      profileForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var nextName = profileNameEl ? String(profileNameEl.value || "").trim() : "";
        var nextEmail = profileEmailEl ? normalizeEmail(profileEmailEl.value) : "";

        if (!nextName) {
          setProfileMsg(false, "Please enter a name.");
          return;
        }
        if (!isValidEmail(nextEmail)) {
          setProfileMsg(false, "Please enter a valid email address.");
          return;
        }
        if (!u || !u.email) {
          setProfileMsg(false, "Session expired. Please sign in again.");
          return;
        }

        var profileSubmitBtn = profileForm.querySelector('button[type="submit"]');
        var BL = window.ElenestButtonLoading;
        if (BL) BL.set(profileSubmitBtn, true);
        else if (profileSubmitBtn) profileSubmitBtn.disabled = true;

        function finishProfileSave(result) {
          if (BL) BL.set(profileSubmitBtn, false);
          else if (profileSubmitBtn) profileSubmitBtn.disabled = false;
          if (!result || !result.ok) {
            setProfileMsg(false, (result && result.message) || "Could not save profile.");
            return;
          }
          applyUpdatedStaffUser(result.user || Object.assign({}, u, { name: nextName, email: nextEmail }));
          setProfileMsg(true, result.message || "Profile saved.");
        }

        var saveFn = Auth && (Auth.updateCurrentUserProfile || Auth.updateStaffProfile);
        if (typeof saveFn === "function") {
          saveFn.call(Auth, { name: nextName, email: nextEmail })
            .then(finishProfileSave)
            .catch(function () {
              finishProfileSave({ ok: false, message: "Could not save profile." });
            });
          return;
        }

        applyUpdatedStaffUser(Object.assign({}, u, { name: nextName, email: nextEmail }));
        finishProfileSave({ ok: true, message: "Profile saved." });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
