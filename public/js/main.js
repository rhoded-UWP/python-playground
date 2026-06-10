/* =========================================================
   Python Playground — Front-end behaviors
   - Highlights the active nav tab based on <body data-page="...">
   - Toggles the mobile nav menu
   - Theme toggle with localStorage persistence
   - Stamps the current year into the footer
   - Types out the home-page hero title (home page only)
   ========================================================= */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    highlightActiveTab();
    wireMobileNavToggle();
    initThemeToggle();
    stampFooterYear();
    initHeroTyping();
  });

  function highlightActiveTab() {
    var page = document.body.getAttribute('data-page');
    if (!page) return;

    var tabs = document.querySelectorAll('.tab[data-tab]');
    tabs.forEach(function (tab) {
      if (tab.getAttribute('data-tab') === page) {
        tab.classList.add('is-active');
        tab.setAttribute('aria-current', 'page');
      }
    });
  }

  function wireMobileNavToggle() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('primary-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  function stampFooterYear() {
    var el = document.getElementById('footer-year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  function initHeroTyping() {
    var typed = document.querySelector('.home-hero__typed');
    if (!typed) return; // only present on the home page

    var full = typed.getAttribute('data-text') || typed.textContent;
    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Reduced motion (or no matchMedia): leave the full title in place.
    if (reduce) {
      typed.textContent = full;
      return;
    }

    typed.textContent = '';
    var i = 0;
    (function tick() {
      typed.textContent = full.slice(0, i);
      if (i < full.length) {
        i += 1;
        setTimeout(tick, 75);
      }
    })();
  }

  function initThemeToggle() {
    var STORAGE_KEY = 'pp-theme';
    var toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    syncToggleUI(document.documentElement.getAttribute('data-theme') || 'light');

    toggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      syncToggleUI(next);
    });

    // The sun/moon glyphs are swapped purely by CSS off [data-theme];
    // here we only keep the button's accessible state in sync.
    function syncToggleUI(theme) {
      var isDark = theme === 'dark';
      toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      toggle.setAttribute('aria-pressed', String(isDark));
    }
  }
})();
