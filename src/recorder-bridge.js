(function () {
  'use strict';
  var w = window;
  var MARK = '__CVR_CANVAS_BRIDGE_V1__';
  if (w[MARK]) return;
  w[MARK] = true;
  var sessionId = String(w.__CVR_SESSION_TOKEN__ || '');
  if (!sessionId) return;
  var frameId = 'frame-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  var sequence = 0, queue = [], stopped = false, recordingEnabled = true, flushTimer = null;
  var canvasIds = new WeakMap(), canvasSizes = new WeakMap(), paths = new WeakMap(), contexts = new WeakMap(), svgIds = new WeakMap(), svgSnapshots = new WeakMap(), svgSources = new WeakMap(), svgPendingSources = new WeakMap(), nextCanvas = 1, nextPath = 1, nextSvg = 1;
  var MAX_BATCH = 100, FLUSH_MS = 150;
  function invoke(name, args) {
    try { return w.__TAURI_INTERNALS__ && w.__TAURI_INTERNALS__.invoke(name, args); } catch (_) { return Promise.reject(_); }
  }
  function flush() {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    Promise.resolve(invoke('record_canvas_events', { sessionId: sessionId, events: batch })).catch(function () {});
    if (queue.length) flush();
  }
  function emit(type, data) {
    if (stopped || !recordingEnabled) return;
    var event = Object.assign({ session_id: sessionId, frame_id: frameId, sequence: ++sequence, type: type }, data || {});
    queue.push(event);
    if (queue.length >= MAX_BATCH) flush();
    if (type === 'svg_detected') flush();
    if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, FLUSH_MS);
  }
  function num(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
  function canvasId(canvas) {
    if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function')) return frameId + '-canvas-unknown';
    var width = Number(canvas.width) || 1, height = Number(canvas.height) || 1;
    if (!canvasIds.has(canvas)) {
      var id = frameId + '-canvas-' + nextCanvas++;
      canvasIds.set(canvas, id);
      canvasSizes.set(canvas, [width, height]);
      emit('canvas_created', { canvas_id: id, width: width, height: height });
    } else {
      var previous = canvasSizes.get(canvas);
      if (!previous || previous[0] !== width || previous[1] !== height) {
        canvasSizes.set(canvas, [width, height]);
        emit('canvas_resized', { canvas_id: canvasIds.get(canvas), width: width, height: height });
      }
    }
    return canvasIds.get(canvas);
  }
  function matrix(ctx) {
    try { var m = ctx.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f].map(num); } catch (_) { return [1, 0, 0, 1, 0, 0]; }
  }
  function pathId(path) {
    if (!paths.has(path)) { var id = frameId + '-path-' + nextPath++; paths.set(path, id); emit('path_created', { path_id: id }); }
    return paths.get(path);
  }
  function contextPath(ctx) {
    var state = contexts.get(ctx);
    if (!state) { state = { path: null, fill: '#000000', stroke: '#000000', lineWidth: 1 }; contexts.set(ctx, state); }
    if (!state.path) { state.path = { id: frameId + '-path-' + nextPath++, internal: true }; emit('path_created', { path_id: state.path.id, canvas_id: canvasId(ctx.canvas) }); }
    return state.path.id;
  }
  function svgNumber(value) { return Number.isFinite(value) ? Number(value.toFixed(4)) : 0; }
  function svgViewBox(root) {
    var values = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
    if (values.length === 4 && values.every(function (value) { return Number.isFinite(value); })) return values;
    var width = Number(root.getAttribute('width')) || 1, height = Number(root.getAttribute('height')) || 1;
    return [0, 0, width, height];
  }
  function centerSvgRoot(root, box) {
    if (!box || !(box.width > 0) || !(box.height > 0)) return;
    var viewBox = svgViewBox(root), dx = viewBox[0] + (viewBox[2] - box.width) / 2 - box.x, dy = viewBox[1] + (viewBox[3] - box.height) / 2 - box.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    var group = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('transform', 'translate(' + svgNumber(dx) + ' ' + svgNumber(dy) + ')');
    Array.prototype.slice.call(root.childNodes).forEach(function (node) {
      if (node.nodeType !== 1) return;
      var tag = String(node.localName || node.tagName || '').toLowerCase();
      if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'style') return;
      group.appendChild(node);
    });
    root.appendChild(group);
  }
  function centerInlineSvg(clone, source) {
    try { if (source && typeof source.getBBox === 'function') centerSvgRoot(clone, source.getBBox()); } catch (_) {}
  }
  function installPath() {
    var P = w.Path2D;
    if (!P || !P.prototype) return;
    ['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'closePath', 'rect', 'arc', 'ellipse'].forEach(function (name) {
      var original = P.prototype[name]; if (typeof original !== 'function' || original.__cvr) return;
      var wrapped = function () {
        var id = pathId(this), args = Array.prototype.slice.call(arguments).map(num);
        emit('path_command', { path_id: id, command: { type: name === 'moveTo' ? 'move_to' : name === 'lineTo' ? 'line_to' : name === 'bezierCurveTo' ? 'bezier_curve_to' : name === 'quadraticCurveTo' ? 'quadratic_curve_to' : name === 'closePath' ? 'close_path' : name === 'rect' ? 'rect' : name, args: args } });
        return original.apply(this, arguments);
      };
      wrapped.__cvr = true; P.prototype[name] = wrapped;
    });
  }
  function installContext() {
    var C = w.CanvasRenderingContext2D;
    var proto = C && C.prototype;
    var canvasProto = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
    var getContext = canvasProto && canvasProto.getContext;
    if (getContext && !getContext.__cvr) {
      var wrappedGetContext = function (type) {
        var context = getContext.apply(this, arguments);
        if (context) { var id = canvasId(this); emit('context_created', { canvas_id: id, context_type: String(type || 'unknown'), width: this.width || 1, height: this.height || 1 }); }
        return context;
      };
      wrappedGetContext.__cvr = true; canvasProto.getContext = wrappedGetContext;
    }
    var offscreenProto = w.OffscreenCanvas && w.OffscreenCanvas.prototype;
    var offscreenGetContext = offscreenProto && offscreenProto.getContext;
    if (offscreenGetContext && !offscreenGetContext.__cvr) {
      var wrappedOffscreenGetContext = function (type) {
        var context = offscreenGetContext.apply(this, arguments);
        if (context) { var id = canvasId(this); emit('context_created', { canvas_id: id, context_type: String(type || 'unknown'), width: this.width || 1, height: this.height || 1 }); }
        return context;
      };
      wrappedOffscreenGetContext.__cvr = true; offscreenProto.getContext = wrappedOffscreenGetContext;
    }
    if (!proto) return;
    ['drawImage', 'clip', 'fill', 'stroke', 'save', 'restore', 'setTransform', 'resetTransform', 'clearRect', 'fillRect', 'strokeRect'].forEach(function (name) {
      var original = proto[name]; if (typeof original !== 'function' || original.__cvr) return;
      var wrapped = function () {
        var canvas = this.canvas, cid = canvasId(canvas), state = contexts.get(this) || { path: null, fill: String(this.fillStyle), stroke: String(this.strokeStyle), lineWidth: Number(this.lineWidth) || 1 };
        contexts.set(this, state);
        var raw = Array.prototype.slice.call(arguments), data = { canvas_id: cid, transform: matrix(this) };
        if (name === 'fill' || name === 'stroke' || name === 'clip') { data.path_id = raw[0] instanceof P2D ? pathId(raw[0]) : contextPath(this); if (name === 'fill') { data.fill_style = String(this.fillStyle); data.fill_rule = raw[1] === 'evenodd' ? 'evenodd' : 'nonzero'; } if (name === 'stroke') { data.stroke_style = String(this.strokeStyle); data.line_width = Number(this.lineWidth) || 1; } }
        if (name === 'drawImage') data.args = raw.slice(1).map(num);
        else if (name === 'clearRect' || name === 'fillRect' || name === 'strokeRect') data.args = raw.map(num);
        else if (name === 'setTransform') data.args = raw.map(num);
        emit(name === 'drawImage' ? 'draw_image' : name === 'setTransform' ? 'set_transform' : name === 'resetTransform' ? 'reset_transform' : name === 'clearRect' ? 'clear_rect' : name === 'fillRect' ? 'fill_rect' : name === 'strokeRect' ? 'stroke_rect' : name, data);
        var result = original.apply(this, arguments);
        if (name === 'save' || name === 'restore') return result;
        if (name === 'fill' || name === 'stroke' || name === 'clip') return result;
        return result;
      };
      wrapped.__cvr = true; proto[name] = wrapped;
    });
    var P2D = w.Path2D;
    ['fillStyle', 'strokeStyle', 'lineWidth'].forEach(function (property) {
      var descriptor = Object.getOwnPropertyDescriptor(proto, property); if (!descriptor || !descriptor.set || descriptor.set.__cvr) return;
      var setter = function (value) { emit(property === 'fillStyle' ? 'set_fill_style' : property === 'strokeStyle' ? 'set_stroke_style' : 'set_line_width', { canvas_id: canvasId(this.canvas), value: property === 'lineWidth' ? num(value) : String(value) }); return descriptor.set.call(this, value); };
      setter.__cvr = true; Object.defineProperty(proto, property, Object.assign({}, descriptor, { set: setter }));
    });
    ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'closePath', 'rect', 'arc', 'ellipse'].forEach(function (name) {
      var original = proto[name]; if (typeof original !== 'function' || original.__cvr) return;
      var wrapped = function () { var id = contextPath(this), args = Array.prototype.slice.call(arguments).map(num); emit('path_command', { canvas_id: canvasId(this.canvas), path_id: id, command: { type: name === 'beginPath' ? 'begin_path' : name === 'moveTo' ? 'move_to' : name === 'lineTo' ? 'line_to' : name === 'bezierCurveTo' ? 'bezier_curve_to' : name === 'quadraticCurveTo' ? 'quadratic_curve_to' : name === 'closePath' ? 'close_path' : name, args: args } }); return original.apply(this, arguments); };
      wrapped.__cvr = true; proto[name] = wrapped;
    });
  }
  function scanInlineSvgs() {
    if (!document.querySelectorAll || !w.XMLSerializer) return;
    var elements = document.querySelectorAll('svg');
    Array.prototype.forEach.call(elements, function (element) {
      if (element.parentElement && element.parentElement.closest && element.parentElement.closest('svg')) return;
      try {
        var clone = element.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        centerInlineSvg(clone, element);
        var svg = new w.XMLSerializer().serializeToString(clone);
        if (!svg || svg.length > 900000) return;
        var id = svgIds.get(element);
        if (!id) { id = frameId + '-svg-' + nextSvg++; svgIds.set(element, id); }
        if (svgSnapshots.get(element) === svg) return;
        svgSnapshots.set(element, svg);
        var viewBox = (element.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
        var bounds = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : { width: 1, height: 1 };
        var width = Number(element.getAttribute('width')) || (viewBox.length === 4 ? viewBox[2] : bounds.width) || 1;
        var height = Number(element.getAttribute('height')) || (viewBox.length === 4 ? viewBox[3] : bounds.height) || 1;
        emit('svg_detected', { canvas_id: id, asset_type: 'svg', width: Math.max(1, width), height: Math.max(1, height), svg: svg, filename: (element.id || 'detected-' + id) + '.svg' });
      } catch (_) {}
    });
  }
  function svgDimensions(svg, host) {
    var width = 0, height = 0;
    try {
      if (w.DOMParser) {
        var root = new w.DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        width = Number(root.getAttribute('width')) || 0;
        height = Number(root.getAttribute('height')) || 0;
        var viewBox = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
        if ((!width || !height) && viewBox.length === 4 && viewBox.slice(2).every(function (value) { return Number.isFinite(value) && value > 0; })) { width = width || viewBox[2]; height = height || viewBox[3]; }
      }
    } catch (_) {}
    var bounds = host && typeof host.getBoundingClientRect === 'function' ? host.getBoundingClientRect() : { width: 1, height: 1 };
    return { width: Math.max(1, Math.round(width || bounds.width || 1)), height: Math.max(1, Math.round(height || bounds.height || 1)) };
  }
  function svgKey(element, prefix) {
    var id = svgIds.get(element);
    if (!id) { id = frameId + '-' + (prefix || 'svg') + '-' + nextSvg++; svgIds.set(element, id); }
    return id;
  }
  function publishSvg(element, id, svg, filename) {
    if (!svg || svg.length > 900000) return;
    var normalized = svg;
    try {
      if (w.DOMParser && w.XMLSerializer && document.body) {
        var root = new w.DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        var holder = document.createElement('div');
        holder.style.cssText = 'position:absolute;left:-100000px;top:-100000px;width:1px;height:1px;overflow:hidden;visibility:hidden';
        var rendered = document.importNode(root, true);
        holder.appendChild(rendered); document.body.appendChild(holder);
        if (typeof rendered.getBBox === 'function') centerSvgRoot(root, rendered.getBBox());
        normalized = new w.XMLSerializer().serializeToString(root);
        holder.remove();
      }
    } catch (_) {}
    if (normalized.length > 900000 || svgSnapshots.get(element) === normalized) return;
    svgSnapshots.set(element, normalized);
    var dimensions = svgDimensions(normalized, element);
    emit('svg_detected', { canvas_id: id, asset_type: 'svg', width: dimensions.width, height: dimensions.height, svg: normalized, filename: filename || id + '.svg' });
  }
  function externalSvgSource(element) {
    var tagName = String(element.tagName || '').toLowerCase();
    if (tagName === 'object') return element.getAttribute('data') || '';
    return element.currentSrc || element.getAttribute('src') || '';
  }
  function isSvgSource(source) { return /^data:image\/svg\+xml[;,]/i.test(source) || /\.svg(?:[?#].*)?$/i.test(source); }
  function decodeSvgDataUrl(source) {
    var comma = source.indexOf(',');
    if (comma < 0) return null;
    try { return /;base64/i.test(source.slice(0, comma)) ? w.atob(source.slice(comma + 1)) : decodeURIComponent(source.slice(comma + 1)); } catch (_) { return null; }
  }
  function scanExternalSvgs() {
    if (!document.querySelectorAll) return;
    Array.prototype.forEach.call(document.querySelectorAll('img[src], object[data], embed[src]'), function (element) {
      var source = externalSvgSource(element);
      if (!isSvgSource(source)) return;
      var id = svgKey(element, 'svg-file');
      if (svgSources.get(element) === source || svgPendingSources.get(element) === source) return;
      svgSources.set(element, source);
      var dataSvg = /^data:image\/svg\+xml/i.test(source) ? decodeSvgDataUrl(source) : null;
      if (dataSvg) { publishSvg(element, id, dataSvg, id + '.svg'); return; }
      try {
        var url = new w.URL(source, location.href);
        if (url.origin !== location.origin || !w.fetch) return;
        svgPendingSources.set(element, source);
        w.fetch(url.href, { credentials: 'include' }).then(function (response) { return response.ok ? response.text() : ''; }).then(function (text) {
          if (text && svgSources.get(element) === source) { var parts = url.pathname.split('/'); var filename = decodeURIComponent(parts[parts.length - 1] || id + '.svg'); publishSvg(element, id, text, filename); }
        }).catch(function () {}).finally(function () { svgPendingSources.delete(element); });
      } catch (_) {}
    });
  }
  function scanSvgs() { scanInlineSvgs(); scanExternalSvgs(); }
  function installSvgDetection() {
    var schedule = function () {
      if (schedule.timer) return;
      schedule.timer = setTimeout(function () { schedule.timer = null; scanSvgs(); }, 350);
    };
    if (document.documentElement && w.MutationObserver) new w.MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['viewBox', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'transform'] });
    w.addEventListener('DOMContentLoaded', schedule, { once: true });
    setTimeout(schedule, 500);
  }
  function scanCanvases() {
    if (!document.querySelectorAll) return;
    Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (canvas) { canvasId(canvas); });
  }
  function installCanvasDetection() {
    var schedule = function () {
      if (schedule.timer) return;
      schedule.timer = setTimeout(function () { schedule.timer = null; scanCanvases(); }, 100);
    };
    if (document.documentElement && w.MutationObserver) new w.MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
    w.addEventListener('DOMContentLoaded', schedule, { once: true });
    setTimeout(schedule, 500);
  }
  var P2D = w.Path2D;
  installPath(); installContext(); emit('session_start', {}); installCanvasDetection(); installSvgDetection();
  w.__CVR_STOP_RECORDER__ = function () { if (stopped) return; emit('session_end', {}); stopped = true; if (flushTimer) clearTimeout(flushTimer); flush(); };
  w.addEventListener('message', function (event) { if (event.source !== w || !event.data) return; if (event.data.type === 'cvr-stop') w.__CVR_STOP_RECORDER__(); if (event.data.type === 'cvr-set-recording') recordingEnabled = Boolean(event.data.enabled); });
}());
