/**
 * Staff Access PIN gate — unlocks the Staff Login page for one browser session.
 * PIN verification uses Supabase RPC (does not replace email/password login).
 */
(function () {
  var STORAGE_KEY = "elenest_staff_pin_ok";

  var ROLE_OPTIONS = [
    {
      role: "admin",
      label: "Admin",
      next: "admin.html",
      blurb: "Full control — settings, users, reports & content",
      accent: "admin"
    },
    {
      role: "manager",
      label: "Manager",
      next: "manager.html",
      blurb: "Operations — bookings, availability & daily oversight",
      accent: "manager"
    },
    {
      role: "reception",
      label: "Receptionist",
      next: "reception.html",
      blurb: "Front desk — guest check-in, payments & assistance",
      accent: "reception"
    }
  ];

  var ROLE_ICONS = {
    admin:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.75a4.25 4.25 0 1 1 0 8.5 4.25 4.25 0 0 1 0-8.5Zm0 10c4.56 0 8.25 2.69 8.25 6.01v1.49c0 .97-.79 1.75-1.75 1.75H5.5c-.97 0-1.75-.78-1.75-1.75v-1.49c0-3.32 3.69-6.01 8.25-6.01Z"/></svg>',
    manager:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.5 5.75A2.75 2.75 0 0 1 6.25 3h11.5A2.75 2.75 0 0 1 20.5 5.75v12.5A2.75 2.75 0 0 1 17.75 21H6.25A2.75 2.75 0 0 1 3.5 18.25V5.75Zm3.25.75a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H6.75Zm0 4a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 4a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z"/></svg>',
    reception:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.75 5A2.75 2.75 0 0 1 7.5 2.25h9A2.75 2.75 0 0 1 19.25 5v3.5a.75.75 0 0 1-1.5 0V5c0-.69-.56-1.25-1.25-1.25h-9c-.69 0-1.25.56-1.25 1.25v14c0 .69.56 1.25 1.25 1.25h4.5a.75.75 0 0 1 0 1.5H7.5A2.75 2.75 0 0 1 4.75 19V5Zm10.6 8.15a3.1 3.1 0 1 1 4.38 4.38l-3.7 3.7a.75.75 0 0 1-.53.22H13.5a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 .22-.53l3.7-3.7Zm3.32.9-.9-.9-3.02 3.02v.9h.9l3.02-3.02Z"/></svg>'
  };

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function isUnlocked() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markUnlocked() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (e) {}
  }

  function clearUnlock() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function roleLoginUrl(role, nextOverride) {
    var selected = String(role || "").toLowerCase();
    var match = null;
    for (var i = 0; i < ROLE_OPTIONS.length; i++) {
      if (ROLE_OPTIONS[i].role === selected) {
        match = ROLE_OPTIONS[i];
        break;
      }
    }
    if (!match) match = ROLE_OPTIONS[0];
    var next = String(nextOverride || match.next || "").trim() || match.next;
    return (
      "login.html?role=" +
      encodeURIComponent(match.role) +
      "&next=" +
      encodeURIComponent(next)
    );
  }

  function staffLoginUrl(nextOverride) {
    // Kept for compatibility; prefer role picker + roleLoginUrl.
    var next = String(nextOverride || "").trim();
    var url = "login.html?portal=staff";
    if (next) url += "&next=" + encodeURIComponent(next);
    return url;
  }

  function isStaffLoginRequest(search) {
    var params = new URLSearchParams(search || window.location.search || "");
    var portal = String(params.get("portal") || "").toLowerCase();
    if (portal === "staff") return true;
    var role = String(params.get("role") || "").toLowerCase();
    return role === "admin" || role === "manager" || role === "reception" || role === "receptionist";
  }

  function verifyPin(pin) {
    var cleaned = String(pin || "").trim();
    if (!cleaned) {
      return Promise.resolve({ ok: false, message: "Please enter the Staff Access PIN." });
    }

    var sb = getClient();
    if (!sb || typeof sb.rpc !== "function") {
      return Promise.resolve({
        ok: false,
        message: "Unable to verify PIN. Refresh the page and try again."
      });
    }

    return sb
      .rpc("verify_staff_access_pin", { p_pin: cleaned })
      .then(function (result) {
        if (result.error) {
          return {
            ok: false,
            message:
              "Unable to verify PIN. Ask an administrator to run the Staff Access PIN setup in Supabase."
          };
        }
        if (result.data === true) {
          markUnlocked();
          return { ok: true };
        }
        return {
          ok: false,
          message: "Invalid Staff Access PIN. Please try again."
        };
      })
      .catch(function () {
        return {
          ok: false,
          message: "Unable to verify PIN. Refresh the page and try again."
        };
      });
  }

  function isMissingRpcError(err) {
    var msg = String((err && err.message) || err || "").toLowerCase();
    return (
      msg.indexOf("could not find the function") !== -1 ||
      msg.indexOf("schema cache") !== -1 ||
      msg.indexOf("pgrst202") !== -1
    );
  }

  function getPinFromTable(sb) {
    return sb
      .from("app_settings")
      .select("value")
      .eq("key", "staff_access_pin")
      .maybeSingle()
      .then(function (result) {
        if (result.error) {
          return {
            ok: false,
            message: result.error.message || "Could not load Staff Access PIN.",
            pin: ""
          };
        }
        var value = result.data && result.data.value;
        var pin = "";
        if (value && typeof value === "object") pin = String(value.pin || "");
        else if (typeof value === "string") {
          try {
            var parsed = JSON.parse(value);
            pin = String((parsed && parsed.pin) || "");
          } catch (e) {
            pin = "";
          }
        }
        if (!pin) pin = "2468";
        return { ok: true, pin: pin };
      });
  }

  function setPinInTable(sb, cleaned) {
    return sb
      .from("app_settings")
      .upsert(
        {
          key: "staff_access_pin",
          value: { pin: cleaned },
          updated_at: new Date().toISOString()
        },
        { onConflict: "key" }
      )
      .then(function (result) {
        if (result.error) {
          return {
            ok: false,
            message: result.error.message || "Could not save Staff Access PIN."
          };
        }
        return { ok: true };
      });
  }

  function getPin() {
    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Supabase is not connected.", pin: "" });
    }
    return sb
      .rpc("admin_get_staff_access_pin", {})
      .then(function (result) {
        if (result.error) {
          if (isMissingRpcError(result.error)) {
            return getPinFromTable(sb);
          }
          return {
            ok: false,
            message: result.error.message || "Could not load Staff Access PIN.",
            pin: ""
          };
        }
        return { ok: true, pin: String(result.data || "") };
      })
      .catch(function (err) {
        if (isMissingRpcError(err)) return getPinFromTable(sb);
        return {
          ok: false,
          message: (err && err.message) || "Could not load Staff Access PIN.",
          pin: ""
        };
      });
  }

  function setPin(pin) {
    var cleaned = String(pin || "").trim();
    if (!cleaned) {
      return Promise.resolve({ ok: false, message: "Staff Access PIN cannot be empty." });
    }
    if (!/^\d{4,12}$/.test(cleaned)) {
      return Promise.resolve({
        ok: false,
        message: "PIN must be 4–12 digits."
      });
    }

    var sb = getClient();
    if (!sb) {
      return Promise.resolve({ ok: false, message: "Supabase is not connected." });
    }

    return sb
      .rpc("admin_set_staff_access_pin", { p_pin: cleaned })
      .then(function (result) {
        if (result.error) {
          if (isMissingRpcError(result.error)) {
            return setPinInTable(sb, cleaned);
          }
          return {
            ok: false,
            message: result.error.message || "Could not save Staff Access PIN."
          };
        }
        return { ok: true };
      })
      .catch(function (err) {
        if (isMissingRpcError(err)) return setPinInTable(sb, cleaned);
        return {
          ok: false,
          message: (err && err.message) || "Could not save Staff Access PIN."
        };
      });
  }

  function ensureModal() {
    var existing = document.getElementById("staffAccessPinOverlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "staffAccessPinOverlay";
    overlay.className = "admin-settings-overlay staff-access-pin-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="admin-settings-modal staff-access-pin-modal staff-gate-modal" role="dialog" aria-modal="true" aria-labelledby="staffAccessPinTitle">' +
      '<div class="staff-gate-modal__hero">' +
      '<p class="staff-gate-modal__eyebrow">Elenest Resort</p>' +
      '<h3 id="staffAccessPinTitle">Staff Access PIN</h3>' +
      '<p class="staff-gate-modal__lead">Enter the PIN to unlock staff login. Customers should use Sign In.</p>' +
      "</div>" +
      '<p id="staffAccessPinMsg" class="auth-msg" hidden></p>' +
      '<form id="staffAccessPinForm" class="form-grid staff-gate-modal__form" autocomplete="off">' +
      '<div class="full">' +
      '<label for="staffAccessPinInput">Staff Access PIN</label>' +
      '<input id="staffAccessPinInput" class="staff-gate-modal__pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" required placeholder="••••" autocomplete="one-time-code">' +
      "</div>" +
      '<div class="full staff-access-pin-actions">' +
      '<button type="button" id="staffAccessPinCancel" class="btn btn--outline">Cancel</button>' +
      '<button type="submit" class="btn" id="staffAccessPinSubmit">Continue</button>' +
      "</div>" +
      "</form>" +
      "</div>";

    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal(options) {
    var opts = options || {};
    var onSuccess = typeof opts.onSuccess === "function" ? opts.onSuccess : null;
    var overlay = ensureModal();
    var form = document.getElementById("staffAccessPinForm");
    var input = document.getElementById("staffAccessPinInput");
    var cancelBtn = document.getElementById("staffAccessPinCancel");
    var msg = document.getElementById("staffAccessPinMsg");
    var submitBtn = document.getElementById("staffAccessPinSubmit");

    function setMsg(ok, text) {
      if (!msg) return;
      msg.hidden = false;
      msg.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
      msg.textContent = text || "";
    }

    function reset() {
      if (input) input.value = "";
      if (msg) {
        msg.hidden = true;
        msg.textContent = "";
        msg.className = "auth-msg";
      }
    }

    function close() {
      overlay.hidden = true;
      overlay.classList.remove("is-visible");
      reset();
      document.removeEventListener("keydown", onKeydown);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    reset();
    overlay.hidden = false;
    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });
    document.addEventListener("keydown", onKeydown);
    if (input) {
      setTimeout(function () {
        input.focus();
      }, 0);
    }

    cancelBtn.onclick = function () {
      close();
    };

    overlay.onclick = function (e) {
      if (e.target === overlay) close();
    };

    form.onsubmit = function (e) {
      e.preventDefault();
      var pin = input ? input.value : "";
      var BL = window.ElenestButtonLoading;
      if (BL) BL.set(submitBtn, true);
      else if (submitBtn) submitBtn.disabled = true;

      verifyPin(pin).then(function (result) {
        if (BL) BL.set(submitBtn, false);
        else if (submitBtn) submitBtn.disabled = false;

        if (!result.ok) {
          setMsg(false, result.message || "Invalid Staff Access PIN. Please try again.");
          if (input) {
            input.focus();
            input.select();
          }
          return;
        }

        close();
        if (onSuccess) onSuccess();
      });
    };
  }

  function ensureRoleModal() {
    var existing = document.getElementById("staffRolePickerOverlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "staffRolePickerOverlay";
    overlay.className = "admin-settings-overlay staff-access-pin-overlay";
    overlay.hidden = true;

    var cardsHtml = ROLE_OPTIONS.map(function (opt, index) {
      var icon = ROLE_ICONS[opt.accent] || ROLE_ICONS.admin;
      return (
        '<button type="button" class="staff-role-card staff-role-card--' +
        opt.accent +
        '" data-staff-role="' +
        opt.role +
        '" style="--role-delay: ' +
        index * 70 +
        'ms">' +
        '<span class="staff-role-card__icon" aria-hidden="true">' +
        icon +
        "</span>" +
        '<span class="staff-role-card__body">' +
        '<span class="staff-role-card__label">' +
        opt.label +
        "</span>" +
        '<span class="staff-role-card__blurb">' +
        opt.blurb +
        "</span>" +
        "</span>" +
        '<span class="staff-role-card__arrow" aria-hidden="true">→</span>' +
        "</button>"
      );
    }).join("");

    overlay.innerHTML =
      '<div class="admin-settings-modal staff-role-picker-modal staff-gate-modal" role="dialog" aria-modal="true" aria-labelledby="staffRolePickerTitle">' +
      '<div class="staff-gate-modal__hero">' +
      '<p class="staff-gate-modal__eyebrow">PIN verified</p>' +
      '<h3 id="staffRolePickerTitle">Choose your portal</h3>' +
      '<p class="staff-gate-modal__lead">Select Admin, Manager, or Receptionist. You will still sign in with email and password.</p>' +
      "</div>" +
      '<div class="staff-role-picker__list">' +
      cardsHtml +
      "</div>" +
      '<div class="admin-settings-modal__actions staff-gate-modal__footer">' +
      '<button type="button" id="staffRolePickerCancel" class="btn btn--outline">Cancel</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(overlay);
    return overlay;
  }

  function openRolePicker(options) {
    var opts = options || {};
    var onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;
    var overlay = ensureRoleModal();
    var cancelBtn = document.getElementById("staffRolePickerCancel");
    var list = overlay.querySelector(".staff-role-picker__list");

    function close() {
      overlay.hidden = true;
      overlay.classList.remove("is-visible");
      document.removeEventListener("keydown", onKeydown);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    overlay.hidden = false;
    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });
    document.addEventListener("keydown", onKeydown);

    cancelBtn.onclick = function () {
      close();
    };

    overlay.onclick = function (e) {
      if (e.target === overlay) close();
    };

    if (list) {
      list.onclick = function (e) {
        var btn = e.target.closest("[data-staff-role]");
        if (!btn) return;
        var role = String(btn.getAttribute("data-staff-role") || "").toLowerCase();
        if (!role) return;
        close();
        if (onSelect) onSelect(role);
        else window.location.href = roleLoginUrl(role);
      };
    }
  }

  function requestAccess() {
    // Always ask for PIN first, then show role cards.
    openModal({
      onSuccess: function () {
        openRolePicker({
          onSelect: function (role) {
            window.location.href = roleLoginUrl(role);
          }
        });
      }
    });
  }

  function guardStaffLoginPage() {
    if (!isStaffLoginRequest()) return true;
    if (isUnlocked()) {
      try {
        var params = new URLSearchParams(window.location.search || "");
        if (params.get("portal") === "staff" && !params.get("role")) {
          openRolePicker({
            onSelect: function (role) {
              window.location.replace(roleLoginUrl(role));
            }
          });
          return false;
        }
      } catch (e) {}
      return true;
    }

    var main = document.querySelector("main");
    if (main) main.setAttribute("hidden", "");

    openModal({
      onSuccess: function () {
        try {
          var p = new URLSearchParams(window.location.search || "");
          if (p.get("portal") === "staff" && !p.get("role")) {
            openRolePicker({
              onSelect: function (role) {
                window.location.replace(roleLoginUrl(role));
              }
            });
            return;
          }
        } catch (err) {}
        if (main) main.removeAttribute("hidden");
      }
    });

    var cancelBtn = document.getElementById("staffAccessPinCancel");
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        window.location.href = "index.html";
      };
    }

    return false;
  }

  window.ElenestStaffAccessPin = {
    isUnlocked: isUnlocked,
    markUnlocked: markUnlocked,
    clearUnlock: clearUnlock,
    verifyPin: verifyPin,
    getPin: getPin,
    setPin: setPin,
    openModal: openModal,
    openRolePicker: openRolePicker,
    requestAccess: requestAccess,
    guardStaffLoginPage: guardStaffLoginPage,
    isStaffLoginRequest: isStaffLoginRequest,
    staffLoginUrl: staffLoginUrl,
    roleLoginUrl: roleLoginUrl
  };
})();
