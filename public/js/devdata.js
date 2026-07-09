/* =========================================================
   Python Playground — "Developer Data" easter egg (all pages).

   A hidden stats panel above the footer, revealed by the { dev } button
   in the footer. Loaded (deferred) on every page, after main.js.

   Deliberate behaviors:
     - Starts CLOSED on every page load. Nothing is persisted on
       purpose: navigating away or refreshing closes it, so it has to
       be reopened on each page.
     - The 1-second refresh runs only while the panel is open — a
       hidden panel costs nothing.
     - Values the browser doesn't expose (performance.memory and
       navigator.deviceMemory are Chromium-only) render as "—".

   Page scripts can add their own stats to the front of the grid:
     window.devdata.addStats([{ label: "...", value: function () {} }])
   playground.js uses this for lines-of-code, runs, and Python version.
   ========================================================= */
(function () {
  "use strict";

  var pageStartMs = Date.now();

  function fmt(n) { return n.toLocaleString(); }
  function mb(bytes) { return (bytes / 1048576).toFixed(0) + " MB"; }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  // Non-standard, Chromium only — hence the "—" fallbacks below.
  function heap() { return performance.memory; }

  var stats = [
    { label: "RAM used (this tab)", value: function () { return heap() ? mb(heap().usedJSHeapSize) : "—"; } },
    { label: "RAM limit (this tab)", value: function () { return heap() ? mb(heap().jsHeapSizeLimit) : "—"; } },
    { label: "Device RAM", value: function () { return navigator.deviceMemory ? "≈ " + navigator.deviceMemory + " GB" : "—"; } },
    { label: "CPU threads", value: function () { return navigator.hardwareConcurrency || "—"; } },
    { label: "Viewport", value: function () { return window.innerWidth + " × " + window.innerHeight + " px"; } },
    { label: "Screen", value: function () { return screen.width + " × " + screen.height + " @ " + window.devicePixelRatio + "x"; } },
    { label: "Network", value: function () {
        var type = navigator.connection && navigator.connection.effectiveType;
        return (navigator.onLine ? "online" : "offline") + (type ? " · " + type : "");
      } },
    { label: "Language", value: function () { return navigator.language; } },
    { label: "Time on page", value: function () {
        var s = Math.floor((Date.now() - pageStartMs) / 1000);
        return pad2(Math.floor(s / 60)) + ":" + pad2(s % 60);
      } },
  ];

  var panel = document.getElementById("devdata");
  var toggle = document.getElementById("devdata-toggle");
  var grid = document.getElementById("devdata-grid");

  var valueEls = [];
  var timer = null;

  // Build the <dl> rows; updates just rewrite the <dd> text.
  function buildGrid() {
    grid.innerHTML = "";
    valueEls = stats.map(function (stat) {
      var wrap = document.createElement("div");
      wrap.className = "devdata__stat";
      var dt = document.createElement("dt");
      dt.className = "devdata__label";
      dt.textContent = stat.label;
      var dd = document.createElement("dd");
      dd.className = "devdata__value";
      dd.textContent = "—";
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      grid.appendChild(wrap);
      return dd;
    });
  }

  function update() {
    stats.forEach(function (stat, i) {
      var text;
      try { text = String(stat.value()); } catch (e) { text = "—"; }
      valueEls[i].textContent = text;
    });
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      update();
      if (!timer) timer = setInterval(update, 1000);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Hook for page scripts to prepend page-specific stats. Defined even
  // if this page lacks the panel markup, so callers never need a guard.
  window.devdata = {
    addStats: function (extra) {
      stats = extra.concat(stats);
      if (panel && grid) buildGrid();
    },
  };

  // Deferred script: the DOM is parsed by the time this runs.
  if (!panel || !toggle || !grid) return;

  buildGrid();
  toggle.addEventListener("click", function () { setOpen(panel.hidden); });
  window.addEventListener("resize", function () {
    if (!panel.hidden) update(); // live viewport numbers while dragging
  });
})();
