import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../src/recorder-bridge.js', import.meta.url), 'utf8');
const controls = await readFile(new URL('../src/target-controls.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const licenseCreate = await readFile(new URL('../tools/license-create.mjs', import.meta.url), 'utf8');
const licenseRust = await readFile(new URL('../src-tauri/src/license/mod.rs', import.meta.url), 'utf8');
const commands = await readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../src-tauri/permissions/default.toml', import.meta.url), 'utf8');
const desktopCapability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/desktop.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
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
  assert.match(main, /save_svg', \{ canvasId: selectedCanvas, settings: settings\(\), filename: lastSvg\.filename \}/);
  assert.match(commands, /filename: Option<String>/);
  assert.match(commands, /safe_svg_filename\(&filename\)/);
  assert.match(styles, /#workspaceView #refreshSettings \{ width: 100%; margin-top: 12px; color: inherit;/);
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
  assert.match(index, /class="landing-mark" src="\.\/assets\/brand\/recorder-brand\.png"/);
  assert.match(index, /id="landingQuote" class="landing-quote"/);
  assert.match(main, /const LANDING_DURATION_MS = 8_000/);
  assert.match(main, /const LANDING_QUOTES = \[/);
  assert.match(main, /function showRandomLandingQuote/);
  assert.match(main, /LAST_LANDING_QUOTE_KEY/);
  assert.match(main, /landingView\.hidden = true/);
  assert.match(styles, /#landingView\.landing-shell \{[\s\S]*background: #121b22;/);
  assert.match(styles, /#landingView \.landing-quote/);
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
  assert.match(index, /<header class="topbar">[\s\S]*?<img class="brand-icon" src="\.\/assets\/brand\/recorder-brand\.png" alt="">/);
  assert.match(styles, /\.badge \{[^}]*font-size: 12px;/);
});

test('workspace provides a persistent accessible dark mode toggle', () => {
  assert.match(index, /id="themeToggle"/);
  assert.match(index, /id="licenseBadge"[\s\S]*id="themeToggle"/);
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
  assert.match(styles, /\.update-indicator[\s\S]*border-radius: 50%/);
  assert.match(main, /from '@tauri-apps\/plugin-updater'/);
  assert.match(main, /downloadAndInstall/);
  assert.match(main, /setUpdateAvailable\(true\)/);
  assert.match(main, /Belum ada release updater yang dipublish di GitHub/);
});

test('workspace checks for releases at most once per day', () => {
  assert.match(main, /UPDATE_CHECK_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(main, /UPDATE_CHECK_STORAGE_KEY/);
  assert.match(main, /checkForUpdatesOncePerDay\(\)/);
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

test('recorder is always active and perpetual licenses show the email', () => {
  assert.doesNotMatch(index, /recordToggle|REC ON/);
  assert.doesNotMatch(main, /recordingEnabled|set_recording/);
  assert.match(main, /s\.perpetual[\s\S]*s\.email \|\| 'Lisensi aktif'/);
  assert.doesNotMatch(bridge, /recordingEnabled|cvr-set-recording/);
});

test('license product code comes from LICENSE_PRODUCT_CODE', () => {
  assert.match(licenseCreate, /process\.env\.LICENSE_PRODUCT_CODE/);
  assert.match(licenseCreate, /WIB_OFFSET_MS/);
  assert.match(licenseCreate, /issuedInWib/);
  assert.match(licenseRust, /option_env!\("LICENSE_PRODUCT_CODE"\)/);
});
