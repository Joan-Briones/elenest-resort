/**
 * Shared button loading UI — spinner + "Please wait…" while async work runs.
 */
(function () {
  var DEFAULT_LABEL = "Please wait…";
  var ATTR_HTML = "data-loading-html";
  var ATTR_DISABLED = "data-loading-was-disabled";

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setButtonLoading(btn, loading, label) {
    if (!btn) return;

    if (loading) {
      if (!btn.hasAttribute(ATTR_HTML)) {
        btn.setAttribute(ATTR_HTML, btn.innerHTML);
      }
      if (!btn.hasAttribute(ATTR_DISABLED)) {
        btn.setAttribute(ATTR_DISABLED, btn.disabled ? "1" : "0");
      }
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.classList.add("is-loading");
      var text = label || DEFAULT_LABEL;
      btn.innerHTML =
        '<span class="btn-spinner" aria-hidden="true"></span>' +
        '<span class="btn-loading-label">' +
        escapeHtml(text) +
        "</span>";
      return;
    }

    var wasDisabled = btn.getAttribute(ATTR_DISABLED) === "1";
    var original = btn.getAttribute(ATTR_HTML);
    btn.classList.remove("is-loading");
    btn.setAttribute("aria-busy", "false");
    btn.removeAttribute(ATTR_DISABLED);
    if (original != null) {
      btn.innerHTML = original;
      btn.removeAttribute(ATTR_HTML);
    } else if (label) {
      btn.textContent = label;
    }
    btn.disabled = wasDisabled;
  }

  function run(btn, work, label) {
    setButtonLoading(btn, true, label || DEFAULT_LABEL);
    var started = Date.now();
    var minMs = 280;
    function finish(result, isError) {
      var wait = Math.max(0, minMs - (Date.now() - started));
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          setButtonLoading(btn, false);
          if (isError) reject(result);
          else resolve(result);
        }, wait);
      });
    }
    return Promise.resolve()
      .then(function () {
        return typeof work === "function" ? work() : work;
      })
      .then(
        function (result) {
          return finish(result, false);
        },
        function (err) {
          return finish(err, true);
        }
      );
  }

  function runForm(form, work, label) {
    var btn =
      form &&
      (form.querySelector('button[type="submit"]') ||
        form.querySelector("button:not([type])") ||
        form.querySelector('input[type="submit"]'));
    return run(btn, work, label);
  }

  window.ElenestButtonLoading = {
    DEFAULT_LABEL: DEFAULT_LABEL,
    set: setButtonLoading,
    run: run,
    runForm: runForm
  };
})();
