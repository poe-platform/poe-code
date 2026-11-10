import { cropReadMaskSteps, cropStoredReadMask } from "./crop-read-mask.js";
import { extractImageSteps, transformStoredImage, type ImageByteStorage, type RgbaColor, type RgbaImage as BaseRgbaImage, type StoredRgbaImage as BaseStoredRgbaImage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { HueMetadata } from "./colorspace-hue.js";

type RgbaImage = BaseRgbaImage & HueMetadata & { writeMask?: BaseRgbaImage | undefined };
type StoredRgbaImage = BaseStoredRgbaImage & HueMetadata & { storedWriteMask?: BaseStoredRgbaImage | undefined };

type Area = { left: number; top: number; width: number; height: number };
type Read = { position: number; length: number };
type TrimPixels = { samples: Uint8Array | Uint16Array | Float64Array; inks: Float64Array | undefined };
type TrimColor = RgbaColor & { black?: number };

function trimColor(pixels: TrimPixels, offset: number, scale: number, hasAlpha: boolean, cmyk: boolean): TrimColor {
    const samples = pixels.samples;
    const r = samples[offset]! / scale, g = samples[offset + 1]! / scale, b = samples[offset + 2]! / scale;
    const a = hasAlpha ? samples[offset + 3]! / scale : 255;
    if (!cmyk) return { r, g, b, a };
    const inks = pixels.inks?.subarray(offset, offset + 4) ?? rgbToCmyk(r / 255, g / 255, b / 255);
    return { r: inks[0]! * 255, g: inks[1]! * 255, b: inks[2]! * 255, a, black: inks[3]! * 255 };
}

function matchesTrimColor(pixel: TrimColor, reference: TrimColor, fuzz: number, hue: boolean, referenceFuzz = fuzz): boolean {
    let distance = pixel.r - reference.r;
    // Native fuzzy equivalence doubles hue arc distance before comparing it.
    if (hue) {
        if (Math.abs(distance) > 127.5) distance -= 255;
        distance *= 2;
    }
    // CMYK black contributes independently; alpha weights the other three inks.
    const squared = (pixel.a - reference.a) ** 2 + ((pixel.black ?? 0) - (reference.black ?? 0)) ** 2
        + (distance ** 2 + (pixel.g - reference.g) ** 2 + (pixel.b - reference.b) ** 2)
        * (pixel.a / 255) * (reference.a / 255) / 3;
    return squared <= fuzz ** 2 + referenceFuzz ** 2;
}

// Percentage trimming peels the least occupied edge first (west wins ties).
// Census values for the opposite edge stay unchanged until its length changes.
function* percentTrimBounds(width: number, height: number, hasAlpha: boolean, fuzz: number, scale: number, percent: number, hue: boolean, background?: RgbaColor, cmyk = false): Generator<Read | undefined, Area | undefined, TrimPixels | undefined> {
    const corners: TrimColor[] = [];
    for (const pixel of [0, width - 1, (height - 1) * width, width * height - 1]) {
        if (background) { corners.push(background); continue; }
        const bytes = yield { position: pixel * 4, length: 4 };
        if (!bytes || bytes.samples.length !== 4) throw new Error("Truncated trim pixels");
        corners.push(trimColor(bytes, 0, scale, hasAlpha, cmyk));
    }
    let left = 0, top = 0, right = width - 1, bottom = height - 1;
    function* census(edge: number, corner: number): Generator<Read | undefined, number, TrimPixels | undefined> {
        const vertical = edge < 2, count = vertical ? bottom - top + 1 : right - left + 1;
        const ref = corners[corner]!;
        let foreground = 0;
        for (let start = 0; start < count;) {
            if (start % 1024 === 0) yield;
            const length = vertical ? 1 : Math.min(1024, count - start);
            const x = vertical ? (edge === 0 ? left : right) : left + start;
            const y = vertical ? top + start : (edge === 2 ? top : bottom);
            const bytes = yield { position: (y * width + x) * 4, length: length * 4 };
            if (!bytes || bytes.samples.length !== length * 4) throw new Error("Truncated trim pixels");
            for (let i = 0; i < bytes.samples.length; i += 4) {
                if (!matchesTrimColor(trimColor(bytes, i, scale, hasAlpha, cmyk), ref, fuzz, hue, background ? 0 : fuzz)) foreground++;
            }
            start += length;
        }
        return foreground / count;
    }
    const occupancy = [yield* census(0, 2), yield* census(1, 1), yield* census(2, 0), yield* census(3, 3)];
    const threshold = Math.min(Math.max(1 - percent / 100, 1e-12), 1);
    while (Math.min(...occupancy) < threshold) {
        const edge = occupancy.indexOf(Math.min(...occupancy));
        if (edge === 0) left++;
        else if (edge === 1) right--;
        else if (edge === 2) top++;
        else bottom--;
        if (left > right || top > bottom) return;
        for (let candidate = 0; candidate < 4; candidate++) {
            if (candidate !== edge && (candidate < 2) === (edge < 2)) continue;
            occupancy[candidate] = yield* census(candidate, candidate === 1 ? 1 : candidate === 3 ? 2 : 0);
        }
    }
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// ImageMagick uses the original corner colors independently for each bound,
// unlike Sharp's median-filtered, single-background trim.
function* trimBounds(width: number, height: number, hasAlpha: boolean, fuzz: number, scale: number, colorspace: HueMetadata["magickColorspace"], edges?: string, percentBackground?: number, background?: RgbaColor, cmyk = false): Generator<Read | undefined, Area | undefined, TrimPixels | undefined> {
    const hue = colorspace !== undefined && ["HCL", "HCLp", "HSL", "HSB", "HSV"].includes(colorspace);
    if (percentBackground !== undefined) return yield* percentTrimBounds(width, height, hasAlpha, fuzz, scale, percentBackground, hue, background, cmyk);
    const corners: TrimColor[] = [];
    for (const pixel of [0, width - 1, (height - 1) * width, width * height - 1]) {
        const bytes = yield { position: pixel * 4, length: 4 };
        if (!bytes || bytes.samples.length !== 4) throw new Error("Truncated trim pixels");
        corners.push(trimColor(bytes, 0, scale, hasAlpha, cmyk));
    }
    // Native bounds start one pixel past a sole row or column. Cropping clamps them later.
    let left = width, top = height;
    let right = edges === undefined && width === 1 ? 1 : 0;
    let bottom = edges === undefined && height === 1 ? 1 : 0;
    for (let y = 0; y < height; y++) {
        let rowRight = right, rowBottom = bottom;
        for (let start = 0; start < width; start += 1024) {
            yield;
            const length = Math.min(1024, width - start) * 4;
            const bytes = yield { position: (y * width + start) * 4, length };
            if (!bytes || bytes.samples.length !== length) throw new Error("Truncated trim pixels");
            for (let i = 0; i < length; i += 4) {
                const x = start + i / 4;
                const pixel = trimColor(bytes, i, scale, hasAlpha, cmyk);
                const matches = (corner: number) => {
                    const ref = corners[corner]!;
                    return matchesTrimColor(pixel, ref, fuzz, hue);
                };
                if ((x < left || y < top) && !matches(0)) { left = Math.min(left, x); top = Math.min(top, y); }
                if (x > rowRight && !matches(1)) rowRight = x;
                if (y > rowBottom && !matches(2)) rowBottom = y;
                if (x < rowRight && y > rowBottom && !matches(3)) { rowRight = x; rowBottom = y; }
            }
        }
        right = Math.max(right, rowRight); bottom = Math.max(bottom, rowBottom);
    }
    if (edges !== undefined) {
        const selected = edges.toLowerCase().split(",");
        if (!selected.includes("west")) left = 0;
        if (!selected.includes("north")) top = 0;
        // Native bounding geometry retains the far edge past the raster.
        if (!selected.includes("east")) right = width;
        if (!selected.includes("south")) bottom = height;
    }
    if (left > right || top > bottom) return;
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function cropTrimBounds(area: Area, width: number, height: number, minSize?: { width?: number; height?: number }): Area {
    const { left, top } = area;
    const retainedWidth = Math.min(width, Math.max(Math.min(area.width, width - left), Math.round(minSize?.width ?? 0)));
    const retainedHeight = Math.min(height, Math.max(Math.min(area.height, height - top), Math.round(minSize?.height ?? 0)));
    return { left: Math.min(left, width - retainedWidth), top: Math.min(top, height - retainedHeight), width: retainedWidth, height: retainedHeight };
}

export function* formatTrimBoundsSteps<Step = never>(
    image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "space" | "magickColorspace">,
    load: (position: number, length: number) => Generator<Step, { data: Uint8Array; data16?: Uint16Array; evaluateSamples?: Float64Array; hueSamples?: Float64Array }, void>,
    format: "trim-geometry" | "bounding-box",
    fuzz: number,
    analysis?: { warnings: string; boundsWarning?: boolean },
    edges?: string,
    percentBackground?: number,
    background?: RgbaColor
): Generator<Step | void, string, void> {
    const first = yield* load(0, 4);
    const steps = trimBounds(image.width, image.height, image.hasAlpha, fuzz, first.evaluateSamples ? 1 : first.data16 ? 257 : 1, image.magickColorspace, edges, percentBackground, background, image.space === "cmyk");
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else {
            const chunk = yield* load(next.value.position, next.value.length);
            next = steps.next({ samples: chunk.evaluateSamples ?? chunk.data16 ?? chunk.data, inks: chunk.hueSamples });
        }
    }
    if (!next.value && analysis && !analysis.boundsWarning) {
        analysis.warnings += "magick: geometry does not contain image\n";
        analysis.boundsWarning = true;
    }
    const area = next.value ?? {
        left: image.width, top: image.height,
        width: edges === undefined && percentBackground === undefined && image.width === 1 ? 1 : 0,
        height: edges === undefined && percentBackground === undefined && image.height === 1 ? 1 : 0
    };
    return format === "bounding-box"
        ? `${area.left},${area.top} ${area.left + area.width},${area.top + area.height}`
        : `${area.width}x${area.height}+${area.left}+${area.top}`;
}

function emptyTrimPixel(image: RgbaImage | StoredRgbaImage, background?: RgbaColor): Uint8Array {
    if (background) return new Uint8Array([background.r, background.g, background.b, 0]);
    // Native PNG reading leaves sub-byte grayscale bKGD samples unscaled.
    const value = image.format === "png" && image.space === "b-w" && image.backgroundColor && (image.bitsPerSample ?? 8) < 8
        ? Math.round(image.backgroundColor.b * (2 ** image.bitsPerSample! - 1) / 255)
        : 255;
    return new Uint8Array([value, value, value, 0]);
}

export function* trimMagickSteps(image: RgbaImage, fuzz: number, edges?: string, minSize?: { width?: number; height?: number }, percentBackground?: number, analysis?: { warnings: string }, background?: RgbaColor, emptyBackground?: RgbaColor): Generator<void, RgbaImage, void> {
    if (image.width === 1 && image.height === 1) {
        if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
        return image;
    }
    const pixels = image.evaluateSamples ?? image.data16 ?? image.data;
    const steps = trimBounds(image.width, image.height, image.hasAlpha, fuzz, image.evaluateSamples ? 1 : image.data16 ? 257 : 1, image.magickColorspace, edges, percentBackground, background, image.space === "cmyk");
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next({ samples: pixels.subarray(position, position + length), inks: image.hueSamples?.subarray(position, position + length) }); }
    }
    if (next.value && next.value.left < image.width && next.value.top < image.height) {
        const area = cropTrimBounds(next.value, image.width, image.height, minSize);
        let cropped: RgbaImage = yield* extractImageSteps(image, area);
        if (image.hueSamples) {
            const hueSamples = new Float64Array(cropped.width * cropped.height * 4);
            for (let y = 0; y < cropped.height; y++) {
                yield;
                const start = ((area.top + y) * image.width + area.left) * 4;
                hueSamples.set(image.hueSamples.subarray(start, start + area.width * 4), y * area.width * 4);
            }
            cropped = { ...cropped, hueSamples };
        }
        if (image.data16) {
            const data16 = new Uint16Array(cropped.width * cropped.height * 4);
            for (let y = 0; y < cropped.height; y++) {
                const page = Math.floor(y / area.height), row = y % area.height;
                const start = ((page * (image.pageHeight ?? image.height) + area.top + row) * image.width + area.left) * 4;
                for (let offset = 0; offset < area.width * 4; offset += 4096) {
                    yield;
                    const length = Math.min(4096, area.width * 4 - offset);
                    data16.set(image.data16.subarray(start + offset, start + offset + length), y * area.width * 4 + offset);
                }
            }
            cropped = { ...cropped, data16 };
        }
        return { ...cropped,
            ...("readMask" in image && image.readMask ? { readMask: yield* cropReadMaskSteps(image.readMask as RgbaImage, area) } : {}),
            ...(image.writeMask ? { writeMask: yield* extractImageSteps(image.writeMask, area) } : {}),
            virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + area.left, y: (image.virtualCanvas?.y ?? 0) + area.top },
        };
    }
    if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
    // ImageMagick represents an empty trim with one transparent background pixel.
    const { data16: ignored, evaluateSamples: ignoredSamples, hueSamples: ignoredHue, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, data: emptyTrimPixel(image, emptyBackground), channels: 4, hasAlpha: true,
        virtualCanvas: { width: image.width, height: image.height, x: -1, y: -1 } };
}

export async function trimStoredMagick(image: StoredRgbaImage, storage: ImageByteStorage, fuzz: number, signal: AbortSignal, edges?: string, minSize?: { width?: number; height?: number }, percentBackground?: number, analysis?: { warnings: string }, background?: RgbaColor, emptyBackground?: RgbaColor): Promise<StoredRgbaImage> {
    if (image.width === 1 && image.height === 1) {
        if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
        return image;
    }
    const sampleBytes = image.storedEvaluateSamples !== undefined ? 8 : image.storedData16 ? 2 : 1;
    const position = image.storedEvaluateSamples ?? image.storedData16?.position ?? image.position;
    const steps = trimBounds(image.width, image.height, image.hasAlpha, fuzz, sampleBytes === 2 ? 257 : 1, image.magickColorspace, edges, percentBackground, background, image.space === "cmyk");
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position: offset, length } = next.value;
            const bytes = await storage.read(position + offset * sampleBytes, length * sampleBytes, { signal });
            if (bytes.length !== length * sampleBytes) throw new Error("Truncated trim pixels");
            const inkBytes = image.space === "cmyk" && image.storedHueSamples !== undefined
                ? await storage.read(image.storedHueSamples + offset * 8, length * 8, { signal }) : undefined;
            next = steps.next({ samples: sampleBytes === 8 ? new Float64Array(new Uint8Array(bytes).buffer)
                : sampleBytes === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes,
                inks: inkBytes ? new Float64Array(new Uint8Array(inkBytes).buffer) : undefined });
        }
    }
    if (next.value && next.value.left < image.width && next.value.top < image.height) {
        const area = cropTrimBounds(next.value, image.width, image.height, minSize);
        return {
            ...await transformStoredImage(image, storage, { kind: "extract", ...area }, signal),
            ...("readMask" in image && image.readMask ? { readMask: await cropStoredReadMask(image.readMask as StoredRgbaImage, area, storage, signal) } : {}),
            ...(image.storedWriteMask ? { storedWriteMask: await transformStoredImage(image.storedWriteMask, storage, { kind: "extract", ...area }, signal) } : {}),
            virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + area.left, y: (image.virtualCanvas?.y ?? 0) + area.top },
        };
    }
    if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
    const emptyPosition = storage.allocate(4);
    await storage.write(emptyPosition, emptyTrimPixel(image, emptyBackground), { signal });
    const { storedData16: ignored, storedEvaluateSamples: ignoredSamples, storedHueSamples: ignoredHue, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, position: emptyPosition, channels: 4, hasAlpha: true,
        virtualCanvas: { width: image.width, height: image.height, x: -1, y: -1 } };
}
