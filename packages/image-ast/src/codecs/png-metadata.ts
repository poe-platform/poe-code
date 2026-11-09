import {createByteCodec} from "@poe-code/compression";
import type {ImageMetadata} from "../ast.js";
import {PNG_SIGNATURE, pngCrc32} from "./png-chunks.js";
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
  let gamma: number | undefined;
  let resolution: ImageMetadata["resolution"];
  let hasTrns = false;
  let virtualCanvas: ImageMetadata["virtualCanvas"];
  let pixelOffset: {x: number; y: number} | undefined;
  const properties: Record<string, string> = Object.create(null);
  let icc: Uint8Array | undefined;
  let exifProfile: Uint8Array | undefined;
  let orientation: number | undefined;
  let backgroundColor: ImageMetadata["backgroundColor"];
  let palette: Uint8Array | undefined;

  const decodeWarnings: string[] = [];
  let hasIdat = false;
  let idatEnded = false;
  let hasEnd = false;
  let pos = 8;
  while (pos + 8 <= size) {
    const header=yield {position:pos,length:8};
    const len=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(0,false);
    const type=String.fromCharCode(header[4]!,header[5]!,header[6]!,header[7]!);
    if (type === "IDAT") {
      if (idatEnded) throw new Error("PNG IDAT chunks must be consecutive");
      hasIdat = true;
    } else if (hasIdat) {
      idatEnded = true;
    }
    const dataStart=pos+8;
    if (dataStart + len + 4 > size) throw new Error("Truncated PNG chunk");
    if (pos === 8 && type !== "IHDR") throw new Error("Missing PNG IHDR");
    if (type === "IHDR" && (pos !== 8 || len !== 13)) throw new Error("Invalid PNG IHDR");
    if (type === "IEND" && len !== 0) throw new Error("Invalid PNG IEND");
    if ((header[4]! & 32) !== 0) {
      let crc = pngCrc32(header.subarray(4));
      for (let offset = 0; offset < len; offset += 4096) {
        crc = pngCrc32(yield {position:dataStart + offset,length:Math.min(4096,len - offset)}, crc);
      }
      const checksum = dataStart + len + 4 <= size ? yield {position:dataStart + len,length:4} : undefined;
      if (!checksum || crc !== new DataView(checksum.buffer,checksum.byteOffset,checksum.byteLength).getUint32(0)) {
        decodeWarnings.push(`PNG ${type} CRC mismatch`);
        pos = dataStart + len + 4;
        continue;
      }
    }

    if (type === "IHDR" && len >= 13) {
      const chunk=yield {position:dataStart,length:13};
      const view=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
      width = view.getUint32(0, false);
      height = view.getUint32(4, false);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    } else if (type === "gAMA" && len === 4) {
      const chunk = yield {position:dataStart,length:4};
      const value = new DataView(chunk.buffer,chunk.byteOffset,4).getUint32(0);
      if (value > 0) gamma = value / 100000;
    } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      if (len > 16 * 1024 * 1024) throw new Error("PNG text exceeds 16 MiB");
      const keyword = yield {position:dataStart,length:Math.min(len,80)};
      const end = keyword.indexOf(0);
      if (end < 1 || end > 79) { pos = dataStart + len + 4; continue; }
      const chunk = yield {position:dataStart,length:len};
      let start = end + 1, compressed = type === "zTXt";
      if (type === "zTXt") {
        if (chunk[start++] !== 0) throw new Error("Invalid PNG text compression");
      } else if (type === "iTXt") {
        const flag = chunk[start++];
        if (flag !== 0 && flag !== 1 || chunk[start++] !== 0) throw new Error("Invalid PNG text compression");
        compressed = flag === 1;
        for (let field = 0; field < 2; field++) {
          const zero = chunk.indexOf(0, start);
          if (zero < 0) throw new Error("Invalid PNG international text");
          start = zero + 1;
        }
      }
      let value = chunk.subarray(start);
      if (compressed) {
        const codec = createByteCodec({direction:"decode",format:"zlib"});
        const parts: Uint8Array[] = []; let length = 0;
        try {
          for (const part of codec.push(value, true)) {
            length += part.length;
            if (length > 16 * 1024 * 1024) throw new Error("PNG text exceeds 16 MiB");
            parts.push(part);
          }
        } finally { codec.close(); }
        value = new Uint8Array(length); let offset = 0;
        for (const part of parts) { value.set(part, offset); offset += part.length; }
      }
      const latin1 = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join("");
      properties[latin1(chunk.subarray(0, end))] = type === "iTXt" ? new TextDecoder().decode(value) : latin1(value);
    } else if (type === "iCCP") {
      if (len > 16 * 1024 * 1024) throw new Error("ICC profile exceeds 16 MiB");
      const chunk = yield {position:dataStart,length:len};
      const end = chunk.indexOf(0);
      if (end < 1 || end > 79 || chunk[end + 1] !== 0) throw new Error("Invalid PNG ICC profile");
      const codec = createByteCodec({direction:"decode",format:"zlib"});
      const parts: Uint8Array[] = []; let length = 0;
      try {
        for (const part of codec.push(chunk.subarray(end + 2), true)) {
          length += part.length;
          if (length > 16 * 1024 * 1024) throw new Error("ICC profile exceeds 16 MiB");
          parts.push(part);
        }
      } finally { codec.close(); }
      icc = new Uint8Array(length); let offset = 0;
      for (const part of parts) { icc.set(part, offset); offset += part.length; }
    } else if (type === "PLTE" && len <= 768) {
      palette = yield {position:dataStart,length:len};
    } else if (type === "bKGD") {
      const length = colorType === 3 ? 1 : colorType === 0 || colorType === 4 ? 2 : 6;
      if (len === length) {
        const chunk = yield {position:dataStart,length};
        const view = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
        if (colorType === 3) {
          const index = chunk[0]! * 3;
          if (palette && index + 2 < palette.length) backgroundColor = {r:palette[index]!,g:palette[index+1]!,b:palette[index+2]!,a:255};
        } else {
          const scale = 255 / (2 ** bitDepth - 1);
          const r = Math.round(view.getUint16(0) * scale);
          backgroundColor = {r,g:length === 2 ? r : Math.round(view.getUint16(2) * scale),b:length === 2 ? r : Math.round(view.getUint16(4) * scale),a:255};
        }
      }
    } else if (type === "pHYs" && len >= 9) {
      const chunk=yield {position:dataStart,length:9};
      const view = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
      const ppuX = view.getUint32(0, false);
      const unit = chunk[8]!;
      resolution = { x: ppuX, y: view.getUint32(4, false), unit: unit === 1 ? "meter" : "unknown" };
      if (unit === 1 && ppuX > 0) {
        density = Math.max(1, Math.round(ppuX * 0.0254));
      } else if (ppuX > 0) {
        density = ppuX;
      }
    } else if (type === "oFFs" && len === 9) {
      const chunk = yield {position:dataStart,length:9};
      if (chunk[8] === 0) {
        const view = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
        pixelOffset = {x:view.getInt32(0),y:view.getInt32(4)};
      }
    } else if (type === "caNv" && len === 16) {
      const chunk = yield {position:dataStart,length:16};
      const view = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
      virtualCanvas = {width:view.getUint32(0),height:view.getUint32(4),x:view.getInt32(8),y:view.getInt32(12)};
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "orNT" && len === 1) {
      const chunk = yield {position:dataStart,length:1};
      if (chunk[0]! <= 8) orientation = chunk[0]!;
    } else if (type === "eXIf" && len >= 8) {
      if (len > 16 * 1024 * 1024) throw new Error("EXIF profile exceeds 16 MiB");
      exifProfile = new Uint8Array(len);
      for (let offset = 0; offset < len; offset += 4096) {
        exifProfile.set(yield {position:dataStart + offset,length:Math.min(4096,len - offset)}, offset);
      }
      if (exifProfile[0] === 69 && exifProfile[1] === 120 && exifProfile[2] === 105 && exifProfile[3] === 102 && exifProfile[4] === 0 && exifProfile[5] === 0) exifProfile = exifProfile.subarray(6);
      const exif = yield* exifMetadataSteps(len,dataStart);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
      resolution ??= exif.resolution;
    } else if (type === "IDAT" || type === "IEND") {
      if (type === "IEND") { hasEnd = true; break; }
    }
    pos = dataStart + len + 4;
  }
  if (!hasEnd) throw new Error("Missing PNG IEND");

  if (pixelOffset) {
    virtualCanvas = {width:virtualCanvas?.width ?? width,height:virtualCanvas?.height ?? height,...pixelOffset};
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
    ...(Object.keys(properties).length ? {properties} : {}),
    ...(icc === undefined ? {} : {icc}),
    ...(exifProfile === undefined ? {} : {exif: exifProfile}),
    ...(decodeWarnings.length ? {decodeWarnings} : {}),
    format: "png",
    ...(colorType === 3 ? {isPalette: true} : {}),
    width,
    height,
    space,
    channels,
    depth,
    bitsPerSample: bitDepth,
    density,
    ...(gamma === undefined ? {} : {gamma}),
    ...(backgroundColor === undefined ? {} : {backgroundColor}),
    ...(resolution === undefined ? {} : {resolution}),
    hasAlpha,
    ...(virtualCanvas === undefined ? {} : {virtualCanvas}),
    ...(orientation !== undefined ? { orientation } : {}),
    isProgressive: interlace === 1,
    size
  };
}
