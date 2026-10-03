import { parseExifBuffer } from "./exif.js";
export interface JpegMetadataState {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  isProgressive: boolean;
  density: number;
  orientation: number | undefined;
}
/** Both drivers stop at the first SOF after applying preceding APP metadata. */
export function applyJpegMetadata(
  state: JpegMetadataState,
  marker: number,
  payload: Uint8Array
): boolean {
  let { width, height, channels, isProgressive, density, orientation } = state;
  if (marker === 0xe0 && payload.length >= 12) {
    // JFIF APP0
    if (
      payload[0] === 0x4a &&
      payload[1] === 0x46 &&
      payload[2] === 0x49 &&
      payload[3] === 0x46 &&
      payload[4] === 0x00
    ) {
      const units = payload[7]!;
      const xDensity = (payload[8]! << 8) | payload[9]!;
      if (xDensity > 0) {
        if (units === 1) density = xDensity;
        else if (units === 2) density = Math.round(xDensity * 2.54);
      }
    }
  } else if (marker === 0xe1 && payload.length >= 8) {
    // EXIF APP1
    const exif = parseExifBuffer(payload);
    if (exif.orientation !== undefined) orientation = exif.orientation;
    if (exif.density !== undefined) density = exif.density;
  } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
    isProgressive = marker === 0xc2;
    height = (payload[1]! << 8) | payload[2]!;
    width = (payload[3]! << 8) | payload[4]!;
    const comps = payload[5]!;
    channels = comps === 1 ? 1 : comps === 4 ? 4 : 3;
  }
  Object.assign(state, { width, height, channels, isProgressive, density, orientation });
  return marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
}
