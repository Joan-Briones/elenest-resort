(function () {
  var body = document.body;
  if (!body) return;

  var required = String(body.getAttribute("data-required-role") || "").trim().toLowerCase();
  if (!required) return;
  if (required === "reception") required = "receptionist";

  document.documentElement.classList.add("elenest-auth-pending");
  body.classList.add("elenest-role-gated");

  function isStaffRequired() {
    return required === "admin" || required === "manager" || required === "receptionist";
  }

  function allow() {
    try {
      sessionStorage.removeItem("elenest_role_hop");
      sessionStorage.removeItem("elenest_staff_gate_deny");
    } catch (e) {}
    document.documentElement.classList.remove("elenest-auth-pending");
    document.documentElement.classList.add("elenest-auth-ready");
  }

  function deny(url) {
    var target = url || "login.html";
    if (isStaffRequired()) {
      // Never send failed staff gates to the customer booking page.
      if (/book\.html/i.test(String(target)) || /index\.html(?:[?#]|$)/i.test(String(target))) {
        target = "login.html";
      }
      try {
        sessionStorage.setItem("elenest_staff_gate_deny", String(Date.now()));
      } catch (e) {}
    }
    try {
      window.location.replace(target);
    } catch (e) {
      window.location.href = target;
    }
  }

  function run() {
    var Auth = window.ElenestAuth;
    if (!Auth || typeof Auth.assertPageAccess !== "function") {
      deny("login.html");
      return;
    }
    Auth.assertPageAccess(required)
      .then(function (result) {
        if (result && result.ok) {
          allow();
          return;
        }
        deny((result && result.redirect) || "login.html");
      })
      .catch(function () {
        deny("login.html");
      });
  }

  function start() {
    if (window.ElenestAuth && window.ElenestAuth.ready) {
      window.ElenestAuth.ready.then(run).catch(run);
      return;
    }
    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
