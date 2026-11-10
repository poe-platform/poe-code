import { extractImageSteps, transformStoredImage, type ImageByteStorage, type RgbaColor, type RgbaImage as BaseRgbaImage, type StoredRgbaImage as BaseStoredRgbaImage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { matchesAlphaFloodfill } from "./floodfill.js";

type RgbaImage = BaseRgbaImage & { writeMask?: BaseRgbaImage | undefined };
type StoredRgbaImage = BaseStoredRgbaImage & { storedWriteMask?: BaseStoredRgbaImage | undefined };

type Area = { left: number; top: number; width: number; height: number };
type Read = { position: number; length: number };

// Percentage trimming peels the least occupied edge first (west wins ties).
// Census values for the opposite edge stay unchanged until its length changes.
function* percentTrimBounds(width: number, height: number, fuzz: number, scale: number, percent: number, background?: RgbaColor): Generator<Read | undefined, Area | undefined, Uint8Array | Uint16Array | Float64Array | undefined> {
    const corners: RgbaColor[] = [];
    for (const pixel of [0, width - 1, (height - 1) * width, width * height - 1]) {
        if (background) { corners.push(background); continue; }
        const bytes = yield { position: pixel * 4, length: 4 };
        if (!bytes || bytes.length !== 4) throw new Error("Truncated trim pixels");
        corners.push({ r: bytes[0]! / scale, g: bytes[1]! / scale, b: bytes[2]! / scale, a: bytes[3]! / scale });
    }
    let left = 0, top = 0, right = width - 1, bottom = height - 1;
    function* census(edge: number, corner: number): Generator<Read | undefined, number, Uint8Array | Uint16Array | Float64Array | undefined> {
        const vertical = edge < 2, count = vertical ? bottom - top + 1 : right - left + 1;
        const ref = corners[corner]!;
        let foreground = 0;
        for (let start = 0; start < count;) {
            if (start % 1024 === 0) yield;
            const length = vertical ? 1 : Math.min(1024, count - start);
            const x = vertical ? (edge === 0 ? left : right) : left + start;
            const y = vertical ? top + start : (edge === 2 ? top : bottom);
            const bytes = yield { position: (y * width + x) * 4, length: length * 4 };
            if (!bytes || bytes.length !== length * 4) throw new Error("Truncated trim pixels");
            for (let i = 0; i < bytes.length; i += 4) {
                if (!matchesAlphaFloodfill(bytes[i]! / scale, bytes[i + 1]! / scale, bytes[i + 2]! / scale, bytes[i + 3]! / scale, ref.r, ref.g, ref.b, ref.a, fuzz)) foreground++;
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
function* trimBounds(width: number, height: number, fuzz: number, scale: number, edges?: string, percentBackground?: number, background?: RgbaColor): Generator<Read | undefined, Area | undefined, Uint8Array | Uint16Array | Float64Array | undefined> {
    if (percentBackground !== undefined) return yield* percentTrimBounds(width, height, fuzz, scale, percentBackground, background);
    const corners: (Uint8Array | Uint16Array | Float64Array)[] = [];
    for (const pixel of [0, width - 1, (height - 1) * width, width * height - 1]) {
        const bytes = yield { position: pixel * 4, length: 4 };
        if (!bytes || bytes.length !== 4) throw new Error("Truncated trim pixels");
        corners.push(bytes.slice());
    }
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) {
        let rowRight = right, rowBottom = bottom;
        for (let start = 0; start < width; start += 1024) {
            yield;
            const length = Math.min(1024, width - start) * 4;
            const bytes = yield { position: (y * width + start) * 4, length };
            if (!bytes || bytes.length !== length) throw new Error("Truncated trim pixels");
            for (let i = 0; i < length; i += 4) {
                const x = start + i / 4;
                const matches = (corner: number) => {
                    const ref = corners[corner]!;
                    return matchesAlphaFloodfill(bytes[i]! / scale, bytes[i + 1]! / scale, bytes[i + 2]! / scale, bytes[i + 3]! / scale, ref[0]! / scale, ref[1]! / scale, ref[2]! / scale, ref[3]! / scale, fuzz);
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
    image: Pick<RgbaImage, "width" | "height">,
    load: (position: number, length: number) => Generator<Step, { data: Uint8Array; data16?: Uint16Array; evaluateSamples?: Float64Array }, void>,
    format: "trim-geometry" | "bounding-box",
    fuzz: number,
    analysis?: { warnings: string },
    edges?: string,
    percentBackground?: number,
    background?: RgbaColor
): Generator<Step | void, string, void> {
    const first = yield* load(0, 4);
    const steps = trimBounds(image.width, image.height, fuzz, first.evaluateSamples ? 1 : first.data16 ? 257 : 1, edges, percentBackground, background);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else {
            const chunk = yield* load(next.value.position, next.value.length);
            next = steps.next(chunk.evaluateSamples ?? chunk.data16 ?? chunk.data);
        }
    }
    if (!next.value && analysis) analysis.warnings += "magick: geometry does not contain image\n";
    const area = next.value ?? { left: image.width, top: image.height, width: 0, height: 0 };
    return format === "bounding-box"
        ? `${area.left},${area.top} ${area.left + area.width},${area.top + area.height}`
        : `${area.width}x${area.height}+${area.left}+${area.top}`;
}

function emptyTrimPixel(image: RgbaImage | StoredRgbaImage): Uint8Array {
    // Native PNG reading leaves sub-byte grayscale bKGD samples unscaled.
    const value = image.format === "png" && image.space === "b-w" && image.backgroundColor && (image.bitsPerSample ?? 8) < 8
        ? Math.round(image.backgroundColor.b * (2 ** image.bitsPerSample! - 1) / 255)
        : 255;
    return new Uint8Array([value, value, value, 0]);
}

export function* trimMagickSteps(image: RgbaImage, fuzz: number, edges?: string, minSize?: { width?: number; height?: number }, percentBackground?: number, analysis?: { warnings: string }, background?: RgbaColor): Generator<void, RgbaImage, void> {
    if (image.width === 1 && image.height === 1) return image;
    const pixels = image.evaluateSamples ?? image.data16 ?? image.data;
    const steps = trimBounds(image.width, image.height, fuzz, image.evaluateSamples ? 1 : image.data16 ? 257 : 1, edges, percentBackground, background);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next(pixels.subarray(position, position + length)); }
    }
    if (next.value && next.value.left < image.width && next.value.top < image.height) {
        const area = cropTrimBounds(next.value, image.width, image.height, minSize);
        let cropped = yield* extractImageSteps(image, area);
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
            ...("readMask" in image && image.readMask ? { readMask: yield* extractImageSteps(image.readMask as RgbaImage, area) } : {}),
            ...(image.writeMask ? { writeMask: yield* extractImageSteps(image.writeMask, area) } : {}),
            virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + area.left, y: (image.virtualCanvas?.y ?? 0) + area.top },
        };
    }
    if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
    // ImageMagick represents an empty trim with one transparent background pixel.
    const { data16: ignored, evaluateSamples: ignoredSamples, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, data: emptyTrimPixel(image), channels: 4, hasAlpha: true,
        virtualCanvas: { width: image.width, height: image.height, x: -1, y: -1 } };
}

export async function trimStoredMagick(image: StoredRgbaImage, storage: ImageByteStorage, fuzz: number, signal: AbortSignal, edges?: string, minSize?: { width?: number; height?: number }, percentBackground?: number, analysis?: { warnings: string }, background?: RgbaColor): Promise<StoredRgbaImage> {
    if (image.width === 1 && image.height === 1) return image;
    const sampleBytes = image.storedEvaluateSamples !== undefined ? 8 : image.storedData16 ? 2 : 1;
    const position = image.storedEvaluateSamples ?? image.storedData16?.position ?? image.position;
    const steps = trimBounds(image.width, image.height, fuzz, sampleBytes === 2 ? 257 : 1, edges, percentBackground, background);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position: offset, length } = next.value;
            const bytes = await storage.read(position + offset * sampleBytes, length * sampleBytes, { signal });
            if (bytes.length !== length * sampleBytes) throw new Error("Truncated trim pixels");
            next = steps.next(sampleBytes === 8 ? new Float64Array(new Uint8Array(bytes).buffer)
                : sampleBytes === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    if (next.value && next.value.left < image.width && next.value.top < image.height) {
        const area = cropTrimBounds(next.value, image.width, image.height, minSize);
        return {
            ...await transformStoredImage(image, storage, { kind: "extract", ...area }, signal),
            ...("readMask" in image && image.readMask ? { readMask: await transformStoredImage(image.readMask as StoredRgbaImage, storage, { kind: "extract", ...area }, signal) } : {}),
            ...(image.storedWriteMask ? { storedWriteMask: await transformStoredImage(image.storedWriteMask, storage, { kind: "extract", ...area }, signal) } : {}),
            virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + area.left, y: (image.virtualCanvas?.y ?? 0) + area.top },
        };
    }
    if (analysis) analysis.warnings += "magick: geometry does not contain image\n";
    const emptyPosition = storage.allocate(4);
    await storage.write(emptyPosition, emptyTrimPixel(image), { signal });
    const { storedData16: ignored, storedEvaluateSamples: ignoredSamples, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, position: emptyPosition, channels: 4, hasAlpha: true,
        virtualCanvas: { width: image.width, height: image.height, x: -1, y: -1 } };
}
