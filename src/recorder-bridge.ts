/**
 * Typed frontend reference to the raw document-start bridge. Rust embeds the
 * same source into each target WebView navigation. The bridge is intentionally
 * only a transport layer: no SVG, license, storage, or microstock logic lives here.
 */
import bridgeSource from './recorder-bridge.js?raw';

export const RECORDER_BRIDGE_SOURCE = bridgeSource;
