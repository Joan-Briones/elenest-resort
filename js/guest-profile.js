/**
 * Guest profile editor modal (book page nav).
 */
(function () {
  var overlay = null;
  var profileForm = null;
  var passwordForm = null;
  var profileMsg = null;
  var passwordMsg = null;
  var passwordSection = null;
  var oauthPasswordNote = null;
  var nameInput = null;
  var phoneInput = null;
  var genderInput = null;
  var emailDisplay = null;
  var currentPasswordInput = null;
  var newPasswordInput = null;
  var confirmPasswordInput = null;
  var closeBtn = null;
  var currentPasswordWrap = null;
  var hasEmailLogin = false;
  var initialized = false;

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function showMsg(el, ok, text) {
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function hideMsg(el) {
    if (!el) {
      return;
    }
    el.hidden = true;
    el.textContent = "";
    el.className = "auth-msg";
  }

  function bindRefs() {
    overlay = document.getElementById("guestProfileOverlay");
    profileForm = document.getElementById("guestProfileForm");
    passwordForm = document.getElementById("guestChangePasswordForm");
    profileMsg = document.getElementById("guestProfileMsg");
    passwordMsg = document.getElementById("guestChangePasswordMsg");
    passwordSection = document.getElementById("guestPasswordSection");
    oauthPasswordNote = document.getElementById("guestOAuthPasswordNote");
    nameInput = document.getElementById("guestProfileName");
    phoneInput = document.getElementById("guestProfilePhone");
    genderInput = document.getElementById("guestProfileGender");
    emailDisplay = document.getElementById("guestProfileEmail");
    currentPasswordInput = document.getElementById("guestCurrentPassword");
    newPasswordInput = document.getElementById("guestNewPassword");
    confirmPasswordInput = document.getElementById("guestConfirmPassword");
    closeBtn = document.getElementById("guestProfileCloseBtn");
    currentPasswordWrap = document.getElementById("guestCurrentPasswordWrap");
  }

  function resetPasswordForm() {
    if (currentPasswordInput) currentPasswordInput.value = "";
    if (newPasswordInput) newPasswordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";
    hideMsg(passwordMsg);
  }

  function fillForm(user) {
    if (!user) return;
    if (nameInput) nameInput.value = user.name || "";
    if (phoneInput) phoneInput.value = user.phone || "";
    if (genderInput) {
      genderInput.value = window.ElenestAuth
        ? window.ElenestAuth.normalizeGender(user.gender)
        : user.gender || "neutral";
    }
    if (emailDisplay) emailDisplay.textContent = user.email || "—";
    hideMsg(profileMsg);
    resetPasswordForm();
  }

  function updatePasswordSection() {
    var Auth = window.ElenestAuth;
    if (!Auth || typeof Auth.canChangePassword !== "function") {
      hasEmailLogin = true;
      setHidden(passwordSection, false);
      setHidden(oauthPasswordNote, true);
      if (currentPasswordInput) currentPasswordInput.required = true;
      return;
    }

    Auth.canChangePassword().then(function (canChange) {
      hasEmailLogin = !!canChange;
      setHidden(passwordSection, false);
      setHidden(oauthPasswordNote, canChange);
      setHidden(currentPasswordWrap, !canChange);
      if (currentPasswordInput) currentPasswordInput.required = canChange;
      if (oauthPasswordNote && !canChange) {
        var provider = "";
        var user = Auth.getCurrentUser && Auth.getCurrentUser();
        if (user && user.auth_provider) provider = String(user.auth_provider);
        if (provider === "google") {
          oauthPasswordNote.textContent =
            "You signed in with Google. Set a password below if you also want to sign in with email.";
        } else if (provider === "facebook") {
          oauthPasswordNote.textContent =
            "You signed in with Facebook. Set a password below if you also want to sign in with email.";
        } else {
          oauthPasswordNote.textContent =
            "You signed in with a social account. Set a password below if you also want to sign in with email.";
        }
      }
    });
  }

  function closeModal() {
    if (!overlay) return;
    setHidden(overlay, true);
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function openModal(user) {
    if (!overlay) bindRefs();
    if (!overlay) return;

    var current = user;
    var Auth = window.ElenestAuth;
    if (!current && Auth && typeof Auth.getCurrentUser === "function") {
      current = Auth.getCurrentUser();
    }
    if (!current) return;

    fillForm(current);
    updatePasswordSection();
    setHidden(overlay, false);
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (nameInput) nameInput.focus();
  }

  function onProfileSubmit(e) {
    e.preventDefault();
    var Auth = window.ElenestAuth;
    if (!Auth || typeof Auth.updateGuestProfile !== "function") {
      showMsg(profileMsg, false, "Profile update is not available.");
      return;
    }

    hideMsg(profileMsg);
    var submitBtn = profileForm ? profileForm.querySelector('button[type="submit"]') : null;
    var BL = window.ElenestButtonLoading;
    if (BL) BL.set(submitBtn, true);
    Auth.updateGuestProfile({
      name: nameInput ? nameInput.value : "",
      phone: phoneInput ? phoneInput.value : "",
      gender: genderInput ? genderInput.value : ""
    }).then(function (result) {
      if (BL) BL.set(submitBtn, false);
      if (!result.ok) {
        showMsg(profileMsg, false, result.message || "Could not save profile.");
        return;
      }
      showMsg(profileMsg, true, "Profile saved.");
      if (result.user) {
        try {
          var fn = document.getElementById("fullName");
          var ph = document.getElementById("phone");
          if (fn) fn.value = result.user.name || "";
          if (ph) ph.value = result.user.phone || "";
        } catch (err) {}
      }
    }).catch(function () {
      if (BL) BL.set(submitBtn, false);
      showMsg(profileMsg, false, "Could not save profile.");
    });
  }

  function onPasswordSubmit(e) {
    e.preventDefault();
    var Auth = window.ElenestAuth;
    if (!Auth) return;

    hideMsg(passwordMsg);
    var currentPassword = currentPasswordInput ? String(currentPasswordInput.value || "") : "";
    var newPassword = newPasswordInput ? String(newPasswordInput.value || "") : "";
    var confirmPassword = confirmPasswordInput ? String(confirmPasswordInput.value || "") : "";

    if (!newPassword || !confirmPassword) {
      showMsg(passwordMsg, false, "Please fill in the new password fields.");
      return;
    }
    if (newPassword.length < 6) {
      showMsg(passwordMsg, false, "Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      showMsg(passwordMsg, false, "New password and confirmation do not match.");
      return;
    }

    var promise;
    if (hasEmailLogin) {
      if (!currentPassword) {
        showMsg(passwordMsg, false, "Please enter your current password.");
        return;
      }
      promise = Auth.changePassword(currentPassword, newPassword);
    } else if (typeof Auth.setAccountPassword === "function") {
      promise = Auth.setAccountPassword(newPassword);
    } else {
      showMsg(passwordMsg, false, "Password update is not available.");
      return;
    }

    var submitBtn = passwordForm ? passwordForm.querySelector('button[type="submit"]') : null;
    var BL = window.ElenestButtonLoading;
    if (BL) BL.set(submitBtn, true);
    promise.then(function (result) {
      if (BL) BL.set(submitBtn, false);
      if (!result.ok) {
        showMsg(passwordMsg, false, result.message || "Could not update password.");
        return;
      }
      showMsg(passwordMsg, true, "Password updated.");
      resetPasswordForm();
      updatePasswordSection();
    }).catch(function () {
      if (BL) BL.set(submitBtn, false);
      showMsg(passwordMsg, false, "Could not update password.");
    });
  }

  function handleProfileTriggerClick(e) {
    var trigger = e.target.closest("[data-guest-profile-trigger]");
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    openModal();
  }

  function init() {
    bindRefs();
    if (!overlay) {
      setTimeout(bindRefs, 0);
    }

    if (!initialized) {
      initialized = true;
      document.addEventListener("click", handleProfileTriggerClick, true);
      if (profileForm) profileForm.addEventListener("submit", onProfileSubmit);
      if (passwordForm) passwordForm.addEventListener("submit", onPasswordSubmit);
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      if (overlay) {
        overlay.addEventListener("click", function (e) {
          if (e.target === overlay) closeModal();
        });
      }
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay && !overlay.hasAttribute("hidden")) closeModal();
      });
    }
  }

  window.ElenestGuestProfile = {
    init: init,
    open: openModal,
    close: closeModal
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
