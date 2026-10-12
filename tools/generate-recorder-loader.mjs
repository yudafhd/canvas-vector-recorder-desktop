// Generate the animated loader and static brand logos from the same vector artwork.
// Run: node tools/generate-recorder-loader.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/assets/brand/recorder-loader.svg', import.meta.url), 'utf8');
// Select only original artwork paths, making regeneration safe to repeat.
const paths = source.match(/<path id="(?:gap-filler|shape)-\d+"[^>]*\/>/g);
const outline = source.match(/<path id="shape-2"[^>]*\/>/)?.[0];
const transform = source.match(/<g id="artwork-transform"[^>]*transform="([^"]+)"/)?.[1];
if (!paths?.length || !outline || !transform) throw new Error('Recorder artwork or outline is missing.');
const artwork = `<g id="artwork-transform" transform="${transform}"><g id="artwork">${paths.join('\n')}</g></g>`;

const frame = outline
  .replace('id="shape-2"', 'id="recorder-outline"')
  .replace('fill="#000000"', 'fill="none" stroke="#c7e5ed" stroke-width="0.65" vector-effect="non-scaling-stroke"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2312" height="1734" viewBox="0 0 2312 1734" fill="none" color-interpolation="sRGB">
  <title>Recorder — outline, color, and capture</title>
  <defs>
    <clipPath id="recorder-frame-clip" clipPathUnits="userSpaceOnUse">
      <rect class="frame-reveal" width="2312" height="1734"/>
    </clipPath>
    <clipPath id="recorder-color-clip" clipPathUnits="userSpaceOnUse">
      <rect class="color-reveal" width="2312" height="1734"/>
    </clipPath>
  </defs>
  <style>
    .frame-reveal, .color-reveal { transform-origin: 0 0; }
    .frame-reveal { animation: reveal 2.7s cubic-bezier(.4,0,.6,1) .15s both; }
    .color-reveal { animation: reveal 1.8s cubic-bezier(.4,0,.6,1) 2.9s both; }
    .recorder-frame { animation: frame-fade .45s ease-out 4.5s both; }
    .recorder-body { transform-origin: 50% 94%; transform-box: view-box; animation: caught 3s ease-in-out 4.8s both; }
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
      .frame-reveal, .color-reveal, .recorder-frame, .recorder-body { animation: none; transform: none; }
      .recorder-frame { display: none; }
    }
  </style>
  <g class="recorder-body">
    <g class="recorder-frame" clip-path="url(#recorder-frame-clip)">
      <g transform="${transform}">${frame}</g>
    </g>
    <g class="recorder-color" clip-path="url(#recorder-color-clip)">
      ${artwork}
    </g>
  </g>
</svg>\n`;
writeFileSync(new URL('../src/assets/brand/recorder-loader.svg', import.meta.url), svg);
console.log('Recorder loader generated from recorder-loader.svg. Animation finishes at 7.8 seconds.');

// Square, transparent branding uses the finished artwork, with no animation or masks.
const brand = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 -289 2312 2312" color-interpolation="sRGB">
  <title>Canvas Vector Recorder</title>
  ${artwork}
</svg>\n`;
writeFileSync(new URL('../src/assets/brand/recorder-brand.svg', import.meta.url), brand);
writeFileSync(new URL('../src/favicon.svg', import.meta.url), brand);
console.log('Static brand SVG and favicon generated.');
