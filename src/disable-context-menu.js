(function () {
  'use strict';
  if (window.__CVR_CONTEXT_MENU_DISABLED__) return;
  window.__CVR_CONTEXT_MENU_DISABLED__ = true;
  window.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
})();
