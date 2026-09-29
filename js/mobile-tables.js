/**
 * Phone-only list layout for data tables.
 * Desktop and laptop tables are left unchanged.
 */
(function () {
  var MQ = window.matchMedia("(max-width: 700px)");
  var NAME_RE = /guest|customer|name|user|client|reviewer|sender|staff|visitor|author/i;
  var META_RE = /date|facility|room|cottage|hall|status|type|time|booking|phone|amount|payment|stay|arrival|price|title/i;
  var ACTION_RE = /action|manage|options/i;
  var modal = null;
  var parked = [];
  var openTable = null;
  var scanTimer = 0;
  var scanning = false;

  function isPhone() {
    return MQ.matches;
  }

  function skipTable(table) {
    if (!table || table.tagName !== "TABLE") return true;
    if (table.closest("table") !== table) return true;
    if (table.closest(".mgr-doc, [data-m-skip]")) return true;
    if (table.getAttribute("data-m-skip") != null) return true;
    var cls = String(table.className || "");
    if (/mgr-doc__/.test(cls)) return true;
    return false;
  }

  function headerLabels(table) {
    var labels = [];
    var headRow = table.tHead && table.tHead.rows.length ? table.tHead.rows[0] : null;
    if (!headRow && table.rows.length && table.rows[0].querySelector("th")) headRow = table.rows[0];
    if (!headRow) return labels;
    Array.prototype.forEach.call(headRow.cells, function (cell) {
      labels.push(String(cell.textContent || "").replace(/\s+/g, " ").trim());
    });
    return labels;
  }

  function bodyRows(table) {
    var rows = [];
    var bodies = table.tBodies.length ? table.tBodies : [table];
    Array.prototype.forEach.call(bodies, function (body) {
      if (!body || !body.rows) return;
      Array.prototype.forEach.call(body.rows, function (row) {
        if (row.querySelector("th") && !row.querySelector("td")) return;
        rows.push(row);
      });
    });
    return rows;
  }

  function isGroupRow(row) {
    if (!row || row.hidden || row.classList.contains("m-record-extra")) return false;
    if (row.classList.contains("rq-group")) return true;
    if (row.cells.length !== 1) return false;
    var span = parseInt(row.cells[0].colSpan, 10) || 1;
    return span > 1 && !row.querySelector("button, a, input, select, textarea");
  }

  function isDetailRow(row) {
    if (!row || row.classList.contains("rq-group")) return false;
    if (row.classList.contains("m-record-extra")) return true;
    if (/detail/.test(String(row.className || ""))) return true;
    if (row.hidden && row.cells.length === 1) return true;
    if (row.cells.length === 1 && (parseInt(row.cells[0].colSpan, 10) || 1) > 1 && !row.querySelector("button, a, input, select, textarea")) {
      return true;
    }
    return false;
  }

  function cellLines(cell) {
    if (!cell) return [];
    var clone = cell.cloneNode(true);
    var junk = clone.querySelectorAll("button, script, style");
    Array.prototype.forEach.call(junk, function (node) { node.remove(); });
    var lines = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        var text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
        return;
      }
      if (node.nodeType !== 1 || node.tagName === "BUTTON") return;
      Array.prototype.forEach.call(node.childNodes, walk);
    }
    walk(clone);
    return lines;
  }

  function cellText(cell) {
    return cellLines(cell).join(" · ");
  }

  function actionIndex(labels, row) {
    for (var i = 0; i < labels.length; i++) {
      if (ACTION_RE.test(labels[i])) return i;
    }
    var cells = row ? row.cells : [];
    for (var c = cells.length - 1; c >= 0; c--) {
      if (cells[c].querySelector("button, a.btn, .admin-pay-icon-btn")) return c;
    }
    return -1;
  }

  function describeRow(row, labels) {
    var cells = Array.prototype.slice.call(row.cells);
    var act = actionIndex(labels, row);
    var titleIdx = -1;
    var i;
    for (i = 0; i < cells.length; i++) {
      if (i === act) continue;
      if (labels[i] && NAME_RE.test(labels[i]) && cellText(cells[i])) {
        titleIdx = i;
        break;
      }
    }
    if (titleIdx < 0) {
      for (i = 0; i < cells.length; i++) {
        if (i === act) continue;
        if (cellText(cells[i])) {
          titleIdx = i;
          break;
        }
      }
    }
    var title = "Record";
    var extra = [];
    var meta = [];
    if (titleIdx >= 0) {
      var lines = cellLines(cells[titleIdx]);
      title = lines[0] || "Record";
      extra = lines.slice(1);
    }
    for (i = 0; i < cells.length; i++) {
      if (i === act || i === titleIdx) continue;
      var text = cellText(cells[i]);
      if (!text) continue;
      if (labels[i] && META_RE.test(labels[i])) meta.push(text);
    }
    extra.forEach(function (line) {
      if (meta.length < 2) meta.push(line);
    });
    if (!meta.length) {
      for (i = 0; i < cells.length; i++) {
        if (i === act || i === titleIdx) continue;
        var fallback = cellText(cells[i]);
        if (fallback) meta.push(fallback);
        if (meta.length >= 2) break;
      }
    }
    return {
      title: title,
      meta: meta.slice(0, 2).join(" · ")
    };
  }

  function walk(table) {
    var labels = headerLabels(table);
    var items = [];
    var current = null;
    bodyRows(table).forEach(function (row) {
      if (isGroupRow(row)) {
        current = null;
        items.push({ kind: "section", text: cellText(row.cells[0]) || "Details" });
        return;
      }
      if (isDetailRow(row)) {
        if (current) current.details.push(row);
        return;
      }
      var info = describeRow(row, labels);
      current = {
        kind: "record",
        row: row,
        labels: labels,
        title: info.title,
        meta: info.meta,
        details: []
      };
      items.push(current);
    });
    return items;
  }

  function signature(table) {
    return walk(table).map(function (item) {
      if (item.kind === "section") return "s:" + item.text;
      return "r:" + item.title + "|" + item.meta;
    }).join("\n");
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "m-record-modal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML =
      '<div class="m-record-modal__panel">' +
        '<div class="m-record-modal__head">' +
          '<h3 class="m-record-modal__title">Details</h3>' +
          '<button type="button" class="m-record-modal__close" aria-label="Close">Close</button>' +
        "</div>" +
        '<div class="m-record-modal__body"></div>' +
        '<div class="m-record-modal__actions"></div>' +
      "</div>";
    document.body.appendChild(modal);
    modal.querySelector(".m-record-modal__close").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal && !modal.hidden) closeModal();
    });
    return modal;
  }

  function restoreParked() {
    parked.forEach(function (item) {
      if (!item.marker || !document.contains(item.marker) || !item.marker.parentNode) return;
      var parent = item.marker.parentNode;
      item.nodes.forEach(function (node) {
        if (node && node.parentNode !== parent) parent.insertBefore(node, item.marker);
      });
      parent.removeChild(item.marker);
    });
    parked = [];
  }

  function park(nodes, destination) {
    var list = Array.prototype.filter.call(nodes, function (node) {
      return node && node.parentNode;
    });
    if (!list.length || !destination) return;
    list.forEach(function (node) {
      var parent = node.parentNode;
      var marker = document.createComment("m-park");
      parent.insertBefore(marker, node);
      destination.appendChild(node);
      parked.push({ marker: marker, nodes: [node] });
    });
  }

  function closeModal() {
    if (!modal) return;
    if (openTable && !document.contains(openTable)) parked = [];
    restoreParked();
    var body = modal.querySelector(".m-record-modal__body");
    var actions = modal.querySelector(".m-record-modal__actions");
    if (body) body.textContent = "";
    if (actions) actions.textContent = "";
    modal.hidden = true;
    document.documentElement.classList.remove("m-record-open");
    document.body.classList.remove("m-record-open");
    openTable = null;
  }

  function cloneCellContents(cell) {
    var wrap = document.createElement("div");
    if (!cell) return wrap;
    Array.prototype.forEach.call(cell.childNodes, function (node) {
      wrap.appendChild(node.cloneNode(true));
    });
    return wrap;
  }

  function addField(body, label, valueNode) {
    var row = document.createElement("div");
    row.className = "m-record-modal__row";
    var lab = document.createElement("div");
    lab.className = "m-record-modal__label";
    lab.textContent = label || "Detail";
    var val = document.createElement("div");
    val.className = "m-record-modal__value";
    if (valueNode) val.appendChild(valueNode);
    row.appendChild(lab);
    row.appendChild(val);
    body.appendChild(row);
  }

  function seenLabel(seen, label) {
    var key = String(label || "").toLowerCase();
    if (!key || seen[key]) return true;
    seen[key] = true;
    return false;
  }

  function openRecord(table, item) {
    closeModal();
    var box = ensureModal();
    var body = box.querySelector(".m-record-modal__body");
    var actions = box.querySelector(".m-record-modal__actions");
    var title = box.querySelector(".m-record-modal__title");
    if (title) title.textContent = item.title || "Details";
    var labels = item.labels || [];
    var seen = {};
    var act = actionIndex(labels, item.row);
    Array.prototype.forEach.call(item.row.cells, function (cell, index) {
      if (index === act) {
        park(Array.prototype.slice.call(cell.childNodes), actions);
        return;
      }
      var label = labels[index] || ("Detail " + (index + 1));
      var text = cellText(cell);
      if (!text && !cell.querySelector("img")) return;
      if (seenLabel(seen, label)) return;
      addField(body, label, cloneCellContents(cell));
    });
    (item.details || []).forEach(function (detail) {
      var structured = detail.querySelectorAll("dt, .rq-detail__label");
      if (structured.length) {
        Array.prototype.forEach.call(structured, function (labelEl) {
          var label = String(labelEl.textContent || "").trim();
          var valueEl = labelEl.nextElementSibling;
          if (!valueEl || seenLabel(seen, label)) return;
          addField(body, label, valueEl.cloneNode(true));
        });
      }
      var buttons = detail.querySelectorAll("button, a.btn, .admin-pay-icon-btn");
      if (buttons.length) park(buttons, actions);
    });
    actions.hidden = !actions.childNodes.length;
    openTable = table;
    box.hidden = false;
    document.documentElement.classList.add("m-record-open");
    document.body.classList.add("m-record-open");
    var closeBtn = box.querySelector(".m-record-modal__close");
    if (closeBtn) closeBtn.focus();
  }

  function buildList(table, items) {
    var list = document.createElement("div");
    list.className = "m-record-list";
    list.setAttribute("data-m-sig", signature(table));
    items.forEach(function (item) {
      if (item.kind === "section") {
        var section = document.createElement("p");
        section.className = "m-record-section";
        section.textContent = item.text;
        list.appendChild(section);
        return;
      }
      var card = document.createElement("article");
      card.className = "m-record";
      var main = document.createElement("div");
      main.className = "m-record__main";
      var heading = document.createElement("p");
      heading.className = "m-record__title";
      heading.textContent = item.title;
      main.appendChild(heading);
      if (item.meta) {
        var meta = document.createElement("p");
        meta.className = "m-record__meta";
        meta.textContent = item.meta;
        main.appendChild(meta);
      }
      var view = document.createElement("button");
      view.type = "button";
      view.className = "btn btn--outline btn--small m-record__view";
      view.textContent = "View";
      view.setAttribute("aria-label", "View details for " + item.title);
      view.addEventListener("click", function () {
        openRecord(table, item);
      });
      card.appendChild(main);
      card.appendChild(view);
      list.appendChild(card);
    });
    return list;
  }

  function syncTable(table) {
    if (skipTable(table)) return;
    var items = walk(table);
    var host = table.parentNode;
    if (!host) return;
    var next = table.nextElementSibling;
    var existing = next && next.classList && next.classList.contains("m-record-list") ? next : null;
    if (!items.length) {
      table.classList.remove("m-src");
      table.inert = false;
      host.classList.remove("m-host");
      if (existing) existing.remove();
      return;
    }
    var sig = signature(table);
    if (existing && existing.getAttribute("data-m-sig") === sig) {
      table.classList.add("m-src");
      table.inert = true;
      host.classList.add("m-host");
      return;
    }
    if (openTable === table) closeModal();
    var list = buildList(table, items);
    if (existing) existing.replaceWith(list);
    else host.insertBefore(list, table.nextSibling);
    table.classList.add("m-src");
    table.inert = true;
    host.classList.add("m-host");
  }

  function clearMobile() {
    closeModal();
    document.querySelectorAll(".m-record-list").forEach(function (list) { list.remove(); });
    document.querySelectorAll("table.m-src").forEach(function (table) {
      table.classList.remove("m-src");
      table.inert = false;
      if (table.parentNode) table.parentNode.classList.remove("m-host");
    });
  }

  function sync() {
    if (scanning) return;
    scanning = true;
    try {
      if (!isPhone()) {
        clearMobile();
        return;
      }
      if (openTable && !document.contains(openTable)) closeModal();
      document.querySelectorAll("table").forEach(syncTable);
      document.querySelectorAll(".m-record-list").forEach(function (list) {
        var prev = list.previousElementSibling;
        if (!prev || prev.tagName !== "TABLE") list.remove();
      });
    } finally {
      scanning = false;
    }
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(sync, 50);
  }

  function start() {
    sync();
    if (document.body) {
      var observer = new MutationObserver(function (records) {
        var relevant = records.some(function (record) {
          var node = record.target;
          if (!node || node.nodeType !== 1) return true;
          if (node.closest && node.closest(".m-record-list, .m-record-modal")) return false;
          return true;
        });
        if (relevant) schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (typeof MQ.addEventListener === "function") MQ.addEventListener("change", sync);
    else if (typeof MQ.addListener === "function") MQ.addListener(sync);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
