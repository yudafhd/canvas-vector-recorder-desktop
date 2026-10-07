export const STOCK_MAX_BYTES = 45_000_000;

export function checkStockSize(data: string | Uint8Array): void {
  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  if (size > STOCK_MAX_BYTES) throw new Error('File vector melebihi batas Adobe Stock 45 MB. Kurangi kompleksitas artwork.');
}

/** Resize only the export artboard; keep tracing geometry and previews intact. */
export function stockSvg(svg: string): string {
  const root = svg.match(/<svg\b[^>]*>/)?.[0];
  const box = root?.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  if (!root || !box || box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[0] !== 0 || box[1] !== 0 || box[2] <= 0 || box[3] <= 0) {
    throw new Error('Artboard SVG tracing tidak valid.');
  }
  const area = box[2] * box[3];
  const scale = Math.sqrt(Math.min(65_000_000, Math.max(15_000_000, area)) / area);
  let width = Math.max(1, Math.ceil(box[2] * scale));
  let height = Math.max(1, Math.ceil(box[3] * scale));
  if (width * height > 65_000_000) {
    width = Math.max(1, Math.floor(box[2] * scale));
    height = Math.max(1, Math.floor(box[3] * scale));
  }
  if (width * height < 15_000_000 || width * height > 65_000_000) throw new Error('Rasio artwork tidak dapat memenuhi artboard 15–65 MP.');
  const updated = root.replace(/\s(?:width|height)="[^"]*"/g, '').replace('>', ` width="${width}" height="${height}">`);
  const result = svg.replace(root, updated);
  checkStockSize(result);
  return result;
}
