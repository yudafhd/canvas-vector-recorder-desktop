// Keep the animated loader faithful to the source vector artwork.
// Regenerate after editing camera.svg: node tools/generate-camera-loader.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/assets/brand/camera.svg', import.meta.url), 'utf8');
const artwork = source.match(/<g id="artwork-transform"[\s\S]*<\/g>/)?.[0];
const outline = source.match(/<path id="shape-2"[^>]*\/>/)?.[0];
const transform = source.match(/<g id="artwork-transform"[^>]*transform="([^"]+)"/)?.[1];
if (!artwork || !outline || !transform) throw new Error('Camera artwork or outline is missing.');

const frame = outline
  .replace('id="shape-2"', 'id="camera-outline"')
  .replace('fill="#000000"', 'fill="none" stroke="#c7e5ed" stroke-width="0.65" vector-effect="non-scaling-stroke"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2312" height="1734" viewBox="0 0 2312 1734" fill="none" color-interpolation="sRGB">
  <title>Camera — outline, color, and capture</title>
  <defs>
    <clipPath id="camera-frame-clip" clipPathUnits="userSpaceOnUse">
      <rect class="frame-reveal" width="2312" height="1734"/>
    </clipPath>
    <clipPath id="camera-color-clip" clipPathUnits="userSpaceOnUse">
      <rect class="color-reveal" width="2312" height="1734"/>
    </clipPath>
  </defs>
  <style>
    .frame-reveal, .color-reveal { transform-origin: 0 0; }
    .frame-reveal { animation: reveal 2.7s cubic-bezier(.4,0,.6,1) .15s both; }
    .color-reveal { animation: reveal 1.8s cubic-bezier(.4,0,.6,1) 2.9s both; }
    .camera-frame { animation: frame-fade .45s ease-out 4.5s both; }
    .camera-body { transform-origin: 50% 94%; transform-box: view-box; animation: caught 3s ease-in-out 4.8s both; }
    @keyframes reveal { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    @keyframes frame-fade { from { opacity: .85; } to { opacity: 0; } }
    @keyframes caught {
      0%, 10% { transform: rotate(0deg); }
      20% { transform: rotate(-5deg); }
      30% { transform: rotate(4deg); }
      40%, 46% { transform: rotate(0deg); }
      56% { transform: rotate(-3.5deg); }
      66% { transform: rotate(3deg); }
      76%, 80% { transform: rotate(0deg); }
      88% { transform: rotate(-1.8deg); }
      95% { transform: rotate(1.4deg); }
      100% { transform: rotate(0deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .frame-reveal, .color-reveal, .camera-frame, .camera-body { animation: none; transform: none; }
      .camera-frame { display: none; }
    }
  </style>
  <g class="camera-body">
    <g class="camera-frame" clip-path="url(#camera-frame-clip)">
      <g transform="${transform}">${frame}</g>
    </g>
    <g class="camera-color" clip-path="url(#camera-color-clip)">
      ${artwork}
    </g>
  </g>
</svg>\n`;
writeFileSync(new URL('../src/assets/brand/camera-loader.svg', import.meta.url), svg);
console.log('Camera loader generated from camera.svg. Animation finishes at 7.8 seconds.');
