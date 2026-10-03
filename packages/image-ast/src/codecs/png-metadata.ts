import type {ImageMetadata} from "../ast.js";
import {PNG_SIGNATURE} from "./png-chunks.js";
import {exifMetadataSteps,type MetadataRead} from "./exif-metadata.js";

export function* pngMetadataSteps(size:number):Generator<MetadataRead,ImageMetadata,Uint8Array> {
  const signature=size>=8?yield {position:0,length:8}:new Uint8Array();
  if (size < 24 || !PNG_SIGNATURE.every((byte,index)=>signature[index]===byte)) {
    throw new Error("Invalid PNG header");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let density = 72;
  let hasTrns = false;
  let orientation: number | undefined;

  let pos = 8;
  while (pos + 8 <= size) {
    const header=yield {position:pos,length:8};
    const len=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(0,false);
    const type=String.fromCharCode(header[4]!,header[5]!,header[6]!,header[7]!);
    const dataStart=pos+8;
    if(dataStart+len>size)break;

    if (type === "IHDR" && len >= 13) {
      const chunk=yield {position:dataStart,length:13};
      const view=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
      width = view.getUint32(0, false);
      height = view.getUint32(4, false);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    } else if (type === "pHYs" && len >= 9) {
      const chunk=yield {position:dataStart,length:9};
      const ppuX = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength).getUint32(0, false);
      const unit = chunk[8]!;
      if (unit === 1 && ppuX > 0) {
        density = Math.max(1, Math.round(ppuX * 0.0254));
      } else if (ppuX > 0) {
        density = ppuX;
      }
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "eXIf" && len >= 8) {
      const exif = yield* exifMetadataSteps(len,dataStart);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
    } else if (type === "IDAT" || type === "IEND") {
      if (type === "IEND") break;
    }
    pos = dataStart + len + 4;
  }

  const channels: 1 | 2 | 3 | 4 =
    colorType === 6
      ? 4
      : colorType === 4
        ? 2
        : colorType === 2
          ? hasTrns
            ? 4
            : 3
          : colorType === 3
            ? hasTrns
              ? 4
              : 3
            : hasTrns
              ? 2
              : 1;

  const hasAlpha = colorType === 6 || colorType === 4 || hasTrns;
  const space =
    colorType === 0 || colorType === 4
      ? bitDepth === 16
        ? "grey16"
        : "b-w"
      : bitDepth === 16
        ? "rgb16"
        : "srgb";
  const depth = bitDepth === 16 ? "ushort" : bitDepth < 8 ? "bit" : "uchar";

  return {
    format: "png",
    width,
    height,
    space,
    channels,
    depth,
    bitsPerSample: bitDepth,
    density,
    hasAlpha,
    ...(orientation !== undefined ? { orientation } : {}),
    isProgressive: interlace === 1,
    size
  };
}
