// Poppler's 4×4 dispersed screen, used below 300 DPI. Keeping the screen
// anchored to image coordinates makes streaming chunk boundaries invisible.
const thresholds = [
  17, 255, 34, 204,
  153, 85, 170, 102,
  51, 221, 1, 238,
  187, 119, 136, 68,
];

export function monochromePixel(luminance: number, x: number, y: number): number {
  return luminance < thresholds[(y & 3) * 4 + (x & 3)]! ? 0 : 255;
}
