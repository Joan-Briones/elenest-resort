/**
 * Quick promotion/event notice forms shared by Manager and Admin CMS.
 */
(function () {
  function setMarketingMsg(elId, ok, text) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function withFormLoading(form, work) {
    var BL = window.ElenestButtonLoading;
    if (!BL || typeof BL.runForm !== "function" || !form) {
      return Promise.resolve().then(work);
    }
    return BL.runForm(form, work);
  }

  function renderMarketingList(kind, hostId, editFn) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.textContent = "";
    var N = window.ElenestNotifications;
    if (!N) return;
    var list = kind === "event" ? N.listManagerEvents() : N.listManagerPromotions();
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">None yet. Add one using the form above.</p>';
      return;
    }
    var table = document.createElement("table");
    table.className = "manager-msg-table";
    table.innerHTML = "<thead><tr><th>Title</th><th>Message</th><th>Actions</th></tr></thead>";
    var tbody = document.createElement("tbody");
    list.forEach(function (item) {
      function makeIconBtn(kind, label) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cm-icon-btn cm-icon-btn--" + (kind === "delete" ? "delete" : "edit");
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
        btn.innerHTML =
          (kind === "delete"
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>') +
          '<span class="cm-icon-tip">' +
          label +
          "</span>";
        return btn;
      }

      var tr = document.createElement("tr");
      tr.className = "manager-msg-row";
      var titleTd = document.createElement("td");
      var titleEl = document.createElement("span");
      titleEl.className = "manager-msg-customer__name";
      titleEl.textContent = item.title || "Untitled";
      titleTd.appendChild(titleEl);
      var msgTd = document.createElement("td");
      var msgEl = document.createElement("span");
      msgEl.className = "manager-msg-body";
      msgEl.textContent = item.message || "";
      if (item.message) msgEl.title = String(item.message);
      msgTd.appendChild(msgEl);
      var actTd = document.createElement("td");
      actTd.className = "manager-msg-col-actions";
      var actions = document.createElement("div");
      actions.className = "content-mgmt-item__actions";
      var editBtn = makeIconBtn("edit", kind === "event" ? "Edit Notice" : "Edit Offer");
      editBtn.addEventListener("click", function () { editFn(item); });
      var delBtn = makeIconBtn("delete", "Delete");
      delBtn.addEventListener("click", function () {
        if (!confirm("Delete this item? This cannot be undone.")) return;
        var BL = window.ElenestButtonLoading;
        var work = function () {
          return Promise.resolve(N.deleteManagerItem(item.id)).then(function () {
            render();
          });
        };
        if (BL) BL.run(delBtn, work);
        else work();
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      actTd.appendChild(actions);
      tr.appendChild(titleTd);
      tr.appendChild(msgTd);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = document.createElement("div");
    wrap.className = "manager-msg-table-wrap";
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function render() {
    renderMarketingList("promotion", "managerPromotionsList", function (item) {
      var editId = document.getElementById("managerPromotionEditId");
      var title = document.getElementById("managerPromotionTitle");
      var message = document.getElementById("managerPromotionMessage");
      var cancel = document.getElementById("managerPromotionCancelBtn");
      var submit = document.getElementById("managerPromotionSubmitBtn");
      if (editId) editId.value = item.id || "";
      if (title) title.value = item.title || "";
      if (message) message.value = item.message || "";
      if (cancel) cancel.hidden = false;
      if (submit) submit.textContent = "Save Changes";
    });
    renderMarketingList("event", "managerEventsList", function (item) {
      var editId = document.getElementById("managerEventEditId");
      var title = document.getElementById("managerEventTitle");
      var message = document.getElementById("managerEventMessage");
      var date = document.getElementById("managerEventDate");
      var cancel = document.getElementById("managerEventCancelBtn");
      var submit = document.getElementById("managerEventSubmitBtn");
      if (editId) editId.value = item.id || "";
      if (title) title.value = item.title || "";
      if (message) message.value = item.message || "";
      if (date) date.value = item.eventDate || "";
      if (cancel) cancel.hidden = false;
      if (submit) submit.textContent = "Save Changes";
    });
  }

  function init() {
    if (init._bound) {
      render();
      return;
    }
    init._bound = true;
    var promoForm = document.getElementById("managerPromotionForm");
    var eventForm = document.getElementById("managerEventForm");
    var promoCancel = document.getElementById("managerPromotionCancelBtn");
    var eventCancel = document.getElementById("managerEventCancelBtn");
    if (promoCancel) {
      promoCancel.addEventListener("click", function () {
        if (promoForm) promoForm.reset();
        var editId = document.getElementById("managerPromotionEditId");
        if (editId) editId.value = "";
        promoCancel.hidden = true;
        var submit = document.getElementById("managerPromotionSubmitBtn");
        if (submit) submit.textContent = "Add Offer";
      });
    }
    if (eventCancel) {
      eventCancel.addEventListener("click", function () {
        if (eventForm) eventForm.reset();
        var editId = document.getElementById("managerEventEditId");
        if (editId) editId.value = "";
        eventCancel.hidden = true;
        var submit = document.getElementById("managerEventSubmitBtn");
        if (submit) submit.textContent = "Add Notice";
      });
    }
    if (promoForm) {
      promoForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var N = window.ElenestNotifications;
        if (!N) return;
        var editId = document.getElementById("managerPromotionEditId");
        var title = document.getElementById("managerPromotionTitle");
        var message = document.getElementById("managerPromotionMessage");
        var payload = {
          id: editId && editId.value ? editId.value.trim() : "",
          title: title ? title.value.trim() : "",
          message: message ? message.value.trim() : "",
          link: "activities.html"
        };
        if (!payload.title || !payload.message) {
          setMarketingMsg("managerPromotionMsg", false, "Please fill in the offer title and details.");
          return;
        }
        withFormLoading(promoForm, function () {
          return Promise.resolve(N.saveManagerPromotion(payload)).then(function () {
            setMarketingMsg("managerPromotionMsg", true, "Offer saved. Guests were notified automatically.");
            if (promoForm) promoForm.reset();
            if (editId) editId.value = "";
            if (promoCancel) promoCancel.hidden = true;
            var submit = document.getElementById("managerPromotionSubmitBtn");
            if (submit) submit.textContent = "Add Offer";
            render();
          });
        });
      });
    }
    if (eventForm) {
      eventForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var N = window.ElenestNotifications;
        if (!N) return;
        var editId = document.getElementById("managerEventEditId");
        var title = document.getElementById("managerEventTitle");
        var message = document.getElementById("managerEventMessage");
        var eventDate = document.getElementById("managerEventDate");
        var payload = {
          id: editId && editId.value ? editId.value.trim() : "",
          title: title ? title.value.trim() : "",
          message: message ? message.value.trim() : "",
          eventDate: eventDate ? eventDate.value : "",
          link: "activities.html"
        };
        if (!payload.title || !payload.message) {
          setMarketingMsg("managerEventMsg", false, "Please fill in the event title and details.");
          return;
        }
        withFormLoading(eventForm, function () {
          return Promise.resolve(N.saveManagerEvent(payload)).then(function () {
            setMarketingMsg("managerEventMsg", true, "Event notice saved. Guests were notified automatically.");
            if (eventForm) eventForm.reset();
            if (editId) editId.value = "";
            if (eventCancel) eventCancel.hidden = true;
            var submit = document.getElementById("managerEventSubmitBtn");
            if (submit) submit.textContent = "Add Notice";
            render();
          });
        });
      });
    }
  }

  window.ElenestCmsMarketing = { init: init, render: render };
  window.ElenestManagerContent = window.ElenestManagerContent || {};
  window.ElenestManagerContent.renderMarketing = render;
})();
