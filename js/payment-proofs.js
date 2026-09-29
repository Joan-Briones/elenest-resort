/**
 * Payment receipt images: compress and upload to Supabase Storage so admin can view them.
 */
(function () {
  var BUCKET = "payment-proofs";
  var MAX_INLINE = 120000;
  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.82;

  function getClient() {
    return window.ElenestSupabase || null;
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl || "").split(",");
    if (parts.length < 2) return null;
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  function compressDataUrl(dataUrl) {
    return new Promise(function (resolve) {
      if (!dataUrl || String(dataUrl).indexOf("data:image") !== 0) {
        resolve(dataUrl || "");
        return;
      }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width || 1;
          var h = img.height || 1;
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function cacheProofLocally(bookingId, dataUrl) {
    if (!bookingId || !dataUrl) return;
    try {
      localStorage.setItem("elenest_proof_" + bookingId, dataUrl);
    } catch (e) {}
  }

  function uploadToStorage(bookingId, dataUrl) {
    var sb = getClient();
    if (!sb || !bookingId || !dataUrl) return Promise.resolve(null);

    return compressDataUrl(dataUrl).then(function (compressed) {
      var blob = dataUrlToBlob(compressed);
      if (!blob) return null;
      var path = String(bookingId) + "/" + Date.now() + ".jpg";
      return sb.storage
        .from(BUCKET)
        .upload(path, blob, {
          cacheControl: "3600",
          upsert: true,
          contentType: "image/jpeg"
        })
        .then(function (res) {
          if (res.error) {
            try {
              console.warn("[Elenest PaymentProofs] Upload failed:", res.error.message || res.error);
            } catch (e) {}
            if (compressed.length <= MAX_INLINE) {
              return { paymentProof: compressed, hasPaymentProof: true };
            }
            cacheProofLocally(bookingId, compressed);
            return { hasPaymentProof: true };
          }
          var pub = sb.storage.from(BUCKET).getPublicUrl(path);
          return {
            paymentProofUrl: pub.data && pub.data.publicUrl ? pub.data.publicUrl : "",
            hasPaymentProof: true
          };
        });
    });
  }

  /**
   * Before saving a booking row, upload receipt if needed and strip huge inline data.
   */
  function prepareForPersist(booking) {
    if (!booking || typeof booking !== "object") return Promise.resolve(booking);

    var copy = {};
    for (var k in booking) {
      if (Object.prototype.hasOwnProperty.call(booking, k)) copy[k] = booking[k];
    }

    if (copy.paymentProofUrl && !copy.paymentProof) {
      delete copy.paymentProof;
      copy.hasPaymentProof = true;
      return Promise.resolve(copy);
    }

    var proof = copy.paymentProof ? String(copy.paymentProof) : "";
    if (!proof) return Promise.resolve(copy);

    return uploadToStorage(copy.id, proof).then(function (result) {
      if (!result) return copy;
      if (result.paymentProofUrl) {
        copy.paymentProofUrl = result.paymentProofUrl;
        delete copy.paymentProof;
        copy.hasPaymentProof = true;
        return copy;
      }
      if (result.paymentProof) {
        copy.paymentProof = result.paymentProof;
        copy.hasPaymentProof = true;
        return copy;
      }
      copy.hasPaymentProof = true;
      delete copy.paymentProof;
      return copy;
    });
  }

  function isValidProofSrc(src) {
    if (!src) return false;
    var value = String(src).trim();
    if (!value || value === "mobile-proof") return false;
    if (value.indexOf("data:image") === 0) {
      var comma = value.indexOf(",");
      return comma > 0 && value.length > comma + 80;
    }
    return /^https?:\/\//i.test(value);
  }

  function storagePathFromPublicUrl(url) {
    var marker = "/storage/v1/object/public/" + BUCKET + "/";
    var idx = String(url || "").indexOf(marker);
    if (idx === -1) return "";
    return decodeURIComponent(String(url).slice(idx + marker.length));
  }

  function buildPublicUrl(path) {
    var sb = getClient();
    if (!sb || !path) return "";
    var pub = sb.storage.from(BUCKET).getPublicUrl(path);
    return pub.data && pub.data.publicUrl ? pub.data.publicUrl : "";
  }

  function buildSignedUrl(path) {
    var sb = getClient();
    if (!sb || !path) return Promise.resolve("");
    return sb.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) return "";
      return sb.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600)
        .then(function (res) {
          if (res.error || !res.data || !res.data.signedUrl) return "";
          return res.data.signedUrl;
        });
    });
  }

  function urlForStoragePath(path) {
    return buildSignedUrl(path).then(function (signed) {
      if (signed) return signed;
      return buildPublicUrl(path);
    });
  }

  function canLoadImage(src) {
    return new Promise(function (resolve) {
      if (!isValidProofSrc(src)) {
        resolve(false);
        return;
      }
      var img = new Image();
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        resolve(!!ok);
      }
      img.onload = function () {
        done(true);
      };
      img.onerror = function () {
        done(false);
      };
      img.src = src;
      setTimeout(function () {
        done(false);
      }, 10000);
    });
  }

  function collectProofCandidates(booking) {
    var out = [];
    function push(value) {
      if (!isValidProofSrc(value)) return;
      if (out.indexOf(value) === -1) out.push(value);
    }
    if (!booking) return out;
    push(booking.paymentProofUrl);
    push(booking.paymentProof);
    var payload = booking.payload;
    if (payload && typeof payload === "object") {
      push(payload.paymentProofUrl);
      push(payload.paymentProof);
    }
    if (booking.id) {
      try {
        push(localStorage.getItem("elenest_proof_" + booking.id));
      } catch (e) {}
    }
    return out;
  }

  function listLatestProofPath(bookingId) {
    var sb = getClient();
    if (!sb || !bookingId) return Promise.resolve("");

    return sb.storage
      .from(BUCKET)
      .list(String(bookingId), { limit: 100 })
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) return "";
        var files = res.data.filter(function (item) {
          return item && item.name && item.metadata;
        });
        if (!files.length) return "";
        files.sort(function (a, b) {
          var aAt = a.created_at || a.updated_at || "";
          var bAt = b.created_at || b.updated_at || "";
          if (aAt !== bAt) return bAt < aAt ? -1 : bAt > aAt ? 1 : 0;
          return 0;
        });
        return String(bookingId) + "/" + files[0].name;
      })
      .catch(function () {
        return "";
      });
  }

  function getProofSrc(booking) {
    if (!booking) return "";
    var candidates = collectProofCandidates(booking);
    if (candidates.length) return candidates[0];
    if (booking.paymentProofUrl) return booking.paymentProofUrl;
    if (booking.paymentProof) return booking.paymentProof;
    if (booking.id) {
      try {
        var stored = localStorage.getItem("elenest_proof_" + booking.id);
        if (stored) return stored;
      } catch (e) {}
    }
    return "";
  }

  function resolveProofSrcFromStorage(bookingId) {
    return listLatestProofPath(bookingId).then(function (path) {
      if (!path) return "";
      return urlForStoragePath(path);
    });
  }

  function resolveProofSrc(booking) {
    if (!booking) return Promise.resolve("");

    var candidates = collectProofCandidates(booking);

    function tryCandidate(index) {
      if (index >= candidates.length) {
        if (!booking.id) return Promise.resolve("");
        return resolveProofSrcFromStorage(booking.id);
      }

      var src = candidates[index];
      return canLoadImage(src).then(function (ok) {
        if (ok) return src;

        var path = storagePathFromPublicUrl(src);
        if (path) {
          return urlForStoragePath(path).then(function (refreshed) {
            if (!refreshed) return tryCandidate(index + 1);
            return canLoadImage(refreshed).then(function (refreshedOk) {
              return refreshedOk ? refreshed : tryCandidate(index + 1);
            });
          });
        }

        return tryCandidate(index + 1);
      });
    }

    return tryCandidate(0).then(function (url) {
      if (url && booking && url.indexOf("data:") !== 0) {
        booking.paymentProofUrl = url;
      }
      return url || "";
    });
  }

  window.ElenestPaymentProofs = {
    prepareForPersist: prepareForPersist,
    getProofSrc: getProofSrc,
    resolveProofSrc: resolveProofSrc,
    isValidProofSrc: isValidProofSrc,
    compressDataUrl: compressDataUrl
  };
})();
