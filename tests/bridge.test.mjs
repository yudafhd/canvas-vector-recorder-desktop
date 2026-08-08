import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../src/recorder-bridge.js', import.meta.url), 'utf8');
const controls = await readFile(new URL('../src/target-controls.js', import.meta.url), 'utf8');
test('bridge batches events and flushes by timer or count', () => {
  assert.match(bridge, /MAX_BATCH = 100/); assert.match(bridge, /FLUSH_MS = 150/); assert.match(bridge, /queue\.length >= MAX_BATCH/); assert.match(bridge, /record_canvas_events/);
});
test('bridge has duplicate-injection and stop behavior', () => {
  assert.match(bridge, /__CVR_CANVAS_BRIDGE_V1__/); assert.match(bridge, /__CVR_STOP_RECORDER__/); assert.match(bridge, /session_start/); assert.match(bridge, /session_end/);
});
test('bridge is transport-only and does not generate SVG', () => { assert.doesNotMatch(bridge, /<svg|buildSvg|escapeXml|license/i); });
test('bridge detects Canvas assets without capturing SVG files', () => {
  assert.match(bridge, /OffscreenCanvas/); assert.match(bridge, /querySelectorAll\('canvas'\)/); assert.match(bridge, /canvas_resized/);
  assert.doesNotMatch(bridge, /svg_detected|querySelectorAll\('svg'\)|img\[src\], object\[data\], embed\[src\]/);
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

test('target controls enforce a five-tab limit', () => {
  assert.match(controls, /MAX_TABS = 5/);
  assert.match(controls, /Maksimal 5 tab/);
});
