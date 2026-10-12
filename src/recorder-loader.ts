import recorderSvg from './assets/brand/recorder-loader.svg?raw';

const WIDTH = 2312;
const DURATION_MS = 7800;
const ROCKING: [number, number][] = [
  [0, 0], [0.1, 0], [0.2, -5], [0.3, 4], [0.4, 0], [0.46, 0],
  [0.56, -3.5], [0.66, 3], [0.76, 0], [0.8, 0], [0.88, -1.8],
  [0.95, 1.4], [1, 0],
];

function progress(elapsed: number, start: number, duration: number): number {
  const value = Math.max(0, Math.min(1, (elapsed - start) / duration));
  return value * value * (3 - 2 * value);
}

function rotation(elapsed: number): number {
  const value = Math.max(0, Math.min(1, (elapsed - 4800) / 3000));
  for (let i = 1; i < ROCKING.length; i++) {
    const [end, angle] = ROCKING[i];
    if (value > end) continue;
    const [start, previousAngle] = ROCKING[i - 1];
    const ease = (1 - Math.cos(Math.PI * (value - start) / (end - start))) / 2;
    return previousAngle + (angle - previousAngle) * ease;
  }
  return 0;
}

/** Mount a fresh SVG per document; the WebView's image animation cache is bypassed. */
export function initRecorderLoader(container: HTMLElement): void {
  const documentSvg = new DOMParser().parseFromString(recorderSvg, 'image/svg+xml');
  const svg = document.importNode(documentSvg.documentElement, true);
  // The standalone asset keeps its CSS animation. In the app, one clock drives all stages.
  svg.querySelectorAll('style').forEach(style => style.remove());
  svg.setAttribute('width', '196');
  svg.setAttribute('height', '147');
  svg.setAttribute('aria-hidden', 'true');
  const frameReveal = svg.querySelector<SVGRectElement>('.frame-reveal');
  const colorReveal = svg.querySelector<SVGRectElement>('.color-reveal');
  const frame = svg.querySelector<SVGGElement>('.recorder-frame');
  if (!frameReveal || !colorReveal || !frame) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let request = 0;
  let start: number | null = null;
  let finished = false;

  function paint(elapsed: number): void {
    frameReveal!.setAttribute('width', String(WIDTH * progress(elapsed, 150, 2700)));
    colorReveal!.setAttribute('width', String(WIDTH * progress(elapsed, 2900, 1800)));
    frame!.setAttribute('opacity', String(0.85 * (1 - progress(elapsed, 4500, 450))));
    container.style.transform = `rotate(${rotation(elapsed)}deg)`;
  }

  function finish(): void {
    cancelAnimationFrame(request);
    finished = true;
    paint(DURATION_MS);
  }

  function tick(now: number): void {
    // Start on the first painted frame, after the SVG has been mounted.
    start ??= now;
    const elapsed = now - start;
    if (elapsed >= DURATION_MS) { finish(); return; }
    paint(elapsed);
    request = requestAnimationFrame(tick);
  }

  paint(reducedMotion.matches ? DURATION_MS : 0);
  container.replaceChildren(svg);
  if (reducedMotion.matches) finished = true;
  else request = requestAnimationFrame(tick);

  const onMotionChange = (): void => {
    if (reducedMotion.matches && !finished) finish();
  };
  reducedMotion.addEventListener('change', onMotionChange);

  // Stop animation work when startup switches to the workspace or activation screen.
  const landing = container.closest<HTMLElement>('#landingView');
  const activation = document.getElementById('activationView');
  const observer = new MutationObserver(() => {
    if (landing?.hidden || (activation && !activation.hidden)) finish();
  });
  if (landing) observer.observe(landing, { attributes: true, attributeFilter: ['hidden'] });
  if (activation) observer.observe(activation, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(request);
    observer.disconnect();
    reducedMotion.removeEventListener('change', onMotionChange);
  }, { once: true });
}
