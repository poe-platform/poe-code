import type {RgbaImage} from "../ast.js";
export function createBmpHeader(img:Pick<RgbaImage,"width"|"height"|"density">) {
 const {width,height}=img;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowStride * height;
  const out = new Uint8Array(54);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, 54 + pixelSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  const ppm = Math.round((img.density ?? 72) / 0.0254);
  view.setInt32(38, ppm, true);
  view.setInt32(42, ppm, true);

 return {data:out,rowStride,pixelSize};
}
