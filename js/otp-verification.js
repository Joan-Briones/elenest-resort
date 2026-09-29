/**
 * OTP phone verification — iProg SMS via pure PHP endpoints (api/send-otp.php,
 * api/verify-otp.php). Works on XAMPP and shared hosts (e.g. InfinityFree).
 */
(function () {
  var STORAGE_PHONE = "elenest_otp_phone";
  var STORAGE_VERIFIED = "elenest_otp_verified";
  var STORAGE_PENDING_REG = "elenest_pending_registration";

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizePhone(raw) {
    var digits = digitsOnly(raw);
    if (digits.length === 11 && digits.indexOf("09") === 0) return digits;
    if (digits.length === 12 && digits.indexOf("639") === 0) {
      return "0" + digits.slice(2);
    }
    if (digits.length === 10 && digits.indexOf("9") === 0) {
      return "0" + digits;
    }
    return "";
  }

  function isValidPhone(phone) {
    return /^09[0-9]{9}$/.test(phone);
  }

  function isValidOtp(otp) {
    return /^[0-9]{4,8}$/.test(String(otp || "").trim());
  }

  function getApiUrl(endpoint) {
    if (window.location.protocol === "file:") {
      return "http://localhost/Elenest_Resort/api/" + endpoint;
    }
    var path = window.location.pathname || "";
    if (path.indexOf("/html/") !== -1) {
      return "../api/" + endpoint;
    }
    return "api/" + endpoint;
  }

  function savePhone(phone) {
    try {
      sessionStorage.setItem(STORAGE_PHONE, phone);
    } catch (e) {}
  }

  function getSavedPhone() {
    try {
      return sessionStorage.getItem(STORAGE_PHONE) || "";
    } catch (e) {
      return "";
    }
  }

  function clearOtpSession() {
    try {
      sessionStorage.removeItem(STORAGE_PHONE);
      sessionStorage.removeItem(STORAGE_VERIFIED);
      sessionStorage.removeItem(STORAGE_PENDING_REG);
    } catch (e) {}
  }

  function markVerified(phone) {
    try {
      sessionStorage.setItem(STORAGE_VERIFIED, phone);
    } catch (e) {}
  }

  function isVerifiedSession() {
    try {
      var phone = sessionStorage.getItem(STORAGE_VERIFIED);
      return !!(phone && isValidPhone(phone));
    } catch (e) {
      return false;
    }
  }

  function getVerifiedPhone() {
    try {
      return sessionStorage.getItem(STORAGE_VERIFIED) || "";
    } catch (e) {
      return "";
    }
  }

  function savePendingRegistration(data) {
    try {
      sessionStorage.setItem(STORAGE_PENDING_REG, JSON.stringify(data));
    } catch (e) {}
  }

  function getPendingRegistration() {
    try {
      var raw = sessionStorage.getItem(STORAGE_PENDING_REG);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearPendingRegistration() {
    try {
      sessionStorage.removeItem(STORAGE_PENDING_REG);
    } catch (e) {}
  }

  function networkHelpMessage() {
    if (window.location.protocol === "file:") {
      return "Open this site through a web server, not as a file. Use your site URL (e.g. http://localhost/.../html/register.html).";
    }
    return "Could not reach the OTP server. Make sure api/send-otp.php is online and api/config.local.json has your iProg token.";
  }

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (e) {
            return {
              status: res.status,
              data: {
                ok: false,
                message: res.ok
                  ? "Invalid server response."
                  : networkHelpMessage()
              }
            };
          }
          return { status: res.status, data: data };
        });
      })
      .catch(function () {
        return {
          status: 0,
          data: { ok: false, message: networkHelpMessage() }
        };
      });
  }

  function invokePhp(endpoint, body) {
    var url = getApiUrl(endpoint);
    return postJson(url, body).then(function (result) {
      var data = result.data || {};
      if (result.status === 0) {
        return { ok: false, message: data.message || networkHelpMessage() };
      }
      if (data.ok === false || result.status >= 400) {
        return { ok: false, message: data.message || "Request failed." };
      }
      return {
        ok: true,
        message: data.message || "Success.",
        phone_number: data.phone_number || body.phone_number,
        is_verified: !!data.is_verified
      };
    });
  }

  function sendOtp(phoneRaw) {
    var phone = normalizePhone(phoneRaw);
    if (!isValidPhone(phone)) {
      return Promise.resolve({
        ok: false,
        message: "Enter a valid Philippine mobile number (09XXXXXXXXX)."
      });
    }

    return invokePhp("send-otp.php", { phone_number: phone }).then(function (result) {
      if (result.ok) savePhone(phone);
      return result;
    });
  }

  function verifyOtp(phoneRaw, otpRaw) {
    var phone = normalizePhone(phoneRaw || getSavedPhone());
    var otp = String(otpRaw || "").trim();

    if (!isValidPhone(phone)) {
      return Promise.resolve({
        ok: false,
        message: "Phone number missing or invalid. Please start again."
      });
    }

    if (!isValidOtp(otp)) {
      return Promise.resolve({
        ok: false,
        message: "Enter the verification code sent to your phone."
      });
    }

    return invokePhp("verify-otp.php", { phone_number: phone, otp: otp }).then(function (result) {
      if (result.ok) markVerified(phone);
      return result;
    });
  }

  window.ElenestOtp = {
    normalizePhone: normalizePhone,
    isValidPhone: isValidPhone,
    isValidOtp: isValidOtp,
    sendOtp: sendOtp,
    verifyOtp: verifyOtp,
    getSavedPhone: getSavedPhone,
    getVerifiedPhone: getVerifiedPhone,
    isVerifiedSession: isVerifiedSession,
    clearOtpSession: clearOtpSession,
    savePendingRegistration: savePendingRegistration,
    getPendingRegistration: getPendingRegistration,
    clearPendingRegistration: clearPendingRegistration
  };
})();
