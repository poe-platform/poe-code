import { extractImageSteps, transformStoredImage, type ImageByteStorage, type RgbaImage, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { matchesAlphaFloodfill } from "./floodfill.js";

type Area = { left: number; top: number; width: number; height: number };
type Read = { position: number; length: number };

// ImageMagick uses the original corner colors independently for each bound,
// unlike Sharp's median-filtered, single-background trim.
function* trimBounds(width: number, height: number, fuzz: number, scale: number, minSize?: { width?: number; height?: number }): Generator<Read | undefined, Area | undefined, Uint8Array | Uint16Array | undefined> {
    const corners: (Uint8Array | Uint16Array)[] = [];
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
    if (left > right || top > bottom) return;
    const retainedWidth = Math.min(width, Math.max(right - left + 1, Math.floor(minSize?.width ?? 0)));
    const retainedHeight = Math.min(height, Math.max(bottom - top + 1, Math.floor(minSize?.height ?? 0)));
    return { left: Math.min(left, width - retainedWidth), top: Math.min(top, height - retainedHeight), width: retainedWidth, height: retainedHeight };
}

export function* trimMagickSteps(image: RgbaImage, fuzz: number, minSize?: { width?: number; height?: number }): Generator<void, RgbaImage, void> {
    const pixels = image.data16 ?? image.data;
    const steps = trimBounds(image.width, image.height, fuzz, image.data16 ? 257 : 1, minSize);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next(pixels.subarray(position, position + length)); }
    }
    if (next.value) {
        const area = next.value;
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
            virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + area.left, y: (image.virtualCanvas?.y ?? 0) + area.top },
        };
    }
    // ImageMagick represents an empty trim with one transparent white pixel.
    const { data16: ignored, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, data: new Uint8Array([255, 255, 255, 0]), channels: 4, hasAlpha: true };
}

export async function trimStoredMagick(image: StoredRgbaImage, storage: ImageByteStorage, fuzz: number, signal: AbortSignal, minSize?: { width?: number; height?: number }): Promise<StoredRgbaImage> {
    const sampleBytes = image.storedData16 ? 2 : 1;
    const position = image.storedData16?.position ?? image.position;
    const steps = trimBounds(image.width, image.height, fuzz, image.storedData16 ? 257 : 1, minSize);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position: offset, length } = next.value;
            const bytes = await storage.read(position + offset * sampleBytes, length * sampleBytes, { signal });
            if (bytes.length !== length * sampleBytes) throw new Error("Truncated trim pixels");
            next = steps.next(image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    if (next.value) return {
        ...await transformStoredImage(image, storage, { kind: "extract", ...next.value }, signal),
        virtualCanvas: { width: image.width, height: image.height, x: (image.virtualCanvas?.x ?? 0) + next.value.left, y: (image.virtualCanvas?.y ?? 0) + next.value.top },
    };
    const emptyPosition = storage.allocate(4);
    await storage.write(emptyPosition, new Uint8Array([255, 255, 255, 0]), { signal });
    const { storedData16: ignored, ...metadata } = image;
    return { ...metadata, width: 1, height: 1, position: emptyPosition, channels: 4, hasAlpha: true };
}
