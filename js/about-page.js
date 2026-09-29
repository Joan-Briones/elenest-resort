(function () {
  function withPreservedScroll(fn) {
    if (typeof window.ElenestPreserveScroll === "function") return window.ElenestPreserveScroll(fn);
    var x = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var result;
    try {
      result = typeof fn === "function" ? fn() : undefined;
    } finally {
      try { window.scrollTo(x, y); } catch (err) {}
    }
    return result;
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var lastSig = "";

  function render() {
    withPreservedScroll(function () {
    var S = window.ElenestContentStore;
    if (!S || typeof S.getAbout !== "function") return;

    var data = S.getAbout();
    var sig = JSON.stringify({
      heroTitle: data.heroTitle || "",
      heroLead: data.heroLead || "",
      credentialsLead: data.credentialsLead || "",
      findUsLead: data.findUsLead || "",
      mapEmbed: data.mapEmbed || "",
      storyCards: data.storyCards || [],
      credentialCards: data.credentialCards || []
    });
    if (sig === lastSig) return;
    lastSig = sig;
    var heroTitle = document.getElementById("aboutHeroTitle");
    var heroLead = document.getElementById("aboutHeroLead");
    if (heroTitle) heroTitle.textContent = data.heroTitle || "";
    if (heroLead) heroLead.textContent = data.heroLead || "";

    var storyHost = document.getElementById("aboutStoryGrid");
    if (storyHost) {
      storyHost.innerHTML = (data.storyCards || [])
        .map(function (card) {
          return (
            '<article class="card"><h3>' +
            esc(card.title) +
            "</h3><p>" +
            esc(card.body) +
            "</p></article>"
          );
        })
        .join("");
    }

    var credLead = document.getElementById("aboutCredLead");
    if (credLead) credLead.textContent = data.credentialsLead || "";

    var credHost = document.getElementById("aboutCredGrid");
    if (credHost) {
      credHost.innerHTML = (data.credentialCards || [])
        .map(function (card) {
          var src = esc(card.image || "../Images/about.png");
          var alt = esc(card.imageAlt || card.title);
          return (
            '<article class="card credential-card">' +
            '<a class="credential-card__media" href="' +
            src +
            '" target="_blank" rel="noopener noreferrer" title="View full document">' +
            '<img src="' +
            src +
            '" alt="' +
            alt +
            '" class="credential-img">' +
            "</a>" +
            "<h3>" +
            esc(card.title) +
            "</h3><p>" +
            esc(card.body) +
            "</p></article>"
          );
        })
        .join("");
    }

    var findLead = document.getElementById("aboutFindLead");
    if (findLead) findLead.textContent = data.findUsLead || "";

    var mapFrame = document.getElementById("aboutMapFrame");
    if (mapFrame && data.mapEmbed) mapFrame.src = data.mapEmbed;
    });
  }

  render();
  (window.ElenestContentStore && window.ElenestContentStore.ready
    ? window.ElenestContentStore.ready
    : Promise.resolve()
  ).then(render);
  window.addEventListener("elenest-content-updated", render);
})();
