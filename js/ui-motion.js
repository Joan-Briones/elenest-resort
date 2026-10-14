/**
 * One-time count-up for KPI numbers. Does not change booking or payment logic.
 */
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var SELECTOR = [
    ".kpi h4",
    ".admin-kpi-card h4",
    ".admin-payment-kpi-card h4",
    ".home-review-kpis__item h1"
  ].join(",");

  function parseNumber(text) {
    var match = String(text || "").match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!match) return null;
    var value = Number(match[0].replace(/,/g, ""));
    if (!isFinite(value)) return null;
    return { raw: match[0], value: value, index: match.index };
  }

  function formatNumber(n, sample) {
    var decimals = (sample.split(".")[1] || "").length;
    var text = decimals ? n.toFixed(decimals) : String(Math.round(n));
    if (sample.indexOf(",") !== -1) {
      var parts = text.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      text = parts.join(".");
    }
    return text;
  }

  function paint(el, original, parsed, value) {
    el.textContent =
      original.slice(0, parsed.index) +
      formatNumber(value, parsed.raw) +
      original.slice(parsed.index + parsed.raw.length);
  }

  function play(el) {
    if (!el || el.dataset.motionBusy === "1") return;
    var original = el.textContent || "";
    var parsed = parseNumber(original);
    if (!parsed) return;
    if (el.dataset.motionN === parsed.raw) return;
    el.dataset.motionBusy = "1";
    el.dataset.motionN = parsed.raw;
    var from = 0;
    var to = parsed.value;
    var start = 0;
    var duration = 680;

    function frame(now) {
      if (!start) start = now;
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      paint(el, original, parsed, from + (to - from) * eased);
      if (t < 1) {
        window.requestAnimationFrame(frame);
        return;
      }
      el.textContent = original;
      el.dataset.motionBusy = "0";
    }

    window.requestAnimationFrame(frame);
  }

  function scan() {
    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) play(nodes[i]);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    window.setTimeout(function () {
      queued = false;
      scan();
    }, 80);
  }

  function start() {
    scan();
    if (!document.body) return;
    var observer = new MutationObserver(function () {
      schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
