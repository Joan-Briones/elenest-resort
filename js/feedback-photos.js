/**
 * Guest feedback images: compress and upload to Supabase Storage.
 * Public URLs are stored on guest_feedback.photo_url.
 */
(function () {
  var BUCKET = "feedback-photos";
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

  function isDataUrl(value) {
    return String(value || "").indexOf("data:image") === 0;
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ""));
  }

  /**
   * Upload a feedback photo and return a public URL (or a small data URL fallback).
   * @param {string} feedbackId
   * @param {string} dataUrl
   * @returns {Promise<string>}
   */
  function uploadPhoto(feedbackId, dataUrl) {
    var sb = getClient();
    if (!dataUrl) return Promise.resolve("");
    if (isHttpUrl(dataUrl)) return Promise.resolve(String(dataUrl));
    if (!isDataUrl(dataUrl)) return Promise.resolve(String(dataUrl || ""));

    return compressDataUrl(dataUrl).then(function (compressed) {
      if (!sb || !feedbackId) {
        return compressed.length <= MAX_INLINE ? compressed : "";
      }

      var blob = dataUrlToBlob(compressed);
      if (!blob) return "";

      var path = String(feedbackId) + "/" + Date.now() + ".jpg";
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
              console.warn(
                "[Elenest FeedbackPhotos] Upload failed:",
                res.error.message || res.error
              );
            } catch (e) {}
            return compressed.length <= MAX_INLINE ? compressed : "";
          }
          var pub = sb.storage.from(BUCKET).getPublicUrl(path);
          return pub.data && pub.data.publicUrl ? pub.data.publicUrl : "";
        });
    });
  }

  /**
   * Prepare photo for guest_feedback.photo_url (Storage URL preferred).
   */
  function preparePhotoUrl(feedbackId, photo) {
    return uploadPhoto(feedbackId, photo || "");
  }

  window.ElenestFeedbackPhotos = {
    uploadPhoto: uploadPhoto,
    preparePhotoUrl: preparePhotoUrl,
    compressDataUrl: compressDataUrl,
    BUCKET: BUCKET
  };
})();
