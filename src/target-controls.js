(function () {
  'use strict';
  if (window.top !== window || window.__CVR_TARGET_CONTROLS__) return;
  window.__CVR_TARGET_CONTROLS__ = true;

  function install() {
    if (!document.documentElement) return;
    var host = document.createElement('div');
    host.setAttribute('data-cvr-target-controls', 'true');
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' +
      ':host{all:initial;position:fixed;inset:0 0 auto 0;height:46px;z-index:2147483647;display:block;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.bar{height:46px;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 9px;background:#181920;color:#f8f8f2;border-bottom:1px solid #ffffff24;box-shadow:0 2px 10px #0006}' +
      'button{height:32px;min-width:32px;padding:0 9px;border:1px solid #ffffff24;border-radius:6px;background:#ffffff0d;color:#f8f8f2;cursor:pointer;font:inherit}' +
      'button:hover{background:#ffffff20}button:disabled{opacity:.4;cursor:default}' +
      'form{display:flex;flex:1;min-width:0;gap:6px}input{height:32px;min-width:0;flex:1;padding:0 10px;border:1px solid #ffffff24;border-radius:6px;background:#101116;color:#f8f8f2;outline:none;font:inherit}input:focus{border-color:#8be9fd} .error{color:#ff8b8b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '</style><div class="bar" role="toolbar" aria-label="Target browser controls">' +
      '<button id="back" type="button" title="Back" aria-label="Back">‹</button>' +
      '<button id="forward" type="button" title="Forward" aria-label="Forward">›</button>' +
      '<button id="reload" type="button" title="Reload" aria-label="Reload">↻</button>' +
      '<form id="go"><input id="url" type="text" spellcheck="false" aria-label="Target URL"><button type="submit" title="Go">Go</button></form>' +
      '<span id="error" class="error" role="status"></span></div>';
    document.documentElement.appendChild(host);

    var urlInput = shadow.getElementById('url');
    var error = shadow.getElementById('error');
    var update = function () { urlInput.value = location.href; error.textContent = ''; };
    var go = function (event) {
      event.preventDefault();
      try {
        var next = new URL(urlInput.value.trim(), location.href);
        if (!/^https?:$/.test(next.protocol)) throw new Error('Gunakan URL http:// atau https://');
        location.href = next.href;
      } catch (reason) { error.textContent = reason && reason.message ? reason.message : 'URL tidak valid'; }
    };
    shadow.getElementById('back').addEventListener('click', function () { history.back(); });
    shadow.getElementById('forward').addEventListener('click', function () { history.forward(); });
    shadow.getElementById('reload').addEventListener('click', function () { location.reload(); });
    shadow.getElementById('go').addEventListener('submit', go);
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    update();
  }

  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
}());
