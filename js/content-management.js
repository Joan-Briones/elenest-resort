/**
 * Manager Content Management module — tabbed editors for all site content.
 */
(function () {
  var ACTIVE_TAB_KEY = "elenest_content_mgmt_tab";
  var FACILITIES_PAGE_SIZE = 5;
  var facilitiesPage = 1;

  function paginateItems(items, page, pageSize) {
    var list = Array.isArray(items) ? items : [];
    var size = Math.max(1, Number(pageSize) || FACILITIES_PAGE_SIZE);
    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / size) || 1);
    var current = Math.max(1, Math.min(Number(page) || 1, totalPages));
    var start = (current - 1) * size;
    return {
      items: list.slice(start, start + size),
      page: current,
      pageSize: size,
      total: total,
      totalPages: totalPages,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total)
    };
  }

  function renderPaginationControls(host, state, onPageChange) {
    if (!host) return;
    host.textContent = "";
    if (!state || state.total <= state.pageSize) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.className = "admin-pagination";

    var info = document.createElement("span");
    info.className = "admin-pagination__info";
    info.textContent = "Showing " + state.from + "–" + state.to + " of " + state.total;

    var nav = document.createElement("div");
    nav.className = "admin-pagination__nav";

    function makeBtn(label, disabled, page) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline btn--small";
      btn.textContent = label;
      btn.disabled = !!disabled;
      if (!disabled) {
        btn.addEventListener("click", function () {
          onPageChange(page);
        });
      }
      return btn;
    }

    nav.appendChild(makeBtn("Previous", state.page <= 1, state.page - 1));

    var pageLabel = document.createElement("span");
    pageLabel.className = "admin-pagination__page";
    pageLabel.textContent = "Page " + state.page + " of " + state.totalPages;
    nav.appendChild(pageLabel);

    nav.appendChild(makeBtn("Next", state.page >= state.totalPages, state.page + 1));

    host.appendChild(info);
    host.appendChild(nav);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var CM_ICON_PENCIL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var CM_ICON_TRASH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

  function cmIconBtn(kind, extraClass, attrs, label) {
    var isDel = kind === "delete";
    var cls =
      "cm-icon-btn " +
      (isDel ? "cm-icon-btn--delete" : "cm-icon-btn--edit") +
      (extraClass ? " " + extraClass : "");
    return (
      '<button type="button" class="' +
      cls +
      '" aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '" ' +
      attrs +
      ">" +
      (isDel ? CM_ICON_TRASH : CM_ICON_PENCIL) +
      '<span class="cm-icon-tip">' +
      esc(label) +
      "</span></button>"
    );
  }

  function cmIconActions(innerHtml) {
    return '<div class="content-mgmt-item__actions">' + innerHtml + "</div>";
  }

  function clipText(s, n) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n - 1) + "…";
  }

  function cmMsgTable(host, headers, rowsHtml) {
    host.innerHTML =
      '<div class="manager-msg-table-wrap"><table class="manager-msg-table"><thead><tr>' +
      headers
        .map(function (h) {
          return "<th>" + h + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table></div>";
  }

  function store() {
    return window.ElenestContentStore;
  }

  function setMsg(elId, ok, text) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.hidden = false;
    el.className = ok ? "auth-msg auth-msg--ok" : "auth-msg auth-msg--err";
    el.textContent = text;
  }

  function actionErrorText(err) {
    var Errors = window.ElenestErrors;
    if (Errors && typeof Errors.friendlyMessage === "function") {
      return Errors.friendlyMessage(err, "Could not complete that action. Please try again.");
    }
    return "Could not complete that action. Please try again.";
  }

  function reportActionError(err, form) {
    var text = actionErrorText(err);
    var msg = form && form.querySelector ? form.querySelector(".auth-msg") : null;
    if (!msg && form && form.id) {
      msg = document.getElementById(String(form.id).replace(/Form$/, "Msg"));
    }
    if (msg) {
      msg.hidden = false;
      msg.className = "auth-msg auth-msg--err";
      msg.textContent = text;
      return;
    }
    if (window.ElenestErrors && typeof window.ElenestErrors.toast === "function") {
      window.ElenestErrors.toast(text);
    }
  }

  function storeOrWarn(msgId) {
    var S = store();
    if (!S) {
      var text = "This action is unavailable right now. Refresh the page and try again.";
      if (msgId) setMsg(msgId, false, text);
      else if (window.ElenestErrors && typeof window.ElenestErrors.toast === "function") {
        window.ElenestErrors.toast(text);
      }
    }
    return S;
  }

  function withFormLoading(form, work) {
    var BL = window.ElenestButtonLoading;
    var job =
      !BL || typeof BL.runForm !== "function" || !form
        ? Promise.resolve().then(work)
        : BL.runForm(form, work);
    return job.catch(function (err) {
      reportActionError(err, form);
    });
  }

  function withBtnLoading(btn, work) {
    var BL = window.ElenestButtonLoading;
    var job =
      !BL || typeof BL.run !== "function" || !btn
        ? Promise.resolve().then(work)
        : BL.run(btn, work);
    return job.catch(function (err) {
      reportActionError(err, null);
    });
  }

  function readFileAsDataUrl(file, cb) {
    if (!file) {
      cb("");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      cb(String(reader.result || ""));
    };
    reader.onerror = function () {
      cb("");
    };
    reader.readAsDataURL(file);
  }

  var MAX_FACILITY_PHOTOS = 20;
  var facilityPhotoDraft = [];

  function facilityImagesOf(item) {
    var S = store();
    if (S && typeof S.getFacilityImages === "function") return S.getFacilityImages(item);
    var list = [];
    if (item && Array.isArray(item.images)) {
      item.images.forEach(function (src) {
        var s = String(src || "").trim();
        if (s && list.indexOf(s) === -1) list.push(s);
      });
    }
    var cover = item && item.image ? String(item.image).trim() : "";
    if (cover && list.indexOf(cover) === -1) list.unshift(cover);
    return list;
  }

  function addFacilityPhoto(src) {
    var s = String(src || "").trim();
    if (!s) return false;
    if (facilityPhotoDraft.indexOf(s) !== -1) return false;
    if (facilityPhotoDraft.length >= MAX_FACILITY_PHOTOS) return false;
    facilityPhotoDraft.push(s);
    return true;
  }

  function renderFacilityPhotoPreview() {
    var host = document.getElementById("managerRoomImagePreview");
    if (!host) return;
    host.textContent = "";
    if (!facilityPhotoDraft.length) {
      var empty = document.createElement("p");
      empty.className = "facility-photos-preview__empty";
      empty.textContent = "No photos yet. Click Choose File to add pictures from your computer.";
      host.appendChild(empty);
      return;
    }
    var count = document.createElement("p");
    count.className = "facility-photos-preview__count";
    count.textContent = facilityPhotoDraft.length + " photo" + (facilityPhotoDraft.length === 1 ? "" : "s");
    host.appendChild(count);
    var row = document.createElement("div");
    row.className = "facility-photos-preview__row";
    facilityPhotoDraft.forEach(function (src, idx) {
      var item = document.createElement("div");
      item.className = "facility-photos-preview__item";
      var img = document.createElement("img");
      img.src = src;
      img.alt = "Facility photo " + (idx + 1);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "facility-photos-preview__remove";
      remove.setAttribute("aria-label", "Remove photo " + (idx + 1));
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        facilityPhotoDraft.splice(idx, 1);
        renderFacilityPhotoPreview();
      });
      item.appendChild(img);
      item.appendChild(remove);
      row.appendChild(item);
    });
    host.appendChild(row);
  }

  function resetFacilityPhotoDraft(images) {
    facilityPhotoDraft = (images || []).slice();
    renderFacilityPhotoPreview();
  }

  function readFilesAsDataUrls(files, cb) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) {
      cb([]);
      return;
    }
    var out = [];
    var i = 0;
    function next() {
      if (i >= list.length) {
        cb(out);
        return;
      }
      readFileAsDataUrl(list[i], function (src) {
        if (src) out.push(src);
        i += 1;
        next();
      });
    }
    next();
  }

  function getActiveTab() {
    try {
      return sessionStorage.getItem(ACTIVE_TAB_KEY) || "about";
    } catch (e) {
      return "about";
    }
  }

  function setActiveTab(tab) {
    try {
      sessionStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch (e) {}
  }

  function showTab(tab) {
    var tabs = ["about", "facilities", "policies", "gallery", "faqs", "activities", "events"];
    if (tabs.indexOf(tab) === -1) tab = "about";
    setActiveTab(tab);

    document.querySelectorAll("[data-content-tab]").forEach(function (btn) {
      var isActive = btn.getAttribute("data-content-tab") === tab;
      btn.classList.toggle("content-mgmt-tab--active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    document.querySelectorAll("[data-content-panel]").forEach(function (panel) {
      var isActive = panel.getAttribute("data-content-panel") === tab;
      panel.hidden = !isActive;
    });

    if (tab === "about") renderAboutEditor();
    else if (tab === "faqs") renderFaqManager();
    else if (tab === "activities") renderActivitiesManager();
    else if (tab === "events") renderEventsManager();
    else if (tab === "facilities") renderFacilitiesManager();
    else if (tab === "policies") renderPoliciesManager();
    else if (tab === "gallery") renderGalleryManager();
  }

  function renderAboutEditor() {
    var S = store();
    if (!S) return;
    var data = S.getAbout();
    var heroTitle = document.getElementById("cmAboutHeroTitle");
    var heroLead = document.getElementById("cmAboutHeroLead");
    var credLead = document.getElementById("cmAboutCredLead");
    var findLead = document.getElementById("cmAboutFindLead");
    var mapEmbed = document.getElementById("cmAboutMapEmbed");
    if (heroTitle) heroTitle.value = data.heroTitle || "";
    if (heroLead) heroLead.value = data.heroLead || "";
    if (credLead) credLead.value = data.credentialsLead || "";
    if (findLead) findLead.value = data.findUsLead || "";
    if (mapEmbed) mapEmbed.value = data.mapEmbed || "";
    renderAboutCardList("cmAboutStoryList", data.storyCards || [], "story");
    renderAboutCardList("cmAboutCredList", data.credentialCards || [], "credential");
  }

  function renderAboutCardList(hostId, cards, kind) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.textContent = "";
    if (!cards.length) {
      host.innerHTML = '<p class="admin-payment-empty">Nothing saved yet. Use the form above to add one.</p>';
      return;
    }
    var headers = kind === "credential" ? ["Title", "Details", "Photo", "Actions"] : ["Title", "Details", "Actions"];
    var rows = cards
      .map(function (card) {
        var body = String(card.body || "");
        return (
          '<tr class="manager-msg-row"><td><span class="manager-msg-customer__name">' +
          esc(card.title) +
          '</span></td><td><span class="manager-msg-body" title="' +
          esc(body) +
          '">' +
          esc(clipText(body, 80)) +
          "</span></td>" +
          (kind === "credential"
            ? "<td>" + esc(clipText(card.image || "No photo", 28)) + "</td>"
            : "") +
          '<td class="manager-msg-col-actions">' +
          cmIconActions(
            cmIconBtn("edit", "", 'data-edit-about-card="' + esc(card.id) + '" data-card-kind="' + kind + '"', "Edit Item") +
              cmIconBtn("delete", "", 'data-del-about-card="' + esc(card.id) + '" data-card-kind="' + kind + '"', "Delete")
          ) +
          "</td></tr>"
        );
      })
      .join("");
    cmMsgTable(host, headers, rows);
  }

  function resetAboutCardForm() {
    var form = document.getElementById("cmAboutCardForm");
    if (form) {
      form.reset();
      form.removeAttribute("data-edit-id");
      form.removeAttribute("data-card-kind");
    }
    var submit = document.getElementById("cmAboutCardSubmit");
    if (submit) submit.textContent = "Add Item";
    var imgRow = document.getElementById("cmAboutCardImageRow");
    if (imgRow) imgRow.hidden = true;
  }

  function renderFaqManager() {
    var host = document.getElementById("cmFaqList");
    if (!host) return;
    var S = store();
    if (!S) return;
    var list = S.getFaqs();
    host.textContent = "";
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">No FAQs yet. Add one using the form above.</p>';
      return;
    }
    var rows = list
      .map(function (item) {
        var answer = String(item.answer || "");
        return (
          '<tr class="manager-msg-row"><td><span class="manager-msg-customer__name">' +
          esc(item.question) +
          '</span></td><td><span class="manager-msg-body" title="' +
          esc(answer) +
          '">' +
          esc(clipText(answer, 80)) +
          '</span></td><td class="manager-msg-col-actions">' +
          cmIconActions(
            cmIconBtn("edit", "", 'data-edit-faq="' + esc(item.id) + '"', "Edit FAQ") +
              cmIconBtn("delete", "", 'data-del-faq="' + esc(item.id) + '"', "Delete")
          ) +
          "</td></tr>"
        );
      })
      .join("");
    cmMsgTable(host, ["Question", "Answer", "Actions"], rows);
  }

  function resetFaqForm() {
    var form = document.getElementById("cmFaqForm");
    if (form) form.reset();
    var editId = document.getElementById("cmFaqEditId");
    if (editId) editId.value = "";
    var submit = document.getElementById("cmFaqSubmit");
    if (submit) submit.textContent = "Add FAQ";
    var cancel = document.getElementById("cmFaqCancel");
    if (cancel) cancel.hidden = true;
  }

  function renderActivitiesManager() {
    var host = document.getElementById("cmActivitiesList");
    if (!host) return;
    var S = store();
    if (!S) return;
    var list = S.getActivities();
    host.textContent = "";
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">No activities yet. Add one using the form above.</p>';
      return;
    }
    var rows = list
      .map(function (item) {
        var desc = String(item.description || "");
        var meta = [item.type || "", item.date || ""].filter(Boolean).join(" · ");
        return (
          '<tr class="manager-msg-row"><td><span class="manager-msg-customer__name">' +
          esc(item.title) +
          "</span></td><td>" +
          esc(meta) +
          '</td><td><span class="manager-msg-body" title="' +
          esc(desc) +
          '">' +
          esc(clipText(desc, 70)) +
          '</span></td><td class="manager-msg-col-actions">' +
          cmIconActions(
            cmIconBtn("edit", "", 'data-edit-activity="' + esc(item.id) + '"', "Edit Activity") +
              cmIconBtn("delete", "", 'data-del-activity="' + esc(item.id) + '"', "Delete")
          ) +
          "</td></tr>"
        );
      })
      .join("");
    cmMsgTable(host, ["Title", "Details", "Description", "Actions"], rows);

    if (window.ElenestCmsMarketing && window.ElenestCmsMarketing.render) {
      window.ElenestCmsMarketing.render();
    } else if (window.ElenestManagerContent && window.ElenestManagerContent.renderMarketing) {
      window.ElenestManagerContent.renderMarketing();
    }
  }

  function renderEventsManager() {
    var host = document.getElementById("cmEventsList");
    if (!host) return;
    var S = store();
    if (!S) return;
    var list = S.getEvents();
    host.textContent = "";
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">No events yet. Add one using the form above.</p>';
      return;
    }
    var rows = list
      .map(function (item) {
        var desc = String(item.description || "");
        var meta = [item.type || "", item.date || ""].filter(Boolean).join(" · ");
        return (
          '<tr class="manager-msg-row"><td><span class="manager-msg-customer__name">' +
          esc(item.title) +
          "</span></td><td>" +
          esc(meta) +
          '</td><td><span class="manager-msg-body" title="' +
          esc(desc) +
          '">' +
          esc(clipText(desc, 70)) +
          '</span></td><td class="manager-msg-col-actions">' +
          cmIconActions(
            cmIconBtn("edit", "", 'data-edit-event="' + esc(item.id) + '"', "Edit Event") +
              cmIconBtn("delete", "", 'data-del-event="' + esc(item.id) + '"', "Delete")
          ) +
          "</td></tr>"
        );
      })
      .join("");
    cmMsgTable(host, ["Title", "Details", "Description", "Actions"], rows);
    if (window.ElenestCmsMarketing && window.ElenestCmsMarketing.render) {
      window.ElenestCmsMarketing.render();
    } else if (window.ElenestManagerContent && window.ElenestManagerContent.renderMarketing) {
      window.ElenestManagerContent.renderMarketing();
    }
  }

  function fmtPHP(amount) {
    var n = Number(amount);
    if (isNaN(n)) return "₱0";
    return "₱" + Math.round(n).toLocaleString();
  }

  function renderFacilitiesManager() {
    var host = document.getElementById("managerRoomCatalogList");
    var pager = document.getElementById("managerRoomCatalogPagination");
    if (!host) return;
    var S = store();
    if (!S) return;
    var list = S.getFacilitiesAll();
    host.textContent = "";
    if (!list.length) {
      facilitiesPage = 1;
      host.innerHTML = '<p class="admin-payment-empty">No facilities yet. Add one using the form above.</p>';
      renderPaginationControls(pager, null);
      return;
    }
    function roomImageCell(r) {
      var count = facilityImagesOf(r).length;
      if (!count) return "No photo";
      return count === 1 ? "1 photo" : count + " photos";
    }
    function roomKindLabel(r) {
      if (String(r.type || "room") !== "room") return "";
      var k = String(r.roomKind || "").toLowerCase();
      if (k === "big") return "Big room";
      if (k === "small") return "Small room";
      if (k === "couple") return "Couple room";
      return "";
    }
    var pageState = paginateItems(list, facilitiesPage, FACILITIES_PAGE_SIZE);
    facilitiesPage = pageState.page;
    var rows = pageState.items.map(function (r) {
      var type = String(r.type || "room");
      var typeLabel = type === "cottage" ? "Cottage" : type === "hall" ? "Event Hall" : "Room";
      var unit = r.priceUnit === "day" ? "per day" : r.priceUnit === "event" ? "per event" : "per night";
      var kind = roomKindLabel(r);
      var nameCell = kind ? kind + " — " + String(r.name || "") : String(r.name || "");
      var UA = window.ElenestUnitAvailability;
      var capLabel =
        UA && typeof UA.formatCapacityLabel === "function"
          ? UA.formatCapacityLabel(r)
          : r.capacity != null
            ? "Up to " + r.capacity + " guests"
            : "—";
      return (
        '<tr class="manager-msg-row"><td>' + typeLabel + "</td><td>" + esc(nameCell) + "</td><td>" + esc(capLabel) + "</td><td>" + fmtPHP(r.price) + " / " + unit + "</td><td>" +
        esc(roomImageCell(r)) + '</td><td class="manager-msg-col-actions">' +
        '<span class="content-mgmt-item__actions">' +
        cmIconBtn("edit", "manager-room-edit", 'data-room-id="' + esc(r.id) + '"', "Edit Facility") +
        cmIconBtn("delete", "manager-room-remove", 'data-room-id="' + esc(r.id) + '"', "Delete") +
        "</span></td></tr>"
      );
    }).join("");
    host.innerHTML = '<div class="manager-msg-table-wrap"><table class="manager-msg-table"><thead><tr><th>Type</th><th>Name</th><th>Guests</th><th>Price</th><th>Photos</th><th>Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    renderPaginationControls(pager, pageState, function (page) {
      facilitiesPage = page;
      renderFacilitiesManager();
    });
    host.querySelectorAll(".manager-room-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this facility? This cannot be undone.")) return;
        withBtnLoading(btn, function () {
          return Promise.resolve(S.deleteFacility(btn.getAttribute("data-room-id"))).then(function () {
            renderFacilitiesManager();
          });
        });
      });
    });
    host.querySelectorAll(".manager-room-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = S.getFacilitiesAll().find(function (x) { return String(x.id) === String(btn.getAttribute("data-room-id")); });
        if (!item) return;
        var roomForm = document.getElementById("managerRoomCatalogForm");
        if (!roomForm) return;
        roomForm.setAttribute("data-edit-id", String(item.id));
        document.getElementById("managerRoomType").value = item.type === "cottage" ? "cottage" : item.type === "hall" ? "hall" : "room";
        document.getElementById("managerRoomKind").value = String(item.roomKind || "");
        document.getElementById("managerRoomName").value = String(item.name || "");
        document.getElementById("managerRoomPrice").value = String(Math.round(Number(item.price || 0)));
        var pu = String(item.priceUnit || "night");
        document.getElementById("managerRoomPriceUnit").value = pu === "day" ? "day" : pu === "event" ? "event" : "night";
        document.getElementById("managerRoomImage").value = "";
        document.getElementById("managerRoomImageUpload").value = "";
        resetFacilityPhotoDraft(facilityImagesOf(item));
        var capEl = document.getElementById("managerRoomCapacity");
        var capMinEl = document.getElementById("managerRoomCapacityMin");
        if (capEl) capEl.value = item.capacity != null ? String(item.capacity) : "";
        if (capMinEl) {
          capMinEl.value = item.capacityMin != null ? String(item.capacityMin) : "";
        }
        syncFacilityCapacityFields();
        document.getElementById("managerRoomDescription").value = String(item.description || "");
        document.getElementById("managerRoomSubmitBtn").textContent = "Save Changes";
      });
    });
  }

  function syncFacilityCapacityFields() {
    var roomType = document.getElementById("managerRoomType");
    var roomKind = document.getElementById("managerRoomKind");
    var capEl = document.getElementById("managerRoomCapacity");
    var capMinEl = document.getElementById("managerRoomCapacityMin");
    var minWrap = document.getElementById("managerRoomCapacityMinWrap");
    if (!roomType || !capEl) return;
    var type = String(roomType.value || "room");
    var kind = roomKind ? String(roomKind.value || "").toLowerCase() : "";
    if (minWrap) minWrap.hidden = type !== "hall";
    if (!capEl.value) {
      if (type === "cottage") capEl.value = "20";
      else if (type === "hall") capEl.value = "150";
      else if (kind === "big") capEl.value = "15";
      else capEl.value = "4";
    }
    if (type === "hall" && capMinEl && !capMinEl.value) capMinEl.value = "60";
  }

  function renderPoliciesManager() {
    var host = document.getElementById("managerPolicyList");
    if (!host) return;
    var S = store();
    if (!S) return;
    var list = S.getPolicies();
    host.textContent = "";
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">No policies yet. Add one using the form above.</p>';
      return;
    }
    function policyKindLabel(kind) {
      return String(kind || "general").toLowerCase() === "pool" ? "Swimming pool rules" : "General policy";
    }
    function imageLabel(src) {
      var s = String(src || "").trim();
      if (!s) return "No photo";
      if (s.indexOf("data:image/") === 0) return "Uploaded photo";
      return s;
    }
    var rows = list.map(function (p) {
      return (
        '<tr class="manager-msg-row"><td>' + esc(policyKindLabel(p.kind)) + "</td><td>" + esc(p.title) + "</td><td>" + esc(imageLabel(p.image)) + '</td><td class="manager-msg-col-actions">' +
        '<span class="content-mgmt-item__actions">' +
        cmIconBtn("edit", "manager-policy-edit", 'data-policy-id="' + esc(p.id) + '"', "Edit Policy") +
        cmIconBtn("delete", "manager-policy-remove", 'data-policy-id="' + esc(p.id) + '"', "Delete") +
        "</span></td></tr>"
      );
    }).join("");
    host.innerHTML = '<div class="manager-msg-table-wrap"><table class="manager-msg-table"><thead><tr><th>Type</th><th>Policy</th><th>Photo</th><th>Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    host.querySelectorAll(".manager-policy-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this policy? This cannot be undone.")) return;
        withBtnLoading(btn, function () {
          return Promise.resolve(S.deletePolicy(btn.getAttribute("data-policy-id"))).then(function () {
            renderPoliciesManager();
          });
        });
      });
    });
    host.querySelectorAll(".manager-policy-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = S.getPolicies().find(function (x) { return String(x.id) === String(btn.getAttribute("data-policy-id")); });
        if (!item) return;
        var policyForm = document.getElementById("managerPolicyForm");
        if (!policyForm) return;
        policyForm.setAttribute("data-edit-id", String(item.id));
        document.getElementById("managerPolicyKind").value = String(item.kind || "general") === "pool" ? "pool" : "general";
        document.getElementById("managerPolicyTitle").value = String(item.title || "");
        var rawImg = String(item.image || "");
        document.getElementById("managerPolicyImage").value = rawImg.indexOf("data:image/") === 0 ? "" : rawImg;
        document.getElementById("managerPolicyImageUpload").value = "";
        document.getElementById("managerPolicyDescription").value = String(item.description || "");
        document.getElementById("managerPolicySubmitBtn").textContent = "Save Changes";
      });
    });
  }

  function resetActivityForm() {
    var form = document.getElementById("cmActivityForm");
    if (form) form.reset();
    var editId = document.getElementById("cmActivityEditId");
    if (editId) editId.value = "";
    var submit = document.getElementById("cmActivitySubmit");
    if (submit) submit.textContent = "Add Activity";
    var cancel = document.getElementById("cmActivityCancel");
    if (cancel) cancel.hidden = true;
    var notify = document.getElementById("cmActivityNotify");
    if (notify) notify.checked = false;
  }

  function resetEventForm() {
    var form = document.getElementById("cmEventForm");
    if (form) form.reset();
    var editId = document.getElementById("cmEventEditId");
    if (editId) editId.value = "";
    var submit = document.getElementById("cmEventSubmit");
    if (submit) submit.textContent = "Add Event";
    var cancel = document.getElementById("cmEventCancel");
    if (cancel) cancel.hidden = true;
  }

  function resetGalleryForm() {
    var form = document.getElementById("cmGalleryForm");
    if (form) {
      form.reset();
      form.removeAttribute("data-edit-id");
    }
    var submit = document.getElementById("cmGallerySubmit");
    if (submit) submit.textContent = "Add Photo";
    var cancel = document.getElementById("cmGalleryCancel");
    if (cancel) cancel.hidden = true;
  }

  function renderGalleryManager() {
    var host = document.getElementById("cmGalleryList");
    if (!host) return;
    var S = store();
    if (!S || typeof S.getGalleryAll !== "function") {
      host.innerHTML = '<p class="admin-payment-empty">Photos are unavailable right now. Please refresh the page.</p>';
      return;
    }
    var list = S.getGalleryAll();
    host.textContent = "";
    if (!list.length) {
      host.innerHTML = '<p class="admin-payment-empty">No photos yet. Add one using the form above.</p>';
      return;
    }
    function imageLabel(src) {
      var s = String(src || "").trim();
      if (!s) return "No photo";
      if (s.indexOf("data:image/") === 0) return "Uploaded photo";
      return s;
    }
    var rows = list.map(function (g) {
      return (
        '<tr class="manager-msg-row"><td>' + esc(g.title || "Untitled") + "</td><td>" + esc(imageLabel(g.image)) + '</td><td class="manager-msg-col-actions">' +
        '<span class="content-mgmt-item__actions">' +
        cmIconBtn("edit", "cm-gallery-edit", 'data-gallery-id="' + esc(g.id) + '"', "Edit Photo") +
        cmIconBtn("delete", "cm-gallery-remove", 'data-gallery-id="' + esc(g.id) + '"', "Delete") +
        "</span></td></tr>"
      );
    }).join("");
    host.innerHTML = '<div class="manager-msg-table-wrap"><table class="manager-msg-table"><thead><tr><th>Title</th><th>Photo</th><th>Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div>";

    host.querySelectorAll(".cm-gallery-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this photo? This cannot be undone.")) return;
        withBtnLoading(btn, function () {
          return Promise.resolve(S.deleteGalleryItem(btn.getAttribute("data-gallery-id"))).then(function () {
            renderGalleryManager();
          });
        });
      });
    });

    host.querySelectorAll(".cm-gallery-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = S.getGalleryAll().find(function (x) {
          return String(x.id) === String(btn.getAttribute("data-gallery-id"));
        });
        if (!item) return;
        var form = document.getElementById("cmGalleryForm");
        if (!form) return;
        form.setAttribute("data-edit-id", String(item.id));
        document.getElementById("cmGalleryTitle").value = String(item.title || "");
        var rawImg = String(item.image || "");
        document.getElementById("cmGalleryImage").value = rawImg.indexOf("data:image/") === 0 ? "" : rawImg;
        document.getElementById("cmGalleryImageUpload").value = "";
        document.getElementById("cmGalleryAlt").value = String(item.imageAlt || "");
        document.getElementById("cmGallerySubmit").textContent = "Save Changes";
        var cancel = document.getElementById("cmGalleryCancel");
        if (cancel) cancel.hidden = false;
      });
    });
  }

  function initTabHandlers() {
    document.querySelectorAll("[data-content-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showTab(btn.getAttribute("data-content-tab"));
      });
    });
  }

  function initAboutHandlers() {
    var cardKind = document.getElementById("cmAboutCardKind");
    var imgRow = document.getElementById("cmAboutCardImageRow");
    if (cardKind && imgRow) {
      cardKind.addEventListener("change", function () {
        imgRow.hidden = cardKind.value !== "credential";
      });
    }

    var aboutHeroForm = document.getElementById("cmAboutHeroForm");
    if (aboutHeroForm) {
      aboutHeroForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var S = storeOrWarn("cmAboutHeroMsg");
        if (!S) return;
        var data = S.getAbout();
        data.heroTitle = document.getElementById("cmAboutHeroTitle").value.trim();
        data.heroLead = document.getElementById("cmAboutHeroLead").value.trim();
        data.credentialsLead = document.getElementById("cmAboutCredLead").value.trim();
        data.findUsLead = document.getElementById("cmAboutFindLead").value.trim();
        data.mapEmbed = document.getElementById("cmAboutMapEmbed").value.trim();
        if (!data.heroTitle || !data.heroLead) {
          setMsg("cmAboutHeroMsg", false, "Please fill in the main heading and short introduction.");
          return;
        }
        withFormLoading(aboutHeroForm, function () {
          return Promise.resolve(S.saveAbout(data)).then(function () {
            renderAboutEditor();
            setMsg("cmAboutHeroMsg", true, "About page text saved.");
          });
        });
      });
    }

    var cardForm = document.getElementById("cmAboutCardForm");
    if (cardForm) {
      cardForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var S = storeOrWarn("cmAboutCardMsg");
        if (!S) return;
        var data = S.getAbout();
        var kind = cardForm.getAttribute("data-card-kind") || document.getElementById("cmAboutCardKind").value;
        var editId = cardForm.getAttribute("data-edit-id") || "";
        var title = document.getElementById("cmAboutCardTitle").value.trim();
        var body = document.getElementById("cmAboutCardBody").value.trim();
        if (!title || !body) {
          setMsg("cmAboutCardMsg", false, "Please fill in the title and details.");
          return;
        }
        if (kind === "credential") {
          var imageInput = document.getElementById("cmAboutCardImage");
          var upload = document.getElementById("cmAboutCardImageUpload");
          var imageAlt = document.getElementById("cmAboutCardImageAlt").value.trim();
          withFormLoading(cardForm, function () {
            return new Promise(function (resolve, reject) {
              function finish(imageSrc) {
                var cards = data.credentialCards || [];
                var record = {
                  id: editId || S.uid(),
                  title: title,
                  body: body,
                  image: imageSrc || (imageInput ? imageInput.value.trim() : ""),
                  imageAlt: imageAlt
                };
                var found = false;
                cards = cards.map(function (c) {
                  if (String(c.id) === String(record.id)) {
                    found = true;
                    return record;
                  }
                  return c;
                });
                if (!found) cards.push(record);
                data.credentialCards = cards;
                Promise.resolve(S.saveAbout(data)).then(function () {
                  resetAboutCardForm();
                  renderAboutEditor();
                  setMsg("cmAboutCardMsg", true, "Award or highlight saved.");
                  resolve();
                }).catch(reject);
              }
              if (upload && upload.files && upload.files[0]) {
                readFileAsDataUrl(upload.files[0], finish);
              } else {
                var existing = (data.credentialCards || []).find(function (c) {
                  return String(c.id) === String(editId);
                });
                finish(imageInput && imageInput.value.trim() ? imageInput.value.trim() : existing ? existing.image : "");
              }
            });
          });
          return;
        }
        var storyCards = data.storyCards || [];
        var storyRecord = { id: editId || S.uid(), title: title, body: body };
        var storyFound = false;
        storyCards = storyCards.map(function (c) {
          if (String(c.id) === String(storyRecord.id)) {
            storyFound = true;
            return storyRecord;
          }
          return c;
        });
        if (!storyFound) storyCards.push(storyRecord);
        data.storyCards = storyCards;
        withFormLoading(cardForm, function () {
          return Promise.resolve(S.saveAbout(data)).then(function () {
            resetAboutCardForm();
            renderAboutEditor();
            setMsg("cmAboutCardMsg", true, "Story saved.");
          });
        });
      });
    }

    var cardCancel = document.getElementById("cmAboutCardCancel");
    if (cardCancel) cardCancel.addEventListener("click", resetAboutCardForm);

    document.addEventListener("click", function (e) {
      var delBtn = e.target.closest("[data-del-about-card]");
      if (delBtn) {
        var S = storeOrWarn("cmAboutCardMsg");
        if (!S) return;
        if (!confirm("Delete this item? This cannot be undone.")) return;
        var data = S.getAbout();
        var id = delBtn.getAttribute("data-del-about-card");
        var kind = delBtn.getAttribute("data-card-kind");
        if (kind === "credential") {
          data.credentialCards = (data.credentialCards || []).filter(function (c) {
            return String(c.id) !== String(id);
          });
        } else {
          data.storyCards = (data.storyCards || []).filter(function (c) {
            return String(c.id) !== String(id);
          });
        }
        withBtnLoading(delBtn, function () {
          return Promise.resolve(S.saveAbout(data)).then(function () {
            renderAboutEditor();
          });
        });
        return;
      }
      var editBtn = e.target.closest("[data-edit-about-card]");
      if (editBtn) {
        var S2 = storeOrWarn("cmAboutCardMsg");
        if (!S2) return;
        var data2 = S2.getAbout();
        var id2 = editBtn.getAttribute("data-edit-about-card");
        var kind2 = editBtn.getAttribute("data-card-kind");
        var card =
          kind2 === "credential"
            ? (data2.credentialCards || []).find(function (c) {
                return String(c.id) === String(id2);
              })
            : (data2.storyCards || []).find(function (c) {
                return String(c.id) === String(id2);
              });
        if (!card) return;
        var form = document.getElementById("cmAboutCardForm");
        form.setAttribute("data-edit-id", id2);
        form.setAttribute("data-card-kind", kind2);
        document.getElementById("cmAboutCardKind").value = kind2 === "credential" ? "credential" : "story";
        document.getElementById("cmAboutCardTitle").value = card.title || "";
        document.getElementById("cmAboutCardBody").value = card.body || "";
        var imgRow2 = document.getElementById("cmAboutCardImageRow");
        if (imgRow2) imgRow2.hidden = kind2 !== "credential";
        if (kind2 === "credential") {
          var rawImg = String(card.image || "");
          document.getElementById("cmAboutCardImage").value =
            rawImg.indexOf("data:image/") === 0 ? "" : rawImg;
          document.getElementById("cmAboutCardImageAlt").value = card.imageAlt || "";
        }
        document.getElementById("cmAboutCardSubmit").textContent = "Save Changes";
      }
    });
  }

  function initFaqHandlers() {
    var form = document.getElementById("cmFaqForm");
    var cancel = document.getElementById("cmFaqCancel");
    if (cancel) cancel.addEventListener("click", resetFaqForm);
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var S = storeOrWarn("cmFaqMsg");
        if (!S) return;
        var editId = document.getElementById("cmFaqEditId").value.trim();
        var question = document.getElementById("cmFaqQuestion").value.trim();
        var answer = document.getElementById("cmFaqAnswer").value.trim();
        var sortOrder = document.getElementById("cmFaqSort").value;
        var ctaLabel = document.getElementById("cmFaqCtaLabel").value.trim();
        if (!question || !answer) {
          setMsg("cmFaqMsg", false, "Please fill in both the question and the answer.");
          return;
        }
        withFormLoading(form, function () {
          return Promise.resolve(S.upsertFaq({
            id: editId,
            question: question,
            answer: answer,
            sortOrder: sortOrder,
            ctaLabel: ctaLabel,
            ctaHref: ""
          })).then(function () {
            resetFaqForm();
            renderFaqManager();
            setMsg("cmFaqMsg", true, editId ? "FAQ updated." : "FAQ added.");
          });
        });
      });
    }

    document.addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-edit-faq]");
      if (editBtn) {
        var S = storeOrWarn("cmFaqMsg");
        if (!S) return;
        var item = S.getFaqs().find(function (f) {
          return String(f.id) === String(editBtn.getAttribute("data-edit-faq"));
        });
        if (!item) return;
        document.getElementById("cmFaqEditId").value = item.id;
        document.getElementById("cmFaqQuestion").value = item.question || "";
        document.getElementById("cmFaqAnswer").value = item.answer || "";
        document.getElementById("cmFaqSort").value = item.sortOrder || "";
        document.getElementById("cmFaqCtaLabel").value = item.ctaLabel || "";
        document.getElementById("cmFaqSubmit").textContent = "Save Changes";
        document.getElementById("cmFaqCancel").hidden = false;
        return;
      }
      var delBtn = e.target.closest("[data-del-faq]");
      if (delBtn) {
        if (!confirm("Delete this FAQ? This cannot be undone.")) return;
        var S2 = storeOrWarn("cmFaqMsg");
        if (!S2) return;
        withBtnLoading(delBtn, function () {
          return Promise.resolve(S2.deleteFaq(delBtn.getAttribute("data-del-faq"))).then(function () {
            renderFaqManager();
          });
        });
      }
    });
  }

  function initActivityHandlers() {
    var form = document.getElementById("cmActivityForm");
    var cancel = document.getElementById("cmActivityCancel");
    if (cancel) cancel.addEventListener("click", resetActivityForm);
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var S = storeOrWarn("cmActivityMsg");
        if (!S) return;
        var editId = document.getElementById("cmActivityEditId").value.trim();
        var type = document.getElementById("cmActivityType").value.trim();
        var title = document.getElementById("cmActivityTitle").value.trim();
        var date = document.getElementById("cmActivityDate").value.trim();
        var description = document.getElementById("cmActivityDescription").value.trim();
        var badge = document.getElementById("cmActivityBadge").value.trim();
        var imageAlt = document.getElementById("cmActivityImageAlt").value.trim();
        var notify = document.getElementById("cmActivityNotify");
        var imageInput = document.getElementById("cmActivityImage");
        var upload = document.getElementById("cmActivityImageUpload");
        if (!title || !description) {
          setMsg("cmActivityMsg", false, "Please fill in the title and description.");
          return;
        }
        withFormLoading(form, function () {
          return new Promise(function (resolve, reject) {
            function finish(imageSrc) {
              Promise.resolve(S.upsertActivity({
                id: editId,
                type: type,
                title: title,
                date: date,
                description: description,
                badge: badge || "Promotion",
                image: imageSrc,
                imageAlt: imageAlt
              })).then(function (saved) {
                if (notify && notify.checked && window.ElenestNotifications) {
                  window.ElenestNotifications.saveManagerPromotion({
                    id: saved.id,
                    title: title,
                    message: description,
                    link: "activities.html"
                  });
                }
                resetActivityForm();
                renderActivitiesManager();
                setMsg("cmActivityMsg", true, editId ? "Activity updated." : "Activity added." + (notify && notify.checked ? " Guests were notified." : ""));
                resolve();
              }).catch(reject);
            }
            if (upload && upload.files && upload.files[0]) {
              readFileAsDataUrl(upload.files[0], finish);
            } else {
              var existing = editId
                ? S.getActivities().find(function (a) {
                    return String(a.id) === String(editId);
                  })
                : null;
              var path = imageInput ? imageInput.value.trim() : "";
              finish(path || (existing ? existing.image : ""));
            }
          });
        });
      });
    }

    document.addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-edit-activity]");
      if (editBtn) {
        var S = storeOrWarn("cmActivityMsg");
        if (!S) return;
        var item = S.getActivities().find(function (a) {
          return String(a.id) === String(editBtn.getAttribute("data-edit-activity"));
        });
        if (!item) return;
        document.getElementById("cmActivityEditId").value = item.id;
        document.getElementById("cmActivityType").value = item.type || "";
        document.getElementById("cmActivityTitle").value = item.title || "";
        document.getElementById("cmActivityDate").value = item.date || "";
        document.getElementById("cmActivityDescription").value = item.description || "";
        document.getElementById("cmActivityBadge").value = item.badge || "";
        var rawImg = String(item.image || "");
        document.getElementById("cmActivityImage").value =
          rawImg.indexOf("data:image/") === 0 ? "" : rawImg;
        document.getElementById("cmActivityImageAlt").value = item.imageAlt || "";
        document.getElementById("cmActivitySubmit").textContent = "Save Changes";
        document.getElementById("cmActivityCancel").hidden = false;
        return;
      }
      var delBtn = e.target.closest("[data-del-activity]");
      if (delBtn) {
        if (!confirm("Delete this activity? This cannot be undone.")) return;
        var S2 = storeOrWarn("cmActivityMsg");
        if (!S2) return;
        withBtnLoading(delBtn, function () {
          return Promise.resolve(S2.deleteActivity(delBtn.getAttribute("data-del-activity"))).then(function () {
            renderActivitiesManager();
          });
        });
      }
    });
  }

  function initEventHandlers() {
    var form = document.getElementById("cmEventForm");
    var cancel = document.getElementById("cmEventCancel");
    if (cancel) cancel.addEventListener("click", resetEventForm);
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var S = storeOrWarn("cmEventMsg");
        if (!S) return;
        var editId = document.getElementById("cmEventEditId").value.trim();
        var type = document.getElementById("cmEventType").value.trim();
        var title = document.getElementById("cmEventTitle").value.trim();
        var date = document.getElementById("cmEventDate").value.trim();
        var description = document.getElementById("cmEventDescription").value.trim();
        var badge = document.getElementById("cmEventBadge").value.trim();
        var imageAlt = document.getElementById("cmEventImageAlt").value.trim();
        var imageInput = document.getElementById("cmEventImage");
        var upload = document.getElementById("cmEventImageUpload");
        if (!title || !description) {
          setMsg("cmEventMsg", false, "Please fill in the title and description.");
          return;
        }
        withFormLoading(form, function () {
          return new Promise(function (resolve, reject) {
            function finish(imageSrc) {
              Promise.resolve(S.upsertEvent({
                id: editId,
                type: type,
                title: title,
                date: date,
                description: description,
                badge: badge || "Past event",
                image: imageSrc,
                imageAlt: imageAlt
              })).then(function () {
                resetEventForm();
                renderEventsManager();
                setMsg("cmEventMsg", true, editId ? "Event updated." : "Event added.");
                resolve();
              }).catch(reject);
            }
            if (upload && upload.files && upload.files[0]) {
              readFileAsDataUrl(upload.files[0], finish);
            } else {
              var existing = editId ? S.getEvents().find(function (a) { return String(a.id) === String(editId); }) : null;
              finish(imageInput ? imageInput.value.trim() || (existing ? existing.image : "") : existing ? existing.image : "");
            }
          });
        });
      });
    }
    document.addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-edit-event]");
      if (editBtn) {
        var S = storeOrWarn("cmEventMsg");
        if (!S) return;
        var item = S.getEvents().find(function (a) { return String(a.id) === String(editBtn.getAttribute("data-edit-event")); });
        if (!item) return;
        document.getElementById("cmEventEditId").value = item.id;
        document.getElementById("cmEventType").value = item.type || "";
        document.getElementById("cmEventTitle").value = item.title || "";
        document.getElementById("cmEventDate").value = item.date || "";
        document.getElementById("cmEventDescription").value = item.description || "";
        document.getElementById("cmEventBadge").value = item.badge || "";
        var rawImg = String(item.image || "");
        document.getElementById("cmEventImage").value = rawImg.indexOf("data:image/") === 0 ? "" : rawImg;
        document.getElementById("cmEventImageAlt").value = item.imageAlt || "";
        document.getElementById("cmEventSubmit").textContent = "Save Changes";
        document.getElementById("cmEventCancel").hidden = false;
        return;
      }
      var delBtn = e.target.closest("[data-del-event]");
      if (delBtn) {
        if (!confirm("Delete this event? This cannot be undone.")) return;
        var S2 = storeOrWarn("cmEventMsg");
        if (!S2) return;
        withBtnLoading(delBtn, function () {
          return Promise.resolve(S2.deleteEvent(delBtn.getAttribute("data-del-event"))).then(function () {
            renderEventsManager();
          });
        });
      }
    });
  }

  function initFacilitiesHandlers() {
    var roomForm = document.getElementById("managerRoomCatalogForm");
    if (!roomForm) return;
    var roomTypeEl = document.getElementById("managerRoomType");
    var roomKindEl = document.getElementById("managerRoomKind");
    if (roomTypeEl) {
      roomTypeEl.addEventListener("change", function () {
        var capEl = document.getElementById("managerRoomCapacity");
        if (capEl) capEl.value = "";
        var capMinEl = document.getElementById("managerRoomCapacityMin");
        if (capMinEl) capMinEl.value = "";
        syncFacilityCapacityFields();
      });
    }
    if (roomKindEl) {
      roomKindEl.addEventListener("change", function () {
        var typeEl = document.getElementById("managerRoomType");
        if (typeEl && String(typeEl.value || "") === "room") {
          var capEl = document.getElementById("managerRoomCapacity");
          if (capEl) capEl.value = "";
          syncFacilityCapacityFields();
        }
      });
    }
    syncFacilityCapacityFields();
    resetFacilityPhotoDraft([]);
    var roomImageAddUrl = document.getElementById("managerRoomImageAddUrl");
    var roomImageUpload = document.getElementById("managerRoomImageUpload");
    if (roomImageAddUrl) {
      roomImageAddUrl.addEventListener("click", function () {
        var roomImage = document.getElementById("managerRoomImage");
        var path = roomImage ? String(roomImage.value || "").trim() : "";
        if (!path) {
          setMsg("managerRoomCatalogMsg", false, "Paste a photo link first, or choose a file to upload.");
          return;
        }
        if (facilityPhotoDraft.length >= MAX_FACILITY_PHOTOS) {
          setMsg("managerRoomCatalogMsg", false, "You can add up to " + MAX_FACILITY_PHOTOS + " photos.");
          return;
        }
        if (!addFacilityPhoto(path)) {
          setMsg("managerRoomCatalogMsg", false, "That photo is already added.");
          return;
        }
        if (roomImage) roomImage.value = "";
        renderFacilityPhotoPreview();
        setMsg("managerRoomCatalogMsg", true, "Photo added. You can add more if you want.");
      });
    }
    if (roomImageUpload) {
      roomImageUpload.addEventListener("change", function () {
        var files = roomImageUpload.files ? Array.prototype.slice.call(roomImageUpload.files) : [];
        if (!files.length) return;
        var invalid = files.some(function (file) {
          return String(file.type || "").indexOf("image/") !== 0;
        });
        if (invalid) {
          setMsg("managerRoomCatalogMsg", false, "Please choose photo files (JPG, PNG, etc.).");
          roomImageUpload.value = "";
          return;
        }
        var remaining = MAX_FACILITY_PHOTOS - facilityPhotoDraft.length;
        if (remaining <= 0) {
          setMsg("managerRoomCatalogMsg", false, "You can add up to " + MAX_FACILITY_PHOTOS + " photos.");
          roomImageUpload.value = "";
          return;
        }
        readFilesAsDataUrls(files.slice(0, remaining), function (srcs) {
          srcs.forEach(addFacilityPhoto);
          renderFacilityPhotoPreview();
          roomImageUpload.value = "";
          setMsg(
            "managerRoomCatalogMsg",
            true,
            facilityPhotoDraft.length + " photo" + (facilityPhotoDraft.length === 1 ? "" : "s") + " ready. You can add more."
          );
        });
      });
    }
    roomForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var S = storeOrWarn("managerRoomCatalogMsg");
      if (!S) return;
      var roomType = document.getElementById("managerRoomType");
      var roomKind = document.getElementById("managerRoomKind");
      var roomName = document.getElementById("managerRoomName");
      var roomPrice = document.getElementById("managerRoomPrice");
      var roomUnit = document.getElementById("managerRoomPriceUnit");
      var roomImage = document.getElementById("managerRoomImage");
      var roomImageUpload = document.getElementById("managerRoomImageUpload");
      var roomDesc = document.getElementById("managerRoomDescription");
      var roomCapacity = document.getElementById("managerRoomCapacity");
      var roomCapacityMin = document.getElementById("managerRoomCapacityMin");
      var roomSubmitBtn = document.getElementById("managerRoomSubmitBtn");
      var type = roomType ? String(roomType.value || "room") : "room";
      var kind = roomKind ? String(roomKind.value || "").toLowerCase() : "";
      var name = roomName ? String(roomName.value || "").trim() : "";
      var price = roomPrice ? Number(roomPrice.value || 0) : 0;
      var unit = roomUnit ? String(roomUnit.value || "night") : "night";
      var image = roomImage ? String(roomImage.value || "").trim() : "";
      var desc = roomDesc ? String(roomDesc.value || "").trim() : "";
      var capacity = roomCapacity ? Number(roomCapacity.value || 0) : 0;
      var capacityMin = roomCapacityMin ? Number(roomCapacityMin.value || 0) : 0;
      if (!name || !price || !desc) {
        setMsg("managerRoomCatalogMsg", false, "Please fill in the facility type, name, price, and description.");
        return;
      }
      if (!capacity || capacity <= 0) {
        setMsg("managerRoomCatalogMsg", false, "Please enter a valid maximum number of guests.");
        return;
      }
      if (type === "hall" && (!capacityMin || capacityMin <= 0)) {
        setMsg("managerRoomCatalogMsg", false, "Please enter a valid minimum number of guests for event halls.");
        return;
      }
      if (image) addFacilityPhoto(image);
      var pendingFiles = roomImageUpload && roomImageUpload.files ? Array.prototype.slice.call(roomImageUpload.files) : [];
      var invalid = pendingFiles.some(function (file) {
        return String(file.type || "").indexOf("image/") !== 0;
      });
      if (invalid) {
        setMsg("managerRoomCatalogMsg", false, "Please choose photo files (JPG, PNG, etc.).");
        return;
      }
      withFormLoading(roomForm, function () {
        return new Promise(function (resolve, reject) {
          function finishRoomSave(extraImages) {
            (extraImages || []).forEach(addFacilityPhoto);
            var priceUnit = unit === "day" ? "day" : unit === "event" ? "event" : "night";
            if (type === "hall") priceUnit = "event";
            else if (priceUnit === "event") priceUnit = "night";
            var editId = String(roomForm.getAttribute("data-edit-id") || "").trim();
            var existing = editId ? S.getFacilitiesAll().find(function (item) { return String(item.id) === editId; }) : null;
            var photos = facilityPhotoDraft.slice();
            if (!photos.length && existing) photos = facilityImagesOf(existing);
            Promise.resolve(S.upsertFacility({
              id: editId || undefined,
              type: type,
              roomKind: type === "room" ? kind : "",
              name: name,
              price: Math.round(price),
              priceUnit: priceUnit,
              image: photos[0] || "",
              images: photos,
              description: desc,
              capacity: Math.round(capacity),
              capacityMin: type === "hall" ? Math.round(capacityMin) : null,
              sortOrder: existing ? existing.sortOrder : S.getFacilitiesAll().length + 1,
              active: true
            })).then(function () {
              roomForm.reset();
              roomForm.removeAttribute("data-edit-id");
              if (roomType) roomType.value = "room";
              if (roomUnit) roomUnit.value = "night";
              if (roomImageUpload) roomImageUpload.value = "";
              if (roomSubmitBtn) roomSubmitBtn.textContent = "Add Facility";
              resetFacilityPhotoDraft([]);
              syncFacilityCapacityFields();
              setMsg("managerRoomCatalogMsg", true, editId ? "Facility updated." : "Facility added.");
              renderFacilitiesManager();
              resolve();
            }).catch(reject);
          }
          if (!pendingFiles.length) {
            finishRoomSave([]);
          } else {
            readFilesAsDataUrls(pendingFiles, finishRoomSave);
          }
        });
      });
    });
  }

  function initPoliciesHandlers() {
    var policyForm = document.getElementById("managerPolicyForm");
    if (!policyForm) return;
    policyForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var S = storeOrWarn("managerPolicyMsg");
      if (!S) return;
      var policyKind = document.getElementById("managerPolicyKind");
      var policyTitle = document.getElementById("managerPolicyTitle");
      var policyImage = document.getElementById("managerPolicyImage");
      var policyImageUpload = document.getElementById("managerPolicyImageUpload");
      var policyDescription = document.getElementById("managerPolicyDescription");
      var policySubmitBtn = document.getElementById("managerPolicySubmitBtn");
      var kind = policyKind ? String(policyKind.value || "general").trim().toLowerCase() : "general";
      var title = policyTitle ? String(policyTitle.value || "").trim() : "";
      var image = policyImage ? String(policyImage.value || "").trim() : "";
      var description = policyDescription ? String(policyDescription.value || "").trim() : "";
      if (!kind || !title || !description) {
        setMsg("managerPolicyMsg", false, "Please fill in the policy type, title, and details.");
        return;
      }
      withFormLoading(policyForm, function () {
        return new Promise(function (resolve, reject) {
          function finishSave(uploadedImage) {
            var editId = String(policyForm.getAttribute("data-edit-id") || "").trim();
            var existing = editId ? S.getPolicies().find(function (item) { return String(item.id) === editId; }) : null;
            var finalImage = String(uploadedImage || "").trim() || image || (existing ? existing.image : "") || "";
            Promise.resolve(S.upsertPolicy({
              id: editId || undefined,
              kind: kind,
              title: title,
              image: finalImage,
              description: description,
              sortOrder: existing ? existing.sortOrder : S.getPolicies().length + 1
            })).then(function () {
              policyForm.reset();
              policyForm.removeAttribute("data-edit-id");
              if (policySubmitBtn) policySubmitBtn.textContent = "Add Policy";
              setMsg("managerPolicyMsg", true, editId ? "Policy updated." : "Policy added.");
              renderPoliciesManager();
              resolve();
            }).catch(reject);
          }
          var file = policyImageUpload && policyImageUpload.files ? policyImageUpload.files[0] : null;
          if (!file) {
            finishSave("");
          } else {
            readFileAsDataUrl(file, finishSave);
          }
        });
      });
    });
  }

  function initGalleryHandlers() {
    var form = document.getElementById("cmGalleryForm");
    if (!form) return;

    var cancel = document.getElementById("cmGalleryCancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        resetGalleryForm();
        setMsg("cmGalleryMsg", true, "Editing cancelled.");
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var S = store();
      if (!S || typeof S.upsertGalleryItem !== "function") {
        setMsg("cmGalleryMsg", false, "Photos are unavailable right now. Please refresh the page.");
        return;
      }
      var titleEl = document.getElementById("cmGalleryTitle");
      var imageEl = document.getElementById("cmGalleryImage");
      var uploadEl = document.getElementById("cmGalleryImageUpload");
      var altEl = document.getElementById("cmGalleryAlt");
      var title = titleEl ? String(titleEl.value || "").trim() : "";
      var image = imageEl ? String(imageEl.value || "").trim() : "";
      var alt = altEl ? String(altEl.value || "").trim() : "";
      if (!title) {
        setMsg("cmGalleryMsg", false, "Please enter a photo title.");
        return;
      }
      withFormLoading(form, function () {
        return new Promise(function (resolve, reject) {
          function finishSave(uploadedImage) {
            var editId = String(form.getAttribute("data-edit-id") || "").trim();
            var existing = editId
              ? S.getGalleryAll().find(function (item) { return String(item.id) === editId; })
              : null;
            var finalImage = String(uploadedImage || "").trim() || image || (existing ? existing.image : "") || "";
            if (!finalImage) {
              setMsg("cmGalleryMsg", false, "Paste a photo link or upload a photo.");
              reject(new Error("missing image"));
              return;
            }
            Promise.resolve(S.upsertGalleryItem({
              id: editId || undefined,
              title: title,
              image: finalImage,
              imageAlt: alt || title,
              sortOrder: existing ? existing.sortOrder : S.getGalleryAll().length + 1,
              active: true
            })).then(function () {
              resetGalleryForm();
              setMsg("cmGalleryMsg", true, editId ? "Photo updated." : "Photo added.");
              renderGalleryManager();
              resolve();
            }).catch(reject);
          }
          var file = uploadEl && uploadEl.files ? uploadEl.files[0] : null;
          if (!file) {
            finishSave("");
          } else if (String(file.type || "").indexOf("image/") !== 0) {
            setMsg("cmGalleryMsg", false, "Please choose a photo file (JPG, PNG, etc.).");
            reject(new Error("invalid image"));
          } else {
            readFileAsDataUrl(file, finishSave);
          }
        });
      });
    });
  }

  function init() {
    initTabHandlers();
    initAboutHandlers();
    initFaqHandlers();
    initActivityHandlers();
    initEventHandlers();
    initFacilitiesHandlers();
    initPoliciesHandlers();
    initGalleryHandlers();
    window.addEventListener("elenest-content-updated", function () {
      var section = document.getElementById("section-content");
      if (section && !section.hasAttribute("hidden")) renderSection();
    });
  }

  function renderSection() {
    showTab(getActiveTab());
  }

  window.ElenestContentManagement = {
    init: init,
    renderSection: renderSection,
    showTab: showTab
  };
})();
