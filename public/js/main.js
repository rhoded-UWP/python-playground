/* =========================================================
   Python Playground — Front-end behaviors
   - Highlights the active nav tab based on <body data-page="...">
   - Toggles the mobile nav menu
   - Theme toggle with localStorage persistence
   - Stamps the current year into the footer
   ========================================================= */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    highlightActiveTab();
    wireMobileNavToggle();
    initThemeToggle();
    stampFooterYear();
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

  function initThemeToggle() {
    var STORAGE_KEY = 'pp-theme';
    var toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    var icon = toggle.querySelector('.theme-toggle__icon');

    syncToggleUI(document.documentElement.getAttribute('data-theme') || 'light');

    toggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      syncToggleUI(next);
    });

    function syncToggleUI(theme) {
      if (theme === 'dark') {
        if (icon) icon.textContent = '🌛';
        toggle.setAttribute('aria-label', 'Switch to light mode');
        toggle.setAttribute('aria-pressed', 'true');
      } else {
        if (icon) icon.textContent = '☀️';
        toggle.setAttribute('aria-label', 'Switch to dark mode');
        toggle.setAttribute('aria-pressed', 'false');
      }
    }
  }
})();
