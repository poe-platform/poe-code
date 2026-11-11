import {ByteCodecError, createByteCodec} from "@poe-code/compression";
import type {ImageMetadata} from "../ast.js";
import {PNG_SIGNATURE, validPngTransparencyLength, pngCrc32, decodePngIcc} from "./png-chunks.js";
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
  let chromaticity: Partial<Record<keyof NonNullable<ImageMetadata["chromaticity"]>, readonly [number, number]>> | undefined;
  let resolution: ImageMetadata["resolution"];
  let hasPhys = false;
  let hasTrns = false;
  let virtualCanvas: ImageMetadata["virtualCanvas"];
  let pixelOffset: {x: number; y: number} | undefined;
  const properties: Record<string, string> = Object.create(null);
  let icc: Uint8Array | undefined;
  let exifProfile: Uint8Array | undefined;
  let xmp: Uint8Array | undefined;
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
      if (colorType === 3 && !palette) throw new Error("Missing PNG PLTE before IDAT");
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
    } else if (type === "cHRM" && len === 32 && !hasIdat && !palette && !chromaticity) {
      const chunk = yield {position:dataStart,length:32};
      const view = new DataView(chunk.buffer,chunk.byteOffset,32);
      chromaticity = {};
      for (const [index, key] of (["white-point", "red-primary", "green-primary", "blue-primary"] as const).entries()) {
        chromaticity[key] = [view.getUint32(index * 8) / 100000, view.getUint32(index * 8 + 4) / 100000];
      }
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
        if (chunk[start++] !== 0) {
          decodeWarnings.push("PNG zTXt: invalid text compression method");
          pos = dataStart + len + 4;
          continue;
        }
      } else if (type === "iTXt") {
        const flag = chunk[start++];
        if (flag !== 0 && flag !== 1 || chunk[start++] !== 0) {
          decodeWarnings.push("Invalid PNG iTXt compression");
          pos = dataStart + len + 4;
          continue;
        }
        compressed = flag === 1;
        const languageEnd = chunk.indexOf(0, start);
        const translatedEnd = languageEnd < 0 ? -1 : chunk.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) {
          decodeWarnings.push("Invalid PNG iTXt header");
          pos = dataStart + len + 4;
          continue;
        }
        // Preserve the actual PNG text. ImageMagick 7.1.2 can instead read
        // part of the translated keyword; that corruption is not emulated.
        start = translatedEnd + 1;
      }
      let value = chunk.subarray(start);
      if (type === "tEXt") {
        const zero = value.indexOf(0);
        if (zero >= 0) value = value.subarray(0, zero);
      }
      if (compressed) {
        const codec = createByteCodec({direction:"decode",format:"zlib"});
        const parts: Uint8Array[] = []; let length = 0;
        try {
          for (const part of codec.push(value, true)) {
            length += part.length;
            if (length > 16 * 1024 * 1024) throw new Error("PNG text exceeds 16 MiB");
            parts.push(part);
          }
        } catch (error) {
          if (type !== "zTXt" || !(error instanceof ByteCodecError)) throw error;
          decodeWarnings.push(`PNG zTXt: ${error.message}`);
          pos = dataStart + len + 4;
          continue;
        } finally { codec.close(); }
        value = new Uint8Array(length); let offset = 0;
        for (const part of parts) { value.set(part, offset); offset += part.length; }
      }
      const latin1 = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join("");
      const key = latin1(chunk.subarray(0, end));
      if (key === "XML:com.adobe.xmp") {
        xmp = value;
      } else if (key === "Raw profile type xmp") {
        const lines = new TextDecoder().decode(value).split("\n");
        const size = lines[2]?.trim() ?? "";
        const length = Number(size);
        const hex = lines.slice(3).map(line => line.trim()).join("").toLowerCase();
        if (size.length && [...size].every(char => char >= "0" && char <= "9") && Number.isSafeInteger(length) && length > 0 && hex.length === length * 2) {
          const bytes = new Uint8Array(length);
          let valid = true;
          for (let i = 0; i < length; i++) {
            const high = "0123456789abcdef".indexOf(hex[i * 2]!);
            const low = "0123456789abcdef".indexOf(hex[i * 2 + 1]!);
            if (high < 0 || low < 0) { valid = false; break; }
            bytes[i] = high * 16 + low;
          }
          if (valid) xmp = bytes;
        }
      } else {
        properties[key] = type === "iTXt" ? new TextDecoder().decode(value) : latin1(value);
      }
    } else if (type === "iCCP") {
      if (len > 16 * 1024 * 1024) throw new Error("ICC profile exceeds 16 MiB");
      const chunk = yield {position:dataStart,length:len};
      const end = chunk.indexOf(0);
      if (end < 1 || end > 79 || chunk[end + 1] !== 0) {
        decodeWarnings.push("PNG iCCP: invalid profile header or compression method");
        pos = dataStart + len + 4;
        continue;
      }
      try {
        icc = decodePngIcc(chunk.subarray(end + 2));
      } catch (error) {
        if (!(error instanceof ByteCodecError)) throw error;
        decodeWarnings.push(`PNG iCCP: ${error.message}`);
        pos = dataStart + len + 4;
        continue;
      }
      // ICC profiles require a complete header, tag count, and the "acsp" signature.
      if (icc.length < 132 || icc[36] !== 97 || icc[37] !== 99 || icc[38] !== 115 || icc[39] !== 112) {
        decodeWarnings.push("PNG iCCP: invalid ICC profile header");
        icc = undefined;
      }
    } else if (type === "PLTE") {
      if (palette) throw new Error("Duplicate PNG PLTE");
      if (hasIdat) throw new Error("PNG PLTE must precede IDAT");
      if (len === 0 || len > 768 || len % 3 !== 0) throw new Error("Invalid PNG PLTE length");
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
    } else if (type === "pHYs") {
      if (hasIdat) {
        decodeWarnings.push("pHYs: out of place");
        pos = dataStart + len + 4;
        continue;
      }
      if (hasPhys) {
        decodeWarnings.push("PNG pHYs: duplicate");
        pos = dataStart + len + 4;
        continue;
      }
      if (len !== 9) {
        decodeWarnings.push("pHYs: invalid");
        pos = dataStart + len + 4;
        continue;
      }
      hasPhys = true;
      const chunk=yield {position:dataStart,length:9};
      const view = new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
      const ppuX = view.getUint32(0, false);
      const ppuY = view.getUint32(4, false);
      if (ppuX === 0 || ppuY === 0) {
        pos = dataStart + len + 4;
        continue;
      }
      const unit = chunk[8]!;
      resolution = { x: ppuX, y: ppuY, unit: unit === 1 ? "meter" : "unknown" };
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
      if (hasIdat || (colorType === 3 && !palette)) decodeWarnings.push("tRNS: out of place");
      else if (hasTrns) decodeWarnings.push("Duplicate PNG tRNS");
      else if (validPngTransparencyLength(colorType, len, palette?.length)) hasTrns = true;
      else decodeWarnings.push("PNG tRNS invalid length");
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
    ...(xmp === undefined ? {} : {xmp}),
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
    ...(chromaticity === undefined ? {} : {chromaticity}),
    ...(backgroundColor === undefined ? {} : {backgroundColor}),
    ...(resolution === undefined ? {} : {resolution}),
    hasAlpha,
    ...(virtualCanvas === undefined ? {} : {virtualCanvas}),
    ...(orientation !== undefined ? { orientation } : {}),
    isProgressive: interlace === 1,
    size
  };
}
