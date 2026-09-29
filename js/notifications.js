(function () {
  var STORAGE_INBOX = "elenest_notifications";
  var STORAGE_BROADCASTS = "elenest_notification_broadcasts";
  var REMINDER_DAYS_BEFORE = 3;
  var ADMIN_FUTURE_REMINDER_DAYS = [7, 3, 1, 0];
  var STORAGE_ADMIN_REMINDER_EMAILS = "elenest_admin_reminder_emails";
  var inboxCache = {};
  var broadcastsCache = null;
  var notifRealtimeChannel = null;
  var notifPollTimer = null;
  var staffInboxEmail = "";
  var staffInboxRole = "";
  var staffScanTimer = null;
  var staffDirectoryCache = null;
  var staffDirectoryAt = 0;
  var inboxLoaded = {};
  var inboxLoading = {};
  var pendingDedup = {};

  function getSb() {
    return window.ElenestSupabase || null;
  }

  function rowToNotification(row) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      read: row.read === true,
      createdAt: row.created_at,
      link: row.link || "",
      bookingId: row.booking_id || "",
      dedupKey: row.dedup_key || "",
      meta: row.meta && typeof row.meta === "object" ? row.meta : {}
    };
  }

  function notificationToRow(email, item) {
    return {
      id: item.id,
      user_email: normalizeEmail(email),
      type: item.type || TYPES.BOOKING_UPDATED,
      title: item.title || "",
      message: item.message || "",
      read: item.read === true,
      link: item.link || "",
      booking_id: item.bookingId || null,
      dedup_key: item.dedupKey || "",
      meta: item.meta && typeof item.meta === "object" ? item.meta : {},
      created_at: item.createdAt || new Date().toISOString()
    };
  }

  function broadcastToRow(item) {
    return {
      id: item.id,
      kind: item.kind === "event" ? "event" : "promotion",
      title: item.title || "",
      message: item.message || "",
      event_date: item.eventDate || null,
      link: item.link || "",
      created_at: item.createdAt || new Date().toISOString()
    };
  }

  function rowToBroadcast(row) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      message: row.message,
      eventDate: row.event_date || "",
      link: row.link || "",
      createdAt: row.created_at,
      updatedAt: row.created_at
    };
  }

  function loadInboxFromSupabase(email) {
    var key = normalizeEmail(email);
    if (!key) return Promise.resolve();
    var sb = getSb();
    if (!sb) {
      inboxLoaded[key] = true;
      return Promise.resolve();
    }
    if (inboxLoading[key]) return inboxLoading[key];
    inboxLoading[key] = sb
      .from("notifications")
      .select("*")
      .eq("user_email", key)
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        inboxCache[key] = (res.data || []).map(rowToNotification);
        inboxLoaded[key] = true;
        inboxLoading[key] = null;
        emitChanged(key);
      })
      .catch(function () {
        inboxLoaded[key] = true;
        inboxLoading[key] = null;
      });
    return inboxLoading[key];
  }

  function loadBroadcastsFromSupabase() {
    var sb = getSb();
    if (!sb) return Promise.resolve();
    return sb
      .from("notification_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        broadcastsCache = (res.data || []).map(rowToBroadcast);
      })
      .catch(function () {});
  }

  function persistNotification(email, item) {
    var sb = getSb();
    if (!sb) return Promise.resolve(false);
    var row = notificationToRow(email, item);
    row.type = persistableType(item);
    return sb
      .from("notifications")
      .upsert(row, { onConflict: "id" })
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      })
      .catch(function () {
        return sb
          .from("notifications")
          .update({
            read: row.read,
            meta: row.meta,
            title: row.title,
            message: row.message
          })
          .eq("id", row.id)
          .select("id")
          .then(function (res2) {
            if (res2.error) throw res2.error;
            return !!(res2.data && res2.data.length);
          })
          .catch(function () {
            return false;
          });
      });
  }

  function persistBroadcast(item) {
    var sb = getSb();
    if (!sb) return Promise.resolve(false);
    return sb
      .from("notification_broadcasts")
      .upsert(broadcastToRow(item), { onConflict: "id" })
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  var TYPES = {
    BOOKING_CONFIRMED: "booking_confirmed",
    BOOKING_UPDATED: "booking_updated",
    BOOKING_REMINDER: "booking_reminder",
    PAYMENT_APPROVED: "payment_approved",
    PAYMENT_REJECTED: "payment_rejected",
    PROMOTION: "promotion",
    EVENT: "event",
    REVIEW_REQUEST: "review_request"
  };

  var TYPE_LABELS = {
    booking_confirmed: "Booking Confirmed",
    booking_updated: "Booking Updated",
    booking_reminder: "Booking Reminder",
    payment_approved: "Payment Approved",
    payment_rejected: "Payment Rejected",
    promotion: "Promotions & Special Offers",
    event: "Upcoming Events & Activities",
    review_request: "Review Request"
  };

  var STAFF_KIND_LABELS = {
    new_booking: "New Reservation",
    payment_pending: "Payment Verification",
    payment_verified: "Payment Verified",
    booking_cancelled: "Booking Cancelled",
    new_message: "Customer Message",
    new_feedback: "Guest Feedback",
    checkin_due: "Check-in Due",
    checkout_due: "Check-out Due",
    future_booking_7d: "Upcoming Booking (7 days)",
    future_booking_3d: "Upcoming Booking (3 days)",
    future_booking_1d: "Upcoming Booking (1 day)",
    checkin_today: "Check-in Today"
  };

  var STAFF_KIND_TO_TYPE = {
    new_booking: TYPES.BOOKING_CONFIRMED,
    payment_pending: TYPES.BOOKING_UPDATED,
    payment_verified: TYPES.PAYMENT_APPROVED,
    booking_cancelled: TYPES.BOOKING_UPDATED,
    new_message: TYPES.BOOKING_UPDATED,
    new_feedback: TYPES.REVIEW_REQUEST,
    checkin_due: TYPES.BOOKING_REMINDER,
    checkout_due: TYPES.BOOKING_REMINDER,
    future_booking_7d: TYPES.BOOKING_REMINDER,
    future_booking_3d: TYPES.BOOKING_REMINDER,
    future_booking_1d: TYPES.BOOKING_REMINDER,
    checkin_today: TYPES.BOOKING_REMINDER
  };

  function persistableType(item) {
    if (item && item.meta && item.meta.staffKind && STAFF_KIND_TO_TYPE[item.meta.staffKind]) {
      return STAFF_KIND_TO_TYPE[item.meta.staffKind];
    }
    var type = item && item.type;
    if (type && TYPE_LABELS[type]) return type;
    return TYPES.BOOKING_UPDATED;
  }

  function getTypeLabel(typeOrItem) {
    var item = typeOrItem && typeof typeOrItem === "object" ? typeOrItem : null;
    var type = item ? item.type : typeOrItem;
    var kind = item && item.meta && item.meta.staffKind;
    if (kind && STAFF_KIND_LABELS[kind]) return STAFF_KIND_LABELS[kind];
    return TYPE_LABELS[type] || type || "Notification";
  }

  function rid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function emitChanged(email) {
    try {
      window.dispatchEvent(
        new CustomEvent("elenest-notifications-changed", { detail: { email: normalizeEmail(email) } })
      );
    } catch (e) {}
  }

  function getInboxAll() {
    if (getSb()) return inboxCache;
    try {
      var raw = localStorage.getItem(STORAGE_INBOX);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveInboxAll(data) {
    if (getSb()) {
      inboxCache = data && typeof data === "object" ? data : {};
      return;
    }
    localStorage.setItem(STORAGE_INBOX, JSON.stringify(data));
  }

  function getBroadcasts() {
    if (getSb()) {
      if (!Array.isArray(broadcastsCache)) broadcastsCache = [];
      return broadcastsCache;
    }
    try {
      var raw = localStorage.getItem(STORAGE_BROADCASTS);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveBroadcasts(list) {
    if (getSb()) {
      broadcastsCache = Array.isArray(list) ? list : [];
      return;
    }
    localStorage.setItem(STORAGE_BROADCASTS, JSON.stringify(list));
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso + (String(iso).length === 10 ? "T12:00:00" : ""));
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (e) {
      return iso;
    }
  }

  function daysUntil(isoDate) {
    if (!isoDate) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var target = new Date(isoDate + "T12:00:00");
    if (isNaN(target.getTime())) return null;
    return Math.round((target - today) / 86400000);
  }

  function isConfirmedBooking(b) {
    if (!b) return false;
    var st = String(b.status || "").toLowerCase();
    return st === "confirmed" || st === "approved";
  }

  function isCancelledBooking(b) {
    if (!b) return false;
    var st = String(b.status || "").toLowerCase();
    return st === "cancelled" || st === "canceled";
  }

  function isDismissed(n) {
    return !!(n && n.meta && n.meta.dismissed);
  }

  function rawListForUser(email) {
    var key = normalizeEmail(email);
    if (!key) return [];
    var all = getInboxAll();
    return Array.isArray(all[key]) ? all[key] : [];
  }

  function listForUser(email) {
    var key = normalizeEmail(email);
    if (!key) return [];
    if (getSb() && !inboxLoaded[key]) {
      loadInboxFromSupabase(key);
    }
    return rawListForUser(key)
      .filter(function (n) {
        return n && !isDismissed(n);
      })
      .slice()
      .sort(function (a, b) {
        var ar = a.read ? 1 : 0;
        var br = b.read ? 1 : 0;
        if (ar !== br) return ar - br;
        var at = a.createdAt || "";
        var bt = b.createdAt || "";
        return bt < at ? -1 : bt > at ? 1 : 0;
      });
  }

  function getById(email, id) {
    if (!id) return null;
    var list = listForUser(email);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function hasDedupKey(email, dedupKey) {
    if (!dedupKey) return false;
    var stamp = normalizeEmail(email) + ":" + dedupKey;
    if (pendingDedup[stamp]) return true;
    return rawListForUser(email).some(function (n) {
      return n && n.dedupKey === dedupKey;
    });
  }

  function addForUser(email, notification) {
    var key = normalizeEmail(email);
    if (!key || !notification) return null;
    if (getSb() && !inboxLoaded[key]) {
      var waitKey = notification.dedupKey ? key + ":" + notification.dedupKey : "";
      if (waitKey) pendingDedup[waitKey] = true;
      loadInboxFromSupabase(key).then(function () {
        if (waitKey) delete pendingDedup[waitKey];
        addForUser(email, notification);
      });
      return null;
    }
    if (notification.dedupKey && hasDedupKey(key, notification.dedupKey)) return null;
    var all = getInboxAll();
    if (!Array.isArray(all[key])) all[key] = [];
    var item = {
      id: notification.id || rid(),
      type: notification.type || TYPES.BOOKING_UPDATED,
      title: String(notification.title || "").trim() || TYPE_LABELS[notification.type] || "Notification",
      message: String(notification.message || "").trim(),
      read: notification.read === true,
      createdAt: notification.createdAt || new Date().toISOString(),
      link: notification.link || "",
      bookingId: notification.bookingId || "",
      dedupKey: notification.dedupKey || "",
      meta: notification.meta && typeof notification.meta === "object" ? notification.meta : {}
    };
    all[key].unshift(item);
    saveInboxAll(all);
    persistNotification(key, item).then(function (ok) {
      if (!ok && getSb()) loadInboxFromSupabase(key);
    });
    emitChanged(key);
    return item;
  }

  function updateForUser(email, id, patch) {
    var key = normalizeEmail(email);
    if (!key || !id || !patch) return false;
    var all = getInboxAll();
    var list = all[key];
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || list[i].id !== id) continue;
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
      }
      saveInboxAll(all);
      persistNotification(key, list[i]);
      emitChanged(key);
      return true;
    }
    return false;
  }

  function markAsRead(email, id) {
    return updateForUser(email, id, { read: true });
  }

  function markAsUnread(email, id) {
    return updateForUser(email, id, { read: false });
  }

  function markAllAsRead(email) {
    var key = normalizeEmail(email);
    if (!key) return;
    var all = getInboxAll();
    var list = all[key];
    if (!Array.isArray(list)) return;
    var changed = false;
    list.forEach(function (n) {
      if (n && !n.read) {
        n.read = true;
        changed = true;
        persistNotification(key, n);
      }
    });
    if (changed) {
      saveInboxAll(all);
      emitChanged(key);
    }
  }

  function dismissItem(item) {
    var meta = item.meta && typeof item.meta === "object" ? item.meta : {};
    item.meta = Object.assign({}, meta, { dismissed: true });
    item.read = true;
    return item;
  }

  function clearForUser(email, id) {
    var key = normalizeEmail(email);
    if (!key || !id) return false;
    var all = getInboxAll();
    var list = all[key];
    if (!Array.isArray(list)) return false;
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        found = dismissItem(list[i]);
        break;
      }
    }
    if (!found) return false;
    saveInboxAll(all);
    persistNotification(key, found);
    emitChanged(key);
    return true;
  }

  function clearAllForUser(email) {
    var key = normalizeEmail(email);
    if (!key) return;
    var all = getInboxAll();
    var list = all[key];
    if (!Array.isArray(list)) {
      all[key] = [];
      saveInboxAll(all);
      emitChanged(key);
      return;
    }
    list.forEach(function (n) {
      if (!n || isDismissed(n)) return;
      dismissItem(n);
      persistNotification(key, n);
    });
    saveInboxAll(all);
    emitChanged(key);
  }

  function countUnread(email) {
    return listForUser(email).filter(function (n) {
      return n && !n.read;
    }).length;
  }

  function getGuestRecipientEmails() {
    var emails = {};
    if (window.ElenestBookings && typeof window.ElenestBookings.listLive === "function") {
      window.ElenestBookings.listLive().forEach(function (row) {
        if (row && row.accountEmail) emails[normalizeEmail(row.accountEmail)] = true;
      });
    }
    try {
      var sb = getSb();
      if (sb) {
        // profiles table holds guest emails when bookings list is empty
      }
    } catch (e) {}
    return Object.keys(emails).filter(Boolean);
  }

  function broadcastToAllCustomers(notification) {
    var emails = getGuestRecipientEmails();
    var sent = 0;
    emails.forEach(function (em) {
      if (addForUser(em, notification)) sent++;
    });
    return sent;
  }

  function notifyPaymentApproved(email, booking) {
    var id = booking && booking.id ? booking.id : "";
    var PF = window.ElenestPaymentFlow;
    var isFull = PF && PF.normalizePaymentType(booking && booking.paymentType) === "full";
    var isFuture = PF && typeof PF.isFutureBooking === "function" && PF.isFutureBooking(booking);
    var downMsg = isFuture
      ? "Your down payment has been verified. Payment: Approved · Booking: Confirmed · Arrival: Not Arrived until your stay date."
      : "Your down payment has been verified. Payment: Approved · Booking: Confirmed · Arrival: Not Arrived. A 3-hour hold timer has started for same-day arrival monitoring.";
    addForUser(email, {
      type: TYPES.PAYMENT_APPROVED,
      title: isFull ? "Full Payment Approved" : "Down Payment Approved",
      message: isFull
        ? "Your full payment has been verified. Payment: Approved · Booking: Confirmed · Arrival: Not Arrived until check-in."
        : downMsg,
      bookingId: id,
      dedupKey: "payment_approved:" + id,
      link: "book.html"
    });
    if (isFull) notifyBookingConfirmed(email, booking);
  }

  function notifyPaymentRejected(email, booking, reason) {
    var id = booking && booking.id ? booking.id : "";
    var msg = "Your payment was REJECTED. This decision is final unless you submit a new booking with a new receipt.";
    if (reason) msg += " Reason: " + reason;
    addForUser(email, {
      type: TYPES.PAYMENT_REJECTED,
      title: "Payment Rejected",
      message: msg,
      bookingId: id,
      dedupKey: "payment_rejected:" + id,
      link: "book.html"
    });
  }

  function notifyBookingConfirmed(email, booking) {
    var id = booking && booking.id ? booking.id : "";
    var ci = booking && booking.checkIn ? fmtDateLong(booking.checkIn) : "your selected dates";
    addForUser(email, {
      type: TYPES.BOOKING_CONFIRMED,
      title: "Booking Confirmed",
      message: "Your reservation starting " + ci + " is confirmed. We look forward to welcoming you!",
      bookingId: id,
      dedupKey: "booking_confirmed:" + id,
      link: "book.html"
    });
  }

  function notifyBookingUpdated(email, booking, detail) {
    var id = booking && booking.id ? booking.id : "";
    addForUser(email, {
      type: TYPES.BOOKING_UPDATED,
      title: "Booking Updated",
      message: detail || "There is an update to your reservation. Check your appointments for details.",
      bookingId: id,
      dedupKey: "booking_updated:" + id + ":" + Date.now(),
      link: "book.html"
    });
  }

  function notifyBookingCancelled(email, booking) {
    notifyBookingUpdated(
      email,
      booking,
      "Your reservation has been cancelled. Contact us if you have questions."
    );
  }

  function notifySelectAnother(email, booking, message) {
    var id = booking && booking.id ? booking.id : "";
    var text =
      message ||
      "This room is unavailable for your selected date and time. Please select another available room.";
    return addForUser(email, {
      type: TYPES.BOOKING_UPDATED,
      title: "Select another facility",
      message: text,
      bookingId: id,
      dedupKey: "select_another:" + id,
      link: "book.html"
    });
  }

  function broadcastPromotion(record, isUpdate) {
    var id = record.id || rid();
    var title = record.title || "Special Offer";
    var message = record.message || "";
    broadcastToAllCustomers({
      type: TYPES.PROMOTION,
      title: title,
      message: message,
      dedupKey: "promotion:" + id + ":" + (record.updatedAt || record.createdAt || ""),
      link: record.link || "activities.html",
      meta: { broadcastId: id, isUpdate: !!isUpdate }
    });
  }

  function broadcastEvent(record, isUpdate) {
    var id = record.id || rid();
    var title = record.title || "Upcoming Event";
    var message = record.message || "";
    if (record.eventDate) {
      message = (message ? message + " " : "") + "Date: " + fmtDateLong(record.eventDate) + ".";
    }
    broadcastToAllCustomers({
      type: TYPES.EVENT,
      title: title,
      message: message.trim(),
      dedupKey: "event:" + id + ":" + (record.updatedAt || record.createdAt || ""),
      link: record.link || "activities.html",
      meta: { broadcastId: id, isUpdate: !!isUpdate, eventDate: record.eventDate || "" }
    });
  }

  function processAutomaticForUser(email) {
    var key = normalizeEmail(email);
    if (!key) return;
    if (getSb() && !inboxLoaded[key]) {
      loadInboxFromSupabase(key).then(function () {
        processAutomaticForUser(key);
      });
      return;
    }
    var bookings =
      window.ElenestBookings && typeof window.ElenestBookings.listForUser === "function"
        ? window.ElenestBookings.listForUser(key)
        : [];

    bookings.forEach(function (b) {
      if (!b || !b.id || isCancelledBooking(b)) return;

      if (isConfirmedBooking(b) && b.checkIn) {
        var days = daysUntil(b.checkIn);
        if (days !== null && days >= 0 && days <= REMINDER_DAYS_BEFORE) {
          addForUser(key, {
            type: TYPES.BOOKING_REMINDER,
            title: "Booking Reminder",
            message:
              "Your stay at Elenest Resort begins on " +
              fmtDateLong(b.checkIn) +
              (days === 0 ? " (today)" : days === 1 ? " (tomorrow)" : " (in " + days + " days)") +
              ".",
            bookingId: b.id,
            dedupKey: "booking_reminder:" + b.id + ":" + b.checkIn,
            link: "book.html",
            createdAt: b.updatedAt || b.submittedAt || b.createdAt
          });
        }
      }

      if (isConfirmedBooking(b) && b.checkOut) {
        var afterStay = daysUntil(b.checkOut);
        if (afterStay !== null && afterStay < 0) {
          addForUser(key, {
            type: TYPES.REVIEW_REQUEST,
            title: "How was your stay?",
            message: "We hope you enjoyed your visit! Please share your experience with a quick review.",
            bookingId: b.id,
            dedupKey: "review_request:" + b.id,
            link:
              "reviews.html?review=1&booking=" +
              encodeURIComponent(b.id) +
              "#guest-review?review=1&booking=" +
              encodeURIComponent(b.id),
            createdAt: b.checkedOutAt || b.checkOut
          });
        }
      }

      var st = String(b.status || "").toLowerCase();
      if (st === "pending payment verification" && b.paymentSubmittedAt) {
        addForUser(key, {
          type: TYPES.BOOKING_UPDATED,
          title: "Payment Submitted",
          message: "We received your proof of payment. Your booking is pending owner verification.",
          bookingId: b.id,
          dedupKey: "payment_pending:" + b.id,
          link: "book.html",
          createdAt: b.paymentSubmittedAt
        });
      }
    });
  }

  function listBroadcasts(kind) {
    return getBroadcasts()
      .filter(function (b) {
        return !kind || b.kind === kind;
      })
      .sort(function (a, b) {
        var at = a.updatedAt || a.createdAt || "";
        var bt = b.updatedAt || b.createdAt || "";
        return bt < at ? -1 : bt > at ? 1 : 0;
      });
  }

  function saveBroadcast(record) {
    var list = getBroadcasts();
    var now = new Date().toISOString();
    var isUpdate = false;
    if (record.id) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === record.id) {
          isUpdate = true;
          list[i] = Object.assign({}, list[i], record, { updatedAt: now });
          saveBroadcasts(list);
          if (list[i].kind === "event") broadcastEvent(list[i], true);
          else broadcastPromotion(list[i], true);
          return persistBroadcast(list[i]).then(function () {
            return list[i];
          });
        }
      }
    }
    var item = {
      id: rid(),
      kind: record.kind === "event" ? "event" : "promotion",
      title: String(record.title || "").trim(),
      message: String(record.message || "").trim(),
      eventDate: record.eventDate || "",
      link: record.link || "",
      createdAt: now,
      updatedAt: now
    };
    list.unshift(item);
    saveBroadcasts(list);
    if (item.kind === "event") broadcastEvent(item, false);
    else broadcastPromotion(item, false);
    return persistBroadcast(item).then(function () {
      return item;
    });
  }

  function deleteBroadcast(id) {
    if (!id) return false;
    var list = getBroadcasts();
    var next = list.filter(function (b) {
      return b && b.id !== id;
    });
    if (next.length === list.length) return false;
    saveBroadcasts(next);
    return true;
  }

  function getBroadcastById(id) {
    if (!id) return null;
    var list = getBroadcasts();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function normBookingStatus(st) {
    var s = String(st || "pending").trim().toLowerCase();
    if (s === "confirmed" || s === "approved") return "confirmed";
    if (s === "cancelled" || s === "canceled") return "cancelled";
    if (s === "pending payment verification") return "pending_payment";
    return "pending";
  }

  function findBooking(email, id) {
    if (!window.ElenestBookings || !id) return null;
    var list = window.ElenestBookings.listForUser(email);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function processBookingPatch(email, prev, patch) {
    if (!prev || !patch) return;
    var merged = {};
    for (var k in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, k)) merged[k] = prev[k];
    }
    for (var p in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, p)) merged[p] = patch[p];
    }

    if (patch.status !== undefined) {
      var newSt = normBookingStatus(patch.status);
      var oldSt = normBookingStatus(prev.status);
      if (newSt === "confirmed" && oldSt !== "confirmed") {
        notifyBookingConfirmed(email, merged);
        return;
      }
      if (newSt === "cancelled" && oldSt !== "cancelled") {
        notifyBookingCancelled(email, merged);
        return;
      }
    }

    if (patch.checkedInAt && !prev.checkedInAt) {
      notifyBookingUpdated(email, merged, "You have been checked in. Welcome to Elenest Resort!");
      return;
    }

    if (patch.checkedOutAt && !prev.checkedOutAt) {
      notifyBookingUpdated(email, merged, "You have checked out. We hope you enjoyed your stay!");
      return;
    }

    var fields = ["checkIn", "checkOut", "roomType", "cottageQty", "eventHall", "checkInTime", "checkOutTime", "paymentStatus"];
    var changed = false;
    for (var f = 0; f < fields.length; f++) {
      var key = fields[f];
      if (patch[key] !== undefined && String(patch[key] || "") !== String(prev[key] || "")) {
        changed = true;
        break;
      }
    }
    if (changed) {
      notifyBookingUpdated(email, merged, "Your reservation details have been updated.");
    }
  }

  function isRecentIso(iso, hours) {
    if (!iso) return false;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return Date.now() - t <= hours * 3600000;
  }

  function isIsoDateToday(iso) {
    if (!iso) return false;
    var d = String(iso).slice(0, 10);
    var now = new Date();
    var m = now.getMonth() + 1;
    var day = now.getDate();
    var stamp =
      now.getFullYear() +
      "-" +
      (m < 10 ? "0" : "") +
      m +
      "-" +
      (day < 10 ? "0" : "") +
      day;
    return d === stamp;
  }

  function staffRoomLabel(value) {
    var v = String(value || "").trim().toLowerCase();
    if (v === "couple") return "Couple room";
    if (v === "big") return "Big room";
    if (v === "small") return "Couple room";
    if (v === "none" || !v) return "No room";
    return v;
  }

  function staffLinkFor(role, kind, bookingId) {
    var bid = bookingId ? encodeURIComponent(String(bookingId)) : "";
    if (role === "admin") {
      if (kind === "payment_pending") {
        return bid
          ? "admin.html#section-payments?booking=" + bid
          : "admin.html#section-payments";
      }
      if (kind === "new_feedback") return "admin.html#section-sentiment";
      if (
        kind === "future_booking_7d" ||
        kind === "future_booking_3d" ||
        kind === "future_booking_1d" ||
        kind === "checkin_today" ||
        kind === "checkin_due"
      ) {
        return bid
          ? "admin.html#section-dashboard?booking=" + bid
          : "admin.html#section-dashboard";
      }
      return bid
        ? "admin.html#section-dashboard?booking=" + bid
        : "admin.html#section-dashboard";
    }
    if (role === "manager") {
      if (kind === "new_message") return "manager.html#section-messages";
      if (kind === "new_feedback") return "manager.html#section-dashboard";
      return "manager.html#section-manage";
    }
    if (kind === "checkout_due") return "reception.html#section-checkout";
    if (kind === "new_booking") return "reception.html#section-customer-record";
    return "reception.html#section-checkin";
  }

  function facilityLabelForStaff(b) {
    if (!b) return "Facility";
    var names = []
      .concat(b.roomCatalogNames || (b.roomCatalogName ? [b.roomCatalogName] : []))
      .concat(b.cottageCatalogNames || [])
      .concat(b.hallCatalogNames || (b.hallCatalogName ? [b.hallCatalogName] : []))
      .filter(Boolean);
    if (names.length) return names.join(", ");
    return staffRoomLabel(b.roomType);
  }

  function getAdminReminderEmailSentMap() {
    try {
      var raw = localStorage.getItem(STORAGE_ADMIN_REMINDER_EMAILS);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function markAdminReminderEmailSent(dedupKey) {
    if (!dedupKey) return;
    var map = getAdminReminderEmailSentMap();
    map[dedupKey] = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_ADMIN_REMINDER_EMAILS, JSON.stringify(map));
    } catch (e) {}
  }

  function sendAdminFutureBookingReminderEmail(adminEmail, booking, days, staffKind) {
    var to = normalizeEmail(adminEmail);
    if (!to || !booking || !booking.id) return Promise.resolve(null);
    var dayKey = String(booking.checkIn || "").slice(0, 10);
    var dedup = "admin_email_reminder:" + booking.id + ":" + dayKey + ":" + days;
    var sent = getAdminReminderEmailSentMap();
    if (sent[dedup]) return Promise.resolve({ skipped: true });

    var PF = window.ElenestPaymentFlow;
    var triplet = PF && typeof PF.statusTriplet === "function" ? PF.statusTriplet(booking) : null;
    var title =
      days === 0
        ? "Check-in Today"
        : "Upcoming booking in " + days + " day" + (days === 1 ? "" : "s");

    return fetch("../api/send-admin-booking-reminder.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to,
        title: title,
        name: booking.fullName || "Guest",
        check_in: booking.checkIn ? fmtDateLong(booking.checkIn) : "",
        check_out: booking.checkOut ? fmtDateLong(booking.checkOut) : "",
        facility: facilityLabelForStaff(booking),
        payment_status: triplet ? triplet.payment : "",
        booking_status: triplet ? triplet.booking : "",
        arrival_status: triplet ? triplet.arrival : "",
        booking_id: String(booking.id),
        days_before: days,
        staff_kind: staffKind || ""
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (res.ok && data && data.ok) {
            markAdminReminderEmailSent(dedup);
          }
          return data;
        }, function () {
          return null;
        });
      })
      .catch(function () {
        return null;
      });
  }

  function pushAdminFutureBookingReminders(email, role, b, guest) {
    if (role !== "admin") return;
    var PF = window.ElenestPaymentFlow;
    if (!PF || typeof PF.shouldSendFutureBookingReminders !== "function") return;
    if (!PF.shouldSendFutureBookingReminders(b)) return;
    var days =
      typeof PF.daysUntilCheckIn === "function" ? PF.daysUntilCheckIn(b) : daysUntil(b.checkIn);
    if (days === null || ADMIN_FUTURE_REMINDER_DAYS.indexOf(days) === -1) return;

    var staffKind =
      days === 0
        ? "checkin_today"
        : days === 7
          ? "future_booking_7d"
          : days === 3
            ? "future_booking_3d"
            : "future_booking_1d";
    var when = b.checkIn ? fmtDateLong(b.checkIn) : "the booking date";
    var room = facilityLabelForStaff(b);
    var title =
      days === 0
        ? "Check-in Today"
        : "Upcoming booking — " + days + " day" + (days === 1 ? "" : "s");
    var message =
      days === 0
        ? guest + " checks in today (" + room + "). Prepare for arrival — Arrival is still Not Arrived until you check them in."
        : guest +
          " has a confirmed stay on " +
          when +
          " (" +
          room +
          "). Reminder only — statuses are unchanged.";

    addStaffForUser(email, {
      staffKind: staffKind,
      title: title,
      message: message,
      bookingId: b.id,
      dedupKey: "staff_" + staffKind + ":" + b.id + ":" + String(b.checkIn).slice(0, 10),
      link: staffLinkFor(role, staffKind, b.id),
      createdAt: new Date().toISOString()
    });
    sendAdminFutureBookingReminderEmail(email, b, days, staffKind);
  }

  function addStaffForUser(email, notification) {
    if (!notification) return null;
    var meta = notification.meta && typeof notification.meta === "object" ? notification.meta : {};
    meta.audience = "staff";
    if (notification.staffKind) meta.staffKind = notification.staffKind;
    return addForUser(email, {
      type: persistableType({ type: notification.type, meta: meta }),
      title: notification.title,
      message: notification.message,
      bookingId: notification.bookingId || "",
      dedupKey: notification.dedupKey || "",
      link: notification.link || "",
      meta: meta,
      createdAt: notification.createdAt
    });
  }

  function listForStaff(email) {
    return listForUser(email).filter(function (n) {
      return n && n.meta && n.meta.audience === "staff";
    });
  }

  function countUnreadStaff(email) {
    return listForStaff(email).filter(function (n) {
      return n && !n.read;
    }).length;
  }

  function bookingAwaitingPayment(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isAwaitingPaymentVerification === "function") {
      return PF.isAwaitingPaymentVerification(b);
    }
    if (!b || b.paymentVerifiedAt || b.paymentRejectedAt) return false;
    var st = String(b.status || "").toLowerCase();
    return (
      st === "for verification" ||
      st === "pending payment verification" ||
      !!(b.paymentSubmittedAt || b.hasPaymentProof || b.paymentProof || b.paymentProofUrl)
    );
  }

  function bookingReadyForCheckIn(b) {
    var PF = window.ElenestPaymentFlow;
    if (PF && typeof PF.isReadyForReceptionCheckIn === "function") {
      return PF.isReadyForReceptionCheckIn(b);
    }
    if (!b || b.checkedInAt || b.checkedOutAt || isCancelledBooking(b)) return false;
    return isConfirmedBooking(b) || String(b.status || "").toLowerCase() === "reserved";
  }

  function scanStaffBookings(email, role) {
    var B = window.ElenestBookings;
    if (!B || typeof B.listLive !== "function") return;
    var rows = B.listLive();
    rows.forEach(function (row) {
      var b = row && row.booking;
      if (!b || !b.id || b.linkedFacilityBooking || b.parentBookingId) return;
      var guest = String(b.fullName || row.accountEmail || "Guest").trim() || "Guest";
      var when = b.checkIn ? fmtDateLong(b.checkIn) : "the selected dates";
      var room = staffRoomLabel(b.roomType);
      var created = b.submittedAt || b.createdAt || b.created_at || "";

      if (isRecentIso(created, 48) && !isCancelledBooking(b)) {
        addStaffForUser(email, {
          staffKind: "new_booking",
          title: "New reservation",
          message: guest + " reserved " + room + " starting " + when + ".",
          bookingId: b.id,
          dedupKey: "staff_new_booking:" + b.id,
          link: staffLinkFor(role, "new_booking", b.id),
          createdAt: created
        });
      }

      if (role === "admin" && bookingAwaitingPayment(b)) {
        addStaffForUser(email, {
          staffKind: "payment_pending",
          title: "Payment awaiting verification",
          message: guest + " submitted proof of payment. Review it in Payment Management.",
          bookingId: b.id,
          dedupKey: "staff_payment_pending:" + b.id,
          link: staffLinkFor(role, "payment_pending", b.id),
          createdAt: b.paymentSubmittedAt || created
        });
      }

      if (
        (role === "manager" || role === "receptionist") &&
        b.paymentVerifiedAt &&
        isRecentIso(b.paymentVerifiedAt, 24)
      ) {
        addStaffForUser(email, {
          staffKind: "payment_verified",
          title: "Payment verified",
          message: "The owner verified payment for " + guest + "'s reservation.",
          bookingId: b.id,
          dedupKey: "staff_payment_verified:" + b.id,
          link: staffLinkFor(role, "payment_verified", b.id),
          createdAt: b.paymentVerifiedAt
        });
      }

      if (
        (role === "admin" || role === "manager") &&
        isCancelledBooking(b) &&
        isRecentIso(b.cancelledAt || b.updatedAt || created, 48)
      ) {
        addStaffForUser(email, {
          staffKind: "booking_cancelled",
          title: "Reservation cancelled",
          message: guest + "'s reservation starting " + when + " was cancelled.",
          bookingId: b.id,
          dedupKey: "staff_booking_cancelled:" + b.id,
          link: staffLinkFor(role, "booking_cancelled", b.id),
          createdAt: b.cancelledAt || b.updatedAt || created
        });
      }

      // Admin future booking reminders (7 / 3 / 1 day + Check-in Today). Never changes statuses.
      pushAdminFutureBookingReminders(email, role, b, guest);

      if (
        (role === "receptionist" || role === "admin") &&
        bookingReadyForCheckIn(b) &&
        isIsoDateToday(b.checkIn)
      ) {
        addStaffForUser(email, {
          staffKind: "checkin_due",
          title: "Check-in due today",
          message: guest + " is scheduled to check in today (" + room + ").",
          bookingId: b.id,
          dedupKey: "staff_checkin_due:" + b.id + ":" + String(b.checkIn).slice(0, 10),
          link: staffLinkFor(role, "checkin_due", b.id),
          createdAt: b.checkIn
        });
      }

      if (role === "receptionist" && b.checkedInAt && !b.checkedOutAt && isIsoDateToday(b.checkOut)) {
        addStaffForUser(email, {
          staffKind: "checkout_due",
          title: "Check-out due today",
          message: guest + " is scheduled to check out today.",
          bookingId: b.id,
          dedupKey: "staff_checkout_due:" + b.id + ":" + String(b.checkOut || "").slice(0, 10),
          link: staffLinkFor(role, "checkout_due", b.id),
          createdAt: b.checkOut
        });
      }
    });
  }

  function scanStaffMessages(email, role) {
    if (role !== "manager" && role !== "admin") return;
    var CM = window.ElenestContactMessages;
    if (!CM || typeof CM.listAll !== "function") return;
    CM.listAll().forEach(function (msg) {
      if (!msg || !msg.id) return;
      if (msg.reply || msg.repliedAt) return;
      if (!isRecentIso(msg.createdAt, 168)) return;
      var preview = String(msg.message || "").trim();
      if (preview.length > 120) preview = preview.slice(0, 120) + "…";
      addStaffForUser(email, {
        staffKind: "new_message",
        title: "New customer message",
        message: (msg.name || "Guest") + (preview ? ": " + preview : " sent a message."),
        dedupKey: "staff_new_message:" + msg.id,
        link: staffLinkFor(role, "new_message"),
        meta: { messageId: msg.id },
        createdAt: msg.createdAt
      });
    });
  }

  function scanStaffFeedback(email, role) {
    if (role !== "admin" && role !== "manager") return;
    var F = window.ElenestGuestFeedback;
    if (!F || typeof F.listLive !== "function") return;
    F.listLive().forEach(function (fb) {
      if (!fb || !fb.id || !isRecentIso(fb.createdAt, 168)) return;
      var stars = Number(fb.stars || fb.rating || 0);
      var comment = String(fb.comment || "").trim();
      if (comment.length > 110) comment = comment.slice(0, 110) + "…";
      addStaffForUser(email, {
        staffKind: "new_feedback",
        title: "New guest review",
        message:
          (fb.name || "Guest") +
          " left a " +
          (stars ? stars + "-star " : "") +
          "review" +
          (comment ? ": " + comment : "."),
        bookingId: fb.bookingId || "",
        dedupKey: "staff_new_feedback:" + fb.id,
        link: staffLinkFor(role, "new_feedback"),
        createdAt: fb.createdAt
      });
    });
  }

  function normalizeStaffRole(role) {
    var r = String(role || "").trim().toLowerCase();
    if (r === "reception") return "receptionist";
    if (r === "administrator" || r === "owner") return "admin";
    return r;
  }

  function loadStaffDirectory() {
    if (staffDirectoryCache && Date.now() - staffDirectoryAt < 60000) {
      return Promise.resolve(staffDirectoryCache);
    }
    var empty = { admin: [], manager: [], receptionist: [] };
    var sb = getSb();
    if (!sb) {
      if (staffInboxEmail && empty[staffInboxRole]) empty[staffInboxRole].push(staffInboxEmail);
      return Promise.resolve(empty);
    }
    return sb
      .from("profiles")
      .select("email, role")
      .then(function (res) {
        var map = { admin: [], manager: [], receptionist: [] };
        (res.data || []).forEach(function (row) {
          var r = normalizeStaffRole(row && row.role);
          var em = normalizeEmail(row && row.email);
          if (!em || !map[r]) return;
          if (map[r].indexOf(em) === -1) map[r].push(em);
        });
        if (staffInboxEmail && map[staffInboxRole] && map[staffInboxRole].indexOf(staffInboxEmail) === -1) {
          map[staffInboxRole].push(staffInboxEmail);
        }
        staffDirectoryCache = map;
        staffDirectoryAt = Date.now();
        return map;
      })
      .catch(function () {
        if (staffInboxEmail && empty[staffInboxRole]) empty[staffInboxRole].push(staffInboxEmail);
        return empty;
      });
  }

  function processAutomaticForStaff(email, role) {
    var key = normalizeEmail(email);
    var r = normalizeStaffRole(role);
    if (!key || (r !== "admin" && r !== "manager" && r !== "receptionist")) return;
    if (getSb() && !inboxLoaded[key]) {
      loadInboxFromSupabase(key).then(function () {
        processAutomaticForStaff(key, r);
      });
      return;
    }
    scanStaffBookings(key, r);
    scanStaffMessages(key, r);
    scanStaffFeedback(key, r);
  }

  function processAutomaticForAllStaff() {
    return loadStaffDirectory().then(function (map) {
      ["admin", "manager", "receptionist"].forEach(function (role) {
        (map[role] || []).forEach(function (em) {
          processAutomaticForStaff(em, role);
        });
      });
      if (staffInboxEmail && staffInboxRole) {
        processAutomaticForStaff(staffInboxEmail, staffInboxRole);
      }
    });
  }

  function scheduleStaffScan() {
    if (!staffInboxEmail || !staffInboxRole) return;
    if (staffScanTimer) clearTimeout(staffScanTimer);
    staffScanTimer = setTimeout(function () {
      staffScanTimer = null;
      processAutomaticForAllStaff();
    }, 400);
  }

  function stopInboxRealtime() {
    var sb = getSb();
    if (notifRealtimeChannel && sb) {
      try {
        sb.removeChannel(notifRealtimeChannel);
      } catch (e) {}
    }
    notifRealtimeChannel = null;
    if (notifPollTimer) {
      clearInterval(notifPollTimer);
      notifPollTimer = null;
    }
  }

  function subscribeInboxRealtime(email) {
    var key = normalizeEmail(email);
    var sb = getSb();
    if (!sb || !key) return;
    stopInboxRealtime();
    try {
      notifRealtimeChannel = sb.channel("elenest-notif-inbox-" + key.replace(/[^a-z0-9]+/gi, "-"));
      notifRealtimeChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: "user_email=eq." + key
        },
        function () {
          loadInboxFromSupabase(key);
        }
      );
      notifRealtimeChannel.subscribe();
    } catch (e) {
      notifRealtimeChannel = null;
    }
    notifPollTimer = setInterval(function () {
      if (typeof document !== "undefined" && document.hidden) return;
      if (getSb()) loadInboxFromSupabase(key);
      if (staffInboxEmail && staffInboxRole) scheduleStaffScan();
    }, 15000);
  }

  function bindStaffInbox(email, role) {
    var key = normalizeEmail(email);
    var r = String(role || "").trim().toLowerCase();
    if (r === "reception") r = "receptionist";
    if (r === "administrator") r = "admin";
    staffInboxEmail = key;
    staffInboxRole = r;
    if (key) {
      subscribeInboxRealtime(key);
      loadInboxFromSupabase(key).then(function () {
        processAutomaticForStaff(key, r);
      });
    }
  }

  function hookStaffLiveEvents() {
    if (hookStaffLiveEvents._bound) return;
    hookStaffLiveEvents._bound = true;
    window.addEventListener("elenest-bookings-updated", scheduleStaffScan);
    window.addEventListener("elenest-contact-messages-updated", scheduleStaffScan);
    window.addEventListener("elenest-feedback-updated", scheduleStaffScan);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !staffInboxEmail) return;
      loadInboxFromSupabase(staffInboxEmail);
      scheduleStaffScan();
    });
  }

  function hookBookingUpdates() {
    var B = window.ElenestBookings;
    if (!B || B._elenestNotifHooked || typeof B.updateFields !== "function") return;
    var original = B.updateFields;
    B.updateFields = function (accountEmail, id, patch) {
      var prev = findBooking(accountEmail, id);
      var result = original.call(B, accountEmail, id, patch);
      if (result && typeof result.then === "function") {
        return result.then(function (ok) {
          if (ok && prev) processBookingPatch(accountEmail, prev, patch);
          return ok;
        });
      }
      if (result && prev) processBookingPatch(accountEmail, prev, patch);
      return result;
    };
    B._elenestNotifHooked = true;
  }

  function saveManagerPromotion(record) {
    return saveBroadcast(Object.assign({}, record, { kind: "promotion" }));
  }

  function saveManagerEvent(record) {
    return Promise.resolve(saveBroadcast(Object.assign({}, record, { kind: "event" }))).then(function (saved) {
      try {
        if (saved && saved.title) {
          var activities = [];
          var raw = localStorage.getItem("elenest_activities");
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) activities = parsed;
          }
          var entry = { title: saved.title, image: "../Images/gallery-2.png" };
          var found = false;
          for (var i = 0; i < activities.length; i++) {
            if (activities[i] && activities[i].title === saved.title) {
              activities[i] = entry;
              found = true;
              break;
            }
          }
          if (!found) activities.unshift(entry);
          localStorage.setItem("elenest_activities", JSON.stringify(activities.slice(0, 10)));
        }
      } catch (e) {}
      return saved;
    });
  }

  function listManagerPromotions() {
    return listBroadcasts("promotion");
  }

  function listManagerEvents() {
    return listBroadcasts("event");
  }

  hookBookingUpdates();
  hookStaffLiveEvents();

  loadBroadcastsFromSupabase();

  if (window.ElenestAuth && window.ElenestAuth.ready) {
    window.ElenestAuth.ready.then(function (user) {
      if (user && user.email) {
        loadInboxFromSupabase(user.email).then(function () {
          processAutomaticForUser(user.email);
        });
        subscribeInboxRealtime(user.email);
      }
    });
  }

  window.ElenestNotifications = {
    TYPES: TYPES,
    TYPE_LABELS: TYPE_LABELS,
    STAFF_KIND_LABELS: STAFF_KIND_LABELS,
    listForUser: listForUser,
    listForStaff: listForStaff,
    getById: getById,
    countUnread: countUnread,
    countUnreadStaff: countUnreadStaff,
    addForUser: addForUser,
    addStaffForUser: addStaffForUser,
    markAsRead: markAsRead,
    markAsUnread: markAsUnread,
    markAllAsRead: markAllAsRead,
    clearForUser: clearForUser,
    clearAllForUser: clearAllForUser,
    notifyPaymentApproved: notifyPaymentApproved,
    notifyPaymentRejected: notifyPaymentRejected,
    notifyBookingConfirmed: notifyBookingConfirmed,
    notifyBookingUpdated: notifyBookingUpdated,
    notifyBookingCancelled: notifyBookingCancelled,
    notifySelectAnother: notifySelectAnother,
    processAutomaticForUser: processAutomaticForUser,
    processAutomaticForStaff: processAutomaticForStaff,
    processAutomaticForAllStaff: processAutomaticForAllStaff,
    bindStaffInbox: bindStaffInbox,
    saveManagerPromotion: saveManagerPromotion,
    saveManagerEvent: saveManagerEvent,
    listManagerPromotions: listManagerPromotions,
    listManagerEvents: listManagerEvents,
    deleteManagerItem: deleteBroadcast,
    getManagerItemById: getBroadcastById,
    getGuestRecipientEmails: getGuestRecipientEmails,
    getTypeLabel: getTypeLabel
  };
})();
