/** JPEG headers identify RGB, YCbCr, CMYK, and YCCK component encoding. */
export class JpegColorEncoding {
  private jfif = false;
  adobeTransform: number | undefined;
  private rgbComponents = false;
  private componentCount = 0;

  read(marker: number, payload: Uint8Array): void {
    if (marker === 0xe0 && payload.length >= 5 &&
        payload[0] === 74 && payload[1] === 70 && payload[2] === 73 && payload[3] === 70 && payload[4] === 0) {
      this.jfif = true;
    } else if (marker === 0xee && payload.length >= 12 &&
        payload[0] === 65 && payload[1] === 100 && payload[2] === 111 && payload[3] === 98 && payload[4] === 101) {
      this.adobeTransform = payload[11];
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      this.componentCount = payload[5]!;
      this.rgbComponents = payload[6] === 82 && payload[9] === 71 && payload[12] === 66;
    }
  }

  get rgb(): boolean {
    return this.componentCount === 3 && !this.jfif &&
      (this.adobeTransform === undefined ? this.rgbComponents : this.adobeTransform === 0);
  }
}

/** Chroma inputs are centered on zero by the sampling loops. */
export function jpegColor(
  y: number,
  cb: number,
  cr: number,
  k: number | undefined,
  strip: boolean,
  rgb: boolean,
  adobeTransform: number | undefined
): number {
  if (rgb) return (y & 255) | (((cb + 128) & 255) << 8) | (((cr + 128) & 255) << 16);
  if (k !== undefined && adobeTransform !== 2) {
    const inverted = adobeTransform === 0;
    const black = inverted ? k : 255 - k;
    const r = Math.round(((inverted ? y : 255 - y) * black) / 255);
    const g = Math.round(((inverted ? cb + 128 : 127 - cb) * black) / 255);
    const b = Math.round(((inverted ? cr + 128 : 127 - cr) * black) / 255);
    return r | (g << 8) | (b << 16);
  }
  let r = strip ? y + ((91881 * cr + 32768) >> 16) : Math.round(y + 1.402 * cr);
  let g = strip
    ? y - ((22554 * cb + 46802 * cr + 32768) >> 16)
    : Math.round(y - 0.344136 * cb - 0.714136 * cr);
  let b = strip ? y + ((116130 * cb + 32768) >> 16) : Math.round(y + 1.772 * cb);
  r = r < 0 ? 0 : r > 255 ? 255 : r;
  g = g < 0 ? 0 : g > 255 ? 255 : g;
  b = b < 0 ? 0 : b > 255 ? 255 : b;
  if (k !== undefined) {
    // YCCK stores the complement of the CMY channels in YCbCr space.
    r = 255 - r;
    g = 255 - g;
    b = 255 - b;
    r = Math.round(strip ? (r * k) / 255 : r * (k / 255));
    g = Math.round(strip ? (g * k) / 255 : g * (k / 255));
    b = Math.round(strip ? (b * k) / 255 : b * (k / 255));
  }
  return (r & 255) | ((g & 255) << 8) | ((b & 255) << 16);
}
