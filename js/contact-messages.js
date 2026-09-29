/**
 * Contact Us / Manager messages → public.customer_messages (mobile table).
 * Never falls back to the old contact_messages / elenest_messages cache.
 */
(function () {
  var TABLE = "customer_messages";
  var STORAGE = "elenest_customer_messages";
  var cache = [];
  var lastError = null;
  var readyResolve;
  var readyDone = false;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  var realtimeChannel = null;
  var reloadTimer = null;

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function rid() {
    return "msg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function finishReady() {
    if (!readyDone) {
      readyDone = true;
      readyResolve();
    }
  }

  function emitUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-contact-messages-updated"));
    } catch (e) {}
  }

  function clearLegacyCaches() {
    try {
      localStorage.removeItem("elenest_messages");
      localStorage.removeItem(STORAGE);
    } catch (e) {}
  }

  function syncLegacyStorage() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(cache));
    } catch (e) {}
  }

  function pick(row, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var v = row[keys[i]];
      if (v != null && String(v) !== "") return v;
    }
    return fallback;
  }

  function rowToMessage(row) {
    if (!row || typeof row !== "object") {
      return {
        id: rid(),
        name: "Guest",
        email: "",
        message: "",
        status: "new",
        reply: "",
        repliedAt: null,
        createdAt: new Date().toISOString()
      };
    }
    return {
      id: pick(row, ["id", "message_id"], rid()),
      name: String(pick(row, ["name", "customer_name", "full_name", "sender_name", "user_name"], "Guest") || "Guest"),
      email: String(pick(row, ["email", "customer_email", "sender_email", "user_email"], "") || ""),
      message: String(pick(row, ["message", "body", "content", "text", "msg"], "") || ""),
      status: String(pick(row, ["status"], "new") || "new"),
      reply: String(pick(row, ["reply", "admin_reply", "staff_reply", "response", "manager_reply"], "") || ""),
      repliedAt: pick(row, ["replied_at", "repliedAt", "reply_at"], null),
      createdAt: pick(row, ["created_at", "createdAt", "date_created", "timestamp", "sent_at"], new Date().toISOString())
    };
  }

  function applyRows(rows) {
    lastError = null;
    cache = (rows || []).map(rowToMessage);
    syncLegacyStorage();
    emitUpdated();
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      reloadTimer = null;
      loadAll(true);
    }, 350);
  }

  function subscribeRealtime(sb) {
    if (!sb || !sb.channel) return;
    if (realtimeChannel) {
      try {
        if (typeof sb.removeChannel === "function") sb.removeChannel(realtimeChannel);
        else if (realtimeChannel.unsubscribe) realtimeChannel.unsubscribe();
      } catch (e) {}
      realtimeChannel = null;
    }
    realtimeChannel = sb.channel("elenest-customer-messages-v2");
    realtimeChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE },
      scheduleReload
    );
    realtimeChannel.subscribe();
  }

  function errMessage(err) {
    if (!err) return "Could not load messages.";
    if (typeof err === "string") return err;
    return err.message || err.error_description || err.details || err.hint || "Could not load messages.";
  }

  function fetchRows(sb) {
    // Prefer newest-first; if created_at is missing on the mobile schema, retry unsorted.
    return sb
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
      .catch(function (err) {
        var msg = errMessage(err);
        if (!/created_at|column|42703/i.test(msg)) throw err;
        return sb
          .from(TABLE)
          .select("*")
          .then(function (res2) {
            if (res2.error) throw res2.error;
            return res2.data || [];
          });
      });
  }

  function loadAll(isReload) {
    var sb = getClient();
    if (!sb) {
      lastError = "Supabase is not connected.";
      cache = [];
      finishReady();
      emitUpdated();
      return Promise.resolve();
    }

    var sessionReady =
      sb.auth && typeof sb.auth.getSession === "function"
        ? sb.auth.getSession().catch(function () {
            return { data: { session: null } };
          })
        : Promise.resolve({ data: { session: null } });

    return sessionReady
      .then(function (sessionRes) {
        var session = sessionRes && sessionRes.data && sessionRes.data.session;
        if (!session) {
          throw new Error("Staff session missing — sign in again, then Refresh.");
        }
        return fetchRows(sb);
      })
      .then(function (rows) {
        applyRows(rows);
        finishReady();
      })
      .catch(function (err) {
        lastError = errMessage(err);
        try {
          console.warn("[Elenest] customer_messages load failed:", err);
        } catch (e) {}
        // Do NOT restore old contact_messages localStorage — show empty + error instead.
        cache = [];
        syncLegacyStorage();
        finishReady();
        emitUpdated();
      });
  }

  function submitViaRpc(row) {
    var sb = getClient();
    if (!sb || typeof sb.rpc !== "function") {
      return Promise.reject(new Error("Supabase is not connected."));
    }
    return sb
      .rpc("submit_contact_message", {
        p_id: row.id,
        p_name: row.name,
        p_email: row.email,
        p_message: row.message
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return rowToMessage(res.data || row);
      });
  }

  function submitViaInsert(row) {
    var sb = getClient();
    if (!sb) {
      return Promise.reject(new Error("Supabase is not connected."));
    }
    return sb
      .from(TABLE)
      .insert({
        id: row.id,
        name: row.name,
        email: row.email,
        message: row.message,
        status: "new",
        reply: ""
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return rowToMessage(
          Object.assign({}, row, {
            status: "new",
            reply: "",
            created_at: new Date().toISOString()
          })
        );
      });
  }

  function submit(entry) {
    var email = String(entry.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Promise.reject(new Error("A valid email is required so we can reply to your inbox."));
    }
    var row = {
      id: entry.id || rid(),
      name: String(entry.name || "").trim() || "Guest",
      email: email,
      message: String(entry.message || "").trim()
    };

    return submitViaRpc(row)
      .catch(function (rpcErr) {
        return submitViaInsert(row).catch(function (insertErr) {
          var rpcMsg = errMessage(rpcErr);
          var insertMsg = errMessage(insertErr);
          if (/could not find the function|PGRST202|404/i.test(rpcMsg)) {
            throw new Error(
              "Run sql/ensure-customer-messages.sql in Supabase SQL Editor, then refresh this page."
            );
          }
          if (/row-level security|rls|42501/i.test(insertMsg) || /row-level security|rls|42501/i.test(rpcMsg)) {
            throw new Error(
              "RLS still blocking inserts. Run sql/ensure-customer-messages.sql, then Ctrl+F5."
            );
          }
          throw new Error(insertMsg || rpcMsg);
        });
      })
      .then(function (item) {
        cache.unshift(item);
        lastError = null;
        syncLegacyStorage();
        emitUpdated();
        return item;
      });
  }

  function saveReply(id, replyText) {
    var reply = String(replyText || "").trim();
    var patch = {
      reply: reply,
      status: reply ? "replied" : "read",
      replied_at: reply ? new Date().toISOString() : null
    };
    var found = false;
    cache = cache.map(function (item) {
      if (String(item.id) !== String(id)) return item;
      found = true;
      return {
        id: item.id,
        name: item.name,
        email: item.email,
        message: item.message,
        status: patch.status,
        reply: patch.reply,
        repliedAt: patch.replied_at,
        createdAt: item.createdAt
      };
    });
    if (!found) return Promise.reject(new Error("Message not found"));
    syncLegacyStorage();
    emitUpdated();

    var sb = getClient();
    if (!sb) return Promise.resolve(true);
    return sb
      .from(TABLE)
      .update(patch)
      .eq("id", id)
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
  }

  clearLegacyCaches();
  loadAll(false);
  subscribeRealtime(getClient());

  if (window.ElenestAuth && window.ElenestAuth.ready) {
    window.ElenestAuth.ready.then(function () {
      loadAll(true);
      subscribeRealtime(getClient());
    });
  }
  window.addEventListener("elenest-auth-change", function () {
    loadAll(true);
    subscribeRealtime(getClient());
  });

  window.ElenestContactMessages = {
    ready: ready,
    tableName: TABLE,
    getLastError: function () {
      return lastError;
    },
    listAll: function () {
      return cache.slice();
    },
    refresh: function () {
      clearLegacyCaches();
      return loadAll(true);
    },
    submit: submit,
    saveReply: saveReply
  };
})();
