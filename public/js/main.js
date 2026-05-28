/* =========================================================
   Python Playground — Front-end behaviors
   - Highlights the active nav tab based on <body data-page="...">
   - Toggles the mobile nav menu
   - Stamps the current year into the footer
   ========================================================= */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    highlightActiveTab();
    wireMobileNavToggle();
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
})();
