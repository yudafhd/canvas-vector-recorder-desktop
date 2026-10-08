import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const bridge = await readFile(new URL('../src/recorder-bridge.js', import.meta.url), 'utf8');
const controls = await readFile(new URL('../src/target-controls.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const loaderStyles = await readFile(new URL('../src/camera-loader.css', import.meta.url), 'utf8');
const licenseCreate = await readFile(new URL('../tools/license-create.mjs', import.meta.url), 'utf8');
const licenseRust = await readFile(new URL('../src-tauri/src/license/mod.rs', import.meta.url), 'utf8');
const commands = await readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../src-tauri/permissions/default.toml', import.meta.url), 'utf8');
const desktopCapability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/desktop.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

async function exerciseCanvasBridge(draw, transport) {
  function Canvas() { this._width = 100; this._height = 100; }
  for (const property of ['width', 'height']) Object.defineProperty(Canvas.prototype, property, {
    configurable: true, get() { return this[`_${property}`]; }, set(value) { this[`_${property}`] = value; },
  });
  function Context() { this.canvas = new Canvas(); this.fillStyle = '#ff0000'; this.strokeStyle = '#00ff00'; this.lineWidth = 7; }
  for (const method of ['fill', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo']) Context.prototype[method] = function () {};
  Context.prototype.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const batches = [], reports = [];
  const window = {
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context, __CVR_SESSION_TOKEN__: 'session',
    __TAURI_INTERNALS__: { async invoke(name, args) {
      if (name === 'record_canvas_events') { batches.push(args.events); if (transport) await transport(args.events, batches.length); }
      if (name === 'report_recorder_error') reports.push(args);
    } },
    addEventListener() {}, console: { error() {} },
  };
  runInNewContext(bridge, { window, document: { documentElement: null, querySelectorAll: () => [] },
    setTimeout: (fn, delay) => setTimeout(fn, delay === 150 || delay === 300 ? 0 : delay), clearTimeout, Promise, Reflect, WeakMap, Map, Set });
  draw(new Context());
  await window.__CVR_STOP_RECORDER__();
  return { batches, reports };
}

test('rectangle paints include their actual colors and stroke width', async () => {
  const { batches } = await exerciseCanvasBridge(ctx => { ctx.fillRect(0, 0, 40, 40); ctx.strokeRect(0, 0, 40, 40); });
  const events = batches.flat();
  assert.equal(events.find(event => event.type === 'fill_rect').fill_style, '#ff0000');
  const stroke = events.find(event => event.type === 'stroke_rect');
  assert.equal(stroke.stroke_style, '#00ff00');
  assert.equal(stroke.line_width, 7);
});

test('resizing creates a fresh current path for the next fill', async () => {
  const { batches } = await exerciseCanvasBridge(ctx => {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.fill();
    ctx.canvas.width = ctx.canvas.width;
    ctx.fill();
  });
  const fills = batches.flat().filter(event => event.type === 'fill');
  assert.notEqual(fills[0].path_id, fills[1].path_id);
  assert.equal(batches.flat().filter(event => event.type === 'path_created').length, 2);
});

test('failed batches retry in order before any later batch is sent', async () => {
  const { batches, reports } = await exerciseCanvasBridge(ctx => {
    for (let index = 0; index < 120; index++) ctx.fillRect(0, 0, 40, 40);
  }, (_, attempt) => { if (attempt === 1) throw new Error('lost response'); });
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0], batches[1]);
  assert.equal(batches[2][0].sequence, batches[1].at(-1).sequence + 1);
  assert.equal(reports.length, 0);
});

test('permanent transport failures stop later batches and report an error', async () => {
  const { batches, reports } = await exerciseCanvasBridge(ctx => {
    for (let index = 0; index < 120; index++) ctx.fillRect(0, 0, 40, 40);
  }, () => { throw new Error('unavailable'); });
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0], batches[2]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].sessionId, 'session');
  assert.match(reports[0].message, /Perekaman terhenti/);
});
test('bridge batches events and flushes by timer or count', () => {
  assert.match(bridge, /MAX_BATCH = 100/); assert.match(bridge, /FLUSH_MS = 150/); assert.match(bridge, /queue\.length >= MAX_BATCH/); assert.match(bridge, /record_canvas_events/);
});
test('bridge has duplicate-injection and stop behavior', () => {
  assert.match(bridge, /__CVR_CANVAS_BRIDGE_V1__/); assert.match(bridge, /__CVR_STOP_RECORDER__/); assert.match(bridge, /session_start/); assert.match(bridge, /session_end/);
});
test('bridge is transport-only and does not generate SVG', () => { assert.doesNotMatch(bridge, /buildSvg|escapeXml|license/i); });
test('bridge detects Canvas assets and serializes meaningful SVG assets', () => {
  assert.match(bridge, /OffscreenCanvas/); assert.match(bridge, /querySelectorAll\('canvas'\)/); assert.match(bridge, /canvas_resized/);
  assert.match(bridge, /querySelectorAll\('svg'\)/); assert.match(bridge, /XMLSerializer/); assert.match(bridge, /record_svg_asset/);
  assert.doesNotMatch(bridge, /img\[src\], object\[data\], embed\[src\]/);
});
test('bridge snapshots Path2D copies at construction and sends batches in sequence', async () => {
  function NativePath2D() {}
  NativePath2D.prototype.addPath = function () {};
  NativePath2D.prototype.lineTo = function () {};
  function Context() { this.canvas = { width: 768, height: 1024 }; this.fillStyle = '#000'; }
  Context.prototype.fill = function () {};
  Context.prototype.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const calls = [];
  let resolveFirst;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const window = {
    Path2D: NativePath2D,
    CanvasRenderingContext2D: Context,
    __CVR_SESSION_TOKEN__: 'session',
    __TAURI_INTERNALS__: { invoke(name, args) {
      if (name === 'record_canvas_events') calls.push(args.events);
      return calls.length === 1 ? first : Promise.resolve();
    } },
    addEventListener() {},
  };
  const document = { documentElement: null, querySelectorAll: () => [] };
  runInNewContext(bridge, { window, document, setTimeout, clearTimeout, Promise, Reflect, WeakMap });
  const d = 'M 0 0' + ' L 1 1'.repeat(2000);
  const source = new window.Path2D(d);
  const copy = new window.Path2D(source);
  source.lineTo(500, 500);
  const combined = new window.Path2D();
  combined.addPath(copy, { a: 0, b: 1, c: -1, d: 0, e: 100, f: 200 });
  new Context().fill(combined, 'evenodd');
  window.__CVR_STOP_RECORDER__();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  resolveFirst();
  await new Promise(resolve => setImmediate(resolve));
  const events = calls.flat();
  assert.equal(events.find(event => event.type === 'path_created' && event.value === d)?.path_id !== undefined, true);
  assert.equal(events.find(event => event.type === 'path_created' && event.value?.source_path_id)?.value.source_path_id,
    events.find(event => event.type === 'path_created' && event.value === d)?.path_id);
  const copyCreated = events.find(event => event.type === 'path_created' && event.value?.source_path_id);
  const sourceMutation = events.find(event => event.type === 'path_command' && event.command.type === 'line_to');
  assert.ok(copyCreated.sequence < sourceMutation.sequence, 'the backend must clone the path before its source changes');
  assert.equal(events.find(event => event.type === 'path_append')?.value.source_path_id,
    events.find(event => event.type === 'path_created' && event.value?.source_path_id)?.path_id);
  assert.deepEqual(Array.from(events.find(event => event.type === 'path_append')?.transform || []), [0, 1, -1, 0, 100, 200]);
  assert.equal(events.find(event => event.type === 'fill')?.path_id,
    events.find(event => event.type === 'path_append')?.path_id);
  assert.equal(events.find(event => event.type === 'fill')?.fill_rule, 'evenodd');
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
});
test('detached canvases are hidden from the recorded asset list', async () => {
  const timers = [];
  const observer = {};
  const canvas = { width: 100, height: 100, getBoundingClientRect: () => ({ width: 100, height: 100 }) };
  let attached = [canvas];
  const batches = [];
  const window = {
    __CVR_SESSION_TOKEN__: 'session',
    __TAURI_INTERNALS__: { invoke(name, args) { if (name === 'record_canvas_events') batches.push(args.events); return Promise.resolve(); } },
    MutationObserver: class { constructor(callback) { observer.callback = callback; } observe() {} },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    addEventListener() {},
  };
  const document = { documentElement: null, querySelectorAll: selector => selector === 'canvas' ? attached : [] };
  const setTimeout = callback => { timers.push(callback); return timers.length; };
  const drainTimers = () => { while (timers.length) timers.shift()(); };
  runInNewContext(bridge, { window, document, setTimeout, clearTimeout() {}, Promise, Reflect, WeakMap, Map, Set });
  document.documentElement = {};
  drainTimers();
  assert.equal(typeof observer.callback, 'function');
  attached = [];
  observer.callback();
  drainTimers();
  window.__CVR_STOP_RECORDER__();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(batches.flat().filter(event => event.type === 'canvas_visibility').map(event => event.value), [true, false]);
});
test('assigning the same canvas width resets the recorded paint', async () => {
  function Canvas() { this._width = 100; this._height = 100; }
  Object.defineProperty(Canvas.prototype, 'width', { configurable: true, get() { return this._width; }, set(value) { this._width = value; } });
  Object.defineProperty(Canvas.prototype, 'height', { configurable: true, get() { return this._height; }, set(value) { this._height = value; } });
  const canvas = new Canvas();
  function Context() { this.canvas = canvas; }
  Context.prototype.fillRect = function () {};
  Context.prototype.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const batches = [];
  const window = {
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context,
    __CVR_SESSION_TOKEN__: 'session',
    __TAURI_INTERNALS__: { invoke(name, args) { if (name === 'record_canvas_events') batches.push(args.events); return Promise.resolve(); } },
    addEventListener() {},
  };
  runInNewContext(bridge, { window, document: { documentElement: null, querySelectorAll: () => [] }, setTimeout, clearTimeout, Promise, Reflect, WeakMap, Map, Set });
  const ctx = new Context();
  ctx.fillRect(0, 0, 100, 100);
  canvas.width = 100;
  ctx.fillRect(0, 0, 50, 50);
  window.__CVR_STOP_RECORDER__();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(batches.flat().filter(event => ['canvas_created', 'canvas_resized', 'fill_rect'].includes(event.type)).map(event => event.type),
    ['canvas_created', 'fill_rect', 'canvas_resized', 'fill_rect']);
});
test('target controls omit the browser navigation toolbar', () => {
  assert.match(controls, /__CVR_TARGET_TAB_ID__/);
  assert.match(controls, /open_target_tab/);
  assert.match(controls, /switch_target_tab/);
  assert.match(controls, /close_target_tab/);
  assert.match(controls, /sync_target_tab/);
  assert.doesNotMatch(controls, /Target browser controls|history\.back|history\.forward|location\.reload|id=\\?"go\\?"/);
});

test('target controls keep tabs in one native window', () => {
  assert.match(controls, /new-tab/);
  assert.match(controls, /target === '_blank'/);
  assert.match(controls, /window\.open/);
  assert.match(controls, /__CVR_SET_TABS__/);
  assert.match(controls, /data-cvr-target-controls/);
});

test('target controls provide a reload button for every target tab', () => {
  assert.match(controls, /tab-reload/);
  assert.match(controls, /Muat ulang tab/);
  assert.match(controls, /reload_target_tab/);
  assert.doesNotMatch(controls, /handleMacReloadShortcut|location\.reload/);
});

test('closing the last target tab returns to the recorder', () => {
  assert.match(commands, /closes_last_tab/);
  assert.match(commands, /target_platform::close_target_views\(&app\)/);
  assert.match(commands, /TargetState::default\(\)/);
  assert.match(commands, /app\.emit\("target-closed", \(\)\)/);
});

test('main macOS tabs provide reload controls and stay compact', () => {
  assert.match(index, /id="newTargetMainTab"[^>]*aria-label="Buka tab target baru"/);
  assert.match(main, /\$\('newTargetMainTab'\)\.addEventListener\('click', \(\) => openTarget\(\)/);
  assert.match(main, /target-tab-reload/);
  assert.match(main, /reload_target_tab/);
  assert.match(styles, /\.target-tab-wrap \.target-main-tab \{ min-width: 100px; max-width: 180px;/);
  assert.match(styles, /\.target-tab-wrap \.target-main-tab \{ justify-content: flex-start; text-align: left; \}/);
  assert.match(styles, /\.target-tab-wrap \.target-main-tab > \.target-tab-label \{ flex: 1 1 auto; min-width: 0;/);
  assert.match(index, /id="targetTabsCount"/);
  assert.match(main, /targetTabsCount\.textContent/);
  assert.match(main, /target-tab-index/);
  assert.match(main, /event\.button !== 1/);
  assert.match(main, /event\.key === 'Tab'/);
  assert.match(main, /event\.key\.toLowerCase\(\) === 'w'/);
  assert.match(styles, /\.target-tab-wrap:hover \.target-tab-close/);
  assert.match(styles, /\.target-main-tab\.active \{ box-shadow: inset 0 3px/);
});

test('macOS target view puts the native webview at the top of the tab content', () => {
  assert.match(main, /mac-target-view/);
  assert.match(styles, /\.target-main-view\.mac-target-view \{ padding-top: 46px; \}/);
  assert.match(styles, /\.target-main-view\.mac-target-view \.target-main-toolbar \{ display: none; \}/);
});

test('preview provides artwork scale controls used by SVG settings', () => {
  assert.match(main, /artworkScale/);
  assert.match(main, /previewZoomSlider/);
  assert.match(index, /id="resetPreview"/);
  assert.match(index, /id="previewZoomSlider"[^>]*max="4"/);
  assert.match(main, /setPreviewZoomValue\(previewZoom - event\.deltaY \* 0\.001\)/);
  assert.match(main, /resetPreviewView/);
  assert.match(main, /draggable="false"/);
  assert.match(main, /dragstart/);
  assert.match(main, /artworkScaleSlider/);
  assert.match(main, /pointerdown/);
  assert.match(main, /pointermove/);
  assert.match(main, /previewPinchStart/);
  assert.match(main, /event\.ctrlKey/);
  assert.doesNotMatch(index, /previewZoomDown|previewZoomUp|artworkScaleDown|artworkScaleUp/);
  assert.match(index, /class="artwork-scale-setting"[\s\S]*artworkScaleSlider/);
  assert.doesNotMatch(index, /class="preview-tools"[\s\S]*artwork-scale-control/);
  assert.match(index, /<div id="preview" class="preview">[\s\S]*id="previewStage"/);
  assert.match(styles, /\.preview-tools \{ position: static;[\s\S]*\.preview-tool-group/);
  assert.match(styles, /\.preview-stage\.is-interacting img \{ transition: none; \}/);
  assert.match(styles, /\.artwork-scale-setting input\[type="range"\]/);
  assert.match(main, /\$\('previewStage'\)\.innerHTML/);
  assert.doesNotMatch(main, /\$\('preview'\)\.innerHTML/);
});

test('preview filename can be edited and is used for export', () => {
  assert.match(index, /id="editFilename"/);
  assert.match(index, /data-lucide="pencil"/);
  assert.match(index, /id="previewFilenameEditor"/);
  assert.match(main, /normalizedFilename/);
  assert.match(main, /filenameOverrides/);
  assert.match(main, /persistSettingsSilently\(\)/);
  assert.match(main, /save_svg', \{ canvasId: selectedCanvas, settings: settings\(\), filename: filenameToSave/);
  assert.match(commands, /filename: Option<String>/);
  assert.match(commands, /safe_svg_filename\(&filename\)/);
});

test('export settings provide custom ratio fields and persist all user settings', () => {
  assert.match(index, /id="exportSettingsForm"/);
  assert.match(index, /value="custom">Custom/);
  assert.match(index, /id="customRatioWidth"/);
  assert.match(index, /id="customRatioHeight"/);
  assert.match(main, /selectedRatioForBackend/);
  assert.match(main, /syncRatioInputsFromSelection/);
  assert.match(main, /ratioSelect\.value = 'custom'/);
  assert.match(main, /localStorage\.setItem/);
  assert.match(main, /localStorage\.getItem/);
  assert.match(main, /SETTINGS_STORAGE_KEY/);
});

test('target controls enforce a five-tab limit', () => {
  assert.match(controls, /MAX_TABS = 5/);
  assert.match(controls, /Maksimal 5 tab/);
});

test('activation screen hides workspace navigation and provides submit feedback', () => {
  assert.match(styles, /\[hidden\]\s*\{\s*display: none !important;/);
  assert.match(index, /class="view activation-shell"/);
  assert.match(index, /label for="licenseEmail"/);
  assert.match(index, /label for="licenseCode"/);
  assert.match(styles, /#activationView #activationForm label \{ display: flex; flex-direction: column; width: 100%;/);
  assert.match(styles, /#activationView #activationForm input, #activationView #activationForm textarea \{ display: block; width: 100%;/);
  assert.match(styles, /\.topbar \{[^}]*padding: 8px 0px;/);
  assert.match(main, /activationSubmit\.disabled = true/);
  assert.match(main, /activationSubmit\.textContent = 'Mengaktifkan…'/);
});

test('startup shows an eight-second landing screen with a local Jakarta font', () => {
  assert.match(index, /id="landingView" class="view landing-shell"/);
  assert.match(index, /id="landingRecorder" class="landing-recorder"/);
  assert.doesNotMatch(index, /id="landingQuote"/);
  assert.match(main, /const LANDING_DURATION_MS = 8_000/);
  assert.match(main, /initRecorderLoader\(\$\('landingRecorder'\)\)/);
  assert.match(main, /landingView\.hidden = true/);
  assert.match(loaderStyles, /#landingView\.landing-shell \{[\s\S]*background: #121b22;/);
  assert.match(styles, /@font-face/);
  assert.match(styles, /assets\/fonts\/plus-jakarta-sans-variable\.ttf/);
});

test('main window refreshes with the platform keyboard shortcut', () => {
  assert.match(main, /function handleRefreshShortcut\(event: KeyboardEvent\)/);
  assert.match(main, /!event\.metaKey && !event\.ctrlKey/);
  assert.match(main, /window\.location\.reload\(\)/);
  assert.match(main, /window\.addEventListener\('keydown', handleRefreshShortcut\)/);
});

test('main window starts maximized', () => {
  assert.equal(tauriConfig.app.windows.find(window => window.label === 'main')?.maximized, true);
});

test('workspace and target tabs use Lucide icons', () => {
  assert.match(index, /data-lucide="monitor-play"/);
  assert.match(index, /data-lucide="download"/);
  assert.match(main, /createIcons/);
  assert.match(main, /iconPlaceholder\('globe'\)/);
  assert.match(controls, /lucidePaths/);
  assert.match(controls, /icon\('globe'\)/);
  assert.doesNotMatch(controls, /reload\.textContent = '↻'/);
  assert.doesNotMatch(controls, /close\.textContent = '×'/);
});

test('workspace brand links to mahes.app', () => {
  assert.match(index, /id="mahesLink" class="brand-link" href="https:\/\/mahes\.app" target="_blank"/);
  assert.match(main, /invoke\('open_mahes_app'\)/);
  assert.match(commands, /pub fn open_mahes_app/);
  assert.match(commands, /MAHES_APP_URL/);
  assert.match(permissions, /"open_mahes_app"/);
  assert.match(styles, /\.brand-link/);
});

test('workspace shows the application version beside the brand title', () => {
  assert.match(index, /id="appVersion" class="brand-version"/);
  assert.match(main, /import packageJson from '\.\.\/package\.json'/);
  assert.match(main, /appVersion\.textContent = `v\$\{packageJson\.version\}`/);
  assert.match(styles, /\.brand-title-row/);
  assert.match(index, /<header class="topbar">[\s\S]*?<img class="brand-icon" src="\.\/assets\/brand\/recorder-brand\.svg" alt="">/);
  assert.match(styles, /\.brand-version/);
});

test('workspace provides a persistent accessible dark mode toggle', () => {
  assert.match(index, /id="themeToggle"/);
  assert.match(index, /aria-pressed="false"/);
  assert.match(main, /THEME_STORAGE_KEY/);
  assert.match(main, /applyTheme\(!darkMode\)/);
  assert.match(main, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /#202124/);
  assert.match(styles, /\.theme-toggle[\s\S]*width: 36px[\s\S]*border: 0/);
  assert.match(styles, /\.topbar-update, \.theme-toggle[\s\S]*background: #f1f3f4[\s\S]*border: 0/);
  assert.doesNotMatch(styles, /\.theme-toggle:hover[^}]*border-color/);
});

test('workspace updater uses signed Tauri releases', () => {
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.equal(typeof tauriConfig.plugins.updater.pubkey, 'string');
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
  assert.match(tauriConfig.plugins.updater.endpoints[0], /github\.com\/yudafhd\/canvas-vector-recorder-desktop/);
  assert.deepEqual(desktopCapability.permissions, ['updater:default']);
  assert.match(index, /id="checkForUpdates"/);
  assert.match(index, /id="updateIndicator" class="update-indicator"/);
  assert.match(index, /id="updatePrompt"/);
  assert.match(index, /id="updatePromptInstall"/);
  assert.match(styles, /\.update-indicator[\s\S]*border-radius: 50%/);
  assert.match(styles, /\.update-prompt \{ position: fixed;/);
  assert.match(main, /from '@tauri-apps\/plugin-updater'/);
  assert.match(main, /downloadAndInstall/);
  assert.match(main, /function showUpdatePrompt/);
  assert.match(main, /function installPendingUpdate/);
  assert.match(main, /showUpdatePrompt\('Aplikasi sudah terbaru'/);
  assert.match(main, /updatePromptCancel\.hidden = !installer/);
  assert.doesNotMatch(main, /window\.confirm/);
  assert.match(main, /setUpdateAvailable\(true\)/);
  assert.match(main, /Belum ada release updater yang dipublish di GitHub/);
});

test('workspace checks for releases periodically', () => {
  assert.match(main, /UPDATE_CHECK_INTERVAL_MS = 3 \* 60 \* 60 \* 1000/);
  assert.match(main, /setAutomaticUpdateChecks/);
  assert.match(main, /checkForUpdates\(\{ automatic: true \}\)/);
});

test('license time source stays in Rust without a clock widget', () => {
  assert.doesNotMatch(index, /clockStatus|clockTime|clock-3/);
  assert.doesNotMatch(main, /getClockStatus|updateHomeClock|formatDeviceClock/);
  assert.doesNotMatch(commands, /get_clock_status/);
  assert.match(licenseRust, /TIME_NOW_URL/);
  assert.match(licenseRust, /fn time_now\(\)/);
  assert.match(licenseRust, /\.activate\(code, email, trusted_now\(\)\)/);
  assert.match(licenseRust, /manager\(app\)\?\.status\(Utc::now\(\)\)/);
  assert.doesNotMatch(licenseRust, /timeapi\.world/);
  assert.doesNotMatch(styles, /\.clock-status/);
});

test('license gating happens before workspace rendering on the landing page', () => {
  assert.doesNotMatch(commands, /license::require_valid/);
  assert.match(main, /landingStatus.textContent = 'Memeriksa lisensi/);
  assert.match(main, /landingView.hidden = true/);
  assert.match(main, /landingView.hidden = false/);
  assert.match(main, /void loadLicense\(\)/);
});

test('recorder is always active and perpetual licenses show active status', () => {
  assert.doesNotMatch(index, /recordToggle|REC ON/);
  assert.doesNotMatch(main, /recordingEnabled|set_recording/);
  assert.match(main, /renderLicense\([\s\S]*s\.valid/);
  assert.doesNotMatch(bridge, /recordingEnabled|cvr-set-recording/);
});

test('license product code comes from LICENSE_PRODUCT_CODE', () => {
  assert.match(licenseCreate, /process\.env\.LICENSE_PRODUCT_CODE/);
  assert.match(licenseCreate, /WIB_OFFSET_MS/);
  assert.match(licenseCreate, /issuedInWib/);
  assert.match(licenseRust, /option_env!\("LICENSE_PRODUCT_CODE"\)/);
});

test('preview groups interactive object eraser controls', () => {
  assert.match(index, /id="eraseMarkedObjects"/);
  assert.match(index, /id="clearMarkedObjects"/);
  assert.match(index, /id="restoreErasedObjects"/);
  assert.match(styles, /\.preview-eraser-actions/);
  assert.match(styles, /\.preview-stage\.eraser-mode/);
  assert.match(styles, /\[data-eraser-marked="true"\]/);
  assert.match(main, /objectEraserActive/);
  assert.match(main, /eraseMarkedObjects/);
  assert.match(main, /renderSvgToPreviewStage/);
});
