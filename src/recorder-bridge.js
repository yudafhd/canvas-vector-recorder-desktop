(function () {
  'use strict';
  var w = window;
  var MARK = '__CVR_CANVAS_BRIDGE_V1__';
  if (w[MARK]) return;
  w[MARK] = true;
  var sessionId = String(w.__CVR_SESSION_TOKEN__ || '');
  if (!sessionId) return;
  var frameId = 'frame-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  var sequence = 0, queue = [], stopped = false, flushTimer = null;
  var canvasIds = new WeakMap(), canvasSizes = new WeakMap(), svgIds = new WeakMap(), paths = new WeakMap(), contexts = new WeakMap(), nextCanvas = 1, nextSvg = 1, nextPath = 1;
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
    if (stopped) return;
    var event = Object.assign({ session_id: sessionId, frame_id: frameId, sequence: ++sequence, type: type }, data || {});
    queue.push(event);
    if (queue.length >= MAX_BATCH) flush();
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
  function scanCanvases() {
    if (!document.querySelectorAll) return;
    Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (canvas) {
      var id = canvasId(canvas);
      emit('canvas_visibility', { canvas_id: id, value: canvasIsVisible(canvas) });
    });
  }
  function canvasIsVisible(canvas) {
    if (!canvas || canvas.hidden) return false;
    var box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (!box || box.width < 1 || box.height < 1) return false;
    try {
      var style = w.getComputedStyle && w.getComputedStyle(canvas);
      return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) !== 0);
    } catch (_) { return true; }
  }
  function svgSize(svg) {
    var viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
    var box = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    var width = Number(svg.getAttribute('width')) || (viewBox.length === 4 && viewBox[2]) || (box && box.width) || 1;
    var height = Number(svg.getAttribute('height')) || (viewBox.length === 4 && viewBox[3]) || (box && box.height) || 1;
    return [Math.max(1, num(width)), Math.max(1, num(height))];
  }
  function svgFilename(svg) {
    var name = svg.getAttribute('data-filename') || svg.id || document.title || 'captured-vector';
    return String(name).replace(/\.[a-z0-9]+$/i, '') + '.svg';
  }
  function isRecordableSvg(svg) {
    if (!svg || (svg.closest && svg.closest('[data-cvr-target-controls]'))) return false;
    var shapes = svg.querySelectorAll && svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line,use,image').length;
    if (!shapes) return false;
    var box = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    return svg.id === 'outputsvg' || !!(svg.id && shapes >= 8 && box && box.width * box.height >= 1024);
  }
  function captureSvg(svg) {
    if (!isRecordableSvg(svg) || !w.XMLSerializer) return;
    var markup;
    try { markup = new w.XMLSerializer().serializeToString(svg); } catch (_) { return; }
    if (!markup || markup.length > 2000000) return;
    if (!/^<svg\b[^>]*\sxmlns=/i.test(markup)) markup = markup.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    var id = svgIds.get(svg);
    if (!id) { id = frameId + '-svg-' + nextSvg++; svgIds.set(svg, id); }
    var dimensions = svgSize(svg);
    invoke('record_svg_asset', { sessionId: sessionId, asset: { svgId: id, width: dimensions[0], height: dimensions[1], shapes: svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line,use,image').length, filename: svgFilename(svg), markup: markup } }).catch(function () {});
  }
  function scanSvgs() {
    if (!document.querySelectorAll) return;
    Array.prototype.forEach.call(document.querySelectorAll('svg'), captureSvg);
  }
  function installCanvasDetection() {
    var schedule = function () {
      if (schedule.timer) return;
      schedule.timer = setTimeout(function () { schedule.timer = null; scanCanvases(); scanSvgs(); }, 100);
    };
    if (document.documentElement && w.MutationObserver) new w.MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height', 'style', 'class', 'hidden'] });
    w.addEventListener('DOMContentLoaded', schedule, { once: true });
    setTimeout(schedule, 500);
  }
  var P2D = w.Path2D;
  installPath(); installContext(); emit('session_start', {}); installCanvasDetection();
  w.__CVR_STOP_RECORDER__ = function () { if (stopped) return; emit('session_end', {}); stopped = true; if (flushTimer) clearTimeout(flushTimer); flush(); };
  w.addEventListener('message', function (event) { if (event.source !== w || !event.data) return; if (event.data.type === 'cvr-stop') w.__CVR_STOP_RECORDER__(); });
}());
