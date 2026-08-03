import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../src/recorder-bridge.js', import.meta.url), 'utf8');
const controls = await readFile(new URL('../src/target-controls.js', import.meta.url), 'utf8');
test('bridge batches events and flushes by timer or count', () => {
  assert.match(bridge, /MAX_BATCH = 100/); assert.match(bridge, /FLUSH_MS = 75/); assert.match(bridge, /queue\.length >= MAX_BATCH/); assert.match(bridge, /record_canvas_events/);
});
test('bridge has duplicate-injection and stop behavior', () => {
  assert.match(bridge, /__CVR_CANVAS_BRIDGE_V1__/); assert.match(bridge, /__CVR_STOP_RECORDER__/); assert.match(bridge, /session_start/); assert.match(bridge, /session_end/);
});
test('bridge is transport-only and does not generate SVG', () => { assert.doesNotMatch(bridge, /<svg|buildSvg|escapeXml|license/i); });
test('bridge detects DOM canvas, OffscreenCanvas, and inline/external SVG assets', () => {
  assert.match(bridge, /OffscreenCanvas/); assert.match(bridge, /querySelectorAll\('canvas'\)/); assert.match(bridge, /svg_detected/); assert.match(bridge, /canvas_resized/); assert.match(bridge, /img\[src\], object\[data\], embed\[src\]/);
});
test('target browser controls support URL navigation', () => {
  assert.match(controls, /history\.back/); assert.match(controls, /history\.forward/); assert.match(controls, /location\.reload/); assert.match(controls, /location\.href/); assert.match(controls, /https\?:/);
});
