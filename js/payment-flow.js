(function () {
  var HOLD_HOURS = 3;

  var STATUS = {
    PENDING: "Pending",
    FOR_VERIFICATION: "For Verification",
    CONFIRMED: "Confirmed",
    RESERVED: "Reserved",
    CHECKED_IN: "Checked In",
    CHECKED_OUT: "Checked Out",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
    NO_SHOW: "No Show",
    COMPLETED: "Completed"
  };

  function normalizePaymentType(v) {
    var s = String(v || "down").trim().toLowerCase();
    return s === "full" ? "full" : "down";
  }

  function normalizeArrivalStatus(v) {
    var s = String(v || "not_arrived").trim().toLowerCase().replace(/\s+/g, "_");
    if (s === "in_transit" || s === "in-transit") return "in_transit";
    // Never treat payment-approved wording as arrived.
    if (s === "arrived") return "arrived";
    if (s === "no_show" || s === "noshow") return "no_show";
    return "not_arrived";
  }

  function bookingCheckInIso(booking) {
    return String((booking && booking.checkIn) || "").slice(0, 10);
  }

  function isFutureBooking(booking) {
    var day = bookingCheckInIso(booking);
    if (!day) return false;
    return day > todayIsoLocal();
  }

  function isCheckInDateToday(booking) {
    var day = bookingCheckInIso(booking);
    return !!(day && day === todayIsoLocal());
  }

  function futureBookingLabel(booking) {
    var day = bookingCheckInIso(booking);
    if (!day) return "Future Booking";
    try {
      var d = new Date(day + "T12:00:00");
      if (isNaN(d.getTime())) return "Future Booking – " + day;
      var label = d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      });
      return "Future Booking – " + label;
    } catch (e) {
      return "Future Booking – " + day;
    }
  }

  /** Payment Status (canonical display): For Verification / Approved / Rejected */
  function paymentDisplayLabel(booking) {
    if (!booking) return "For Verification";
    if (
      booking.paymentRejectedAt ||
      booking.payment_rejected_at ||
      normalizeBookingStatus(booking.status) === STATUS.REJECTED
    ) {
      return "Rejected";
    }
    var pay = String(booking.paymentStatus || "").toLowerCase();
    if (pay.indexOf("reject") !== -1) return "Rejected";
    if (isAwaitingPaymentVerification(booking)) return "For Verification";
    if (booking.paymentVerifiedAt || booking.payment_verified_at || isPaymentApproved(booking)) {
      return "Approved";
    }
    if (pay.indexOf("for verification") !== -1 || pay.indexOf("pending") !== -1) {
      return "For Verification";
    }
    return "For Verification";
  }

  /** Booking Status (canonical display): Pending / Confirmed / Cancelled / Completed */
  function bookingDisplayStatus(booking) {
    var st = normalizeBookingStatus(booking && booking.status);
    if (st === STATUS.CANCELLED || st === STATUS.REJECTED || st === STATUS.NO_SHOW) {
      return "Cancelled";
    }
    if (st === STATUS.CHECKED_OUT || st === STATUS.COMPLETED) return "Completed";
    if (st === STATUS.PENDING || st === STATUS.FOR_VERIFICATION) return "Pending";
    // Reserved / Confirmed / Checked In stay as Confirmed until checkout completes the stay.
    return "Confirmed";
  }

  function arrivalDisplayLabel(booking) {
    if (!booking) return "Not Arrived";
    if (booking.checkedInAt || normalizeArrivalStatus(booking.arrivalStatus) === "arrived") {
      return "Arrived";
    }
    if (normalizeArrivalStatus(booking.arrivalStatus) === "no_show") return "No Show";
    if (normalizeArrivalStatus(booking.arrivalStatus) === "in_transit") return "In Transit";
    return "Not Arrived";
  }

  function statusTriplet(booking) {
    return {
      payment: paymentDisplayLabel(booking),
      booking: bookingDisplayStatus(booking),
      arrival: arrivalDisplayLabel(booking)
    };
  }

  /**
   * Check-in / Arrived is only allowed on the booking date, within a window
   * around the scheduled arrival time (2h early through end of check-in day).
   */
  function isWithinCheckInWindow(booking) {
    if (!booking || !bookingCheckInIso(booking)) return false;
    if (!isCheckInDateToday(booking)) return false;
    var start = parseTimeOnDate(booking.checkIn, booking.checkInTime || "12:00 AM");
    var end = parseTimeOnDate(booking.checkIn, "11:59 PM");
    var now = Date.now();
    if (start && !isNaN(start.getTime())) {
      var windowStart = new Date(start.getTime() - 2 * 60 * 60 * 1000);
      if (now < windowStart.getTime()) return false;
    }
    if (end && !isNaN(end.getTime()) && now > end.getTime()) return false;
    return true;
  }

  function canMarkGuestArrived(booking) {
    if (!booking) return false;
    if (booking.checkedInAt) return false;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "arrived") return false;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "no_show") return false;
    if (booking.paymentRejectedAt) return false;
    if (!isPaymentApproved(booking) && !booking.paymentVerifiedAt) return false;
    var st = normalizeBookingStatus(booking.status);
    if (
      st === STATUS.CANCELLED ||
      st === STATUS.REJECTED ||
      st === STATUS.NO_SHOW ||
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED ||
      st === STATUS.PENDING ||
      st === STATUS.FOR_VERIFICATION
    ) {
      return false;
    }
    // Active 3-hour hold: Admin may mark Arrived immediately (that is the purpose of monitoring).
    if (isActiveDownPaymentHold(booking)) return true;
    return isWithinCheckInWindow(booking);
  }

  function normalizeBookingStatus(st) {
    var s = String(st || STATUS.PENDING).trim().toLowerCase();
    if (s === "for verification" || s === "pending payment verification") return STATUS.FOR_VERIFICATION;
    if (s === "confirmed" || s === "approved" || s === "active") return STATUS.CONFIRMED;
    if (s === "reserved") return STATUS.RESERVED;
    if (s === "checked in" || s === "checked_in" || s === "checked-in" || s === "in_house" || s === "in-house") {
      return STATUS.CHECKED_IN;
    }
    if (s === "checked out" || s === "checked_out" || s === "checked-out") return STATUS.CHECKED_OUT;
    if (s === "rejected") return STATUS.REJECTED;
    if (s === "no show" || s === "no_show" || s === "noshow") return STATUS.NO_SHOW;
    if (s === "cancelled" || s === "canceled") return STATUS.CANCELLED;
    if (s === "completed") return STATUS.CHECKED_OUT;
    return STATUS.PENDING;
  }

  function isFinalPaymentStatus(booking) {
    if (!booking) return false;
    if (booking.paymentVerifiedAt || booking.paymentRejectedAt) return true;
    var st = normalizeBookingStatus(booking.status);
    return (
      st === STATUS.CONFIRMED ||
      st === STATUS.RESERVED ||
      st === STATUS.CHECKED_IN ||
      st === STATUS.CHECKED_OUT ||
      st === STATUS.REJECTED ||
      st === STATUS.CANCELLED ||
      st === STATUS.NO_SHOW ||
      st === STATUS.COMPLETED
    );
  }

  function hasSubmittedReceipt(booking) {
    if (!booking) return false;
    return !!(
      booking.paymentProof ||
      booking.paymentProofUrl ||
      booking.paymentSubmittedAt ||
      booking.hasPaymentProof
    );
  }

  function isAwaitingPaymentVerification(booking) {
    if (!booking) return false;
    if (booking.paymentVerifiedAt || booking.paymentRejectedAt) return false;
    if (!hasSubmittedReceipt(booking)) return false;
    var st = normalizeBookingStatus(booking.status);
    if (st === STATUS.FOR_VERIFICATION) return true;
    if (st === STATUS.PENDING) return true;
    var raw = String(booking.status || "").trim().toLowerCase();
    if (raw === "pending payment verification") return true;
    return false;
  }

  /**
   * Admin-verified bookings eligible for the reception check-in queue
   * (includes future bookings — perform action is gated separately).
   */
  function isEligibleForCheckInQueue(booking) {
    if (!booking) return false;
    if (booking.checkedInAt || booking.checkedOutAt) return false;
    if (isAwaitingPaymentVerification(booking)) return false;
    // Active 3-hour holds stay in Admin monitoring until Admin clicks Arrive.
    if (isActiveDownPaymentHold(booking)) return false;
    var st = normalizeBookingStatus(booking.status);
    if (
      st === STATUS.PENDING ||
      st === STATUS.FOR_VERIFICATION ||
      st === STATUS.CANCELLED ||
      st === STATUS.REJECTED ||
      st === STATUS.NO_SHOW ||
      st === STATUS.CHECKED_IN ||
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED
    ) {
      return false;
    }
    if (st !== STATUS.CONFIRMED && st !== STATUS.RESERVED) return false;
    if (booking.paymentRejectedAt) return false;
    if (booking.paymentVerifiedAt) return true;
    if (st === STATUS.CONFIRMED || st === STATUS.RESERVED) return true;
    return false;
  }

  /** Admin-verified bookings ready for reception Complete Check-In today. */
  function isReadyForReceptionCheckIn(booking) {
    if (!isEligibleForCheckInQueue(booking)) return false;
    // Never allow check-in before the booking date / outside the check-in window.
    return isWithinCheckInWindow(booking);
  }

  function isSlotLockedStatus(st) {
    var s = normalizeBookingStatus(st);
    return (
      s === STATUS.CONFIRMED ||
      s === STATUS.RESERVED ||
      s === STATUS.CHECKED_IN
    );
  }

  function bookingBlocksCalendarSlot(booking) {
    if (!booking) return false;
    if (!booking.checkIn || !booking.checkOut) return false;
    if (booking.paymentRejectedAt) return false;

    if (booking.slotLocked === true) {
      var stLocked = normalizeBookingStatus(booking.status);
      if (
        stLocked === STATUS.REJECTED ||
        stLocked === STATUS.CANCELLED ||
        stLocked === STATUS.NO_SHOW ||
        stLocked === STATUS.CHECKED_OUT ||
        stLocked === STATUS.COMPLETED
      ) {
        return false;
      }
      if (stLocked === STATUS.RESERVED && normalizePaymentType(booking.paymentType) === "down") {
        if (booking.holdExpiresAt && isHoldExpired(booking)) return false;
      }
      if (stLocked === STATUS.FOR_VERIFICATION && normalizePaymentType(booking.paymentType) === "down") {
        if (booking.holdExpiresAt && isHoldExpired(booking)) return false;
      }
      return true;
    }

    var st = normalizeBookingStatus(booking.status);
    var type = normalizePaymentType(booking.paymentType);

    if (
      st === STATUS.REJECTED ||
      st === STATUS.CANCELLED ||
      st === STATUS.NO_SHOW ||
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED
    ) {
      return false;
    }

    if (st === STATUS.CHECKED_IN || st === STATUS.CONFIRMED || st === STATUS.RESERVED) {
      if (type === "down" && st === STATUS.RESERVED && isHoldExpired(booking)) return false;
      return true;
    }

    if (st === STATUS.FOR_VERIFICATION) {
      if (type === "down") {
        if (booking.holdExpiresAt && isHoldExpired(booking)) return false;
        return true;
      }
      return type === "full";
    }

    if (st === STATUS.PENDING) {
      if (booking.holdExpiresAt && isHoldExpired(booking)) return false;
      return true;
    }

    return false;
  }

  function occupiesCalendarSlot(st) {
    return bookingBlocksCalendarSlot({ status: st });
  }

  function amountDueNow(paymentType, pricing) {
    var type = normalizePaymentType(paymentType);
    var subtotal = pricing && pricing.subtotal != null ? Number(pricing.subtotal) : 0;
    var down = pricing && pricing.down != null ? Number(pricing.down) : Math.round(subtotal * 0.2);
    return type === "full" ? subtotal : down;
  }

  function holdExpiresAtFromNow(fromIso) {
    var base = fromIso ? new Date(fromIso) : new Date();
    if (isNaN(base.getTime())) base = new Date();
    return new Date(base.getTime() + HOLD_HOURS * 60 * 60 * 1000).toISOString();
  }

  function isHoldExpired(booking) {
    if (!booking || !booking.holdExpiresAt) return false;
    var deadline = new Date(booking.holdExpiresAt);
    if (isNaN(deadline.getTime())) return false;
    return Date.now() > deadline.getTime();
  }

  function formatTimerRemaining(deadlineIso) {
    if (!deadlineIso) return "—";
    var ms = new Date(deadlineIso).getTime() - Date.now();
    if (isNaN(ms)) return "—";
    if (ms <= 0) return "Expired";
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    function pad(n) {
      return n < 10 ? "0" + n : String(n);
    }
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  function arrivalStatusLabel(status) {
    var s = normalizeArrivalStatus(status);
    if (s === "in_transit") return "In Transit";
    if (s === "arrived") return "Arrived";
    if (s === "no_show") return "No Show";
    return "Not Arrived";
  }

  /** True when reminder system should keep sending (not Completed/Cancelled). */
  function shouldSendFutureBookingReminders(booking) {
    if (!booking || !booking.id || !booking.checkIn) return false;
    var display = bookingDisplayStatus(booking);
    if (display === "Cancelled" || display === "Completed") return false;
    if (!isPaymentApproved(booking) && !booking.paymentVerifiedAt) return false;
    var day = bookingCheckInIso(booking);
    if (!day) return false;
    // Reminders for upcoming/today confirmed stays that are not yet completed.
    return day >= todayIsoLocal();
  }

  function daysUntilCheckIn(booking) {
    var day = bookingCheckInIso(booking);
    if (!day) return null;
    try {
      var target = new Date(day + "T12:00:00");
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var then = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      return Math.round((then.getTime() - today.getTime()) / 86400000);
    } catch (e) {
      return null;
    }
  }

  function paymentTypeLabel(type) {
    return normalizePaymentType(type) === "full" ? "Full Payment" : "Down Payment";
  }

  function buildCustomerSubmitPatch(paymentType, submittedAt) {
    var type = normalizePaymentType(paymentType);
    var at = submittedAt || new Date().toISOString();
    return {
      status: STATUS.FOR_VERIFICATION,
      paymentStatus: STATUS.FOR_VERIFICATION,
      paymentSubmittedAt: at,
      // Do not start any 3-hour clock on submit/upload — only after Admin verifies.
      verificationExpiresAt: null,
      holdExpiresAt: null,
      verificationStage: "awaiting_admin",
      slotLocked: true,
      workflow: "pending_payment",
      paymentType: type,
      // Payment submit never implies arrival.
      arrivalStatus: "not_arrived"
    };
  }

  function buildVerificationApprovePatch(booking, adminEmail) {
    var type = normalizePaymentType(booking && booking.paymentType);
    var verifiedAt = new Date().toISOString();
    var admin = adminEmail || "";
    var total = booking && booking.totalEstimate != null ? Number(booking.totalEstimate) : 0;
    var paid =
      booking && booking.amountPaid != null
        ? Number(booking.amountPaid)
        : booking && booking.amountDown != null
          ? Number(booking.amountDown)
          : 0;
    var future = isFutureBooking(booking);

    if (type === "full") {
      return {
        status: STATUS.CONFIRMED,
        paymentVerifiedAt: verifiedAt,
        paymentVerifiedBy: admin,
        paymentStatus: "Fully Paid",
        paymentType: "full",
        amountPaid: total,
        balanceDue: 0,
        nonRefundable: true,
        slotLocked: true,
        holdExpiresAt: null,
        verificationExpiresAt: null,
        // Payment approval must NEVER mark Arrived.
        arrivalStatus: "not_arrived",
        verificationStage: "approved",
        workflow: "confirmed"
      };
    }

    // Down payment: start the 3-hour hold only when check-in is today.
    // Future bookings stay Confirmed + Not Arrived (timer activates on the booking date).
    if (future) {
      return {
        status: STATUS.CONFIRMED,
        paymentVerifiedAt: verifiedAt,
        paymentVerifiedBy: admin,
        paymentStatus: "Down Payment Received",
        paymentType: "down",
        amountPaid: paid,
        balanceDue: Math.max(0, total - paid),
        nonRefundable: false,
        slotLocked: true,
        holdExpiresAt: null,
        holdDeferred: true,
        verificationExpiresAt: null,
        arrivalStatus: "not_arrived",
        verificationStage: "approved",
        workflow: "confirmed"
      };
    }

    return {
      status: STATUS.RESERVED,
      paymentVerifiedAt: verifiedAt,
      paymentVerifiedBy: admin,
      paymentStatus: "Down Payment Received",
      paymentType: "down",
      amountPaid: paid,
      balanceDue: Math.max(0, total - paid),
      nonRefundable: false,
      slotLocked: true,
      holdExpiresAt: holdExpiresAtFromNow(verifiedAt),
      holdDeferred: false,
      verificationExpiresAt: null,
      arrivalStatus: "not_arrived",
      verificationStage: "approved",
      workflow: "approved"
    };
  }

  /** Activate deferred 3-hour holds on the booking/check-in date (does not mark Arrived). */
  function buildActivateDeferredHoldPatch(fromIso) {
    var at = fromIso || new Date().toISOString();
    return {
      status: STATUS.RESERVED,
      holdExpiresAt: holdExpiresAtFromNow(at),
      holdDeferred: false,
      arrivalStatus: "not_arrived",
      workflow: "approved"
    };
  }

  function shouldActivateDeferredHold(booking) {
    if (!booking) return false;
    if (normalizePaymentType(booking.paymentType) !== "down") return false;
    // Only explicit deferred future approvals — never every booking missing a timer.
    if (booking.holdDeferred !== true && booking.hold_deferred !== true) return false;
    if (!booking.paymentVerifiedAt && !booking.payment_verified_at) return false;
    if (booking.paymentRejectedAt) return false;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "arrived" || booking.checkedInAt) return false;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "no_show") return false;
    var st = normalizeBookingStatus(booking.status);
    if (st !== STATUS.CONFIRMED && st !== STATUS.RESERVED) return false;
    if (booking.holdExpiresAt && !isHoldExpired(booking)) return false;
    if (!isCheckInDateToday(booking)) return false;
    if (isActiveDownPaymentHold(booking)) return false;
    return true;
  }

  function buildVerificationRejectPatch(booking, adminEmail, reason) {
    return {
      status: STATUS.REJECTED,
      paymentRejectedAt: new Date().toISOString(),
      paymentRejectedBy: adminEmail || "",
      paymentRejectionReason: reason || "",
      paymentStatus: STATUS.REJECTED,
      paymentVerifiedAt: null,
      paymentVerifiedBy: null,
      slotLocked: false,
      holdExpiresAt: null,
      verificationExpiresAt: null,
      verificationStage: "rejected",
      workflow: "rejected"
    };
  }

  function buildNoShowPatch() {
    return {
      status: STATUS.NO_SHOW,
      noShowAt: new Date().toISOString(),
      paymentStatus: "No Show — reservation cancelled",
      slotLocked: false,
      holdExpiresAt: null,
      arrivalStatus: "no_show",
      workflow: "cancelled"
    };
  }

  function buildExpiredHoldPatch() {
    return {
      status: STATUS.CANCELLED,
      noShowAt: new Date().toISOString(),
      paymentStatus: "Hold expired — reservation cancelled",
      slotLocked: false,
      holdExpiresAt: null,
      arrivalStatus: "no_show",
      workflow: "cancelled"
    };
  }

  function buildArrivalCheckInPatch(adminEmail) {
    // Admin marks guest arrived / ready — does NOT change Payment Status.
    // Reception still does Complete Check-In.
    return {
      status: STATUS.CONFIRMED,
      arrivalStatus: "arrived",
      holdExpiresAt: null,
      holdDeferred: false,
      slotLocked: true,
      workflow: "confirmed",
      arrivedMarkedAt: new Date().toISOString(),
      arrivedMarkedBy: adminEmail || ""
    };
  }

  /** Receptionist Complete Check-In — Arrival becomes Arrived; payment stays Approved. */
  function buildCompleteCheckInPatch(staffEmail) {
    return {
      status: STATUS.CHECKED_IN,
      arrivalStatus: "arrived",
      checkedInAt: new Date().toISOString(),
      checkedInBy: staffEmail || "",
      holdExpiresAt: null,
      holdDeferred: false,
      slotLocked: true,
      workflow: "checked_in"
    };
  }

  /** Receptionist Complete Check-Out */
  function buildCompleteCheckOutPatch(staffEmail) {
    return {
      status: STATUS.CHECKED_OUT,
      checkedOutAt: new Date().toISOString(),
      checkedOutBy: staffEmail || "",
      paymentStatus: "Checked out — stay completed",
      slotLocked: false,
      holdExpiresAt: null,
      completedAt: new Date().toISOString(),
      workflow: "checked_out"
    };
  }

  function parseTimeOnDate(isoDate, timeStr) {
    if (!isoDate) return null;
    var raw = String(timeStr || "12:00 PM").trim();
    var m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) {
      return new Date(isoDate + "T23:59:59");
    }
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var ap = (m[3] || "PM").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return new Date(
      isoDate +
        "T" +
        (h < 10 ? "0" : "") +
        h +
        ":" +
        (min < 10 ? "0" : "") +
        min +
        ":00"
    );
  }

  function getCheckoutDeadline(booking) {
    if (!booking || !booking.checkOut) return null;
    var time = booking.checkOutTime;
    if (!time) {
      // Same-day stays default to evening; overnight stays default to noon checkout.
      if (booking.checkIn && String(booking.checkIn).slice(0, 10) === String(booking.checkOut).slice(0, 10)) {
        time = "10:00 PM";
      } else {
        time = "12:00 PM";
      }
    }
    return parseTimeOnDate(booking.checkOut, time);
  }

  function todayIsoLocal() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return (
      d.getFullYear() +
      "-" +
      (m < 10 ? "0" : "") +
      m +
      "-" +
      (day < 10 ? "0" : "") +
      day
    );
  }

  function hasStayPeriodEnded(booking) {
    var deadline = getCheckoutDeadline(booking);
    if (!deadline || isNaN(deadline.getTime())) return false;
    return Date.now() >= deadline.getTime();
  }

  /** Checked-in guests whose stay end date/time has passed → Check-Out page. */
  function isReadyForReceptionCheckOut(booking) {
    if (!booking) return false;
    if (booking.checkedOutAt) return false;
    var st = normalizeBookingStatus(booking.status);
    if (
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED ||
      st === STATUS.CANCELLED ||
      st === STATUS.REJECTED ||
      st === STATUS.NO_SHOW
    ) {
      return false;
    }
    var checkedIn = !!booking.checkedInAt || st === STATUS.CHECKED_IN;
    if (!checkedIn) return false;

    // Never move to Check-Out before the reservation's check-out DATE.
    var outDay = String(booking.checkOut || "").slice(0, 10);
    var today = todayIsoLocal();
    if (outDay && outDay > today) return false;

    // Stay end date/time must have passed.
    if (!hasStayPeriodEnded(booking)) return false;

    // Avoid instant jump right after Complete Check-In (clock skew / same-day defaults).
    if (booking.checkedInAt) {
      var checkedAt = new Date(booking.checkedInAt).getTime();
      if (!isNaN(checkedAt) && Date.now() - checkedAt < 5 * 60 * 1000) {
        // Only allow early if checkout day is already strictly in the past.
        if (!outDay || outDay >= today) return false;
      }
    }

    return true;
  }

  /** Still in-house (checked in, stay not yet ended). */
  function isInHouseGuest(booking) {
    if (!booking) return false;
    if (booking.checkedOutAt) return false;
    var st = normalizeBookingStatus(booking.status);
    if (
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED ||
      st === STATUS.CANCELLED ||
      st === STATUS.REJECTED ||
      st === STATUS.NO_SHOW
    ) {
      return false;
    }
    if (!(booking.checkedInAt || st === STATUS.CHECKED_IN)) return false;
    return !isReadyForReceptionCheckOut(booking);
  }

  // Do not auto-finalize stays — receptionist Complete Check-Out owns that step.
  function shouldAutoCompleteCheckout() {
    return false;
  }

  function buildCheckoutCompletePatch(staffEmail) {
    return buildCompleteCheckOutPatch(staffEmail);
  }

  function downPaymentHoldDeadline(booking) {
    if (!booking) return null;
    if (normalizePaymentType(booking.paymentType) !== "down") return null;
    if (booking.paymentRejectedAt) return null;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "arrived" || booking.checkedInAt) return null;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "no_show") return null;
    // Hold exists only after Admin verification.
    if (!booking.paymentVerifiedAt && !booking.payment_verified_at) return null;
    // Future bookings must not run the 3-hour clock until the check-in date.
    if (isFutureBooking(booking)) return null;
    var st = normalizeBookingStatus(booking.status);
    if (st !== STATUS.RESERVED && st !== STATUS.CONFIRMED) return null;
    if (booking.holdExpiresAt) return booking.holdExpiresAt;
    // Deferred holds wait for activate-on-check-in-date.
    if (booking.holdDeferred) return null;
    var verifiedAt = booking.paymentVerifiedAt || booking.payment_verified_at;
    return holdExpiresAtFromNow(verifiedAt);
  }

  function isActiveDownPaymentHold(booking) {
    var deadline = downPaymentHoldDeadline(booking);
    if (!deadline) return false;
    return !isHoldExpired({ holdExpiresAt: deadline });
  }

  function shouldAutoNoShow(booking) {
    if (!booking) return false;
    var deadline = downPaymentHoldDeadline(booking);
    if (!deadline) return false;
    return isHoldExpired({ holdExpiresAt: deadline });
  }

  function shouldAutoCancelExpiredHold(booking) {
    // Unverified receipts must not expire on a 3-hour clock.
    // The hold starts only after admin approval (Reserved / no-show path).
    return false;
  }

  function isPaymentApproved(booking) {
    if (!booking) return false;
    if (booking.paymentRejectedAt) return false;
    if (booking.paymentVerifiedAt || booking.payment_verified_at) return true;
    var stage = String(booking.verificationStage || booking.verification_stage || "")
      .trim()
      .toLowerCase();
    if (stage === "approved") return true;
    var wf = String(booking.workflow || "")
      .trim()
      .toLowerCase();
    if (wf === "confirmed" || wf === "approved" || wf === "verified_by_receptionist") return true;
    var pay = String(booking.paymentStatus || "").toLowerCase();
    if (
      pay.indexOf("fully paid") !== -1 ||
      pay.indexOf("down payment received") !== -1 ||
      pay.indexOf("payment approved") !== -1
    ) {
      return true;
    }
    var st = normalizeBookingStatus(booking.status);
    return (
      st === STATUS.CONFIRMED ||
      st === STATUS.RESERVED ||
      st === STATUS.CHECKED_IN ||
      st === STATUS.CHECKED_OUT ||
      st === STATUS.COMPLETED
    );
  }

  /**
   * Customer-facing 3-hour countdown deadline.
   * Starts only after Admin verifies a down payment (paymentVerifiedAt / holdExpiresAt).
   * Never based on booking submit or receipt upload time.
   */
  function customerTimerDeadline(booking) {
    return downPaymentHoldDeadline(booking);
  }

  function showCustomerTimer(booking) {
    if (!booking) return false;
    if (booking.paymentRejectedAt) return false;
    return !!downPaymentHoldDeadline(booking);
  }

  function customerStatusNote(booking) {
    if (!booking) return null;
    if (normalizeArrivalStatus(booking.arrivalStatus) === "arrived" || booking.checkedInAt) {
      return { label: "Arrival status", value: "Arrived" };
    }
    if (isFutureBooking(booking) && isPaymentApproved(booking)) {
      return {
        label: "Arrival status",
        value: "Not Arrived · " + futureBookingLabel(booking)
      };
    }
    if (isActiveDownPaymentHold(booking)) {
      return {
        label: "3-hour hold",
        value: "Arrive within 3 hours of payment verification (timer ≠ arrived)"
      };
    }
    var holdDeadline = downPaymentHoldDeadline(booking);
    if (holdDeadline && isHoldExpired({ holdExpiresAt: holdDeadline })) {
      return {
        label: "3-hour hold",
        value: "Hold expired — reservation will be released"
      };
    }
    if (isPaymentApproved(booking)) {
      return {
        label: "Arrival status",
        value: "Not Arrived"
      };
    }
    var waiting = normalizeBookingStatus(booking.status);
    if (waiting === STATUS.FOR_VERIFICATION || waiting === STATUS.PENDING) {
      return {
        label: "Verification",
        value: "Waiting for the owner to verify your payment"
      };
    }
    return null;
  }

  function bookingLifecycleLabel(booking, fallback) {
    if (!booking) return fallback || "";
    var st = normalizeBookingStatus(booking.status);
    if (st === STATUS.CHECKED_IN) return "Confirmed";
    if (st === STATUS.CHECKED_OUT || st === STATUS.COMPLETED) return "Completed";
    if (st === STATUS.NO_SHOW) return "Cancelled";
    if (st === STATUS.REJECTED) return "Cancelled";
    if (st === STATUS.CANCELLED) return "Cancelled";
    if (isFutureBooking(booking) && isPaymentApproved(booking)) {
      return futureBookingLabel(booking);
    }
    if (normalizeArrivalStatus(booking.arrivalStatus) === "arrived" || booking.checkedInAt) {
      return "Confirmed";
    }
    if (isActiveDownPaymentHold(booking)) return "Confirmed · 3-Hour Hold";
    if (st === STATUS.RESERVED) return "Confirmed";
    if (st === STATUS.FOR_VERIFICATION) return "Pending";
    if (st === STATUS.PENDING) return "Pending";
    if (st === STATUS.CONFIRMED) return "Confirmed";
    return fallback != null ? fallback : bookingDisplayStatus(booking);
  }

  function statusDisplayLabel(st, booking) {
    if (booking) return bookingLifecycleLabel(booking, bookingDisplayStatus(booking));
    return normalizeBookingStatus(st);
  }

  var STATUS_ICON = {
    SUCCESS: "✓",
    PENDING: "⏱",
    CANCELLED: "✕"
  };

  function statusGlyph(kind) {
    var k = String(kind || "pending").toLowerCase();
    var open =
      '<svg class="status-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (k === "success" || k === "confirmed" || k === "completed" || k === "paid") {
      return open + '<path d="M20 6 9 17l-5-5"/></svg>';
    }
    if (k === "cancelled" || k === "canceled" || k === "rejected" || k === "failed") {
      return open + '<path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
    }
    return open + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  }

  function presentationForKind(kind, label) {
    var k = String(kind || "pending").toLowerCase();
    if (k === "success" || k === "confirmed" || k === "completed") {
      return {
        kind: "success",
        icon: STATUS_ICON.SUCCESS,
        badgeClass: "booking-status--confirmed",
        label: label || "Confirmed"
      };
    }
    if (k === "cancelled" || k === "canceled" || k === "rejected" || k === "failed") {
      return {
        kind: "cancelled",
        icon: STATUS_ICON.CANCELLED,
        badgeClass: "booking-status--cancelled",
        label: label || "Cancelled"
      };
    }
    return {
      kind: "pending",
      icon: STATUS_ICON.PENDING,
      badgeClass: "booking-status--pending",
      label: label || "Pending"
    };
  }

  function getStatusPresentation(bookingOrStatus, opts) {
    opts = opts || {};
    var booking =
      bookingOrStatus && typeof bookingOrStatus === "object" ? bookingOrStatus : { status: bookingOrStatus };
    var st = normalizeBookingStatus(booking.status);
    var kind = "pending";
    var display = bookingDisplayStatus(booking);
    if (display === "Cancelled") {
      kind = "cancelled";
    } else if (display === "Completed" || display === "Confirmed") {
      kind = "success";
    } else if (isActiveDownPaymentHold(booking)) {
      kind = "pending";
    } else if (st === STATUS.REJECTED || st === STATUS.CANCELLED || st === STATUS.NO_SHOW) {
      kind = "cancelled";
    }
    if (opts.kind) kind = opts.kind;
    var defaultLabel =
      opts.label != null
        ? opts.label
        : bookingLifecycleLabel(booking, display);
    var pres = presentationForKind(kind, defaultLabel);
    if (st === STATUS.FOR_VERIFICATION && !opts.kind && !isPaymentApproved(booking)) {
      pres.badgeClass = "booking-status--pending";
    }
    return pres;
  }

  function getPaymentPresentation(booking, opts) {
    opts = opts || {};
    var label = opts.label != null ? opts.label : paymentDisplayLabel(booking);
    if (!booking) {
      return presentationForKind("pending", label || "For Verification");
    }
    var display = paymentDisplayLabel(booking);
    var kind = "pending";
    if (display === "Rejected") kind = "cancelled";
    else if (display === "Approved") kind = "success";
    if (opts.kind) kind = opts.kind;
    return presentationForKind(kind, label || display);
  }

  function fillStatusBadge(el, presentation) {
    if (!el) return el;
    var incoming = presentation || {};
    var defaults = presentationForKind(incoming.kind, incoming.label);
    var pres = {
      kind: incoming.kind || defaults.kind,
      icon: incoming.icon || defaults.icon,
      badgeClass: incoming.badgeClass || defaults.badgeClass,
      label: incoming.label != null ? incoming.label : defaults.label
    };
    el.className = "booking-status " + (pres.badgeClass || "booking-status--pending");
    el.setAttribute("data-status-kind", pres.kind || "pending");
    el.setAttribute("aria-label", "Status: " + (pres.label || ""));
    el.textContent = "";
    var iconEl = document.createElement("span");
    iconEl.className = "booking-status__icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.innerHTML = statusGlyph(pres.kind);
    var textEl = document.createElement("span");
    textEl.className = "booking-status__label";
    textEl.textContent = pres.label || "";
    el.appendChild(iconEl);
    el.appendChild(textEl);
    return el;
  }

  window.ElenestPaymentFlow = {
    HOLD_HOURS: HOLD_HOURS,
    STATUS: STATUS,
    normalizePaymentType: normalizePaymentType,
    normalizeArrivalStatus: normalizeArrivalStatus,
    normalizeBookingStatus: normalizeBookingStatus,
    bookingCheckInIso: bookingCheckInIso,
    isFutureBooking: isFutureBooking,
    isCheckInDateToday: isCheckInDateToday,
    futureBookingLabel: futureBookingLabel,
    paymentDisplayLabel: paymentDisplayLabel,
    bookingDisplayStatus: bookingDisplayStatus,
    arrivalDisplayLabel: arrivalDisplayLabel,
    statusTriplet: statusTriplet,
    isWithinCheckInWindow: isWithinCheckInWindow,
    canMarkGuestArrived: canMarkGuestArrived,
    isFinalPaymentStatus: isFinalPaymentStatus,
    isAwaitingPaymentVerification: isAwaitingPaymentVerification,
    isEligibleForCheckInQueue: isEligibleForCheckInQueue,
    isReadyForReceptionCheckIn: isReadyForReceptionCheckIn,
    isReadyForReceptionCheckOut: isReadyForReceptionCheckOut,
    isInHouseGuest: isInHouseGuest,
    hasStayPeriodEnded: hasStayPeriodEnded,
    isSlotLockedStatus: isSlotLockedStatus,
    bookingBlocksCalendarSlot: bookingBlocksCalendarSlot,
    occupiesCalendarSlot: occupiesCalendarSlot,
    amountDueNow: amountDueNow,
    holdExpiresAtFromNow: holdExpiresAtFromNow,
    isHoldExpired: isHoldExpired,
    formatTimerRemaining: formatTimerRemaining,
    arrivalStatusLabel: arrivalStatusLabel,
    paymentTypeLabel: paymentTypeLabel,
    bookingLifecycleLabel: bookingLifecycleLabel,
    statusDisplayLabel: statusDisplayLabel,
    shouldSendFutureBookingReminders: shouldSendFutureBookingReminders,
    daysUntilCheckIn: daysUntilCheckIn,
    STATUS_ICON: STATUS_ICON,
    statusGlyph: statusGlyph,
    presentationForKind: presentationForKind,
    getStatusPresentation: getStatusPresentation,
    getPaymentPresentation: getPaymentPresentation,
    fillStatusBadge: fillStatusBadge,
    buildCustomerSubmitPatch: buildCustomerSubmitPatch,
    buildVerificationApprovePatch: buildVerificationApprovePatch,
    buildVerificationRejectPatch: buildVerificationRejectPatch,
    buildActivateDeferredHoldPatch: buildActivateDeferredHoldPatch,
    shouldActivateDeferredHold: shouldActivateDeferredHold,
    buildNoShowPatch: buildNoShowPatch,
    buildExpiredHoldPatch: buildExpiredHoldPatch,
    buildArrivalCheckInPatch: buildArrivalCheckInPatch,
    buildCompleteCheckInPatch: buildCompleteCheckInPatch,
    buildCompleteCheckOutPatch: buildCompleteCheckOutPatch,
    buildCheckoutCompletePatch: buildCheckoutCompletePatch,
    shouldAutoCompleteCheckout: shouldAutoCompleteCheckout,
    getCheckoutDeadline: getCheckoutDeadline,
    shouldAutoNoShow: shouldAutoNoShow,
    downPaymentHoldDeadline: downPaymentHoldDeadline,
    isActiveDownPaymentHold: isActiveDownPaymentHold,
    shouldAutoCancelExpiredHold: shouldAutoCancelExpiredHold,
    isPaymentApproved: isPaymentApproved,
    customerTimerDeadline: customerTimerDeadline,
    showCustomerTimer: showCustomerTimer,
    customerStatusNote: customerStatusNote,
    hasSubmittedReceipt: hasSubmittedReceipt,
    todayIsoLocal: todayIsoLocal
  };
})();
