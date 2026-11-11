import {GifCodes,GifPalette,gifRows,gifLayout,gifHeader,gifFrameHeader,type GifOptions} from "./gif-output-parts.js";
import { checkLimitInputPixels } from "../limits.js";
import type { SharpInputOptions, ImageMetadata, RgbaImage } from "../ast.js";

export {isGifBytes} from "./gif-metadata.js";
import {isGifBytes,gifAnimationSteps,gifMetadataFields} from "./gif-metadata.js";

export function readGifMetadata(bytes:Uint8Array,options?:Pick<SharpInputOptions,"animated"|"page"|"pages"|"coalesce">):ImageMetadata {
 if(!isGifBytes(bytes)||bytes.length<13)throw new Error("Invalid GIF header");
 const start=13+(bytes[10]!&128?3*(1<<((bytes[10]!&7)+1)):0),steps=gifAnimationSteps(bytes.length,start,options?.page),delays:number[]=[];let next=steps.next();
 while(!next.done){if(typeof next.value==="number")next=steps.next(bytes[next.value]);else {delays.push(next.value.delay);next=steps.next();}}
 return {isProgressive:next.value.isProgressive,...(next.value.icc?{icc:next.value.icc}:{}),...(next.value.gifApplications?{gifApplications:next.value.gifApplications}:{}),...(next.value.properties ? {properties:next.value.properties,gifCommentBytes:next.value.gifCommentBytes} : {}),...gifMetadataFields(bytes[6]!|(bytes[7]!<<8),bytes[8]!|(bytes[9]!<<8),bytes.length,next.value.frames,next.value.loop,options,next.value.frame),...(delays.length?{delay:delays}:{})};
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
      if (code !== nextCode || oldCode === -1) throw new Error("Invalid GIF LZW dictionary");
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
  if (outPos < pixelCount) throw new Error("Truncated GIF pixels");
  return out;
}

export function decodeGifImage(
  bytes: Uint8Array,
  options?: SharpInputOptions
): RgbaImage {
  const meta = readGifMetadata(bytes, { page: options?.page ?? 0 });
  const { width, height } = meta;
  const totalPages = meta.pages ?? 1;
  const isMulti = options?.coalesce !== false && (
    options?.animated === true ||
    options?.pages === -1 ||
    (options?.pages !== undefined && options.pages > 1));
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
  const rgba = new Uint8Array(options?.coalesce === false ? 0 : framePixels);
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
      if (options?.coalesce === false && currentFrame !== startPage) {
        currentFrame++; transparentIdx = -1; continue;
      }
      const totalLen = blocks.reduce((s, b) => s + b.length, 0);
      const lzwStream = new Uint8Array(totalLen);
      let off = 0;
      for (const b of blocks) {
        lzwStream.set(b, off);
        off += b.length;
      }
      const indices = lzwDecode(minCodeSize, lzwStream, imgW * imgH);
      for (const index of indices) {
        if (index * 3 + 2 >= palette.length) throw new Error("invalid colormap index in GIF");
      }
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
      if (options?.coalesce === false && currentFrame === startPage) {
        checkLimitInputPixels(imgW, imgH, options);
        const data = new Uint8Array(imgW * imgH * 4);
        for (let sy = 0; sy < imgH; sy++) for (let x = 0; x < imgW; x++) {
          const index = indices[sy * imgW + x]!, at = (rowMap[sy]! * imgW + x) * 4;
          data.set([palette[index * 3] ?? 0, palette[index * 3 + 1] ?? 0, palette[index * 3 + 2] ?? 0, index === transparentIdx ? 0 : 255], at);
        }
        return { ...(meta.icc?{icc:meta.icc}:{}),...(meta.gifApplications?{gifApplications:meta.gifApplications}:{}), ...(meta.properties ? {properties:meta.properties,gifCommentBytes:meta.gifCommentBytes} : {}), width: imgW, height: imgH, data, format: "gif", space: "srgb", channels: 4, depth: "uchar", density: 72,
          indexedColors: Array.from({ length: palette.length / 3 }, (_, i) => (i === transparentIdx ? 0 : 255 * 16777216) + palette[i * 3]! * 65536 + palette[i * 3 + 1]! * 256 + palette[i * 3 + 2]!),
          ...(imgFlags & 0x80 ? {} : { backgroundColor: { r: palette[bytes[11]! * 3] ?? 0, g: palette[bytes[11]! * 3 + 1] ?? 0, b: palette[bytes[11]! * 3 + 2] ?? 0, a: 255 } }),
          hasAlpha: transparentIdx !== -1, virtualCanvas: { width, height, x: left, y: top }, disposal: disposalMethod,
          ...(meta.delay ? { delay: meta.delay } : {}), ...(meta.loop === undefined ? {} : { loop: meta.loop }) };
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
            if (idx !== transparentIdx || currentFrame === 0) {
              rgba[outIdx] = palette[idx * 3] ?? 0;
              rgba[outIdx + 1] = palette[idx * 3 + 1] ?? 0;
              rgba[outIdx + 2] = palette[idx * 3 + 2] ?? 0;
              rgba[outIdx + 3] = idx === transparentIdx ? 0 : 255;
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
      // Delay and disposal persist until another graphic control extension.
    }
    // Ignore stray bytes only between blocks; payloads retain their declared lengths.
  }

  if (options?.coalesce === false) throw new RangeError("GIF frame is out of range");
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
    ...(meta.icc?{icc:meta.icc}:{}),...(meta.gifApplications?{gifApplications:meta.gifApplications}:{}), ...(meta.properties ? {properties:meta.properties,gifCommentBytes:meta.gifCommentBytes} : {}),
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
 const layout=gifLayout(img,options),palette=new GifPalette(options.transparentColor),data=img.data;
 for(let i=0;i<img.width*img.height;i++)palette.add(data[i*4]!,data[i*4+1]!,data[i*4+2]!,data[i*4+3]!);
 if(img.backgroundColor){const c=img.backgroundColor;palette.add(c.r,c.g,c.b,255);}
 // Full-canvas frames that restore/clear after every display share an empty base.
 // Previous disposal lets us crop their transparent margins without leaving trails.
 let resetFrames = !!options.optimizeFrames && layout.frames > 1 && !(img.virtualCanvas?.x || img.virtualCanvas?.y);
 for (let frame = 0; resetFrames && frame < layout.frames; frame++) {
   const rectangle = img.gifFrames?.[frame];
   const disposal = typeof img.disposal === "number" ? img.disposal : img.disposal?.[frame];
   resetFrames = (disposal === 2 || disposal === 3) && (!rectangle || (rectangle.x === 0 && rectangle.y === 0 && rectangle.width === layout.width && rectangle.height === layout.frameHeight));
 }
 let headerImage = img;
 if (resetFrames) {
   for (let i = 0; i < layout.framePixels; i++) if (data[i * 4 + 3]! >= 128) {
     headerImage = { ...img, backgroundColor: { r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]!, a: 255 } }; break;
   }
 }
 palette.finish();const chunks:Uint8Array[]=[gifHeader(headerImage,options,layout,palette)];
 for(let frame=0;frame<layout.frames;frame++){
  const start=frame*layout.framePixels, rectangle=img.gifFrames?.[frame], count=rectangle ? rectangle.width*rectangle.height : layout.framePixels;
  const pixel=(i:number)=>start+(rectangle?Math.floor(i/rectangle.width)*img.width+i%rectangle.width:i);let transparent=false;
  for(let i=0;i<count;i++)if(data[pixel(i)*4+3]!<128){transparent=true;break;}

    let left = rectangle?.x ?? img.virtualCanvas?.x ?? 0, top = rectangle?.y ?? img.virtualCanvas?.y ?? 0, width = rectangle?.width ?? layout.width, height = rectangle?.height ?? layout.frameHeight;
    let cropped = false, empty = false;
    const currentDisposal = (typeof img.disposal === "number" ? img.disposal : img.disposal?.[frame]) ?? 1;
    const previousDisposal = (typeof img.disposal === "number" ? img.disposal : img.disposal?.[frame - 1]) ?? 1;
    const previousRectangle = img.gifFrames?.[frame - 1];
    const transdiff = options.gifTransdiff && frame > 0 && currentDisposal <= 1 && previousDisposal <= 1
      && left === 0 && top === 0 && width === layout.width && height === layout.frameHeight
      && (!previousRectangle || (previousRectangle.x === 0 && previousRectangle.y === 0 && previousRectangle.width === layout.width && previousRectangle.height === layout.frameHeight));
    if (resetFrames || (options.optimizeFrames && currentDisposal <= 1 && previousDisposal <= 1
      && left === 0 && top === 0 && width === layout.width && height === layout.frameHeight
      && (!previousRectangle || (previousRectangle.x === 0 && previousRectangle.y === 0 && previousRectangle.width === layout.width && previousRectangle.height === layout.frameHeight)))) {
      cropped = true;
      let right = -1, bottom = -1;
      left = width; top = height;
      for (let i = 0; i < layout.framePixels; i++) {
        const at = (start + i) * 4, previous = at - layout.framePixels * 4;
        const different = resetFrames || frame === 0 ? data[at + 3]! >= 128 : data[at] !== data[previous] || data[at + 1] !== data[previous + 1] || data[at + 2] !== data[previous + 2] || data[at + 3] !== data[previous + 3];
        if (different) {
          const x = i % layout.width, y = Math.floor(i / layout.width);
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      if (right < 0) { empty = true; left = 0; top = 0; width = 1; height = 1; }
      else { width = right - left + 1; height = bottom - top + 1; }
    }
  if (cropped) {
    transparent = false;
    for (let i = 0; i < width * height; i++) if (data[(start + (top + Math.floor(i / width)) * layout.width + left + i % width) * 4 + 3]! < 128) { transparent = true; break; }
  }
  if (empty || transdiff) transparent = true;
  const disposal = resetFrames ? 3 : options.optimizeFrames && currentDisposal <= 1 ? 1 : undefined;
  chunks.push(gifFrameHeader(img,palette,options,layout,frame,transparent,undefined,disposal,{left,top,width,height,...(rectangle ? {icc:rectangle.icc} : {}),gifApplications:rectangle?.gifApplications,comment:rectangle?.comment,gifCommentBytes:rectangle?.gifCommentBytes}));const codes=new GifCodes();codes.code(256);
  let emitted = 0;
  for (const row of gifRows(height, options.gifInterlace)) for (let x = 0; x < width; x++) {
   const i = row * width + x;
   if(emitted>0&&emitted%120===0){const chunk=codes.code(256);if(chunk)chunks.push(chunk);}
   emitted++;
   const at=(cropped?start+(top+Math.floor(i/width))*layout.width+left+i%width:pixel(i))*4;
   const previous = at - layout.framePixels * 4;
   const unchanged = transdiff && data[at] === data[previous] && data[at+1] === data[previous+1] && data[at+2] === data[previous+2] && data[at+3] === data[previous+3];
   const chunk=codes.code(empty || unchanged ? 255 : palette.index(data[at]!,data[at+1]!,data[at+2]!,data[at+3]!));if(chunk)chunks.push(chunk);
  }
  chunks.push(...codes.finish());
 }
 chunks.push(Uint8Array.of(59));const output=new Uint8Array(chunks.reduce((length,chunk)=>length+chunk.length,0));let offset=0;
 for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
