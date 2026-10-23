/* The hub board: categories of links you drag around, plus a 12-slot quick pad.
   State lives in hub.json on disk; every change is written straight through. */
(function () {
  "use strict";

  var board = { quickpad: [], categories: [], inbox: [] };
  var filter = "";
  var editingCat = null;
  var editingLink = null;
  var padTarget = null;

  /* ------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function hue(seed) {
    var n = 0, s = String(seed || "?");
    for (var i = 0; i < s.length; i++) { n = (n * 31 + s.charCodeAt(i)) >>> 0; }
    return "hsl(" + (n % 360) + " 48% 48%)";
  }

  /* A letter tile for anything with no icon, so nothing is ever blank. */
  function iconSrc(path, bust) {
    var v = bust ? Date.now() : (board.iconsVersion || "");
    return "/" + path + (v ? "?v=" + v : "");
  }

  function glyph(item, cls) {
    if (item && item.icon) {
      return '<img src="' + esc(iconSrc(item.icon)) + '" alt="" loading="lazy">';
    }
    var label = (item && (item.title || item.name)) || "?";
    var seed = (item && item.url ? host(item.url) : label);
    return '<span class="' + cls + '" style="background:' + hue(seed) + '">' +
      esc(label.trim().charAt(0).toUpperCase()) + "</span>";
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function api(method, path, body) {
    return fetch("/api" + path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.error || r.statusText);
      }); }
      return r.json();
    });
  }

  /* Push the whole board after a drag — order is the thing that changed. */
  var pushTimer = null;
  function pushBoard() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      api("PUT", "/board", board).catch(function (e) { toast("Not saved: " + e.message); });
    }, 120);
  }

  function linkById(id) {
    for (var i = 0; i < board.categories.length; i++) {
      var ls = board.categories[i].links;
      for (var j = 0; j < ls.length; j++) { if (ls[j].id === id) { return ls[j]; } }
    }
    for (var k = 0; k < board.inbox.length; k++) {
      if (board.inbox[k].id === id) { return board.inbox[k]; }
    }
    return null;
  }

  function catById(id) {
    return board.categories.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* A plain click navigates this tab, like a normal link. Ctrl/Cmd-click,
     middle-click or shift-click opens a new one. */
  var framed = window.top !== window.self;

  function wantsNewTab(ev) {
    return !!ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1);
  }

  /* Wire an element so it behaves like a link: plain click navigates here,
     ctrl/cmd/shift-click and middle-click open a new tab. */
  function openOn(el, url, id) {
    if (!el) { return; }
    el.addEventListener("click", function (ev) { open(url, id, ev); });
    el.addEventListener("auxclick", function (ev) {
      if (ev.button === 1) { ev.preventDefault(); open(url, id, ev); }
    });
    el.addEventListener("mousedown", function (ev) {
      if (ev.button === 1) { ev.preventDefault(); }   // no autoscroll cursor
    });
  }

  function open(url, id, ev) {
    if (id) {
      var at = "/api/links/" + id + "/click";
      // A normal fetch would be cancelled by the navigation, so beacon it.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(at, new Blob([], { type: "application/json" }));
      } else {
        fetch(at, { method: "POST", keepalive: true }).catch(function () {});
      }
    }
    if (wantsNewTab(ev)) {
      window.open(url, "_blank", "noopener");
    } else if (framed) {
      // Inside the new-tab frame: navigate the tab, not the frame.
      window.open(url, "_top");
    } else {
      window.location.href = url;
    }
  }

  /* ------------------------------------------------------------- quick pad */

  function renderPad() {
    var pad = $("pad");
    pad.innerHTML = board.quickpad.map(function (slot, i) {
      if (!slot) {
        return '<div class="slot blank" data-slot="' + i + '" title="Drag a link here"></div>';
      }
      // The link it points at is the truth; the slot is only a pointer.
      var live = linkById(slot.id) || slot;
      return '<div class="slot" data-slot="' + i + '" title="' + esc(live.title) + '">' +
        glyph(live, "mono") + '<span class="cap">' + esc(live.title) + "</span>" +
        '<button class="unpin" title="Remove from quick links">&times;</button></div>';
    }).join("");

    [].forEach.call(pad.children, function (el) {
      var i = +el.dataset.slot;

      var un = el.querySelector(".unpin");
      if (un) {
        un.addEventListener("click", function (ev) {
          ev.stopPropagation();
          unpin(i);
        });
      }

      el.addEventListener("contextmenu", function (ev) {
        var slot = board.quickpad[i];
        if (!slot) { return; }
        var live = linkById(slot.id) || slot;
        showCtx(ev, live.title, [
          { label: "Open", run: function () { open(live.url, slot.id); } },
          { label: "Open in a new tab",
            run: function () { window.open(live.url, "_blank", "noopener"); } },
          { label: "Copy link", run: function () { copyText(live.url, "Link"); } },
          { label: "Edit\u2026", run: function () { openSlotSheet(i); } },
          "-",
          { label: "Remove from quick links", danger: true,
            run: function () { unpin(i); } }
        ]);
      });

      el.addEventListener("click", function (ev) {
        var slot = board.quickpad[i];
        if (!slot) { return; }
        slot = linkById(slot.id) || slot;
        if (ev.altKey) { unpin(i); return; }
        open(slot.url, slot.id, ev);
      });

    });

    // Dropping a link onto the pad pins it. The pad is part of the same drag
    // group as the category lists, so one system handles every drag.
    Sortable.create(pad, {
      group: { name: "links", pull: false, put: true },
      sort: true,
      forceFallback: true,
      animation: 140,
      draggable: ".slot",
      // Rearranging the pad: the tiles carry their original index, so the new
      // DOM order is enough to rebuild the twelve slots, blanks included.
      onUpdate: function () {
        var order = [].map.call(pad.querySelectorAll(".slot"), function (el) {
          return board.quickpad[+el.dataset.slot];
        });
        while (order.length < 12) { order.push(null); }
        board.quickpad = order.slice(0, 12);
        renderPad();
        pushBoard();
      },
      onAdd: function (ev) {
        var id = ev.item.dataset.link;
        var slot = Math.min(Math.max(ev.newIndex, 0), 11);
        ev.item.remove();            // the model is the truth; drop the stray node
        var link = linkById(id);
        if (!link) { renderPad(); return; }
        board.quickpad[slot] = {
          id: link.id, title: link.title, url: link.url, icon: link.icon || ""
        };
        renderPad();
        renderBoard();
        pushBoard();
        toast("Pinned to slot " + (slot + 1));
      }
    });
  }

  /* ------------------------------------------------------------- board */

  function matches(link) {
    if (!filter) { return true; }
    return (link.title + " " + link.url).toLowerCase().indexOf(filter) >= 0;
  }

  function childrenOf(id) {
    return board.categories.filter(function (c) { return (c.parent || "") === id; });
  }

  function catBody(c, links) {
    return '<ul class="links" data-cat="' + c.id + '">' +
      links.map(function (l) {
        return '<li data-link="' + l.id + '">' +
          '<div class="row">' + glyph(l, "mono") +
            '<span class="t" title="' + esc(l.url) + '">' + esc(l.title) + "</span>" +
            '<button class="x" title="Edit">&#8942;</button>' +
          "</div></li>";
      }).join("") +
      "</ul>";
  }

  function subCard(c) {
    var links = c.links.filter(matches);
    if (filter && !links.length) { return ""; }
    return '<section class="card subcat' + (c.collapsed ? " closed" : "") + '" data-cat="' + c.id + '"' +
        (c.color ? ' style="--tint:' + esc(c.color) + '"' : "") + ">" +
      '<div class="subhead">' +
        '<button class="chev" title="Collapse">&#9660;</button>' +
        glyph({ icon: c.icon, title: c.name }, "mono") +
        "<h4>" + esc(c.name) + "</h4>" +
        '<span class="cnt">' + c.links.length + "</span>" +
        '<button class="gear" title="Edit category">&#9881;</button>' +
      "</div>" +
      '<div class="fold"><div class="inner">' + catBody(c, links) +
        '<div class="subs" data-parent="' + c.id + '"></div>' +
      "</div></div>" +
      "</section>";
  }

  function renderBoard() {
    var cols = $("cols");
    cols.innerHTML = board.categories.filter(function (c) { return !c.parent; })
      .map(function (c) {
        var links = c.links.filter(matches);
        var kids = childrenOf(c.id);
        var kidHtml = kids.map(subCard).join("");
        if (filter && !links.length && !kidHtml) { return ""; }
        var total = c.links.length + kids.reduce(function (a, k) { return a + k.links.length; }, 0);
        return '<section class="card cat' + (c.collapsed ? " closed" : "") + '" data-cat="' + c.id + '"' +
            (c.color ? ' style="--tint:' + esc(c.color) + '"' : "") + ">" +
          '<div class="cathead">' +
            '<button class="chev" title="Collapse">&#9660;</button>' +
            glyph({ icon: c.icon, title: c.name }, "mono") +
            "<h3>" + esc(c.name) + "</h3>" +
            '<span class="cnt">' + total + "</span>" +
            '<button class="gear" title="Edit category">&#9881;</button>' +
          "</div>" +
          '<div class="fold"><div class="inner">' +
            catBody(c, links) +
            '<div class="subs" data-parent="' + c.id + '">' + kidHtml + "</div>" +
          "</div></div>" +
          "</section>";
      }).join("");

    wire();
    packCards();
  }

  function wire() {
    var cols = $("cols");

    [].forEach.call(cols.querySelectorAll(".cat, .subcat"), function (sec) {
      var cat = catById(sec.dataset.cat);
      if (!cat) { return; }

      sec.querySelector(".gear").addEventListener("click", function (ev) {
        ev.stopPropagation();
        openCatSheet(cat);
      });

      sec.querySelector(".chev").addEventListener("click", function (ev) {
        ev.stopPropagation();
        setCollapsed(cat, !cat.collapsed);
      });

      [].forEach.call(sec.querySelectorAll("li"), function (li) {
        var link = linkById(li.dataset.link);
        openOn(li.querySelector(".t"), link.url, link.id);
        openOn(li.querySelector(".row").firstElementChild, link.url, link.id);
        li.querySelector(".x").addEventListener("click", function (ev) {
          ev.stopPropagation();
          linkMenu(ev, link, cat);
        });
        li.addEventListener("contextmenu", function (ev) { linkMenu(ev, link, cat); });
      });

      var head = sec.querySelector(".cathead, .subhead");
      if (head) {
        head.addEventListener("contextmenu", function (ev) { categoryMenu(ev, cat); });
      }
    });

    // Links: reorder inside a category and move between categories.
    [].forEach.call(cols.querySelectorAll(".links"), function (ul) {
      Sortable.create(ul, {
        group: "links",
        animation: 140,
        // Mouse-event dragging rather than the browser's own: it behaves the
        // same everywhere and the drag image follows the cursor properly.
        forceFallback: true,
        ghostClass: "drag-ghost",
        chosenClass: "drag-chosen",
        onStart: function (ev) { armBin(true); dragging = ev.item.dataset.link; },
        onEnd: function (ev) {
          armBin(false);
          var droppedOnBin = lastPointerOverBin;
          dragging = null;
          if (droppedOnBin) {
            ev.item.remove();
            trashLink(ev.item.dataset.link);
            return;
          }
          var fromCat = catById(ev.from.dataset.cat);
          var toCat = catById(ev.to.dataset.cat);
          if (!fromCat || !toCat) { return; }
          var moved = fromCat.links.splice(ev.oldIndex, 1)[0];
          toCat.links.splice(ev.newIndex, 0, moved);
          pushBoard();
          renderCounts();
          packCards();
        }
      });
    });

    // Sub-categories reorder inside their parent, and can be dragged out to the bin.
    [].forEach.call(cols.querySelectorAll(".subs"), function (box) {
      Sortable.create(box, {
        group: "cards",
        animation: 150,
        onChange: packCards,
        handle: ".cathead, .subhead",
        draggable: ".card",
        forceFallback: true,
        ghostClass: "ghost",
        onStart: function (ev) { armBin(true, "category"); dragging = ev.item.dataset.cat; },
        onEnd: function (ev) {
          armBin(false);
          var onBin = lastPointerOverBin;
          dragging = null;
          if (onBin) { ev.item.remove(); trashCategory(ev.item.dataset.cat); return; }
          reorderFromDom();
          renderBoard();
          pushBoard();
        }
      });
    });

    // Categories: reorder the whole board by dragging a header.
    Sortable.create(cols, {
      group: "cards",
      animation: 160,
      onChange: packCards,
      handle: ".cathead, .subhead",
      draggable: ".card",
      forceFallback: true,
      ghostClass: "ghost",
      onStart: function (ev) {
        armBin(true, "category");
        dragging = ev.item.dataset.cat;
      },
      onEnd: function (ev) {
        armBin(false);
        var droppedOnBin = lastPointerOverBin;
        dragging = null;
        if (droppedOnBin) {
          ev.item.remove();
          trashCategory(ev.item.dataset.cat);
          return;
        }
        reorderFromDom();
        renderBoard();
        pushBoard();
      }
    });
  }

  /* Each card claims the number of 8px grid rows its content actually needs. */
  var ROW = 8, GAP = 16;
  function packCards() {
    [].forEach.call(document.querySelectorAll(".cat"), function (sec) {
      sec.style.gridRowEnd = "span " + Math.ceil((sec.offsetHeight + GAP) / ROW);
    });
  }
  window.addEventListener("resize", function () {
    clearTimeout(packCards._t);
    packCards._t = setTimeout(packCards, 120);
  });

  /* With nesting, Sortable's indices are per-container. The rendered order is
     the simpler truth: read it back and rebuild the list from it. */
  function reorderFromDom() {
    var seen = [];
    var taken = {};

    // Sortable's ghost and fallback clones carry the same data-cat as the card
    // being dragged, so the DOM can show one card twice mid-drag. Reading that
    // back without guarding duplicated the category.
    function claim(el, parentId) {
      if (el.classList.contains("drag-ghost") || el.classList.contains("ghost") ||
          el.classList.contains("sortable-fallback") ||
          el.classList.contains("sortable-drag")) { return null; }
      var cat = catById(el.dataset.cat);
      if (!cat || taken[cat.id]) { return null; }
      taken[cat.id] = true;
      cat.parent = parentId;
      seen.push(cat);
      return cat;
    }

    [].forEach.call(document.querySelectorAll("#cols > .card"), function (sec) {
      var top = claim(sec, "");
      if (!top) { return; }
      [].forEach.call(sec.querySelectorAll(".subs > .card"), function (sub) {
        claim(sub, top.id);
      });
    });

    board.categories.forEach(function (c) {
      if (!taken[c.id]) { taken[c.id] = true; seen.push(c); }
    });
    board.categories = seen;
  }

  function renderCounts() {
    [].forEach.call(document.querySelectorAll(".cat"), function (sec) {
      var c = catById(sec.dataset.cat);
      if (c) { sec.querySelector(".cnt").textContent = c.links.length; }
    });
  }


  /* ------------------------------------------------------------- collapse */

  function setCollapsed(cat, closed) {
    cat.collapsed = closed;
    var sec = document.querySelector('[data-cat="' + cat.id + '"].cat, [data-cat="' + cat.id + '"].subcat');
    if (sec) {
      sec.classList.toggle("closed", closed);
      // The card's height is mid-transition, so repack as it moves and once more
      // at the end, or the grid rows would jump to the final size immediately.
      var until = Date.now() + 300;
      (function follow() {
        packCards();
        if (Date.now() < until) { requestAnimationFrame(follow); }
      })();
    }
    api("PATCH", "/categories/" + cat.id, { collapsed: closed })
      .catch(function (e) { toast("Not saved: " + e.message); });
  }

  function setAllCollapsed(closed) {
    board.categories.forEach(function (c) { c.collapsed = closed; });
    [].forEach.call(document.querySelectorAll(".cat, .subcat"), function (sec) {
      sec.classList.toggle("closed", closed);
    });
    var until = Date.now() + 320;
    (function follow() {
      packCards();
      if (Date.now() < until) { requestAnimationFrame(follow); }
    })();
    pushBoard();
    toast(closed ? "All collapsed" : "All expanded");
  }

  /* ------------------------------------------------------------- trash */

  function renderTrash() {
    var n = board.trash ? board.trash.length : 0;
    $("trashn").textContent = n;
    $("trashn").className = "n" + (n ? "" : " zero");

    var ul = $("trashlist");
    $("emptytrash").disabled = !n;
    $("restoreall").disabled = !n;
    $("trashsub").textContent = n
      ? n + " item" + (n === 1 ? "" : "s") + " waiting. Kept for 30 days, then cleared automatically."
      : "Nothing here right now.";

    if (!n) {
      ul.innerHTML = '<li class="emptystate"><strong>The trash is empty</strong>' +
        "Anything you delete lands here first, so nothing is lost by accident." +
        "<ul><li>Drag a link onto the bin, or use the \u22ee menu on it</li>" +
        "<li>Drag a whole category onto the bin and its links come with it</li>" +
        "<li>Every item shows how many days it has left, and Restore puts it back</li></ul></li>";
      return;
    }
    var now = Date.now() / 1000;
    ul.innerHTML = board.trash.map(function (t) {
      var left = Math.max(0, Math.ceil(30 - (now - (t.deletedAt || now)) / 86400));
      var isCat = t.kind === "category";
      var n = isCat ? t.links.length : 0;
      var where = isCat ? "category · " + n + " link" + (n === 1 ? "" : "s")
                        : (t.from || "Inbox");
      var goesTo = isCat ? "back to the board"
                         : (t.fromId && catById(t.fromId) ? "back to " + catById(t.fromId).name
                                                          : "back to the inbox");
      return '<li data-link="' + t.id + '">' +
        glyph({ icon: t.icon, title: t.title || t.name }, "mono") +
        '<span class="t"><div>' + esc(t.title || t.name) + "</div>" +
        '<div class="h">' + esc(where) + " · " + left + " day" + (left === 1 ? "" : "s") +
        " left</div></span>" +
        '<span class="back">' + esc(goesTo) + "</span>" +
        '<button class="act" data-do="restore">Restore</button>' +
        '<button class="iconbtn" data-do="purge" title="Delete for good">' + TRASH_SVG + "</button></li>";
    }).join("");

    [].forEach.call(ul.querySelectorAll("li[data-link]"), function (li) {
      var id = li.dataset.link;
      li.querySelector('[data-do="restore"]').addEventListener("click", function () {
        var item = board.trash.filter(function (t) { return t.id === id; })[0];
        var wasCat = item && item.kind === "category";
        api("POST", "/trash/" + id + "/restore")
          .then(function () { return refreshBoard(); })
          .then(function () {
            var home = (!wasCat && item && item.fromId) ? catById(item.fromId) : null;
            toast(wasCat ? "Category restored"
                         : (home ? "Back in " + home.name : "Back in the inbox"));
          });
      });
      li.querySelector('[data-do="purge"]').addEventListener("click", function () {
        api("DELETE", "/trash/" + id).then(function () {
          board.trash = board.trash.filter(function (t) { return t.id !== id; });
          renderTrash();
        });
      });
    });
  }

  /* The bin only exists while something is being dragged. */
  var bin = $("bin");
  var dragging = null;
  var lastPointerOverBin = false;
  // Sortable's own move events don't fire over the bin, since the bin is not
  // one of its lists — so the pointer is tracked here instead.
  document.addEventListener("pointermove", function (ev) {
    if (!dragging) { return; }
    lastPointerOverBin = overBin(ev);
    bin.classList.toggle("over", lastPointerOverBin);
  }, true);
  function armBin(on, what) {
    bin.classList.toggle("armed", on);
    if (!on) { bin.classList.remove("over"); return; }
    bin.querySelector("span").textContent =
      what === "category" ? "Drop a category here to delete it and its links"
                          : "Drop here to delete";
  }

  function overBin(ev) {
    if (!bin.classList.contains("armed")) { return false; }
    var r = bin.getBoundingClientRect();
    var x = ev.clientX, y = ev.clientY;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function trashLink(id) {
    var link = linkById(id);
    if (!link) { return; }
    board.categories.forEach(function (c) {
      c.links = c.links.filter(function (l) { return l.id !== id; });
    });
    board.inbox = board.inbox.filter(function (l) { return l.id !== id; });
    api("DELETE", "/links/" + id).then(function () {
      return fetch("/api/board").then(function (r) { return r.json(); });
    }).then(function (fresh) {
      board.trash = fresh.trash;
      renderTrash();
    }).catch(function () {});
    renderBoard(); renderPad(); renderInbox();
    toast("Moved to the trash");
  }

  /* ------------------------------------------------------------- freshness */

  /* The page holds the board in memory, but the extension writes to the file
     behind its back. So re-read before showing a list, and when the tab comes
     back to the front — never mid-drag or mid-edit, which would clobber it. */
  function busy() {
    return !!dragging || !!document.querySelector(".scrim.open");
  }

  function refreshBoard(then) {
    return fetch("/api/board").then(function (r) { return r.json(); }).then(function (fresh) {
      board = fresh;
      while (board.quickpad.length < 12) { board.quickpad.push(null); }
      renderPad(); renderBoard(); renderInbox(); renderTrash();
      if (then) { then(); }
    }).catch(function () { if (then) { then(); } });
  }

  window.addEventListener("focus", function () { if (!busy()) { refreshBoard(); } });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !busy()) { refreshBoard(); }
  });

  function trashCategory(catId) {
    var cat = catById(catId);
    if (!cat) { return; }
    var n = cat.links.length;
    board.categories = board.categories.filter(function (c) { return c.id !== catId; });
    renderBoard();
    renderPad();
    api("DELETE", "/categories/" + catId)
      .then(function () { return refreshBoard(); })
      .then(function () {
        toast("\u201c" + cat.name + "\u201d and its " + n + " link" + (n === 1 ? "" : "s") + " moved to the trash");
      })
      .catch(function (e) { toast("Not deleted: " + e.message); refreshBoard(); });
  }


  /* ------------------------------------------------------------- context menu */

  var ctxEl = null;

  function closeCtx() {
    if (ctxEl) { ctxEl.remove(); ctxEl = null; }
  }
  document.addEventListener("click", closeCtx);
  document.addEventListener("scroll", closeCtx, true);
  window.addEventListener("blur", closeCtx);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeCtx(); }
  });

  /* items: {label, run, danger, disabled} or the string "-" for a divider. */
  function showCtx(ev, title, items) {
    ev.preventDefault();
    ev.stopPropagation();
    closeCtx();

    var el = document.createElement("div");
    el.className = "ctx";
    if (title) {
      var h = document.createElement("div");
      h.className = "head";
      h.textContent = title;
      el.appendChild(h);
    }
    items.forEach(function (it) {
      if (it === "-") {
        var sep = document.createElement("div");
        sep.className = "sep";
        el.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      if (it.danger) { b.classList.add("danger"); }
      if (it.disabled) { b.disabled = true; }
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeCtx();
        if (!it.disabled) { it.run(); }
      });
      el.appendChild(b);
    });

    el.style.visibility = "hidden";
    document.body.appendChild(el);
    var w = el.offsetWidth, h2 = el.offsetHeight;
    el.style.left = Math.min(ev.clientX, window.innerWidth - w - 8) + "px";
    el.style.top = Math.min(ev.clientY, window.innerHeight - h2 - 8) + "px";
    el.style.visibility = "";
    ctxEl = el;
  }

  function copyText(text, what) {
    var done = function () { toast(what + " copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Could not copy"); }
      ta.remove();
    }
  }

  function pinToPad(link) {
    var free = -1;
    for (var n = 0; n < board.quickpad.length; n++) {
      if (!board.quickpad[n]) { free = n; break; }
    }
    if (free < 0) {
      toast("Quick links is full \u2014 remove one first");
      return;
    }
    // The slot carries the whole link, not a pointer, so pinning something
    // straight out of the inbox can take it out of the inbox with it.
    board.quickpad[free] = {
      id: link.id, title: link.title, url: link.url, icon: link.icon || "", note: link.note || ""
    };
    var wasInInbox = board.inbox.some(function (l) { return l.id === link.id; });
    if (wasInInbox) {
      board.inbox = board.inbox.filter(function (l) { return l.id !== link.id; });
    }
    renderPad();
    if (wasInInbox) { renderInbox(); }
    pushBoard();
    toast(wasInInbox ? "Pinned, and cleared from the inbox" : "Pinned to quick links");
  }

  /* Unpinning something that lives nowhere else puts it back in the inbox
     rather than dropping it on the floor. */
  function unpin(i) {
    var slot = board.quickpad[i];
    board.quickpad[i] = null;
    if (slot && !linkById(slot.id)) {
      board.inbox.unshift({
        id: slot.id, title: slot.title, url: slot.url,
        icon: slot.icon || "", note: slot.note || "", clicks: 0, added: ""
      });
      renderInbox();
      toast("Unpinned \u2014 back in the inbox");
    } else {
      toast("Removed from quick links");
    }
    renderPad();
    pushBoard();
  }

  function linkMenu(ev, link, cat) {
    var alreadyPinned = board.quickpad.some(function (s) { return s && s.id === link.id; });
    showCtx(ev, link.title, [
      { label: "Open", run: function () { open(link.url, link.id); } },
      { label: "Open in a new tab",
        run: function () { window.open(link.url, "_blank", "noopener"); } },
      { label: "Copy link", run: function () { copyText(link.url, "Link"); } },
      "-",
      alreadyPinned
        ? { label: "Remove from quick links", run: function () {
            var at = -1;
            board.quickpad.forEach(function (s, n) { if (s && s.id === link.id) { at = n; } });
            if (at >= 0) { unpin(at); }
          } }
        : { label: "Add to quick links", run: function () { pinToPad(link); } },
      { label: "Edit\u2026", run: function () { openLinkSheet(link, cat && cat.id); } },
      "-",
      { label: "Move to trash", danger: true, run: function () { trashLink(link.id); } }
    ]);
  }

  function categoryMenu(ev, cat) {
    var kids = childrenOf(cat.id);
    var count = cat.links.length;
    showCtx(ev, cat.name, [
      { label: "Add link\u2026", run: function () { openLinkSheet(null, cat.id); } },
      { label: cat.collapsed ? "Expand" : "Collapse",
        run: function () { setCollapsed(cat, !cat.collapsed); } },
      { label: "Open all " + count + " link" + (count === 1 ? "" : "s"),
        disabled: !count,
        run: function () {
          cat.links.forEach(function (l, i) {
            setTimeout(function () { window.open(l.url, "_blank", "noopener"); }, i * 120);
          });
        } },
      "-",
      { label: "Edit category\u2026", run: function () { openCatSheet(cat); } },
      "-",
      { label: kids.length
          ? "Move to trash (with " + kids.length + " sub-categor" + (kids.length === 1 ? "y" : "ies") + ")"
          : "Move to trash",
        danger: true, run: function () { trashCategory(cat.id); } }
    ]);
  }

  /* ------------------------------------------------------------- sheets */

  function showSheet(id) { $(id).classList.add("open"); }
  function hideSheets() {
    [].forEach.call(document.querySelectorAll(".scrim"), function (s) { s.classList.remove("open"); });
  }

  function paintPreview(previewId, icon) {
    $(previewId).innerHTML = icon
      ? '<img src="' + esc(iconSrc(icon, true)) + '" alt="">' : "";
  }

  var pickedColor = "";
  var pickedPalette = [];

  function paintSwatches() {
    var el = $("cat-swatches");
    var list = pickedPalette.slice(0, 5);
    el.innerHTML = '<button class="sw none" data-c="" title="No colour">&times;</button>' +
      list.map(function (c) {
        return '<button class="sw" data-c="' + esc(c) + '" style="background:' + esc(c) +
          '" title="' + esc(c) + '"></button>';
      }).join("");
    [].forEach.call(el.children, function (b) {
      b.setAttribute("aria-pressed", b.dataset.c === pickedColor);
      b.addEventListener("click", function () {
        pickedColor = b.dataset.c;
        paintSwatches();
      });
    });
  }

  var pickedParent = "";

  function paintParentPicker(cat) {
    var box = $("cat-parent");
    box.innerHTML = "";
    var TOP = { id: "", name: "Top level", icon: "" };
    var picker = buildPicker(function (id) {
      pickedParent = id;
      paintParentPicker(cat);
    }, {
      label: pickedParent ? (catById(pickedParent) || TOP).name : "Top level",
      items: function () {
        return [TOP].concat(board.categories.filter(function (c) {
          // not itself, not one of its own children, and not already nested
          return (!cat || c.id !== cat.id) && !c.parent &&
                 !(cat && c.parent === cat.id);
        }));
      }
    });
    box.appendChild(picker);
  }

  function openCatSheet(cat) {
    editingCat = cat;
    pickedParent = (cat && cat.parent) || "";
    paintParentPicker(cat);
    $("catsheet-title").textContent = cat ? cat.name : "New category";
    $("cat-name").value = cat ? cat.name : "";
    $("cat-icon").value = cat && cat.icon ? cat.icon : "";
    $("cat-delete").style.display = cat ? "" : "none";
    pickedColor = (cat && cat.color) || "";
    pickedPalette = (cat && cat.palette && cat.palette.length) ? cat.palette.slice() : [];
    if (pickedColor && pickedPalette.indexOf(pickedColor) < 0) {
      pickedPalette.unshift(pickedColor);
    }
    paintSwatches();
    paintPreview("cat-prev", cat && cat.icon);
    showSheet("catsheet");
    $("cat-name").focus();
  }

  var editingSlot = -1;

  function openSlotSheet(i) {
    var slot = board.quickpad[i];
    if (!slot) { return; }
    editingSlot = i;
    editingLink = null;
    editingLink_cat = null;
    $("linksheet-title").textContent = "Edit quick link";
    $("linksheet-sub").textContent = "Slot " + (i + 1);
    $("link-title").value = slot.title || "";
    $("link-url").value = slot.url || "";
    $("link-icon").value = slot.icon || "";
    $("link-delete").style.display = "";
    paintPreview("link-prev", slot.icon);
    showSheet("linksheet");
    $("link-title").focus();
  }

  function openLinkSheet(link, catId) {
    editingSlot = -1;
    editingLink = link;
    editingLink_cat = catId;
    $("linksheet-title").textContent = link ? "Edit link" : "New link";
    $("linksheet-sub").textContent = link ? host(link.url) : "It goes into this category.";
    $("link-title").value = link ? link.title : "";
    $("link-url").value = link ? link.url : "";
    $("link-icon").value = link && link.icon ? link.icon : "";
    $("link-delete").style.display = link ? "" : "none";
    paintPreview("link-prev", link && link.icon);
    showSheet("linksheet");
    $(link ? "link-title" : "link-url").focus();
  }
  var editingLink_cat = null;

  function grabIcon(sourceInputId, previewId, name) {
    var source = $(sourceInputId).value.trim();
    if (!source) { toast("Give it a site or an image address first"); return; }
    if (source.indexOf("icons/") === 0) { return; }
    toast("Fetching…");
    api("POST", "/icon", { source: source, name: name }).then(function (r) {
      $(sourceInputId).value = r.icon;
      paintPreview(previewId, r.icon);
      toast("Got it");
    }).catch(function (e) { toast(e.message); });
  }

  /* ------------------------------------------------------------- inbox */

  var PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M14 2l8 8-3 1-4 4-1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5-1 4-4 1-3z"/></svg>';
  var TRASH_SVG = '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/></svg>';

  /* A category picker you can type into. A native select has no search. */
  function buildPicker(onPick, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "picker";
    wrap.innerHTML =
      '<button type="button"><span class="lbl">' + esc(opts.label || "File into\u2026") +
      '</span><span class="caret">\u25BC</span></button>' +
      '<div class="pop"><input type="text" placeholder="Search categories\u2026" ' +
      'autocomplete="off" spellcheck="false"><ul></ul></div>';

    var btn = wrap.firstChild;
    var pop = wrap.lastChild;
    var input = pop.firstChild;
    var list = pop.lastChild;
    var shown = [];
    var cursor = 0;

    function paint() {
      var q = input.value.trim().toLowerCase();
      var pool = opts.items ? opts.items() : board.categories;
      shown = pool.filter(function (c) {
        return !q || c.name.toLowerCase().indexOf(q) >= 0;
      });
      cursor = Math.min(cursor, Math.max(shown.length - 1, 0));
      list.innerHTML = shown.length
        ? shown.map(function (c, i) {
            return '<li data-id="' + c.id + '" aria-selected="' + (i === cursor) + '">' +
              glyph({ icon: c.icon, title: c.name }, "mono") +
              "<span>" + esc(c.name) + "</span></li>";
          }).join("")
        : '<li class="none">No category matches</li>';
      [].forEach.call(list.querySelectorAll("li[data-id]"), function (li) {
        li.addEventListener("click", function () { choose(li.dataset.id); });
      });
      var sel = list.querySelector('[aria-selected="true"]');
      if (sel) { sel.scrollIntoView({ block: "nearest" }); }
    }

    function choose(id) {
      close();
      onPick(id);
    }

    function open() {
      closeAllPickers();
      wrap.classList.add("open");
      input.value = "";
      cursor = 0;
      paint();
      input.focus();
    }

    function close() { wrap.classList.remove("open"); }
    wrap.close = close;

    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains("open")) { close(); } else { open(); }
    });
    input.addEventListener("input", function () { cursor = 0; paint(); });
    input.addEventListener("click", function (ev) { ev.stopPropagation(); });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { cursor = Math.min(cursor + 1, shown.length - 1); paint(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { cursor = Math.max(cursor - 1, 0); paint(); ev.preventDefault(); }
      else if (ev.key === "Enter" && shown[cursor]) { ev.preventDefault(); choose(shown[cursor].id); }
      else if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    });
    return wrap;
  }

  function closeAllPickers() {
    [].forEach.call(document.querySelectorAll(".picker.open"), function (p) {
      p.classList.remove("open");
    });
  }
  document.addEventListener("click", closeAllPickers);

  function renderInbox() {
    var n = board.inbox.length;
    $("inboxn").textContent = n;
    $("inboxn").className = "n" + (n ? "" : " zero");

    var ul = $("inboxlist");
    ul.innerHTML = "";
    if (!n) {
      ul.innerHTML = '<li class="empty">Nothing waiting. Saved pages land here.</li>';
      return;
    }

    board.inbox.forEach(function (l) {
      var li = document.createElement("li");
      li.dataset.link = l.id;
      li.innerHTML = glyph(l, "mono") +
        '<span class="t"><div>' + esc(l.title) + "</div>" +
        '<div class="h">' + esc(host(l.url)) + "</div></span>";

      openOn(li.querySelector(".t"), l.url, l.id);
      li.addEventListener("contextmenu", function (ev) { linkMenu(ev, l, null); });

      li.appendChild(buildPicker(function (catId) {
        var cat = catById(catId);
        if (!cat) { return; }
        board.inbox = board.inbox.filter(function (x) { return x.id !== l.id; });
        cat.links.push(l);
        pushBoard();
        renderInbox();
        renderBoard();
        toast("Filed under " + cat.name);
      }));

      var pin = document.createElement("button");
      pin.className = "iconbtn pin";
      pin.title = "Add to quick links";
      pin.innerHTML = PIN_SVG;
      pin.addEventListener("click", function () { pinToPad(l); });
      li.appendChild(pin);

      var del = document.createElement("button");
      del.className = "iconbtn";
      del.title = "Move to trash";
      del.innerHTML = TRASH_SVG;
      del.addEventListener("click", function () {
        api("DELETE", "/links/" + l.id).then(function () {
          board.inbox = board.inbox.filter(function (x) { return x.id !== l.id; });
          return refreshBoard();
        }).then(function () { toast("Moved to the trash"); });
      });
      li.appendChild(del);

      ul.appendChild(li);
    });
  }

  /* ------------------------------------------------------------- events */

  function wireUpload(btnId, fileId, inputId, previewId, nameOf) {
    $(btnId).addEventListener("click", function () { $(fileId).click(); });
    $(fileId).addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (!file) { return; }
      var body = new FormData();
      body.append("file", file);
      body.append("name", nameOf());
      toast("Uploading\u2026");
      fetch("/api/icon/upload", { method: "POST", body: body })
        .then(function (r) { return r.json().then(function (j) {
          if (!r.ok) { throw new Error(j.error || r.statusText); }
          return j;
        }); })
        .then(function (j) {
          $(inputId).value = j.icon;
          paintPreview(previewId, j.icon);
          toast("Icon set");
        })
        .catch(function (e) { toast(e.message); });
      this.value = "";
    });
  }

  wireUpload("cat-upload", "cat-file", "cat-icon", "cat-prev",
             function () { return $("cat-name").value || "category"; });
  wireUpload("link-upload", "link-file", "link-icon", "link-prev",
             function () { return $("link-title").value || host($("link-url").value) || "link"; });

  $("cat-fetch").addEventListener("click", function () {
    grabIcon("cat-icon", "cat-prev", "cat-" + ($("cat-name").value || "category"));
  });

  $("cat-save").addEventListener("click", function () {
    var name = $("cat-name").value.trim() || "Untitled";
    var icon = $("cat-icon").value.trim();
    if (icon && icon.indexOf("icons/") !== 0) {
      toast("Press Fetch to turn that address into a logo first");
      return;
    }
    var patch = { name: name, icon: icon, color: pickedColor, palette: pickedPalette,
                  parent: pickedParent };
    var done = function () { hideSheets(); renderBoard(); };
    if (editingCat) {
      Object.assign(editingCat, patch);
      api("PATCH", "/categories/" + editingCat.id, patch).then(done);
    } else {
      api("POST", "/categories", patch).then(function (cat) {
        board.categories.unshift(cat);
        done();
      });
    }
  });

  $("cat-delete").addEventListener("click", function () {
    if (!editingCat) { return; }
    var n = editingCat.links.length;
    if (!window.confirm("Delete “" + editingCat.name + "”?" +
        (n ? "\n\nIts " + n + " links go back to the inbox." : ""))) { return; }
    api("DELETE", "/categories/" + editingCat.id).then(function () {
      board.inbox = editingCat.links.concat(board.inbox);
      board.categories = board.categories.filter(function (c) { return c.id !== editingCat.id; });
      hideSheets();
      renderBoard();
      renderInbox();
      toast(n ? n + " links moved to the inbox" : "Category deleted");
    });
  });

  $("link-fetch").addEventListener("click", function () {
    var src = $("link-icon").value.trim() || $("link-url").value.trim();
    $("link-icon").value = src;
    grabIcon("link-icon", "link-prev", "lnk-" + (host(src) || "icon"));
  });

  $("link-save").addEventListener("click", function () {
    var url = $("link-url").value.trim();
    if (!url) { toast("An address is required"); return; }
    if (!/^https?:\/\//i.test(url)) { url = "https://" + url; }
    var patch = {
      title: $("link-title").value.trim() || url,
      url: url,
      icon: $("link-icon").value.trim()
    };
    if (patch.icon && patch.icon.indexOf("icons/") !== 0) { patch.icon = ""; }

    if (editingSlot >= 0) {
      var slot = board.quickpad[editingSlot];
      Object.assign(slot, patch);
      var live = linkById(slot.id);
      if (live) {
        Object.assign(live, patch);
        api("PATCH", "/links/" + live.id, patch).catch(function () {});
      }
      hideSheets(); renderPad(); renderBoard(); pushBoard();
      return;
    }
    if (editingLink) {
      Object.assign(editingLink, patch);
      api("PATCH", "/links/" + editingLink.id, patch).then(function () {
        hideSheets(); renderBoard(); renderPad();
      });
    } else {
      patch.category = editingLink_cat;
      api("POST", "/links", patch).then(function (link) {
        var cat = catById(editingLink_cat);
        if (cat) { cat.links.push(link); } else { board.inbox.unshift(link); }
        hideSheets(); renderBoard(); renderInbox();
        if (!link.icon) {
          // No icon given, so try the site's own and keep it quietly.
          api("POST", "/icon", { source: link.url, name: "site-" + host(link.url) })
            .then(function (r) {
              link.icon = r.icon;
              return api("PATCH", "/links/" + link.id, { icon: r.icon });
            })
            .then(renderBoard)
            .catch(function () {});
        }
      });
    }
  });

  $("link-delete").addEventListener("click", function () {
    if (editingSlot >= 0) {
      var i = editingSlot;
      hideSheets();
      unpin(i);
      return;
    }
    if (!editingLink) { return; }
    api("DELETE", "/links/" + editingLink.id).then(function () {
      board.categories.forEach(function (c) {
        c.links = c.links.filter(function (l) { return l.id !== editingLink.id; });
      });
      hideSheets(); renderBoard(); renderPad();
      toast("Deleted");
    });
  });

  $("cat-autocolor").addEventListener("click", function () {
    var icon = $("cat-icon").value.trim();
    var site = icon.indexOf("icons/") === 0 ? "" : icon;
    if (!site && editingCat) { site = editingCat.site || ""; }
    if (!site && !icon) { toast("Give it a site first, or fetch a logo"); return; }
    toast("Reading the brand\u2019s colours\u2026");
    api("POST", "/colors", { site: site, icon: icon.indexOf("icons/") === 0 ? icon : "" })
      .then(function (r) {
        pickedPalette = r.palette;
        if (!pickedColor) { pickedColor = r.palette[0]; }
        paintSwatches();
        toast("Found " + r.palette.length);
      })
      .catch(function (e) { toast(e.message); });
  });

  $("collapseall").addEventListener("click", function () { setAllCollapsed(true); });
  $("expandall").addEventListener("click", function () { setAllCollapsed(false); });
  $("trashbtn").addEventListener("click", function () {
    refreshBoard(function () { showSheet("trashsheet"); });
  });

  $("restoreall").addEventListener("click", function () {
    var items = (board.trash || []).slice();
    if (!items.length) { return; }
    var chain = Promise.resolve();
    items.forEach(function (t) {
      chain = chain.then(function () { return api("POST", "/trash/" + t.id + "/restore"); });
    });
    chain.then(function () { return refreshBoard(); })
      .then(function () { toast("Restored " + items.length); })
      .catch(function (e) { toast("Some could not be restored: " + e.message); refreshBoard(); });
  });

  $("emptytrash").addEventListener("click", function () {
    if (!board.trash.length) { return; }
    if (!window.confirm("Delete all " + board.trash.length + " for good?")) { return; }
    api("DELETE", "/trash").then(function () {
      board.trash = [];
      renderTrash();
      toast("Trash emptied");
    });
  });

  $("railtoggle").addEventListener("click", function () {
    var closed = document.body.classList.toggle("rail-closed");
    $("railtoggle").title = closed ? "Show the panel" : "Hide the panel";
    try { localStorage.setItem("stash.rail", closed ? "closed" : "open"); } catch (e) {}
    setTimeout(packCards, 280);
  });

  $("addcat").addEventListener("click", function () { openCatSheet(null); });
  $("addlinktop").addEventListener("click", function () {
    openLinkSheet(null, board.categories[0] && board.categories[0].id);
  });
  $("inboxbtn").addEventListener("click", function () {
    refreshBoard(function () { showSheet("inboxsheet"); });
  });

  $("gridlink").addEventListener("click", function () {
    window.open("/grid/", "_blank", "noopener");
  });

  $("theme").addEventListener("click", function () {
    var now = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = now;
    try { localStorage.setItem("stash.theme", now); } catch (e) {}
  });

  $("search").addEventListener("input", function () {
    filter = this.value.trim().toLowerCase();
    renderBoard();
  });

  document.addEventListener("click", function (ev) {
    if (ev.target.matches("[data-close]") || ev.target.classList.contains("scrim")) {
      hideSheets();
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { hideSheets(); }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing && ev.key === "/") { ev.preventDefault(); $("search").focus(); }
  });

  /* ------------------------------------------------------------- boot */

  try {
    var t = localStorage.getItem("stash.theme");
    if (t) { document.documentElement.dataset.theme = t; }
    if (localStorage.getItem("stash.rail") === "closed") {
      document.body.classList.add("rail-closed");
    }
  } catch (e) {}

  fetch("/api/board").then(function (r) { return r.json(); }).then(function (b) {
    board = b;
    while (board.quickpad.length < 12) { board.quickpad.push(null); }
    var n = board.categories.reduce(function (a, c) { return a + c.links.length; }, 0);
    $("stamp").textContent = n + " links · " + board.categories.length + " categories";
    $("gridlink").hidden = !board.hasGrid;
    renderPad();
    renderBoard();
    renderInbox();
    renderTrash();
  });
})();
