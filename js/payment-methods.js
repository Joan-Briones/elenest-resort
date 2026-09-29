(function () {
  var cache = [];
  var DEFAULT_QR = "../Images/payment-qr.svg";
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function rid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emitUpdated() {
    try {
      window.dispatchEvent(new CustomEvent("elenest-payment-methods-updated"));
    } catch (e) {}
  }

  function rowToMethod(row) {
    return {
      id: row.id,
      provider: row.provider || "",
      accountName: row.account_name || "",
      accountNumber: row.account_number || "",
      instructions: row.instructions || "",
      qrImage: (row.qr_image && String(row.qr_image).trim()) || DEFAULT_QR,
      active: row.active !== false,
      sortOrder: row.sort_order != null ? row.sort_order : 0,
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  function methodToRow(item) {
    return {
      id: item.id,
      provider: item.provider || "",
      account_name: item.accountName || "",
      account_number: item.accountNumber || "",
      instructions: item.instructions || "",
      qr_image: item.qrImage || DEFAULT_QR,
      active: item.active !== false,
      sort_order: item.sortOrder != null ? item.sortOrder : 0,
      updated_at: new Date().toISOString()
    };
  }

  function sortList(list) {
    return list.slice().sort(function (a, b) {
      var ao = a.sortOrder != null ? a.sortOrder : 999;
      var bo = b.sortOrder != null ? b.sortOrder : 999;
      if (ao !== bo) return ao - bo;
      return String(a.provider || "").localeCompare(String(b.provider || ""));
    });
  }

  function defaultMethods() {
    return [
      {
        id: rid(),
        provider: "GCash",
        accountName: "Elenest Resort Events",
        accountNumber: "09171234567",
        instructions:
          "Scan the QR code using your GCash app. Send exactly the down payment amount shown. Use your full name as reference.",
        qrImage: DEFAULT_QR,
        active: true,
        sortOrder: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: rid(),
        provider: "Maya",
        accountName: "Elenest Resort Events",
        accountNumber: "09181234567",
        instructions:
          "Scan the Maya QR code and send the exact amount shown. Use your full name as reference, then upload your receipt.",
        qrImage: DEFAULT_QR,
        active: true,
        sortOrder: 1,
        createdAt: new Date().toISOString()
      },
      {
        id: rid(),
        provider: "LandBank",
        accountName: "Elenest Resort Inc.",
        accountNumber: "1234-5678-90",
        instructions:
          "Scan via your bank app or InstaPay. Transfer the exact down payment amount to the account below and upload your receipt.",
        qrImage: DEFAULT_QR,
        active: true,
        sortOrder: 2,
        createdAt: new Date().toISOString()
      },
      {
        id: rid(),
        provider: "BDO",
        accountName: "Elenest Resort",
        accountNumber: "001234567890",
        instructions:
          "Use BDO Pay, online banking, or any e-wallet that supports InstaPay. Include your booking name in the notes.",
        qrImage: DEFAULT_QR,
        active: true,
        sortOrder: 3,
        createdAt: new Date().toISOString()
      }
    ];
  }

  function loadAll() {
    var sb = getClient();
    if (!sb) {
      cache = defaultMethods();
      readyResolve();
      return Promise.resolve();
    }

    return sb
      .from("payment_methods")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        cache = (res.data || []).map(rowToMethod);
        if (!cache.length) {
          cache = defaultMethods();
          return sb.from("payment_methods").upsert(cache.map(methodToRow), { onConflict: "id" });
        }
      })
      .then(function () {
        readyResolve();
        emitUpdated();
      })
      .catch(function (err) {
        try {
          console.warn("[Elenest PaymentMethods] Supabase load failed:", err);
        } catch (e) {}
        cache = defaultMethods();
        readyResolve();
      });
  }

  function persist(item) {
    var sb = getClient();
    if (!sb) return Promise.resolve(false);
    return sb
      .from("payment_methods")
      .upsert(methodToRow(item), { onConflict: "id" })
      .then(function (res) {
        if (res.error) throw res.error;
        emitUpdated();
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function removeRow(id) {
    var sb = getClient();
    if (!sb) return Promise.resolve(false);
    return sb
      .from("payment_methods")
      .delete()
      .eq("id", id)
      .then(function (res) {
        if (res.error) throw res.error;
        cache = cache.filter(function (m) {
          return m && m.id !== id;
        });
        emitUpdated();
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  loadAll();

  window.ElenestPaymentMethods = {
    ready: ready,

    listAll: function () {
      return sortList(cache);
    },

    listActive: function () {
      return sortList(
        cache.filter(function (m) {
          return m && m.active !== false;
        })
      );
    },

    getById: function (id) {
      if (!id) return null;
      for (var i = 0; i < cache.length; i++) {
        if (cache[i] && cache[i].id === id) return cache[i];
      }
      return null;
    },

    add: function (record) {
      var item = {
        id: rid(),
        provider: String(record.provider || "").trim(),
        accountName: String(record.accountName || "").trim(),
        accountNumber: String(record.accountNumber || "").trim(),
        instructions: String(record.instructions || "").trim(),
        qrImage: String(record.qrImage || DEFAULT_QR),
        active: record.active !== false,
        sortOrder: cache.length,
        createdAt: new Date().toISOString()
      };
      cache.push(item);
      return Promise.resolve(persist(item)).then(function () {
        return item;
      });
    },

    update: function (id, patch) {
      if (!id || !patch) return Promise.resolve(false);
      for (var i = 0; i < cache.length; i++) {
        if (!cache[i] || cache[i].id !== id) continue;
        for (var k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) {
            cache[i][k] = patch[k];
          }
        }
        return Promise.resolve(persist(cache[i])).then(function () {
          return true;
        });
      }
      return Promise.resolve(false);
    },

    remove: function (id) {
      if (!id) return Promise.resolve(false);
      return Promise.resolve(removeRow(id)).then(function (ok) {
        return !!ok;
      });
    },

    toggleActive: function (id) {
      var m = window.ElenestPaymentMethods.getById(id);
      if (!m) return false;
      return window.ElenestPaymentMethods.update(id, { active: m.active === false });
    },

    refresh: loadAll
  };
})();
