import { tracingSvgPaths } from './svg-paths';
/**
 * Converts path-only tracing SVG to EPS (Encapsulated PostScript 3.0)
 * with embedded TIFF (8-bit Color / Baseline RGB) preview and Adobe XMP metadata.
 * Fully compatible with microstock validators (Shutterstock, Freepik, Adobe Stock)
 * and vector graphic editors (Adobe Illustrator, CorelDRAW, Inkscape).
 */

export function parseHexColor(color: string): [number, number, number] {
  let hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [0, 0, 0];
}

const f = (n: number) => {
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
};

export function pathToPs(d: string): string {
  let ps = '';
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gi) || [];
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-df-z]$/i.test(token)) {
      cmd = token;
      i++;
    }
    if (!cmd) { i++; continue; }

    if (cmd === 'M' || cmd === 'm') {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      if (!isNaN(x) && !isNaN(y)) {
        ps += `${f(x)} ${f(y)} moveto\n`;
      }
      cmd = cmd === 'm' ? 'l' : 'L';
    } else if (cmd === 'L' || cmd === 'l') {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      if (!isNaN(x) && !isNaN(y)) {
        ps += `${f(x)} ${f(y)} lineto\n`;
      }
    } else if (cmd === 'C' || cmd === 'c') {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x2 = parseFloat(tokens[i++]);
      const y2 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2) && !isNaN(x) && !isNaN(y)) {
        ps += `${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} curveto\n`;
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      ps += 'closepath\n';
      cmd = '';
    } else {
      i++;
    }
  }
  return ps;
}

export function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/width="([^"]+)"/);
  const heightMatch = svg.match(/height="([^"]+)"/);
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);

  let width = 1024, height = 1024;
  if (widthMatch) width = parseFloat(widthMatch[1]) || width;
  if (heightMatch) height = parseFloat(heightMatch[1]) || height;
  if ((!widthMatch || !heightMatch) && viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  }
  return { width, height };
}

export function computePreviewDimensions(
  width: number,
  height: number,
  maxSide = 256
): { previewWidth: number; previewHeight: number } {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  if (safeW >= safeH) {
    const previewWidth = maxSide;
    const previewHeight = Math.max(1, Math.round(maxSide * (safeH / safeW)));
    return { previewWidth, previewHeight };
  } else {
    const previewHeight = maxSide;
    const previewWidth = Math.max(1, Math.round(maxSide * (safeW / safeH)));
    return { previewWidth, previewHeight };
  }
}

export function generatePostScript(
  svg: string,
  title = 'vector-tracing',
  jpegThumbnailBase64?: string,
  thumbWidth = 256,
  thumbHeight = 256
): string {
  const { width, height } = parseSvgDimensions(svg);

  let psPaths = '';
  for (const path of tracingSvgPaths(svg)) {
    const [r, g, b] = parseHexColor(path.color), pathPs = pathToPs(path.data);
    if (!pathPs.trim()) continue;
    psPaths += 'gsave\n';
    psPaths += `${f(r)} ${f(g)} ${f(b)} setrgbcolor\n`;
    const matrix = path.original.match(/transform="matrix\(([^)]+)\)"/)?.[1].trim().split(/[\s,]+/).map(Number);
    if (matrix?.length === 6 && matrix.every(Number.isFinite)) psPaths += '[' + matrix.map(f).join(' ') + '] concat\n';
    if (path.clip) psPaths += 'newpath\n' + pathToPs(path.clip) + 'clip\nnewpath\n';
    psPaths += 'newpath\n' + pathPs + (path.evenodd ? 'eofill\n' : 'fill\n') + 'grestore\n';
  }

  const wRound = Math.round(width);
  const hRound = Math.round(height);

  let out = '%!PS-Adobe-3.0 EPSF-3.0\n';
  out += '%%Creator: Canvas Vector Recorder Desktop\n';
  out += `%%Title: ${title}\n`;
  out += '%%Pages: 1\n';
  out += `%%BoundingBox: 0 0 ${wRound} ${hRound}\n`;
  out += `%%HiResBoundingBox: 0.0000 0.0000 ${f(width)} ${f(height)}\n`;
  out += '%%LanguageLevel: 3\n';
  out += '%%EndComments\n';

  // Embed Adobe-compatible XMP packet with embedded thumbnail
  out += '%XMPbegin: XMP\n';
  out += 'currentfile 0 (%XMPend:) /SubFileDecode filter flushfile\n';
  out += '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n';
  out += '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c111">\n';
  out += '   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n';
  out += '      <rdf:Description rdf:about=""\n';
  out += '            xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n';
  out += '            xmlns:xmpGImg="http://ns.adobe.com/xap/1.0/g/img/">\n';
  out += '         <xmp:CreatorTool>Canvas Vector Recorder</xmp:CreatorTool>\n';
  if (jpegThumbnailBase64) {
    out += '         <xmp:Thumbnails>\n';
    out += '            <rdf:Alt>\n';
    out += '               <rdf:li rdf:parseType="Resource">\n';
    out += '                  <xmpGImg:format>JPEG</xmpGImg:format>\n';
    out += `                  <xmpGImg:width>${thumbWidth}</xmpGImg:width>\n`;
    out += `                  <xmpGImg:height>${thumbHeight}</xmpGImg:height>\n`;
    out += `                  <xmpGImg:image>${jpegThumbnailBase64}</xmpGImg:image>\n`;
    out += '               </rdf:li>\n';
    out += '            </rdf:Alt>\n';
    out += '         </xmp:Thumbnails>\n';
  }
  out += '      </rdf:Description>\n';
  out += '   </rdf:RDF>\n';
  out += '</x:xmpmeta>\n';
  out += '<?xpacket end="w"?>\n';
  out += '%XMPend:\n\n';

  out += '%%Page: 1 1\n';
  out += 'save\n';
  out += `0 ${f(height)} translate\n`;
  out += '1 -1 scale\n\n';
  out += '% Artwork\n';
  out += 'gsave\n';
  const box = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
    const scale = Math.min(width / box[2], height / box[3]);
    out += `${f((width - box[2] * scale) / 2)} ${f((height - box[3] * scale) / 2)} translate\n`;
    out += `${f(scale)} ${f(scale)} scale\n`;
    out += `${f(-box[0])} ${f(-box[1])} translate\n`;
  }
  out += psPaths;
  out += 'grestore\n';
  out += 'restore\n';
  out += 'showpage\n';
  out += '%%EOF\n';

  return out;
}

/**
 * Creates a Baseline TIFF 6.0 uncompressed 24-bit RGB preview image.
 * Tags are strictly sorted in ascending order to comply with the TIFF specification.
 */
export function createRgbTiff(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const tiff = new Uint8Array(180 + rgb.length);
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);

  // Little-endian TIFF header: 'II', 42, IFD offset = 8
  view.setUint16(0, 0x4949, false);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  // 12 directory entries
  view.setUint16(8, 12, true);

  const bitsOffset = 158;
  const xresOffset = 164;
  const yresOffset = 172;
  const dataOffset = 180;

  let offset = 10;
  const writeEntry = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, val, true);
    offset += 12;
  };

  writeEntry(256, 4, 1, width); // ImageWidth (LONG)
  writeEntry(257, 4, 1, height); // ImageLength (LONG)
  writeEntry(258, 3, 3, bitsOffset); // BitsPerSample (SHORT[3])
  writeEntry(259, 3, 1, 1); // Compression (1 = None)
  writeEntry(262, 3, 1, 2); // PhotometricInterpretation (2 = RGB)
  writeEntry(273, 4, 1, dataOffset); // StripOffsets (LONG)
  writeEntry(277, 3, 1, 3); // SamplesPerPixel (3)
  writeEntry(278, 4, 1, height); // RowsPerStrip (LONG)
  writeEntry(279, 4, 1, width * height * 3); // StripByteCounts (LONG)
  writeEntry(282, 5, 1, xresOffset); // XResolution (RATIONAL)
  writeEntry(283, 5, 1, yresOffset); // YResolution (RATIONAL)
  writeEntry(296, 3, 1, 2); // ResolutionUnit (2 = Inch)

  view.setUint32(offset, 0, true); // Next IFD = 0

  // BitsPerSample values: [8, 8, 8]
  view.setUint16(158, 8, true);
  view.setUint16(160, 8, true);
  view.setUint16(162, 8, true);

  // XResolution: 72/1
  view.setUint32(164, 72, true);
  view.setUint32(168, 1, true);

  // YResolution: 72/1
  view.setUint32(172, 72, true);
  view.setUint32(176, 1, true);

  // Pixel data
  tiff.set(rgb, 180);

  return tiff;
}

/**
 * Creates standard 30-byte DOS EPS Binary Header with embedded TIFF preview.
 * Header magic: 0xC5, 0xD0, 0xD3, 0xC6.
 */
export function createDosEps(psBytes: Uint8Array, tiffBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(30 + psBytes.length + tiffBytes.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  out[0] = 0xc5;
  out[1] = 0xd0;
  out[2] = 0xd3;
  out[3] = 0xc6;

  view.setUint32(4, 30, true); // PostScript start offset
  view.setUint32(8, psBytes.length, true); // PostScript length
  view.setUint32(12, 0, true); // WMF start
  view.setUint32(16, 0, true); // WMF length
  view.setUint32(20, 30 + psBytes.length, true); // TIFF start offset
  view.setUint32(24, tiffBytes.length, true); // TIFF length
  view.setUint16(28, 0xffff, true); // Checksum (0xFFFF = ignore)

  out.set(psBytes, 30);
  out.set(tiffBytes, 30 + psBytes.length);

  return out;
}

/**
 * Rasterizes an SVG string to a canvas thumbnail for EPS preview embedding.
 */
export async function rasterizeSvgToPreview(
  svg: string,
  width = 256,
  height = 256
): Promise<{ rgb: Uint8Array; jpegBase64: string } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const loaded = await new Promise<boolean>(resolve => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    URL.revokeObjectURL(url);
    if (!loaded) return null;

    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const rgba = imgData.data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const jpegBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

    return { rgb, jpegBase64 };
  } catch {
    return null;
  }
}

/**
 * Builds a complete DOS EPS file with embedded TIFF preview and XMP thumbnail,
 * preserving the exact aspect ratio of the vector artwork.
 */
export async function buildDosEps(svg: string, title = 'vector-tracing'): Promise<Uint8Array> {
  const { width, height } = parseSvgDimensions(svg);
  const { previewWidth, previewHeight } = computePreviewDimensions(width, height, 256);

  const preview = await rasterizeSvgToPreview(svg, previewWidth, previewHeight);
  const encoder = new TextEncoder();

  let rgb: Uint8Array;
  let tiffWidth = previewWidth;
  let tiffHeight = previewHeight;
  let jpegThumbnail: string | undefined;

  if (preview) {
    rgb = preview.rgb;
    jpegThumbnail = preview.jpegBase64;
  } else {
    // Fallback valid white TIFF preserving aspect ratio
    const fb = computePreviewDimensions(width, height, 32);
    tiffWidth = fb.previewWidth;
    tiffHeight = fb.previewHeight;
    rgb = new Uint8Array(tiffWidth * tiffHeight * 3).fill(255);
  }

  const ps = generatePostScript(svg, title, jpegThumbnail, tiffWidth, tiffHeight);
  const psBytes = encoder.encode(ps);
  const tiffBytes = createRgbTiff(tiffWidth, tiffHeight, rgb);

  return createDosEps(psBytes, tiffBytes);
}

/**
 * Synchronous EPS generation with fallback TIFF preview preserving aspect ratio.
 */
export function buildDosEpsSync(svg: string, title = 'vector-tracing'): Uint8Array {
  const { width, height } = parseSvgDimensions(svg);
  const { previewWidth, previewHeight } = computePreviewDimensions(width, height, 32);
  const encoder = new TextEncoder();
  const ps = generatePostScript(svg, title, undefined, previewWidth, previewHeight);
  const psBytes = encoder.encode(ps);
  const tiffBytes = createRgbTiff(previewWidth, previewHeight, new Uint8Array(previewWidth * previewHeight * 3).fill(255));
  return createDosEps(psBytes, tiffBytes);
}

/**
 * Legacy string EPS generator (for backwards compatibility).
 */
export function svgToEps(svg: string, title = 'vector-tracing'): string {
  return generatePostScript(svg, title);
}
