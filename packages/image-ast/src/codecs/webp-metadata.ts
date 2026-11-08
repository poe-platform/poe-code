import type {ImageMetadata} from "../ast.js";
import {exifMetadataSteps,type MetadataRead} from "./exif-metadata.js";

export function isWebpBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

export function* webpMetadataSteps(size:number):Generator<MetadataRead,ImageMetadata,Uint8Array> {
  const prefix=size>=12?yield {position:0,length:12}:new Uint8Array();
  if (!isWebpBytes(prefix)) {
    throw new Error("Invalid WebP header");
  }
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let density = 72;
  let orientation: number | undefined;

  let pos = 12;
  while (pos + 8 <= size) {
    const header=yield {position:pos,length:8};
    const fourcc=String.fromCharCode(header[0]!,header[1]!,header[2]!,header[3]!);
    const chunkSize=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(4,true);
    const dataStart=pos+8;
    if(dataStart+chunkSize>size)break;
    const wanted=(fourcc==="VP8X" || fourcc==="VP8 ") && chunkSize>=10?10:fourcc==="VP8L" && chunkSize>=5?5:0;
    const payload=wanted?yield {position:dataStart,length:wanted}:new Uint8Array();

    if (fourcc === "VP8X" && chunkSize >= 10) {
      const flags = payload[0]!;
      hasAlpha = (flags & 0x10) !== 0;
      width = 1 + (payload[4]! | (payload[5]! << 8) | (payload[6]! << 16));
      height = 1 + (payload[7]! | (payload[8]! << 8) | (payload[9]! << 16));
    } else if (fourcc === "VP8L" && chunkSize >= 5 && payload[0] === 0x2f) {
      const bits =
        payload[1]! |
        (payload[2]! << 8) |
        (payload[3]! << 16) |
        ((payload[4]! << 24) >>> 0);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasAlpha = ((bits >>> 28) & 1) !== 0;
    } else if (fourcc === "VP8 " && chunkSize >= 10) {
      if (payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a) {
        width = (payload[6]! | (payload[7]! << 8)) & 0x3fff;
        height = (payload[8]! | (payload[9]! << 8)) & 0x3fff;
      }
    } else if (fourcc === "EXIF") {
      const exif = yield* exifMetadataSteps(chunkSize,dataStart);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
    }
    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid WebP dimensions");
  }

  return {
    format: "webp",
    width,
    height,
    space: "srgb",
    channels: hasAlpha ? 4 : 3,
    depth: "uchar",
    density,
    hasAlpha,
    ...(orientation !== undefined ? { orientation } : {}),
    size
  };
}
