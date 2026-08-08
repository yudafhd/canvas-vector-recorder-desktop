(function () {
  'use strict';
  if (window.__CVR_TARGET_CONTROLS__) return;
  window.__CVR_TARGET_CONTROLS__ = true;

  var tabId = String(window.__CVR_TARGET_TAB_ID__ || '');
  var tabState = window.__CVR_TARGET_TABS__ || { active_id: tabId, tabs: [] };
  var multiWindowMode = window.__CVR_TARGET_MODE__ === 'multi-window';

  function invoke(name, args) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        return Promise.resolve(window.__TAURI_INTERNALS__.invoke(name, args));
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error('Kontrol native target tidak tersedia.'));
  }

  function validUrl(value) {
    try {
      var parsed = new URL(value, location.href);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
    } catch (_) {
      return null;
    }
  }

  function syncTab() {
    if (window.top !== window) return;
    if (!tabId) return;
    invoke('sync_target_tab', {
      tabId: tabId,
      url: location.href,
      title: document.title || ''
    }).catch(function () {});
  }

  function interceptNewTab(event) {
    var target = event.target;
    var link = target && target.closest ? target.closest('a') : null;
    if (!link || !link.href || link.hasAttribute('download')) return;
    var wantsNewTab = link.target === '_blank' || event.metaKey || event.ctrlKey || event.button === 1;
    var next = validUrl(link.href);
    if (!wantsNewTab || !next) return;
    event.preventDefault();
    event.stopPropagation();
    invoke('open_target_tab', { url: next }).catch(function () {});
  }

  if (window.top !== window) return;

  document.addEventListener('click', interceptNewTab, true);
  document.addEventListener('auxclick', interceptNewTab, true);
  var nativeOpen = window.open;
  window.open = function (url) {
    var next = url && validUrl(String(url));
    if (next) {
      invoke('open_target_tab', { url: next }).catch(function () {});
      return window;
    }
    return nativeOpen.apply(window, arguments);
  };

  window.addEventListener('pageshow', syncTab);
  window.addEventListener('load', syncTab);
  window.addEventListener('popstate', syncTab);
  window.addEventListener('hashchange', syncTab);
  document.addEventListener('DOMContentLoaded', syncTab, { once: true });

  var host = document.createElement('div');
  host.setAttribute('data-cvr-target-controls', 'true');
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>' +
    ':host{all:initial;position:fixed;inset:0 0 auto 0;height:34px;z-index:2147483647;display:block;font:13px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}' +
    '.chrome{height:34px;box-sizing:border-box;background:#181920;color:#f8f8f2;border-bottom:1px solid #ffffff24;box-shadow:0 2px 10px #0006}' +
    '.tabs{height:34px;display:flex;align-items:stretch;gap:3px;padding:4px 6px 0;overflow:hidden;background:#101116}' +
    '.tab{display:flex;align-items:center;min-width:120px;max-width:240px;padding:0 5px 0 11px;border:1px solid #ffffff1f;border-bottom:0;border-radius:6px 6px 0 0;background:#20232c;color:#bfc3cb;cursor:pointer}' +
    '.tab.active{background:#2d313c;color:#fff;border-color:#ffffff30}' +
    '.tab:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #8be9fd;outline-offset:1px}' +
    '.tab-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.tab-close,.new-tab{width:25px;min-width:25px;height:25px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:16px inherit}' +
    '.tab-close:hover,.new-tab:hover{background:#ffffff1c}' +
    '.new-tab{margin:0 0 0 2px;color:#d9dce3;font-size:19px}' +
    'button{height:32px;min-width:32px;padding:0 9px;border:1px solid #ffffff24;border-radius:6px;background:#ffffff0d;color:#f8f8f2;cursor:pointer;font:inherit}' +
    'button:hover{background:#ffffff20}button:disabled{opacity:.4;cursor:default}' +
    'form{display:flex;flex:1;min-width:0;gap:6px}input{height:32px;min-width:0;flex:1;padding:0 10px;border:1px solid #ffffff24;border-radius:6px;background:#101116;color:#f8f8f2;outline:none;font:inherit}input:focus{border-color:#8be9fd}.error{color:#ff8b8b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.dialog[hidden]{display:none}.dialog{position:fixed;inset:0;display:grid;place-items:start center;padding-top:52px;background:#0008}.dialog-card{display:flex;flex-direction:column;gap:12px;width:min(460px,calc(100vw - 32px));padding:18px;border:1px solid #ffffff26;border-radius:10px;background:#242732;box-shadow:0 12px 35px #0008}.dialog-title{font-size:15px;font-weight:600}.dialog-card label{display:flex;flex-direction:column;gap:6px;color:#d9dce3}.dialog-card input{width:100%;box-sizing:border-box;background:#101116}.dialog-actions{display:flex;justify-content:flex-end;gap:8px}.dialog-actions .primary{background:#087dcc;border-color:#087dcc}.dialog-actions .primary:hover{background:#0b91e6}.dialog-error{min-height:16px;color:#ff8b8b}' +
    '</style><div class=\"chrome\"><div id=\"tabs\" class=\"tabs\" role=\"tablist\" aria-label=\"Target tabs\"><button id=\"new-tab\" class=\"new-tab\" type=\"button\" title=\"Tab baru\" aria-label=\"Tab baru\">+</button></div>' +
    '' +
    '<div id=\"tab-dialog\" class=\"dialog\" hidden><form id=\"new-tab-form\" class=\"dialog-card\">' +
    '<div class=\"dialog-title\">Buka tab baru</div><label>URL<input id=\"new-tab-url\" type=\"url\" value=\"https://\" spellcheck=\"false\" autocomplete=\"off\"></label>' +
    '<div id=\"new-tab-error\" class=\"dialog-error\" role=\"status\"></div><div class=\"dialog-actions\"><button id=\"cancel-new-tab\" type=\"button\">Batal</button><button class=\"primary\" type=\"submit\">Buka tab</button></div>' +
    '</form></div></div>';
  function mountHost() {
    var root = document.documentElement || document.body;
    if (root) { root.appendChild(host); return; }
    setTimeout(mountHost, 0);
  }
  if (!multiWindowMode) mountHost();

  var tabs = shadow.getElementById('tabs');
  tabs.hidden = multiWindowMode;
  var tabDialog = shadow.getElementById('tab-dialog');
  var newTabForm = shadow.getElementById('new-tab-form');
  var newTabUrl = shadow.getElementById('new-tab-url');
  var newTabError = shadow.getElementById('new-tab-error');
  var newTabButton = shadow.getElementById('new-tab');
  var MAX_TABS = 5;

  function showError(message) { newTabError.textContent = message || ''; }

  function renderTabs() {
    tabs.querySelectorAll('.tab').forEach(function (tabButton) { tabButton.remove(); });
    (tabState.tabs || []).forEach(function (tab) {
      var tabButton = document.createElement('div');
      tabButton.className = 'tab' + (tab.id === tabState.active_id ? ' active' : '');
      tabButton.dataset.tab = tab.id;
      tabButton.title = tab.url;
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('tabindex', '0');
      tabButton.setAttribute('aria-selected', String(tab.id === tabState.active_id));
      var label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title || tab.url;
      var close = document.createElement('button');
      close.className = 'tab-close';
      close.type = 'button';
      close.title = 'Tutup tab';
      close.setAttribute('aria-label', 'Tutup tab');
      close.textContent = '×';
      close.addEventListener('click', function (event) {
        event.stopPropagation();
        invoke('close_target_tab', { tabId: tab.id }).catch(function (result) {
          showError(result && result.message ? result.message : 'Tab tidak dapat ditutup.');
        });
      });
      tabButton.appendChild(label);
      tabButton.appendChild(close);
      tabButton.addEventListener('click', function () {
        invoke('switch_target_tab', { tabId: tab.id }).catch(function (result) {
          showError(result && result.message ? result.message : 'Tab tidak dapat dibuka.');
        });
      });
      tabButton.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          invoke('switch_target_tab', { tabId: tab.id }).catch(function () {});
        }
      });
      tabs.insertBefore(tabButton, shadow.getElementById('new-tab'));
    });
  }

  function update() {
    var atLimit = (tabState.tabs || []).length >= MAX_TABS;
    newTabButton.disabled = atLimit;
    newTabButton.title = atLimit ? 'Batas maksimal 5 tab tercapai' : 'Tab baru';
    newTabButton.setAttribute('aria-label', atLimit ? 'Batas maksimal 5 tab tercapai' : 'Tab baru');
    renderTabs();
  }

  window.__CVR_SET_TABS__ = function (nextState) {
    if (!nextState || !Array.isArray(nextState.tabs)) return;
    tabState = nextState;
    update();
  };

  newTabButton.addEventListener('click', function () {
    tabDialog.hidden = false;
    newTabUrl.value = 'https://';
    newTabError.textContent = '';
    newTabUrl.focus();
    newTabUrl.select();
  });
  shadow.getElementById('cancel-new-tab').addEventListener('click', function () {
    tabDialog.hidden = true;
  });
  newTabForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if ((tabState.tabs || []).length >= MAX_TABS) {
      newTabError.textContent = 'Maksimal 5 tab dapat dibuka dalam satu window.';
      return;
    }
    var next = validUrl(newTabUrl.value.trim());
    if (!next) {
      newTabError.textContent = 'Gunakan URL http:// atau https://';
      return;
    }
    invoke('open_target_tab', { url: next }).then(function () {
      tabDialog.hidden = true;
    }).catch(function (result) {
      newTabError.textContent = result && result.message ? result.message : 'Tab baru tidak dapat dibuka.';
    });
  });
  update();
}());
