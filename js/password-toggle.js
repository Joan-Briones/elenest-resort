/**
 * Wraps each password input in a field with an eye toggle (show / hide).
 */
(function () {
  var ICON_SHOW =
    '<svg class="password-field__svg" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_HIDE =
    '<svg class="password-field__svg" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function bindToggle(wrap, input, btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var visible = input.type === "text";
      input.type = visible ? "password" : "text";
      btn.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      btn.setAttribute("aria-pressed", visible ? "false" : "true");
      btn.innerHTML = visible ? ICON_SHOW : ICON_HIDE;
    });
  }

  function enhance(input) {
    if (!input || input.closest(".password-field")) return;
    var wrap = document.createElement("div");
    wrap.className = "password-field";
    var parent = input.parentNode;
    if (!parent) return;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-field__toggle";
    btn.setAttribute("aria-label", "Show password");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = ICON_SHOW;
    wrap.appendChild(btn);
    bindToggle(wrap, input, btn);
  }

  function init() {
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
