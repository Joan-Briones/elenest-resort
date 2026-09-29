/**
 * Redirect file:// opens to XAMPP — Facebook OAuth requires http://localhost.
 */
(function () {
  if (window.location.protocol !== "file:") return;

  var config = window.ElenestSupabaseConfig || {};
  var base = config.siteHtmlBaseUrl || "http://localhost/Elenest_Resort/html/";
  if (base.charAt(base.length - 1) !== "/") base += "/";

  var path = window.location.pathname || "";
  var fileName = path.split("/").pop() || "book.html";
  if (!fileName || fileName.indexOf(".html") === -1) fileName = "book.html";

  window.location.replace(base + fileName + (window.location.search || "") + (window.location.hash || ""));
})();
