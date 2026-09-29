/**
 * Initializes the Supabase client for Elenest Resort.
 * Requires @supabase/supabase-js (CDN) and supabase-config.js loaded first.
 */
(function () {
  var config = window.ElenestSupabaseConfig;

  function warn(msg) {
    try {
      console.warn("[Elenest Supabase] " + msg);
    } catch (e) {}
  }

  if (!config || !config.url || !config.publishableKey) {
    warn("Configuration missing. Check supabase-config.js.");
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    warn("Library not loaded. Include @supabase/supabase-js before this script.");
    return;
  }

  var client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });

  window.ElenestSupabase = client;

  window.ElenestSupabaseHelpers = {
    getClient: function () {
      return client;
    },

    isReady: function () {
      return !!client;
    },

    /** Quick connectivity check (does not require database tables). */
    ping: function () {
      return client.auth
        .getSession()
        .then(function (result) {
          return {
            ok: true,
            hasSession: !!(result.data && result.data.session)
          };
        })
        .catch(function (err) {
          return { ok: false, error: err.message || String(err) };
        });
    }
  };
})();
