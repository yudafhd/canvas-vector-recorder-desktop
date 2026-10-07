export interface Raster { pixels: Uint8ClampedArray; width: number; height: number }

export function validateRaster(pixels: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2048 * 2048 || pixels.length !== width * height * 4) throw new Error('Ukuran raster Auto tidak valid.');
}

/** Mobile AutoFinalTracer's bilinear sampling in premultiplied alpha. */
export function resizeRaster(pixels: Uint8ClampedArray, width: number, height: number, maxSide: number): Raster {
  validateRaster(pixels, width, height);
  if (!Number.isInteger(maxSide) || maxSide < 1 || maxSide > 2048) throw new Error('Resolusi Auto tidak valid.');
  const scale = Math.min(1, maxSide / Math.max(width, height)), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  if (w === width && h === height) return { pixels, width, height };
  const output = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = (y + .5) * height / h - .5, y0 = Math.max(0, Math.min(height - 1, Math.floor(sy))), y1 = Math.min(height - 1, y0 + 1), fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < w; x++) {
      const sx = (x + .5) * width / w - .5, x0 = Math.max(0, Math.min(width - 1, Math.floor(sx))), x1 = Math.min(width - 1, x0 + 1), fx = Math.max(0, Math.min(1, sx - x0));
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const offset = ((yy ? y1 : y0) * width + (xx ? x1 : x0)) * 4, weight = (yy ? fy : 1 - fy) * (xx ? fx : 1 - fx) * pixels[offset + 3];
        alpha += weight; red += weight * pixels[offset]; green += weight * pixels[offset + 1]; blue += weight * pixels[offset + 2];
      }
      const o = (y * w + x) * 4;
      output[o] = Math.round(alpha ? red / alpha : 0); output[o + 1] = Math.round(alpha ? green / alpha : 0); output[o + 2] = Math.round(alpha ? blue / alpha : 0); output[o + 3] = Math.round(alpha);
    }
  }
  return { pixels: output, width: w, height: h };
}
