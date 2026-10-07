/** Decode one source at a time in the gallery and retain only a small raster. */
export async function rasterThumbnail(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 64000000) throw new Error('Pratinjau tidak tersedia.');
    const scale = Math.min(1, 384 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pratinjau tidak tersedia.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Pratinjau tidak tersedia.')), 'image/png'));
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
