import { extractImageSteps, transformStoredImage, type ImageByteStorage, type RgbaImage, type StoredRgbaImage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { matchesAlphaFloodfill } from "./floodfill.js";

type Area = { left: number; top: number; width: number; height: number };
type Read = { position: number; length: number };

// ImageMagick uses the original corner colors independently for each bound,
// unlike Sharp's median-filtered, single-background trim.
function* trimBounds(width: number, height: number, fuzz: number): Generator<Read | undefined, Area | undefined, Uint8Array | undefined> {
    const corners: Uint8Array[] = [];
    for (const pixel of [0, width - 1, (height - 1) * width, width * height - 1]) {
        const bytes = yield { position: pixel * 4, length: 4 };
        if (!bytes || bytes.length !== 4) throw new Error("Truncated trim pixels");
        corners.push(new Uint8Array(bytes));
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
                    return matchesAlphaFloodfill(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!, ref[0]!, ref[1]!, ref[2]!, ref[3]!, fuzz);
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
    return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function* trimMagickSteps(image: RgbaImage, fuzz: number): Generator<void, RgbaImage, void> {
    const steps = trimBounds(image.width, image.height, fuzz);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next(image.data.subarray(position, position + length)); }
    }
    return next.value ? yield* extractImageSteps(image, next.value) : image;
}

export async function trimStoredMagick(image: StoredRgbaImage, storage: ImageByteStorage, fuzz: number, signal: AbortSignal): Promise<StoredRgbaImage> {
    const steps = trimBounds(image.width, image.height, fuzz);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next(await storage.read(image.position + position, length, { signal })); }
    }
    return next.value ? transformStoredImage(image, storage, { kind: "extract", ...next.value }, signal) : image;
}
