/** TIFF's default full-range YCbCr encoding (BT.601 coefficients). */
export function tiffYCbCrToRgb(y: number, cb: number, cr: number, max: number): [number, number, number] {
  cb -= (max + 1) / 2;
  cr -= (max + 1) / 2;
  const channel = (value: number) => Math.max(0, Math.min(max, Math.round(value)));
  return [channel(y + 1.402 * cr), channel(y - 0.344136 * cb - 0.714136 * cr), channel(y + 1.772 * cb)];
}
