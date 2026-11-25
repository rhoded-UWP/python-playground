/* =========================================================
   Python Playground — Usage dashboard (dashboard.html only)

   Fetches GET /api/stats?days=N (see lib/analytics.js) and draws
   everything with plain DOM + inline SVG — no chart library. Refreshes
   once a minute while the tab is visible, so it can stay up on a
   classroom or hallway display.
   ========================================================= */

(function () {
  'use strict';

  var RANGE_KEY = 'pp-dash-days';
  var REFRESH_MS = 60 * 1000;

  var METRICS = [
    { key: 'lines', label: 'Lines written', noun: 'lines of Python written' },
    { key: 'runs', label: 'Code runs', noun: 'code runs' },
    { key: 'views', label: 'Page views', noun: 'page views' },
    { key: 'completions', label: 'Completions', noun: 'assignments completed' },
    { key: 'checks', label: 'Problem-set answers', noun: 'problem-set answers checked' },
  ];

  var PAGE_NAMES = {
    '/index.html': 'Home',
    '/programming-playground.html': 'Programming Playground',
    '/problem-sets.html': 'Problem Sets',
    '/attendance.html': 'Attendance Activities',
    '/aprc.html': 'APRC',
    '/awpc.html': 'AWPC',
    '/python-arcade.html': 'Python Arcade',
    '/about.html': 'About Us',
    '/dashboard.html': 'Dashboard',
  };

  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var state = { days: 30, metric: 'lines', stats: null, timer: null };
  var $ = function (id) { return document.getElementById(id); };
  var tooltip;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    tooltip = $('dash-tooltip');
    try {
      var saved = parseInt(localStorage.getItem(RANGE_KEY), 10);
      if ([7, 30, 90].indexOf(saved) !== -1) state.days = saved;
    } catch (e) {}

    wireRange();
    buildMetricSwitch();

    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function (entries) {
        var w = Math.round(entries[0].contentRect.width);
        if (w !== lastW && state.stats) { lastW = w; renderDaily(); }
        lastW = w;
      }).observe($('dash-daily'));
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });

    load();
  }

  /* ---- Data ------------------------------------------------ */

  function load() {
    clearTimeout(state.timer);
    $('dash-body').setAttribute('aria-busy', 'true');

    fetch('/api/stats?days=' + state.days)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (stats) {
        if (!stats.enabled) return showDisabled();
        state.stats = stats;
        render();
        $('dash-updated').textContent = 'Updated ' + new Date(stats.generatedAt)
          .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · refreshes every minute';
      })
      .catch(function (err) {
        $('dash-updated').textContent = 'Could not load stats (' + err.message + '). Retrying in a minute.';
      })
      .then(function () {
        $('dash-body').setAttribute('aria-busy', 'false');
        if (!document.hidden) state.timer = setTimeout(load, REFRESH_MS);
      });
  }

  function showDisabled() {
    var notice = $('dash-notice');
    notice.hidden = false;
    notice.textContent = 'Usage tracking is not switched on yet. The site owner needs to connect a ' +
      'Postgres database by setting DATABASE_URL on the server. Numbers will start appearing as soon as it is.';
    $('dash-body').hidden = true;
    $('dash-updated').textContent = '';
  }

  function render() {
    renderKpis();
    renderLoc();
    renderDaily();
    renderDailyTable();
    renderHeatmap();
    renderAssignments();
    renderMissed();
    renderErrors();
    renderPages();
  }

  /* ---- Controls -------------------------------------------- */

  function wireRange() {
    var buttons = document.querySelectorAll('.dash-range button');
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.days) === state.days));
      btn.addEventListener('click', function () {
        state.days = Number(btn.dataset.days);
        try { localStorage.setItem(RANGE_KEY, String(state.days)); } catch (e) {}
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        load();
      });
    });
  }

  function buildMetricSwitch() {
    var wrap = $('dash-metric');
    METRICS.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = m.label;
      btn.setAttribute('aria-pressed', String(m.key === state.metric));
      btn.addEventListener('click', function () {
        state.metric = m.key;
        wrap.querySelectorAll('button').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        renderDaily();
      });
      wrap.appendChild(btn);
    });
  }

  /* ---- KPI tiles ------------------------------------------- */

  function renderKpis() {
    var s = state.stats, t = s.totals, p = s.previous;
    var acc = t.checks ? Math.round((100 * t.checksCorrect) / t.checks) : null;
    var prevAcc = p.checks ? Math.round((100 * p.checksCorrect) / p.checks) : null;

    var tiles = [
      { label: 'Page views', value: fmt(t.views), delta: pctDelta(t.views, p.views) },
      { label: 'Code runs', value: fmt(t.runs), delta: pctDelta(t.runs, p.runs) },
      { label: 'Assignments completed', value: fmt(t.completions), delta: pctDelta(t.completions, p.completions) },
      { label: 'Lines of Python written', value: fmt(t.lines), delta: pctDelta(t.lines, p.lines) },
      {
        label: 'Problem-set accuracy',
        value: acc === null ? '—' : acc + '%',
        delta: acc === null
          ? 'No answers checked yet'
          : fmt(t.checks) + ' answers' + (prevAcc === null ? '' : ' · ' + signed(acc - prevAcc) + ' pts vs previous'),
      },
    ];

    $('dash-kpis').innerHTML = tiles.map(function (k) {
      return '<div class="dash-kpi"><p class="dash-kpi__label">' + k.label + '</p>' +
        '<p class="dash-kpi__value">' + k.value + '</p>' +
        '<p class="dash-kpi__delta">' + k.delta + '</p></div>';
    }).join('');
  }

  function pctDelta(cur, prev) {
    var range = 'previous ' + state.days + ' days';
    if (!prev) return cur ? 'New this period' : 'No activity yet';
    var pct = Math.round((100 * (cur - prev)) / prev);
    var arrow = pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '';
    return arrow + Math.abs(pct) + '% vs ' + range;
  }

  function renderLoc() {
    var l = state.stats.lines;
    var items = [['Today', l.today], ['Last 7 days', l.week], ['Last 30 days', l.month], ['All time', l.allTime]];
    $('dash-loc').innerHTML = items.map(function (i) {
      return '<div><dt>' + i[0] + '</dt><dd>' + fmt(i[1]) + '</dd></div>';
    }).join('');
  }

  /* ---- Daily column chart ---------------------------------- */

  function renderDaily() {
    var wrap = $('dash-daily');
    var data = state.stats.daily;
    var metric = METRICS.filter(function (m) { return m.key === state.metric; })[0];
    var values = data.map(function (d) { return d[metric.key]; });

    var W = Math.max(280, wrap.clientWidth), H = 240;
    var m = { top: 12, right: 4, bottom: 26, left: 40 };
    var iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    var max = niceMax(Math.max.apply(null, values.concat([0])));
    var band = iw / data.length;
    var gap = band >= 6 ? 2 : 1;
    var bw = Math.max(1, band - gap);
    var y = function (v) { return m.top + ih - (v / max) * ih; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc('Daily ' + metric.noun + ', last ' + state.days + ' days. Total ' + fmt(sum(values)) + '.') + '">';

    // Gridlines + y labels (4 steps)
    for (var i = 0; i <= 4; i++) {
      var v = (max / 4) * i, gy = y(v);
      if (i > 0) svg += '<line class="grid" x1="' + m.left + '" x2="' + (W - m.right) + '" y1="' + gy + '" y2="' + gy + '"/>';
      svg += '<text class="axis-text" x="' + (m.left - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + short(v) + '</text>';
    }

    // X labels: about 6–8 evenly spaced dates
    var every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 80))));
    data.forEach(function (d, idx) {
      if ((data.length - 1 - idx) % every !== 0) return;
      var cx = m.left + idx * band + band / 2;
      svg += '<text class="axis-text" x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + dayLabel(d.day, false) + '</text>';
    });

    // Bars (rounded top, square base) with a full-height hover target each
    data.forEach(function (d, idx) {
      var val = d[metric.key];
      var x = m.left + idx * band + gap / 2;
      svg += '<rect class="hit" data-i="' + idx + '" x="' + (m.left + idx * band) + '" y="' + m.top +
        '" width="' + band + '" height="' + ih + '"/>';
      if (val > 0) svg += '<path class="bar" data-i="' + idx + '" d="' + barPath(x, y(val), bw, m.top + ih - y(val)) + '"/>';
    });

    svg += '<line class="baseline" x1="' + m.left + '" x2="' + (W - m.right) + '" y1="' + (m.top + ih) + '" y2="' + (m.top + ih) + '"/>';
    svg += '</svg>';
    wrap.innerHTML = svg;

    wrap.querySelectorAll('.hit').forEach(function (hit) {
      var idx = Number(hit.dataset.i);
      var bar = wrap.querySelector('.bar[data-i="' + idx + '"]');
      hit.addEventListener('mousemove', function (e) {
        if (bar) bar.classList.add('is-hot');
        showTip(e, dayLabel(data[idx].day, true), fmt(data[idx][metric.key]) + ' ' + metric.noun);
      });
      hit.addEventListener('mouseleave', function () {
        if (bar) bar.classList.remove('is-hot');
        hideTip();
      });
    });
  }

  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    if (w < 6) r = 0;
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) +
      (r ? 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y : '') +
      'H' + (x + w - r) +
      (r ? 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) : '') +
      'V' + (y + h) + 'Z';
  }

  function renderDailyTable() {
    var rows = state.stats.daily.slice().reverse();
    $('dash-daily-table').innerHTML = table(
      ['Day', 'Page views', 'Code runs', 'Lines written', 'Completions', 'Problem-set answers'],
      rows.map(function (d) {
        return [dayLabel(d.day, true), fmt(d.views), fmt(d.runs), fmt(d.lines), fmt(d.completions), fmt(d.checks)];
      })
    );
  }

  /* ---- Heatmap --------------------------------------------- */

  function renderHeatmap() {
    var cells = {};
    var max = 0, best = null;
    state.stats.heatmap.forEach(function (c) {
      cells[c.dow + '-' + c.hour] = c.count;
      if (c.count > max) { max = c.count; best = c; }
    });

    var html = '<div class="dash-heat__grid"><span></span>';
    for (var h = 0; h < 24; h++) {
      html += '<span class="dash-heat__hour">' + (h % 3 === 0 ? hourLabel(h, true) : '') + '</span>';
    }
    for (var d = 1; d <= 7; d++) {
      html += '<span class="dash-heat__day">' + DAYS[d - 1] + '</span>';
      for (var hr = 0; hr < 24; hr++) {
        var n = cells[d + '-' + hr] || 0;
        var style = n ? ' style="background:' + heatColor(n / max) + '"' : '';
        html += '<span class="dash-heat__cell" data-d="' + d + '" data-h="' + hr + '" data-n="' + n + '"' + style + '></span>';
      }
    }
    html += '</div>';

    html += '<div class="dash-heat__legend"><span>Less</span>';
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (f) {
      html += '<span class="swatch" style="background:' + (f ? heatColor(f) : 'var(--dash-empty)') + '"></span>';
    });
    html += '<span>More</span></div>';

    html += '<p class="dash-card__sub" style="margin:0.75rem 0 0">' + (best
      ? 'Busiest hour: <strong>' + DAYS[best.dow - 1] + ' ' + hourLabel(best.hour) + '–' + hourLabel((best.hour + 1) % 24) +
        '</strong> (' + fmt(best.count) + ' actions).'
      : 'No coding activity in this range yet.') + '</p>';

    var wrap = $('dash-heat');
    wrap.innerHTML = html;
    wrap.querySelectorAll('.dash-heat__cell').forEach(function (cell) {
      cell.addEventListener('mousemove', function (e) {
        var d = Number(cell.dataset.d), hr = Number(cell.dataset.h);
        showTip(e, DAYS[d - 1] + ' ' + hourLabel(hr) + '–' + hourLabel((hr + 1) % 24), fmt(Number(cell.dataset.n)) + ' actions');
      });
      cell.addEventListener('mouseleave', hideTip);
    });
  }

  // Five steps of the accent hue, light to dark (dark to bright in dark mode),
  // mixed against the card surface so they follow the theme.
  function heatColor(f) {
    var step = Math.min(5, Math.max(1, Math.ceil(f * 5)));
    return 'color-mix(in srgb, var(--dash-mark) ' + (step * 20) + '%, var(--color-surface))';
  }

  /* ---- Tables and bar lists -------------------------------- */

  function renderAssignments() {
    var list = state.stats.assignments;
    if (!list.length) {
      $('dash-assignments').innerHTML = '<p class="dash-empty">No assignment activity in this range yet.</p>';
      return;
    }
    $('dash-assignments').innerHTML = table(
      ['Assignment', 'Code runs', 'Test runs', 'Test runs passing', 'Completed', 'Lines written'],
      list.map(function (a) {
        var rate = a.tests ? Math.round((100 * a.passingTests) / a.tests) + '%' : '—';
        return [esc(a.name), fmt(a.runs), fmt(a.tests), rate, fmt(a.completions), fmt(a.lines)];
      })
    );
  }

  function renderMissed() {
    var list = state.stats.missed;
    if (!list.length) {
      $('dash-missed').innerHTML = '<p class="dash-empty">Not enough problem-set answers in this range yet.</p>';
      return;
    }
    $('dash-missed').innerHTML = bars(list.map(function (r) {
      var pct = Math.round((100 * r.misses) / r.attempts);
      return {
        label: (r.snippet ? '<code>' + esc(r.snippet) + '</code>' : 'Line ' + esc(r.row)) +
          '<span class="dash-bars__meta">' + esc(r.setTitle) + ' · ' + esc(r.part) + ' · line ' + esc(r.row) + '</span>',
        value: pct + '% wrong',
        title: r.misses + ' of ' + r.attempts + ' answers wrong',
        fraction: pct / 100,
      };
    }), 'dash-bars--fail');
  }

  function renderErrors() {
    var list = state.stats.errors;
    if (!list.length) {
      $('dash-errors').innerHTML = '<p class="dash-empty">No errors in this range. Nice work, everyone.</p>';
      return;
    }
    var max = list[0].count;
    $('dash-errors').innerHTML = bars(list.map(function (e) {
      return { label: '<code>' + esc(e.error) + '</code>', value: fmt(e.count), fraction: e.count / max };
    }));
  }

  function renderPages() {
    var list = state.stats.pages;
    if (!list.length) {
      $('dash-pages').innerHTML = '<p class="dash-empty">No page views in this range yet.</p>';
      return;
    }
    var max = list[0].views;
    $('dash-pages').innerHTML = bars(list.map(function (p) {
      return { label: esc(PAGE_NAMES[p.page] || p.page), value: fmt(p.views), fraction: p.views / max };
    }));
  }

  function bars(items, modifier) {
    return '<ul class="dash-bars ' + (modifier || '') + '">' + items.map(function (it) {
      return '<li' + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' +
        '<div class="dash-bars__row"><span class="dash-bars__label">' + it.label + '</span>' +
        '<span class="dash-bars__value">' + it.value + '</span></div>' +
        '<div class="dash-bars__track" aria-hidden="true"><div class="dash-bars__fill" style="width:' +
        (Math.max(0, Math.min(1, it.fraction)) * 100).toFixed(1) + '%"></div></div></li>';
    }).join('') + '</ul>';
  }

  function table(head, rows) {
    return '<table class="dash-table"><thead><tr>' +
      head.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) {
          return i === 0 ? '<th scope="row" style="font-weight:400;color:inherit">' + c + '</th>' : '<td>' + c + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---- Tooltip --------------------------------------------- */

  function showTip(e, title, body) {
    tooltip.innerHTML = '<strong>' + esc(body) + '</strong>' + esc(title);
    tooltip.hidden = false;
    var pad = 12, r = tooltip.getBoundingClientRect();
    var x = e.clientX + pad, yy = e.clientY - r.height - pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (yy < 8) yy = e.clientY + pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top = yy + 'px';
  }
  function hideTip() { tooltip.hidden = true; }

  /* ---- Formatting ------------------------------------------ */

  function fmt(n) { return Number(n || 0).toLocaleString(); }
  function sum(a) { return a.reduce(function (s, v) { return s + v; }, 0); }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function short(v) {
    if (v >= 1e6) return +(v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return +(v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v * 10) / 10);
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  function dayLabel(iso, long) {
    var parts = iso.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString([], long
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' });
  }

  function hourLabel(h, compact) {
    var suffix = h < 12 ? (compact ? 'a' : ' AM') : (compact ? 'p' : ' PM');
    var hr = h % 12 === 0 ? 12 : h % 12;
    return hr + suffix;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
