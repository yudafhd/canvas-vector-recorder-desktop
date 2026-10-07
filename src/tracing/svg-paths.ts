/** The local path/clip subset produced by the tracing engine. */
export function tracingSvgPaths(svg: string) {
  const clips = new Map<string, string>();
  for (const match of svg.matchAll(/<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/g)) {
    const id = match[1].match(/\bid="([^"]+)"/)?.[1], data = match[2].match(/\bd="([^"]+)"/)?.[1];
    if (id && data) clips.set(id, data);
  }
  const painted = svg.replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/g, '');
  const paths: { color: string; data: string; clip?: string; evenodd: boolean; original: string }[] = [];
  for (const match of painted.matchAll(/<path\b([^>]*?)\/?>/g)) {
    const color = match[1].match(/\bfill="(#[0-9a-fA-F]{6})"/)?.[1], data = match[1].match(/\bd="([^"]+)"/)?.[1];
    if (!color || !data) continue;
    const clipId = match[1].match(/\bclip-path="url\(#([^)]*)\)"/)?.[1];
    if (clipId && !clips.has(clipId)) throw new Error('Clip SVG tidak tersedia.');
    paths.push({ color, data, clip: clipId ? clips.get(clipId) : undefined, evenodd: /fill-rule="evenodd"/.test(match[1]), original: match[0] });
  }
  return paths;
}
