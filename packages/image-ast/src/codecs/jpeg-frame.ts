import type { SharpInputOptions } from "../ast.js";
import type { JpegComponentState } from "./jpeg-decode-kernel.js";
export interface JpegFrameComponent extends JpegComponentState {
  id: number;
  h: number;
  v: number;
  qId: number;
  blocksX: number;
  blocksY: number;
}
/** Preserve sampling and shrink decisions, including a later frame's inherited scale. */
export function readJpegFrame(
  payload: Uint8Array,
  progressive: boolean,
  options: SharpInputOptions | undefined,
  scaleDenom: 1 | 2 | 4,
  blockStep: 8 | 4 | 2
) {
  let width = 0,
    height = 0,
    outWidth = 0,
    outHeight = 0,
    maxH = 1,
    maxV = 1,
    mcusX = 0,
    mcusY = 0,
    useStripDecode = false;
  const components: JpegFrameComponent[] = [];
  height = (payload[1]! << 8) | payload[2]!;
  width = (payload[3]! << 8) | payload[4]!;
  if (!progressive && options?.maxDecodeDimension && options.maxDecodeDimension > 0) {
    const maxSide = Math.max(width, height);
    const minSide = Math.min(width, height);
    if (maxSide >= options.maxDecodeDimension * 4 && minSide >= options.maxDecodeDimension * 2) {
      scaleDenom = 4;
      blockStep = 2;
    } else if (maxSide >= options.maxDecodeDimension * 2) {
      scaleDenom = 2;
      blockStep = 4;
    }
  }
  outWidth = Math.max(1, Math.ceil(width / scaleDenom));
  outHeight = Math.max(1, Math.ceil(height / scaleDenom));
  const numComps = payload[5]!;
  maxH = 1;
  maxV = 1;
  for (let i = 0; i < numComps; i++) {
    const id = payload[6 + i * 3]!;
    const hv = payload[6 + i * 3 + 1]!;
    const h = hv >>> 4;
    const v = hv & 0x0f;
    const qId = payload[6 + i * 3 + 2]!;
    if (h > maxH) maxH = h;
    if (v > maxV) maxV = v;
    components.push({
      id,
      h,
      v,
      qId,
      dcId: 0,
      acId: 0,
      dcPred: 0,
      blocksX: 0,
      blocksY: 0
    });
  }
  mcusX = Math.ceil(width / (maxH * 8));
  mcusY = Math.ceil(height / (maxV * 8));
  useStripDecode = !progressive && (scaleDenom > 1 || width * height > 512 * 512);
  return {
    width,
    height,
    outWidth,
    outHeight,
    maxH,
    maxV,
    mcusX,
    mcusY,
    useStripDecode,
    scaleDenom,
    blockStep,
    components
  };
}
