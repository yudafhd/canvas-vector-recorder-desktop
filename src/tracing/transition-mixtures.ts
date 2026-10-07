/** Bounded RGB simplex fitting and topology guards from NativeTraceEngine. */
type RGB = [number, number, number];
export interface TransitionDiagnostics {
  mixtureCandidates: number; mixtureFits: number; mixtureJunctionFits: number; mixtureTopologyRejected: number;
  mixtureRegionsChanged: number; mixtureReassignedPixels: number;
  boundaryColorRegions: number; boundaryColorProposals: number; boundaryColorChanged: number; boundaryColorRejected: number;
  smallEdgeRegionsMerged: number; smallEdgePixelsChanged: number;
}
export const transitionDefaults: TransitionDiagnostics = {
  mixtureCandidates: 0, mixtureFits: 0, mixtureJunctionFits: 0, mixtureTopologyRejected: 0, mixtureRegionsChanged: 0, mixtureReassignedPixels: 0,
  boundaryColorRegions: 0, boundaryColorProposals: 0, boundaryColorChanged: 0, boundaryColorRejected: 0, smallEdgeRegionsMerged: 0, smallEdgePixelsChanged: 0,
};
const square = (v: number) => v * v;
const distance = (a: RGB, b: RGB) => square(a[0] - b[0]) + square(a[1] - b[1]) + square(a[2] - b[2]);
const error = (rgba: Uint8ClampedArray, p: number, c: RGB) => square(rgba[p * 4] - c[0]) + square(rgba[p * 4 + 1] - c[1]) + square(rgba[p * 4 + 2] - c[2]);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const neighbors = (p: number, w: number, h: number) => [p % w > 0 ? p - 1 : -1, p % w + 1 < w ? p + 1 : -1, p >= w ? p - w : -1, p + w < w * h ? p + w : -1];
const ringX = [-1, 0, 1, 1, 1, 0, -1, -1], ringY = [-1, -1, -1, 0, 1, 1, 1, 0];
const ring4 = [0x82, 0x05, 0x0a, 0x14, 0x28, 0x50, 0xa0, 0x41], ring8 = [0x82, 0x8d, 0x0a, 0x36, 0x28, 0xd8, 0xa0, 0x63];
function components(mask: number, adjacency: number[], cardinalOnly = false) {
  let count = 0;
  while (mask) {
    let component = mask & -mask, front = component;
    while (front) {
      let expanded = 0;
      for (let i = 0; i < 8; i++) if (front & (1 << i)) expanded |= adjacency[i];
      front = expanded & mask & ~component; component |= front;
    }
    mask &= ~component; if (!cardinalOnly || (component & 0xaa)) count++;
  }
  return count;
}
function ringMask(labels: Int16Array, p: number, label: number, w: number, h: number) {
  let mask = 0; const x = p % w, y = Math.floor(p / w);
  for (let i = 0; i < 8; i++) {
    const nx = x + ringX[i], ny = y + ringY[i];
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && labels[ny * w + nx] === label) mask |= 1 << i;
  }
  return mask;
}
export function canGrowTransitionLabel(labels: Int16Array, p: number, destination: number, w: number, h: number) {
  const mask = ringMask(labels, p, destination, w, h);
  return components(mask, ring4, true) === 1 && components(mask ^ 255, ring8) === 1;
}

export class ColorMixture {
  readonly weights: Float64Array;
  private colors: RGB[];
  private gram: number[][];
  private system: number[][];
  private rhs: Float64Array;
  private solution: Float64Array;
  constructor(palette: RGB[], readonly labels: number[], regularization = 25) {
    if (labels.length < 1 || labels.length > 6 || !(regularization > 0)) throw new Error('Invalid local mixture model');
    this.colors = labels.map(i => palette[i]); this.weights = new Float64Array(labels.length);
    this.rhs = new Float64Array(labels.length); this.solution = new Float64Array(labels.length);
    this.system = Array.from({ length: labels.length + 1 }, () => new Array(labels.length + 2).fill(0));
    this.gram = this.colors.map((a, i) => this.colors.map((b, j) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + (i === j ? regularization : 0)));
  }
  private solve(face: number) {
    const working = this.labels.map((_, i) => i).filter(i => face & (1 << i)), n = working.length, system = this.system;
    if (!n) return false;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) system[row][col] = this.gram[working[row]][working[col]];
      system[row][n] = 1; system[row][n + 1] = this.rhs[working[row]];
    }
    for (let col = 0; col < n; col++) system[n][col] = 1;
    system[n][n] = 0; system[n][n + 1] = 1;
    for (let col = 0; col <= n; col++) {
      let pivot = col;
      for (let row = col + 1; row <= n; row++) if (Math.abs(system[row][col]) > Math.abs(system[pivot][col])) pivot = row;
      if (Math.abs(system[pivot][col]) < 1e-12) return false;
      [system[col], system[pivot]] = [system[pivot], system[col]];
      const divisor = system[col][col]; for (let k = col; k <= n + 1; k++) system[col][k] /= divisor;
      for (let row = 0; row <= n; row++) if (row !== col) {
        const multiplier = system[row][col]; for (let k = col; k <= n + 1; k++) system[row][k] -= multiplier * system[col][k];
      }
    }
    this.solution.fill(0); working.forEach((i, row) => { this.solution[i] = system[row][n + 1]; }); return true;
  }
  fit(rgba: Uint8ClampedArray, offset: number, active: number) {
    this.weights.fill(0); let best = -1, nearest = Infinity;
    this.colors.forEach((c, i) => {
      const e = square(rgba[offset] - c[0]) + square(rgba[offset + 1] - c[1]) + square(rgba[offset + 2] - c[2]);
      if ((active & (1 << i)) && e < nearest) { nearest = e; best = i; }
      this.rhs[i] = c[0] * rgba[offset] + c[1] * rgba[offset + 1] + c[2] * rgba[offset + 2];
    });
    if (best < 0) return Infinity;
    this.weights[best] = 1; let face = 1 << best, converged = false;
    const gradient = (a: number) => this.gram[a].reduce((sum, v, b) => sum + v * this.weights[b], -this.rhs[a]);
    for (let pass = 0; pass < 32; pass++) {
      if (!this.solve(face)) break;
      let fraction = 1;
      for (let a = 0; a < this.weights.length; a++) if ((face & (1 << a)) && this.solution[a] < -1e-10) fraction = Math.min(fraction, this.weights[a] / (this.weights[a] - this.solution[a]));
      if (fraction < 1) {
        for (let a = 0; a < this.weights.length; a++) if (face & (1 << a)) {
          this.weights[a] += fraction * (this.solution[a] - this.weights[a]);
          if (this.weights[a] <= 1e-10) { this.weights[a] = 0; face &= ~(1 << a); }
        }
        continue;
      }
      for (let a = 0; a < this.weights.length; a++) this.weights[a] = face & (1 << a) ? Math.max(0, this.solution[a]) : 0;
      const reference = 31 - Math.clz32(face & -face); let enter = -1, lowest = gradient(reference) - 1e-7;
      for (let a = 0; a < this.weights.length; a++) if ((active & (1 << a)) && !(face & (1 << a))) {
        const g = gradient(a); if (g < lowest) { lowest = g; enter = a; }
      }
      if (enter < 0) { converged = true; break; } face |= 1 << enter;
    }
    if (!converged) return Infinity;
    return [0, 1, 2].reduce((sum, c) => sum + square(this.colors.reduce((v, color, a) => v + this.weights[a] * color[c], 0) - rgba[offset + c]), 0);
  }
  heaviest() {
    let best = 0; for (let i = 1; i < this.weights.length; i++) if (this.weights[i] > this.weights[best] + 1e-10) best = i;
    return this.labels[best];
  }
}

function evidence(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], w: number, h: number) {
  const ids = new Int32Array(labels.length).fill(-1), queue = new Int32Array(labels.length), colors: number[] = [];
  for (let seed = 0; seed < labels.length; seed++) {
    if (ids[seed] >= 0) continue;
    const id = colors.length, label = labels[seed]; colors.push(label); ids[seed] = id; queue[0] = seed;
    let head = 0, tail = 1;
    while (head < tail) for (const q of neighbors(queue[head++], w, h)) if (q >= 0 && ids[q] < 0 && labels[q] === label) { ids[q] = id; queue[tail++] = q; }
  }
  const n = colors.length, head = new Int32Array(n).fill(-1), next = new Int32Array(labels.length), size = new Int32Array(n), opaque = new Int32Array(n), supported = new Int32Array(n), interior = new Int32Array(n), moments = Array.from({ length: n }, () => new Float64Array(6));
  for (let p = 0; p < labels.length; p++) {
    const id = ids[p], label = labels[p]; next[p] = head[id]; head[id] = p; size[id]++;
    if (label < 0) continue;
    if (rgba[p * 4 + 3] === 255) opaque[id]++;
    for (let c = 0; c < 3; c++) { const v = rgba[p * 4 + c]; moments[id][c] += v; moments[id][c + 3] += v * v; }
    const e = error(rgba, p, palette[label]); if (e <= 144) supported[id]++;
    const x = p % w, y = Math.floor(p / w); if (x === 0 || x + 1 === w || y === 0 || y + 1 === h || e > 1024) continue;
    let same = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ids[p + dy * w + dx] === id) same++;
    if (same >= 8) interior[id]++;
  }
  const fillCost = (id: number, color: RGB) => color.reduce((sum, v, c) => { const mean = moments[id][c] / size[id]; return sum + Math.max(0, moments[id][c + 3] - moments[id][c] * mean) + size[id] * square(v - mean); }, 0);
  const variance = (id: number) => [0, 1, 2].reduce((sum, c) => sum + Math.max(0, moments[id][c + 3] / size[id] - square(moments[id][c] / size[id])), 0);
  return { ids, colors, head, next, size, opaque, supported, interior, fillCost, variance };
}

const luma = (c: RGB) => .299 * c[0] + .587 * c[1] + .114 * c[2];
const boundaryError = (source: RGB, color: RGB) => { const r = source[0] - color[0], g = source[1] - color[1], b = source[2] - color[2], y = .299 * r + .587 * g + .114 * b; return 3 * y * y + .5 * (square(r - y) + square(b - y)); };
const dark = (c: RGB) => Math.max(...c) < 90;
const white = (c: RGB) => Math.min(...c) >= 242;
export function cleanTransitionMixtures(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], w: number, h: number, diagnostics: TransitionDiagnostics) {
  const e = evidence(rgba, labels, palette, w, h), stats = { mergedRegions: 0, reassignedPixels: 0 };
  for (const boundary of [false, true]) for (let id = 0; id < e.size.length; id++) {
    const current = e.colors[id], n = e.size[id];
    if (current < 0 || boundary && n > 4096 || e.opaque[id] !== n || e.interior[id] >= Math.max(3, n * .15) || e.supported[id] >= Math.max(2, n * .35)) continue;
    const own = palette[current], original = e.fillCost(id, own);
    if (original <= n * 64 || original <= n * 1024 && e.variance(id) <= 144 || boundary && (dark(own) || white(own))) continue;
    const contacts = new Int32Array(palette.length); let intact = true;
    for (let p = e.head[id]; p >= 0; p = e.next[p]) {
      if (boundary && labels[p] !== current) { intact = false; break; }
      for (const q of neighbors(p, w, h)) if (q >= 0 && labels[q] >= 0 && labels[q] !== current) {
        const other = e.ids[q]; if (e.interior[other] > 0 || e.supported[other] >= Math.max(2, e.size[other] * .5)) contacts[labels[q]]++;
      }
    }
    if (!intact) continue;
    const candidates = palette.map((_, c) => c).filter(c => contacts[c] >= 2).sort((a, b) => contacts[b] - contacts[a] || a - b).slice(0, 6);
    if (candidates.length < 2) continue;
    if (boundary) diagnostics.boundaryColorRegions++; else diagnostics.mixtureCandidates++;
    const model = boundary ? undefined : new ColorMixture(palette, candidates), pixels = new Int32Array(n), replacement = new Int16Array(n).fill(current);
    let cost = 0, proposals = 0, k = 0;
    for (let p = e.head[id]; p >= 0; p = e.next[p], k++) {
      pixels[k] = p; const x = p % w, y = Math.floor(p / w), near = new Int32Array(palette.length);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && labels[ny * w + nx] >= 0) near[labels[ny * w + nx]]++;
      }
      const self = error(rgba, p, own);
      if (!boundary) {
        let active = 0, count = 0; candidates.forEach((c, i) => { if (near[c]) { active |= 1 << i; count++; } });
        if (count < 2) { cost += self; continue; }
        const fit = model!.fit(rgba, p * 4, active); diagnostics.mixtureFits++; if (count > 2) diagnostics.mixtureJunctionFits++;
        if (fit <= 1200 && fit + 64 < self) { replacement[k] = model!.heaviest(); cost += fit + 25; proposals++; } else cost += self;
      } else {
        const source: RGB = [rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]], sy = luma(source); let best = boundaryError(source, own), to = current;
        for (const a of candidates) for (const b of candidates) {
          if (a >= b || near[a] < 2 || near[b] < 2 || distance(palette[a], palette[b]) < 4000) continue;
          const ca = palette[a], cb = palette[b], ay = luma(ca), dy = luma(cb) - ay, dr = cb[0] - ca[0] - dy, db = cb[2] - ca[2] - dy;
          const t = clamp((3 * (sy - ay) * dy + .5 * ((source[0] - ca[0] - sy + ay) * dr + (source[2] - ca[2] - sy + ay) * db)) / (3 * dy * dy + .5 * (dr * dr + db * db)));
          if (t > .3 && t < .7) continue;
          const mixed = ca.map((v, c) => v + (cb[c] - v) * t) as RGB, trial = boundaryError(source, mixed);
          if (trial <= 1200 && trial + 25 < best) { best = trial; to = t < .5 ? a : b; }
        }
        if (to !== current && !dark(palette[to]) && !white(palette[to]) && error(rgba, p, palette[to]) <= self + 1e-9) { replacement[k] = to; proposals++; }
      }
    }
    if (!boundary && (proposals < Math.max(1, n * .5) || cost >= original * .8)) continue;
    let changed = 0;
    for (let pass = 0; pass < 4; pass++) {
      let accepted = 0;
      for (k = 0; k < n; k++) if (replacement[k] !== current && labels[pixels[k]] === current && canGrowTransitionLabel(labels, pixels[k], replacement[k], w, h) && (!boundary || components(ringMask(labels, pixels[k], current, w, h), ring4) <= 1)) {
        labels[pixels[k]] = replacement[k]; changed++; accepted++;
      }
      if (!accepted) break;
    }
    if (boundary) { diagnostics.boundaryColorProposals += proposals; diagnostics.boundaryColorChanged += changed; diagnostics.boundaryColorRejected += proposals - changed; }
    else { diagnostics.mixtureTopologyRejected += proposals - changed; if (changed) diagnostics.mixtureRegionsChanged++; diagnostics.mixtureReassignedPixels += changed; }
    if (changed === n) stats.mergedRegions++; stats.reassignedPixels += changed;
  }
  return stats;
}

export function mergeSmallEdgeRegions(rgba: Uint8ClampedArray, labels: Int16Array, palette: RGB[], w: number, h: number, protectedPixels: Uint8Array, diagnostics: TransitionDiagnostics, perceptual: (color: RGB) => RGB) {
  const dark = (c: RGB) => Math.max(...c) < 100, white = (c: RGB) => Math.min(...c) > 235;
  const e = evidence(rgba, labels, palette, w, h), n = e.size.length; if (n > 2000) return;
  const limit = Math.max(64, Math.min(1024, Math.round(1024 * square(Math.max(w, h) / 512))));
  const perimeter = new Int32Array(n), depth = new Uint8Array(labels.length), maxDepth = new Uint8Array(n), support = new Int32Array(n), protectedRegion = new Uint8Array(n), queue = new Int32Array(labels.length), borders = Array.from({ length: n }, () => new Map<number, number>());
  let head = 0, tail = 0;
  for (let p = 0; p < labels.length; p++) {
    const id = e.ids[p]; let boundary = false; if (rgba[p * 4 + 3] !== 255 || protectedPixels[p]) protectedRegion[id] = 1;
    for (const q of neighbors(p, w, h)) if (q < 0 || e.ids[q] !== id) {
      boundary = true; perimeter[id]++; if (q >= 0) borders[id].set(e.ids[q], (borders[id].get(e.ids[q]) ?? 0) + 1);
    }
    if (boundary) { depth[p] = 1; queue[tail++] = p; }
  }
  while (head < tail) {
    const p = queue[head++]; if (depth[p] >= 3) continue;
    for (const q of neighbors(p, w, h)) if (q >= 0 && e.ids[q] === e.ids[p] && !depth[q]) { depth[q] = depth[p] + 1; queue[tail++] = q; }
  }
  for (let p = 0; p < labels.length; p++) {
    const id = e.ids[p]; maxDepth[id] = Math.max(maxDepth[id], depth[p] || 3);
    if (labels[p] >= 0 && depth[p] >= 2 && error(rgba, p, palette[labels[p]]) <= 64) support[id]++;
  }
  const destinations = new Int16Array(n).fill(-1), labs = palette.map(perceptual);
  for (let id = 0; id < n; id++) {
    const color = e.colors[id]; if (color < 0 || protectedRegion[id] || e.size[id] > limit || maxDepth[id] > 2 || 2 * e.size[id] / perimeter[id] > 2 || support[id] >= Math.max(2, Math.floor(e.size[id] / 4)) || dark(palette[color]) || white(palette[color])) continue;
    if (![...borders[id].keys()].some(other => e.colors[other] >= 0 && dark(palette[e.colors[other]]))) continue;
    let best = -1;
    for (const [adjacent, border] of [...borders[id]].sort(([a], [b]) => a - b)) {
      const label = e.colors[adjacent]; if (label < 0 || protectedRegion[adjacent] || e.size[adjacent] < Math.max(128, e.size[id] * 4) || dark(palette[label]) || white(palette[label])) continue;
      const d = Math.sqrt(distance(labs[color], labs[label])); if (d > 48) continue;
      const score = border / (1 + d); if (score > best) { destinations[id] = label; best = score; }
    }
  }
  support.fill(0);
  for (let p = 0; p < labels.length; p++) {
    const id = e.ids[p], to = destinations[id]; if (to < 0) continue;
    const old = error(rgba, p, palette[labels[p]]); if (old <= 16 && error(rgba, p, palette[to]) - old > 512) support[id]++;
  }
  for (let id = 0; id < n; id++) if (destinations[id] >= 0) {
    if (support[id] >= Math.max(2, Math.floor((e.size[id] + 1) / 2))) destinations[id] = -1; else diagnostics.smallEdgeRegionsMerged++;
  }
  for (let p = 0; p < labels.length; p++) { const to = destinations[e.ids[p]]; if (to >= 0) { labels[p] = to; diagnostics.smallEdgePixelsChanged++; } }
}
