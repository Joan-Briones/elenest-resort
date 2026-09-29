(function () {
  function normalizeGender(value) {
    var g = String(value || "")
      .trim()
      .toLowerCase();
    if (g === "male" || g === "m") return "male";
    if (g === "female" || g === "f") return "female";
    return "neutral";
  }

  function createGuestAvatar(userOrGender, opts) {
    var gender =
      typeof userOrGender === "string"
        ? normalizeGender(userOrGender)
        : normalizeGender(userOrGender && userOrGender.gender);
    var size = (opts && opts.size) || "md";
    var el = document.createElement("span");
    el.className = "guest-avatar guest-avatar--" + gender + " guest-avatar--" + size;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      gender === "male"
        ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/></svg>'
        : gender === "female"
          ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg>'
          : '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg>';
    return el;
  }

  function calendarIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '<path d="M16 3v4M8 3v4M3 11h18"/>' +
      "</svg>"
    );
  }

  function logoutIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>' +
      '<path d="M15 12H8"/>' +
      '<path d="M12 8l4 4-4 4"/>' +
      "</svg>"
    );
  }

  function renderGuestUserNav(host, user, onLogout, onProfileClick, onAppointmentsClick) {
    if (!host) return;
    host.textContent = "";
    host.hidden = false;
    host.className = "book-nav-user";

    var identity = document.createElement("div");
    identity.className = "book-nav-identity";

    var profile = document.createElement("button");
    profile.type = "button";
    profile.className = "book-nav-profile";
    profile.setAttribute("data-guest-profile-trigger", "1");
    profile.setAttribute("aria-label", "Edit profile");
    profile.title = "Edit profile";
    profile.appendChild(createGuestAvatar(user, { size: "sm" }));

    var name = document.createElement("span");
    name.className = "book-nav-greet";
    name.textContent = user && user.name ? user.name : "Guest";
    profile.appendChild(name);

    if (typeof onProfileClick === "function") {
      profile.addEventListener("click", onProfileClick);
    }

    identity.appendChild(profile);
    host.appendChild(identity);

    var actions = document.createElement("div");
    actions.className = "book-nav-actions";

    var appt = document.createElement("button");
    appt.type = "button";
    appt.className = "book-nav-appointments book-nav-icon-btn";
    appt.innerHTML = calendarIconSvg();
    appt.setAttribute("aria-label", "Appointments");
    appt.title = "Appointments";
    appt.setAttribute("aria-haspopup", "dialog");
    appt.setAttribute("aria-controls", "appointmentsOverlay");
    appt.setAttribute("aria-expanded", "false");
    appt.addEventListener("click", function (e) {
      e.preventDefault();
      if (typeof onAppointmentsClick === "function") {
        onAppointmentsClick(e);
        return;
      }
      try {
        window.dispatchEvent(new CustomEvent("elenest-open-appointments"));
      } catch (err) {}
    });
    actions.appendChild(appt);

    if (window.ElenestCustomerNotifications && typeof window.ElenestCustomerNotifications.createBell === "function") {
      actions.appendChild(window.ElenestCustomerNotifications.createBell(user));
    }

    if (typeof onLogout === "function") {
      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "book-nav-logout book-nav-icon-btn";
      logoutBtn.innerHTML = logoutIconSvg();
      logoutBtn.setAttribute("aria-label", "Log out");
      logoutBtn.title = "Log out";
      logoutBtn.addEventListener("click", onLogout);
      actions.appendChild(logoutBtn);
    }

    host.appendChild(actions);
  }

  window.ElenestGuestAvatar = {
    normalizeGender: normalizeGender,
    create: createGuestAvatar,
    renderUserNav: renderGuestUserNav
  };
})();
