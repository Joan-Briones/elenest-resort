(function () {
  var nav = document.getElementById("roleLoginNav");
  var trigger = document.getElementById("roleLoginTrigger");
  if (!nav || !trigger) return;

  var menu = document.getElementById("roleLoginMenu");
  if (menu && menu.parentNode) menu.parentNode.removeChild(menu);

  nav.hidden = false;
  trigger.hidden = false;
  trigger.classList.add("staff-access-btn");
  trigger.removeAttribute("aria-haspopup");
  trigger.removeAttribute("aria-expanded");

  function currentPage() {
    try {
      return String(window.location.pathname.split("/").pop() || "").toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function setAnonymous() {
    nav.hidden = false;
    trigger.hidden = false;
    trigger.setAttribute("aria-label", "Sign In");
    trigger.textContent = "Sign In";
    if (trigger.tagName === "A") trigger.setAttribute("href", "login.html");
  }

  function applyUser(user) {
    var Auth = window.ElenestAuth;
    if (!user) {
      setAnonymous();
      return;
    }
    var role =
      Auth && typeof Auth.normalizeRole === "function"
        ? Auth.normalizeRole(user.role)
        : String(user.role || "guest").toLowerCase();
    var home =
      Auth && typeof Auth.getHomePathForRole === "function"
        ? Auth.getHomePathForRole(role)
        : "book.html";
    var page = currentPage();

    if (role === "guest" && (page === "book.html" || (document.body && document.body.classList.contains("book-page")))) {
      nav.hidden = true;
      nav.setAttribute("hidden", "");
      trigger.hidden = true;
      trigger.setAttribute("hidden", "");
      return;
    }

    // Logged-in customers on the booking page never need Sign In.
    if (role === "guest" && document.body && document.body.classList.contains("customer-logged-in")) {
      nav.hidden = true;
      nav.setAttribute("hidden", "");
      trigger.hidden = true;
      trigger.setAttribute("hidden", "");
      return;
    }

    nav.hidden = false;
    trigger.hidden = false;
    if (role === "guest") {
      trigger.setAttribute("aria-label", "My Booking");
      trigger.textContent = "My Booking";
    } else {
      trigger.setAttribute("aria-label", "Dashboard");
      trigger.textContent = "Dashboard";
    }
    if (trigger.tagName === "A") trigger.setAttribute("href", home);
  }

  setAnonymous();

  if (trigger.tagName !== "A") {
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = trigger.getAttribute("href") || "login.html";
    });
  }

  var Auth = window.ElenestAuth;
  if (Auth && Auth.ready) {
    Auth.ready.then(applyUser);
  }
  window.addEventListener("elenest-auth-change", function (ev) {
    applyUser(ev && ev.detail ? ev.detail.user : null);
  });
})();
