import {GifCodes,GifPalette,gifLayout,gifHeader,gifFrameHeader,type GifOptions} from "./gif-output-parts.js";
import type { ImageMetadata, RgbaImage } from "../ast.js";

export {isGifBytes} from "./gif-metadata.js";
import {isGifBytes,gifAnimationSteps,gifMetadataFields} from "./gif-metadata.js";

export function readGifMetadata(bytes:Uint8Array,options?:{readonly animated?:boolean;readonly page?:number;readonly pages?:number}):ImageMetadata {
 if(!isGifBytes(bytes)||bytes.length<13)throw new Error("Invalid GIF header");
 const start=13+(bytes[10]!&128?3*(1<<((bytes[10]!&7)+1)):0),steps=gifAnimationSteps(bytes.length,start),delays:number[]=[];let next=steps.next();
 while(!next.done){if(typeof next.value==="number")next=steps.next(bytes[next.value]);else {delays.push(next.value.delay);next=steps.next();}}
 return {...gifMetadataFields(bytes[6]!|(bytes[7]!<<8),bytes[8]!|(bytes[9]!<<8),bytes.length,next.value.frames,next.value.loop,options),...(delays.length?{delay:delays}:{})};
}

function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  let bitPos = 0;
  let oldCode = -1;
  let firstChar = 0;

  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      if (byteIdx >= data.length) return eoiCode;
      const bit = (data[byteIdx]! >>> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    return code;
  };

  while (outPos < pixelCount) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      oldCode = -1;
      continue;
    }
    let inCode = code;
    let sp = 0;
    if (code >= nextCode) {
      stack[sp++] = firstChar;
      inCode = oldCode;
    }
    while (inCode >= clearCode && inCode >= 0) {
      stack[sp++] = suffix[inCode]!;
      inCode = prefix[inCode]!;
    }
    if (inCode < 0) break;
    firstChar = suffix[inCode]!;
    stack[sp++] = firstChar;

    while (sp > 0 && outPos < pixelCount) {
      out[outPos++] = stack[--sp]!;
    }

    if (oldCode !== -1 && nextCode < 4096) {
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstChar;
      nextCode++;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
    }
    oldCode = code;
  }
  return out;
}

export function decodeGifImage(
  bytes: Uint8Array,
  options?: { readonly page?: number; readonly pages?: number; readonly animated?: boolean }
): RgbaImage {
  const meta = readGifMetadata(bytes);
  const { width, height } = meta;
  const totalPages = meta.pages ?? 1;
  const isMulti =
    options?.animated === true ||
    options?.pages === -1 ||
    (options?.pages !== undefined && options.pages > 1);
  const startPage = Math.max(0, options?.page ?? 0);
  const numPages = isMulti
    ? options?.pages !== undefined && options.pages > 0
      ? Math.min(options.pages, Math.max(1, totalPages - startPage))
      : Math.max(1, totalPages - startPage)
    : 1;
  const endPage = startPage + numPages - 1;

  const packed = bytes[10]!;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  let pos = 13;
  let gct: Uint8Array = new Uint8Array(0);
  if (hasGct) {
    gct = bytes.subarray(pos, pos + gctSize * 3);
    pos += gctSize * 3;
  }

  let transparentIdx = -1;
  let disposalMethod = 0;
  let currentFrame = 0;
  const framePixels = width * height * 4;
  const rgba = new Uint8Array(framePixels);
  const stackedRgba = numPages > 1 ? new Uint8Array(framePixels * numPages) : rgba;
  let hasAnyAlpha = false;

  while (pos < bytes.length) {
    const intro = bytes[pos++]!;
    if (intro === 0x3b) break; // trailer
    if (intro === 0x21) {
      const label = bytes[pos++]!;
      if (label === 0xf9) {
        const blockSize = bytes[pos++]!;
        const gceFlags = bytes[pos]!;
        disposalMethod = (gceFlags >>> 2) & 0x07;
        if (gceFlags & 0x01) {
          transparentIdx = bytes[pos + 3]!;
        } else {
          transparentIdx = -1;
        }
        pos += blockSize + 1;
      } else {
        while (pos < bytes.length) {
          const subLen = bytes[pos++]!;
          if (subLen === 0) break;
          pos += subLen;
        }
      }
    } else if (intro === 0x2c) {
      const left = bytes[pos]! | (bytes[pos + 1]! << 8);
      const top = bytes[pos + 2]! | (bytes[pos + 3]! << 8);
      const imgW = bytes[pos + 4]! | (bytes[pos + 5]! << 8);
      const imgH = bytes[pos + 6]! | (bytes[pos + 7]! << 8);
      const imgFlags = bytes[pos + 8]!;
      pos += 9;
      let palette: Uint8Array = gct;
      if (imgFlags & 0x80) {
        const lctSize = 1 << ((imgFlags & 0x07) + 1);
        palette = bytes.subarray(pos, pos + lctSize * 3);
        pos += lctSize * 3;
      }
      const minCodeSize = bytes[pos++]!;
      const blocks: Uint8Array[] = [];
      while (pos < bytes.length) {
        const subLen = bytes[pos++]!;
        if (subLen === 0) break;
        blocks.push(bytes.subarray(pos, pos + subLen));
        pos += subLen;
      }
      const totalLen = blocks.reduce((s, b) => s + b.length, 0);
      const lzwStream = new Uint8Array(totalLen);
      let off = 0;
      for (const b of blocks) {
        lzwStream.set(b, off);
        off += b.length;
      }
      const indices = lzwDecode(minCodeSize, lzwStream, imgW * imgH);
      const isInterlaced = (imgFlags & 0x40) !== 0;
      const rowMap = new Int32Array(imgH);
      if (isInterlaced) {
        let srcRow = 0;
        const passes: [number, number][] = [[0, 8], [4, 8], [2, 4], [1, 2]];
        for (const [start, step] of passes) {
          for (let r = start; r < imgH; r += step) {
            rowMap[srcRow++] = r;
          }
        }
      } else {
        for (let r = 0; r < imgH; r++) rowMap[r] = r;
      }
      const prevCanvas = disposalMethod === 3 ? new Uint8Array(rgba) : undefined;
      for (let sy = 0; sy < imgH; sy++) {
        const y = rowMap[sy]!;
        for (let x = 0; x < imgW; x++) {
          const idx = indices[sy * imgW + x]!;
          const dstX = left + x;
          const dstY = top + y;
          if (dstX < width && dstY < height) {
            const outIdx = (dstY * width + dstX) * 4;
            if (idx === transparentIdx) {
              if (currentFrame === 0) rgba[outIdx + 3] = 0;
            } else {
              rgba[outIdx] = palette[idx * 3] ?? 0;
              rgba[outIdx + 1] = palette[idx * 3 + 1] ?? 0;
              rgba[outIdx + 2] = palette[idx * 3 + 2] ?? 0;
              rgba[outIdx + 3] = 255;
            }
          }
        }
      }
      if (transparentIdx !== -1) hasAnyAlpha = true;
      if (currentFrame >= startPage && currentFrame <= endPage) {
        if (numPages > 1) {
          stackedRgba.set(rgba, (currentFrame - startPage) * framePixels);
        }
      }
      if (currentFrame >= endPage) {
        break;
      }
      if (disposalMethod === 2) {
        for (let sy = 0; sy < imgH; sy++) {
          const dstY = top + sy;
          if (dstY >= height) continue;
          for (let sx = 0; sx < imgW; sx++) {
            const dstX = left + sx;
            if (dstX >= width) continue;
            const outIdx = (dstY * width + dstX) * 4;
            rgba[outIdx] = 0;
            rgba[outIdx + 1] = 0;
            rgba[outIdx + 2] = 0;
            rgba[outIdx + 3] = 0;
          }
        }
      } else if (disposalMethod === 3 && prevCanvas) {
        rgba.set(prevCanvas);
      }
      currentFrame++;
      transparentIdx = -1;
      disposalMethod = 0;
    } else {
      break;
    }
  }

  const outData = numPages > 1 ? stackedRgba : rgba;
  let hasAlpha = hasAnyAlpha;
  if (!hasAlpha) {
    for (let i = 3; i < outData.length; i += 4) {
      if (outData[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
  }

  return {
    width,
    height: height * numPages,
    data: outData,
    format: "gif",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha,
    ...(numPages > 1 ? { pages: numPages, sourcePages: totalPages } : {}),
    ...(numPages > 1 ? { pageHeight: height } : {}),
    ...(meta.delay !== undefined ? { delay: meta.delay } : {}),
    ...(meta.loop !== undefined ? { loop: meta.loop } : {})
  };
}

/** Explicit in-memory convenience; file workflows use the retained encoder. */
export function encodeGifImage(img:RgbaImage,options:GifOptions={}):Uint8Array {
 const layout=gifLayout(img,options),palette=new GifPalette(),data=img.data;
 for(let i=0;i<img.width*img.height;i++)palette.add(data[i*4]!,data[i*4+1]!,data[i*4+2]!,data[i*4+3]!);
 palette.finish();const chunks:Uint8Array[]=[gifHeader(img,options,layout,palette)];
 for(let frame=0;frame<layout.frames;frame++){
  const start=frame*layout.framePixels;let transparent=false;
  for(let i=0;i<layout.framePixels;i++)if(data[(start+i)*4+3]!<128){transparent=true;break;}
  chunks.push(gifFrameHeader(img,options,layout,frame,transparent));const codes=new GifCodes();codes.code(256);
  for(let i=0;i<layout.framePixels;i++){
   if(i>0&&i%120===0){const chunk=codes.code(256);if(chunk)chunks.push(chunk);}
   const at=(start+i)*4,chunk=codes.code(palette.index(data[at]!,data[at+1]!,data[at+2]!,data[at+3]!));if(chunk)chunks.push(chunk);
  }
  chunks.push(...codes.finish());
 }
 chunks.push(Uint8Array.of(59));const output=new Uint8Array(chunks.reduce((length,chunk)=>length+chunk.length,0));let offset=0;
 for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
