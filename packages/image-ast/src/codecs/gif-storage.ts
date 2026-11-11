import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { Pixels } from "../ops/storage-raster.js";
import {
  GifCodes,
  gifRows,
  GifPalette,
  gifLayout,
  gifHeader,
  gifFrameHeader,
  type GifOptions
} from "./gif-output-parts.js";
/** Multipass GIF encoding with a source-derived palette and pull-driven owned subblocks. */
export async function* encodeGifFromStorage(
  image: StoredRgbaImage,
  storage: ImageByteStorage,
  signal: AbortSignal,
  options: GifOptions = {}
) {
  signal.throwIfAborted();
  const layout = gifLayout(image, options),
    length = image.width * image.height * 4;
  if (
    !Number.isSafeInteger(image.position) ||
    image.position < 0 ||
    !Number.isSafeInteger(image.position + length)
  )
    throw new RangeError("Invalid GIF backing allocation");
  const pixels = new Pixels(image, storage, signal),
    palette = new GifPalette(options.transparentColor),
    previousPixels = new Pixels(image, storage, signal);
  for (let i = 0; i < length / 4; i++) {
    const p = await pixels.pixel(i);
    palette.add(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24);
  }
  if (image.backgroundColor) {
    const c = image.backgroundColor;
    palette.add(c.r, c.g, c.b, 255);
  }
  // These full-canvas frames share an empty base; Previous allows cropping their margins.
  let resetFrames = !!options.optimizeFrames && layout.frames > 1 && !(image.virtualCanvas?.x || image.virtualCanvas?.y);
  for (let frame = 0; resetFrames && frame < layout.frames; frame++) {
    const rectangle = await image.storedGifFrame?.at(frame) ?? image.gifFrames?.[frame];
    const disposal = await image.storedDisposal?.at(frame, { signal }) ?? (typeof image.disposal === "number" ? image.disposal : image.disposal?.[frame]);
    resetFrames = (disposal === 2 || disposal === 3) && (!rectangle || (rectangle.x === 0 && rectangle.y === 0 && rectangle.width === layout.width && rectangle.height === layout.frameHeight));
  }
  let headerImage = image;
  if (resetFrames) {
    for (let i = 0; i < layout.framePixels; i++) {
      const p = await pixels.pixel(i);
      if (p >>> 24 >= 128) {
        headerImage = { ...image, backgroundColor: { r: p & 255, g: (p >>> 8) & 255, b: (p >>> 16) & 255, a: 255 } }; break;
      }
    }
  }
  palette.finish();
  signal.throwIfAborted();
  yield gifHeader(headerImage, options, layout, palette, await image.storedGifFrame?.at(0) ?? image.gifFrames?.[0]);
  for (let frame = 0; frame < layout.frames; frame++) {
    const start = frame * layout.framePixels;
    const rectangle = await image.storedGifFrame?.at(frame) ?? image.gifFrames?.[frame];
    const count = rectangle ? rectangle.width * rectangle.height : layout.framePixels;
    const pixel = (i: number) => start + (rectangle ? Math.floor(i / rectangle.width) * image.width + i % rectangle.width : i);
    let transparent = false;
    for (let i = 0; i < count; i++)
      if ((await pixels.pixel(pixel(i))) >>> 24 < 128) {
        transparent = true;
        break;
      }
    signal.throwIfAborted();
    const frameDelay = options.delay === undefined
      ? await image.storedDelay?.at(frame, {signal})
      : undefined;
    signal.throwIfAborted();
    const frameDisposal = await image.storedDisposal?.at(frame, {signal});

    let left = rectangle?.x ?? image.virtualCanvas?.x ?? 0, top = rectangle?.y ?? image.virtualCanvas?.y ?? 0, width = rectangle?.width ?? layout.width, height = rectangle?.height ?? layout.frameHeight;
    let cropped = false, empty = false;
    const currentDisposal = frameDisposal ?? (typeof image.disposal === "number" ? image.disposal : image.disposal?.[frame]) ?? 1;
    const previousDisposal = frame > 0 ? await image.storedDisposal?.at(frame - 1, { signal }) ?? (typeof image.disposal === "number" ? image.disposal : image.disposal?.[frame - 1]) ?? 1 : 1;
    const previousRectangle = frame > 0 ? await image.storedGifFrame?.at(frame - 1) ?? image.gifFrames?.[frame - 1] : undefined;
    const transdiff = options.gifTransdiff && frame > 0 && currentDisposal <= 1 && previousDisposal <= 1
      && left === 0 && top === 0 && width === layout.width && height === layout.frameHeight
      && (!previousRectangle || (previousRectangle.x === 0 && previousRectangle.y === 0 && previousRectangle.width === layout.width && previousRectangle.height === layout.frameHeight));
    if (resetFrames || (options.optimizeFrames && currentDisposal <= 1 && previousDisposal <= 1
      && left === 0 && top === 0 && width === layout.width && height === layout.frameHeight
      && (!previousRectangle || (previousRectangle.x === 0 && previousRectangle.y === 0 && previousRectangle.width === layout.width && previousRectangle.height === layout.frameHeight)))) {
      cropped = true;
      let right = -1, bottom = -1;
      left = width; top = height;
      for (let i = 0; i < count; i++) {
        const different = resetFrames || frame === 0 ? (await pixels.pixel(pixel(i))) >>> 24 >= 128 : await pixels.pixel(pixel(i)) !== await previousPixels.pixel(start - layout.framePixels + i);
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
      for (let i = 0; i < width * height; i++) if ((await pixels.pixel(start + (top + Math.floor(i / width)) * layout.width + left + i % width)) >>> 24 < 128) { transparent = true; break; }
    }
    if (empty || transdiff) transparent = true;
    const disposal = resetFrames ? 3 : options.optimizeFrames && currentDisposal <= 1 ? 1 : frameDisposal;
    yield gifFrameHeader(image, palette, options, layout, frame, transparent, frameDelay, disposal, { left, top, width, height, ...(rectangle ? { icc: rectangle.icc } : {}), gifApplications: rectangle?.gifApplications, comment: rectangle?.comment, gifCommentBytes: rectangle?.gifCommentBytes });
    const codes = new GifCodes();
    codes.code(256);
    let emitted = 0;
    for (const row of gifRows(height, options.gifInterlace)) for (let x = 0; x < width; x++) {
      const i = row * width + x;
      if (emitted > 0 && emitted % 120 === 0) {
        const chunk = codes.code(256);
        if (chunk) {
          signal.throwIfAborted();
          yield chunk;
        }
      }
      emitted++;
      const at = cropped ? start + (top + Math.floor(i / width)) * layout.width + left + i % width : pixel(i);
      const p = await pixels.pixel(at);
      const unchanged = transdiff && p === await previousPixels.pixel(at - layout.framePixels);
      const chunk = codes.code(empty || unchanged ? 255 : palette.index(p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24));
      if (chunk) {
        signal.throwIfAborted();
        yield chunk;
      }
    }
    for (const chunk of codes.finish()) {
      signal.throwIfAborted();
      yield chunk;
    }
  }
  signal.throwIfAborted();
  yield Uint8Array.of(59);
}
