/** Preserve the legacy strip/full rounding and four-component multiplication. */
export function jpegColor(
  y: number,
  cb: number,
  cr: number,
  k: number | undefined,
  strip: boolean
): number {
  let r = strip ? y + ((91881 * cr + 32768) >> 16) : Math.round(y + 1.402 * cr);
  let g = strip
    ? y - ((22554 * cb + 46802 * cr + 32768) >> 16)
    : Math.round(y - 0.344136 * cb - 0.714136 * cr);
  let b = strip ? y + ((116130 * cb + 32768) >> 16) : Math.round(y + 1.772 * cb);
  r = r < 0 ? 0 : r > 255 ? 255 : r;
  g = g < 0 ? 0 : g > 255 ? 255 : g;
  b = b < 0 ? 0 : b > 255 ? 255 : b;
  if (k !== undefined) {
    r = Math.round(strip ? (r * k) / 255 : r * (k / 255));
    g = Math.round(strip ? (g * k) / 255 : g * (k / 255));
    b = Math.round(strip ? (b * k) / 255 : b * (k / 255));
  }
  return (r & 255) | ((g & 255) << 8) | ((b & 255) << 16);
}
