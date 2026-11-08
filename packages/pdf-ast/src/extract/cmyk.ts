// DeviceCMYK corner colors, in CMYK binary order, calibrated to Poppler's
// four-decimal RGB values. Interpolate in four dimensions before byte rounding.
const corners = [
  [1, 1, 1], [0.1373, 0.1216, 0.1255],
  [1, 0.9490, 0], [0.1098, 0.1020, 0],
  [0.9255, 0, 0.5490], [0.1412, 0, 0],
  [0.9294, 0.1098, 0.1412], [0.1333, 0, 0],
  [0, 0.6784, 0.9373], [0, 0.0588, 0.1412],
  [0, 0.6510, 0.3137], [0, 0.0745, 0],
  [0.1804, 0.1922, 0.5725], [0, 0, 0.0078],
  [0.2118, 0.2119, 0.2235], [0, 0, 0],
] as const;

export function cmykToRgb(c: number, m: number, y: number, k: number, output: Uint8Array, offset: number): void {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < corners.length; i++) {
    const weight = (i & 8 ? c : 1 - c) * (i & 4 ? m : 1 - m)
      * (i & 2 ? y : 1 - y) * (i & 1 ? k : 1 - k);
    const color = corners[i]!;
    r += weight * color[0]; g += weight * color[1]; b += weight * color[2];
  }
  output[offset] = Math.round(r * 255);
  output[offset + 1] = Math.round(g * 255);
  output[offset + 2] = Math.round(b * 255);
}
