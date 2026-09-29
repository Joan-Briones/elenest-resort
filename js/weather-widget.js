/**
 * Mataasnakahoy, Batangas weather (Open-Meteo — no API key).
 * Tap the widget to open the live forecast.
 */
(function () {
  var LAT = 13.9756;
  var LON = 121.1119;
  var PLACE = "Mataasnakahoy, Batangas";
  var CACHE_KEY = "elenest_weather_cache_v3";
  var CACHE_MS = 15 * 60 * 1000;

  var state = {
    loading: true,
    error: "",
    current: null,
    daily: [],
    hourly: [],
    updatedAt: null
  };

  var readyResolve;
  var readyDone = false;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  var bound = false;

  function finishReady() {
    if (!readyDone) {
      readyDone = true;
      readyResolve();
    }
  }

  function weatherLabel(code) {
    var c = Number(code);
    if (c === 0) return "Clear";
    if (c === 1 || c === 2) return "Partly cloudy";
    if (c === 3) return "Overcast";
    if (c === 45 || c === 48) return "Foggy";
    if (c >= 51 && c <= 57) return "Drizzle";
    if (c >= 61 && c <= 67) return "Rain";
    if (c >= 71 && c <= 77) return "Snow";
    if (c >= 80 && c <= 82) return "Showers";
    if (c >= 95) return "Thunderstorm";
    return "Cloudy";
  }

  function weatherTone(code) {
    var c = Number(code);
    if (c === 0) return "clear";
    if (c <= 3) return "cloud";
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return "rain";
    return "soft";
  }

  function weatherIcon(code) {
    var c = Number(code);
    var path;
    if (c === 0) {
      path =
        '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
    } else if (c <= 3) {
      path =
        '<path d="M7 16a5 5 0 1 1 9.9-1.5A4 4 0 1 1 17 20H8a3.5 3.5 0 0 1-1-6.9"/><circle cx="16" cy="8" r="2.5"/>';
    } else if (c === 45 || c === 48) {
      path =
        '<path d="M4 12h16M6 16h12M8 8h8"/><path d="M7 20a5 5 0 1 1 9.9-1.5"/>';
    } else if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) {
      path =
        '<path d="M7 15a5 5 0 1 1 9.9-1.5A4 4 0 1 1 17 19H8a3.5 3.5 0 0 1-1-6.9"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2"/>';
    } else {
      path = '<path d="M7 16a5 5 0 1 1 9.9-1.5A4 4 0 1 1 17 20H8a3.5 3.5 0 0 1-1-6.9"/>';
    }
    return (
      '<span class="weather-icon-wrap weather-icon-wrap--' +
      weatherTone(c) +
      '"><svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      path +
      "</svg></span>"
    );
  }

  function liveBadge(text) {
    return (
      '<span class="weather-live"><span class="weather-live__dot" aria-hidden="true"></span>' +
      (text || "Live") +
      "</span>"
    );
  }

  function fmtTemp(n) {
    if (n == null || isNaN(Number(n))) return "—";
    return Math.round(Number(n)) + "°";
  }

  function weekdayLabel(iso) {
    try {
      var d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString(undefined, { weekday: "short" });
    } catch (e) {
      return iso;
    }
  }

  function fullDateLabel(iso) {
    try {
      var d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric"
      });
    } catch (e) {
      return iso;
    }
  }

  function hourLabel(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
    } catch (e) {
      return iso;
    }
  }

  function timeUpdatedLabel(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || Date.now() - parsed.at > CACHE_MS) return null;
      return parsed.payload || null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: payload }));
    } catch (e) {}
  }

  function applyPayload(payload) {
    state.loading = false;
    state.error = "";
    state.current = payload.current || null;
    state.daily = payload.daily || [];
    state.hourly = payload.hourly || [];
    state.updatedAt = payload.updatedAt || new Date().toISOString();
  }

  function ensureModal() {
    var existing = document.getElementById("weatherForecastModal");
    if (existing) return existing;

    var overlay = document.createElement("div");
    overlay.id = "weatherForecastModal";
    overlay.className = "weather-modal";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<div class="weather-modal__backdrop" data-weather-close tabindex="-1"></div>' +
      '<div class="weather-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="weatherModalTitle">' +
      '<button type="button" class="weather-modal__close" data-weather-close aria-label="Close weather forecast">&times;</button>' +
      '<div class="weather-modal__header">' +
      liveBadge("Live weather") +
      '<h2 id="weatherModalTitle" class="weather-modal__title">Garden forecast</h2>' +
      '<p class="weather-modal__place">' +
      PLACE +
      "</p>" +
      "</div>" +
      '<div id="weatherModalBody" class="weather-modal__body"></div>' +
      '<div class="weather-modal__actions">' +
      '<button type="button" class="btn btn--outline weather-modal__refresh" id="weatherModalRefresh">Refresh live</button>' +
      '<button type="button" class="btn weather-modal__done" data-weather-close>Done</button>' +
      "</div></div>";
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target.closest("[data-weather-close]")) closeModal();
    });
    var refreshBtn = document.getElementById("weatherModalRefresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        openModal(true);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeModal();
    });
    return overlay;
  }

  function buildModalBodyHtml() {
    if (state.loading && !state.current) {
      return '<p class="weather-modal__status">Fetching live weather for Mataasnakahoy…</p>';
    }
    if ((state.error || !state.current) && !state.loading) {
      return '<p class="weather-modal__status">Live weather is unavailable right now. Tap Refresh live to try again.</p>';
    }
    if (!state.current) {
      return '<p class="weather-modal__status">Fetching live weather for Mataasnakahoy…</p>';
    }

    var cur = state.current;
    var days = (state.daily || []).slice(0, 7);
    var hours = (state.hourly || []).slice(0, 12);

    var daysHtml = days
      .map(function (d) {
        return (
          '<article class="weather-modal-day weather-modal-day--' +
          weatherTone(d.code) +
          '">' +
          '<div class="weather-modal-day__head">' +
          weatherIcon(d.code) +
          "<div><strong>" +
          fullDateLabel(d.date) +
          "</strong><span>" +
          weatherLabel(d.code) +
          "</span></div></div>" +
          '<p class="weather-modal-day__temps"><span class="weather-modal-day__high">' +
          fmtTemp(d.max) +
          '</span><span class="weather-modal-day__low">' +
          fmtTemp(d.min) +
          "</span></p></article>"
        );
      })
      .join("");

    var hoursHtml = hours
      .map(function (h) {
        return (
          '<div class="weather-modal-hour" title="' +
          weatherLabel(h.code) +
          '">' +
          "<span>" +
          hourLabel(h.time) +
          "</span>" +
          weatherIcon(h.code) +
          "<strong>" +
          fmtTemp(h.temp) +
          "</strong></div>"
        );
      })
      .join("");

    return (
      '<section class="weather-modal-now weather-modal-now--' +
      weatherTone(cur.code) +
      '">' +
      weatherIcon(cur.code) +
      '<div class="weather-modal-now__copy">' +
      liveBadge("Live now") +
      '<p class="weather-modal-now__temp">' +
      fmtTemp(cur.temp) +
      "C</p>" +
      '<p class="weather-modal-now__cond">' +
      weatherLabel(cur.code) +
      "</p>" +
      '<p class="weather-modal-now__updated">Updated ' +
      timeUpdatedLabel(state.updatedAt) +
      " · Asia/Manila</p>" +
      "</div>" +
      '<ul class="weather-modal-now__meta">' +
      "<li><span>Feels like</span><strong>" +
      fmtTemp(cur.feels != null ? cur.feels : cur.temp) +
      "</strong></li>" +
      "<li><span>Humidity</span><strong>" +
      (cur.humidity != null ? Math.round(cur.humidity) + "%" : "—") +
      "</strong></li>" +
      "<li><span>Wind</span><strong>" +
      (cur.wind != null ? Math.round(cur.wind) + " km/h" : "—") +
      "</strong></li>" +
      "</ul></section>" +
      '<h3 class="weather-modal__section-title">Next hours</h3>' +
      '<div class="weather-modal-hours">' +
      hoursHtml +
      "</div>" +
      '<h3 class="weather-modal__section-title">7-day outlook</h3>' +
      '<div class="weather-modal-days">' +
      daysHtml +
      "</div>"
    );
  }

  function renderModalBody() {
    var body = document.getElementById("weatherModalBody");
    if (body) body.innerHTML = buildModalBodyHtml();
  }

  function openModal(forceRefresh) {
    ensureModal();
    var overlay = document.getElementById("weatherForecastModal");
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("weather-modal-open");
    renderModalBody();
    fetchWeather(!!forceRefresh).then(renderModalBody);
  }

  function closeModal() {
    var overlay = document.getElementById("weatherForecastModal");
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("weather-modal-open");
  }

  function buildPanelHtml(compact) {
    var extra = compact ? " weather-widget--compact" : "";
    if (state.loading && !state.current) {
      return (
        '<button type="button" class="weather-widget weather-widget--tap weather-widget--loading' +
        extra +
        '" data-weather-open aria-label="Open live weather forecast for Mataasnakahoy">' +
        liveBadge("Live weather") +
        '<p class="weather-widget__status">Loading Mataasnakahoy weather…</p>' +
        '<span class="weather-widget__hint">Tap for forecast</span></button>'
      );
    }
    if ((state.error || !state.current) && !state.loading) {
      return (
        '<button type="button" class="weather-widget weather-widget--tap weather-widget--error' +
        extra +
        '" data-weather-open aria-label="Open live weather forecast for Mataasnakahoy">' +
        liveBadge("Live weather") +
        '<p class="weather-widget__status">Weather unavailable</p>' +
        '<span class="weather-widget__hint">Tap to retry</span></button>'
      );
    }
    if (!state.current) {
      return (
        '<button type="button" class="weather-widget weather-widget--tap weather-widget--loading' +
        extra +
        '" data-weather-open aria-label="Open live weather forecast for Mataasnakahoy">' +
        liveBadge("Live weather") +
        '<p class="weather-widget__status">Loading Mataasnakahoy weather…</p>' +
        '<span class="weather-widget__hint">Tap for forecast</span></button>'
      );
    }
    var cur = state.current;
    var days = (state.daily || []).slice(0, compact ? 4 : 5);
    var daysHtml = days
      .map(function (d) {
        return (
          '<div class="weather-day weather-day--' +
          weatherTone(d.code) +
          '">' +
          '<span class="weather-day__name">' +
          weekdayLabel(d.date) +
          "</span>" +
          weatherIcon(d.code) +
          '<span class="weather-day__temps">' +
          '<em>' +
          fmtTemp(d.max) +
          "</em> / " +
          fmtTemp(d.min) +
          "</span></div>"
        );
      })
      .join("");

    return (
      '<button type="button" class="weather-widget weather-widget--tap weather-widget--' +
      weatherTone(cur.code) +
      extra +
      '" data-weather-open aria-label="Open live weather forecast for Mataasnakahoy, Batangas">' +
      '<div class="weather-widget__now">' +
      weatherIcon(cur.code) +
      '<div class="weather-widget__now-text">' +
      liveBadge("Live") +
      '<p class="weather-widget__temp">' +
      fmtTemp(cur.temp) +
      "</p>" +
      '<p class="weather-widget__label">' +
      weatherLabel(cur.code) +
      "</p>" +
      '<p class="weather-widget__place">' +
      PLACE +
      "</p>" +
      "</div></div>" +
      '<div class="weather-widget__days">' +
      daysHtml +
      "</div>" +
      '<span class="weather-widget__hint">Open forecast</span></button>'
    );
  }

  function bindOpenHandlers(root) {
    if (!root) return;
    root.querySelectorAll("[data-weather-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openModal(false);
      });
    });
  }

  function renderMounts() {
    var guest = document.getElementById("weatherPanelGuest");
    var top = document.getElementById("weatherBarTop");
    if (guest) {
      guest.innerHTML = buildPanelHtml(false);
      bindOpenHandlers(guest);
    }
    if (top) {
      top.innerHTML = buildPanelHtml(true);
      bindOpenHandlers(top);
    }
    if (document.getElementById("weatherForecastModal") && !document.getElementById("weatherForecastModal").hidden) {
      renderModalBody();
    }
  }

  function setLoggedIn(isLoggedIn) {
    var guest = document.getElementById("weatherPanelGuest");
    var top = document.getElementById("weatherBarTop");
    if (guest) guest.hidden = !!isLoggedIn;
    if (top) top.hidden = !isLoggedIn;
    renderMounts();
  }

  function normalizePayload(json) {
    var current = json.current || {};
    var daily = json.daily || {};
    var hourly = json.hourly || {};
    var days = [];
    var dates = daily.time || [];
    for (var i = 0; i < dates.length; i++) {
      days.push({
        date: dates[i],
        code: (daily.weather_code || [])[i],
        max: (daily.temperature_2m_max || [])[i],
        min: (daily.temperature_2m_min || [])[i]
      });
    }
    var hours = [];
    var times = hourly.time || [];
    var now = Date.now();
    for (var h = 0; h < times.length; h++) {
      var t = new Date(times[h]).getTime();
      if (isNaN(t) || t < now - 30 * 60 * 1000) continue;
      hours.push({
        time: times[h],
        temp: (hourly.temperature_2m || [])[h],
        code: (hourly.weather_code || [])[h]
      });
      if (hours.length >= 12) break;
    }
    return {
      current: {
        temp: current.temperature_2m,
        feels: current.apparent_temperature,
        code: current.weather_code,
        humidity: current.relative_humidity_2m,
        wind: current.wind_speed_10m
      },
      daily: days,
      hourly: hours,
      updatedAt: current.time || new Date().toISOString()
    };
  }

  function forecastUrl() {
    return (
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      LAT +
      "&longitude=" +
      LON +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
      "&hourly=temperature_2m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&timezone=Asia%2FManila&forecast_days=7"
    );
  }

  function fetchWeather(force) {
    if (!state.current) {
      state.loading = true;
      renderMounts();
    }
    if (!force) {
      var cached = readCache();
      if (cached) {
        applyPayload(cached);
        renderMounts();
        finishReady();
      }
    }

    return fetch(forecastUrl(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Weather request failed");
        return res.json();
      })
      .then(function (json) {
        var payload = normalizePayload(json);
        writeCache(payload);
        applyPayload(payload);
        renderMounts();
        finishReady();
      })
      .catch(function () {
        if (!state.current) {
          state.loading = false;
          state.error = "unavailable";
          renderMounts();
        } else {
          state.loading = false;
        }
        finishReady();
      });
  }

  if (!bound) {
    bound = true;
    ensureModal();
    fetchWeather(false);
  }

  window.ElenestWeather = {
    ready: ready,
    refresh: function () {
      return fetchWeather(true);
    },
    open: function () {
      openModal(true);
    },
    setLoggedIn: setLoggedIn,
    render: renderMounts
  };
})();
