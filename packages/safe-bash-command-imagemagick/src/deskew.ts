import type { ImageByteStorage, RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { WarpPlan } from "./warp-kernel.js";

type Read = { position: number; length: number };

// ImageMagick's fast Radon transform counts dark pixels in eight-pixel groups,
// then scores the differences between adjacent projected scanlines.
function* deskewAngle(width: number, height: number, spec: string, range: number): Generator<Read | undefined, number, Uint8Array | Uint16Array | Float64Array | undefined> {
    if ([...spec].some(character => character.trim() !== "" && !"0123456789eExX!#%()+,-./:<>@^".includes(character))) {
        throw new Error("Invalid deskew threshold");
    }
    const text = spec.trimStart(), sign = text[0] === "-" ? -1 : 1;
    const unsigned = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
    let value = unsigned.toLowerCase().startsWith("0x") ? Number.parseInt(text, 16) : Number.parseFloat(text);
    if (Number.isNaN(value)) {
        const geometry = [...spec].filter(c => c.trim() !== "" && c !== "(" && c !== ")").join("");
        const [first, second] = geometry.split(",");
        const component = (first || second || "").split("/")[0]!;
        const hasGeometryFlag = geometry.startsWith("-") || [...geometry].some(c => "xX.!#%:<>@^".includes(c));
        if (!hasGeometryFlag && !(component && Number.isFinite(Number(component)))) {
            throw new Error("Invalid deskew threshold");
        }
        // Native accepts geometry without a leading scalar, then reads that scalar as zero.
        value = 0;
    }
    // Geometry suffixes are valid, but only % immediately after the number scales it.
    const percent = unsigned.indexOf("%"), prefix = unsigned.slice(0, percent);
    const isPercent = percent > 0 && prefix.trimEnd() === prefix && Number(prefix) * sign === value;
    const threshold = value * (isPercent ? range / 100 : range / 65535);
    if (!Number.isFinite(threshold)) throw new Error("Invalid deskew threshold");
    const groups = Math.ceil(width / 8);
    let columns = 1;
    while (columns < groups) columns *= 2;
    const counts = new Uint16Array(columns * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x += 1024) {
            yield;
            const length = Math.min(1024, width - x) * 4;
            const bytes = yield { position: (y * width + x) * 4, length };
            if (!bytes || bytes.length !== length) throw new Error("Truncated deskew pixels");
            for (let i = 0; i < length; i += 4) {
                if (bytes[i]! < threshold || bytes[i + 1]! < threshold || bytes[i + 2]! < threshold)
                    counts[y * columns + Math.floor((x + i / 4) / 8)]!++;
            }
        }
    }
    const projection = new Float64Array(2 * columns - 1);
    for (const sign of [-1, 1]) {
        let p = new Uint16Array(counts.length), q = new Uint16Array(counts.length);
        for (let y = 0; y < height; y++) {
            yield;
            for (let x = 0; x < groups; x++) p[y * columns + x] = counts[y * columns + (sign < 0 ? groups - x - 1 : x)]!;
        }
        for (let step = 1; step < columns; step *= 2) {
            for (let x = 0; x < columns; x += 2 * step) {
                for (let i = 0; i < step; i++) {
                    for (let y = 0; y < height; y++) {
                        if (y % 1024 === 0) yield;
                        const value = p[y * columns + x + i]!;
                        q[y * columns + x + 2 * i] = value + (y + i < height ? p[(y + i) * columns + x + i + step]! : 0);
                        q[y * columns + x + 2 * i + 1] = value + (y + i + 1 < height ? p[(y + i + 1) * columns + x + i + step]! : 0);
                    }
                }
            }
            [p, q] = [q, p];
        }
        for (let x = 0; x < columns; x++) {
            let sum = 0;
            for (let y = 0; y < height - 1; y++) {
                if (y % 1024 === 0) yield;
                const delta = p[y * columns + x]! - p[(y + 1) * columns + x]!;
                sum += delta * delta;
            }
            projection[columns + sign * x - 1] = sum;
        }
    }
    let max = 0, skew = 0;
    for (let i = 0; i < projection.length; i++) {
        if (i % 1024 === 0) yield;
        if (projection[i]! > max) { max = projection[i]!; skew = i - columns + 1; }
    }
    return -Math.atan(skew / columns / 8);
}

export function* deskewAngleSteps(image: Pick<RgbaImage, "width" | "height" | "data" | "data16" | "hueSamples" | "evaluateSamples"> & Partial<Pick<RgbaImage, "space">>, spec: string): Generator<void, number, void> {
    // Native deskew tests C, M and Y in CMYK; K and alpha do not enter the projection.
    const inks = image.space === "cmyk" ? image.hueSamples : undefined;
    const data = inks ?? image.evaluateSamples ?? image.data16 ?? image.data;
    const steps = deskewAngle(image.width, image.height, spec, inks ? 1 : !image.evaluateSamples && image.data16 ? 65535 : 255);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { yield; next = steps.next(); }
        else { const { position, length } = next.value; next = steps.next(data.subarray(position, position + length)); }
    }
    return next.value;
}

export async function storedDeskewAngle(image: StoredRgbaImage, storage: ImageByteStorage, spec: string, signal: AbortSignal): Promise<number> {
    const inks = image.space === "cmyk" ? image.storedHueSamples : undefined;
    const evaluate = image.storedEvaluateSamples !== undefined;
    const sampleBytes = inks !== undefined || evaluate ? 8 : image.storedData16 ? 2 : 1;
    const position = inks ?? image.storedEvaluateSamples ?? image.storedData16?.position ?? image.position;
    const steps = deskewAngle(image.width, image.height, spec, inks !== undefined ? 1 : !evaluate && image.storedData16 ? 65535 : 255);
    let next = steps.next();
    while (!next.done) {
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position: offset, length } = next.value;
            const bytes = await storage.read(position + offset * sampleBytes, length * sampleBytes, { signal });
            if (bytes.length !== length * sampleBytes) throw new Error("Truncated deskew pixels");
            next = steps.next(inks !== undefined || evaluate ? new Float64Array(new Uint8Array(bytes).buffer)
                : image.storedData16 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    return next.value;
}

export function deskewPlan(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "properties" | "virtualCanvas">, radians: number, background: RgbaColor, pointFilter = false, interpolation: WarpPlan["interpolation"] = "bilinear") {
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const page = image.virtualCanvas;
    const left = page?.x ?? 0, top = page?.y ?? 0;
    const corners = [left, left + image.width].flatMap(x => [top, top + image.height].map(y => [x * cos - y * sin - 0.5, x * sin + y * cos - 0.5]));
    const x = Math.floor(Math.min(...corners.map(p => p[0]!))), y = Math.floor(Math.min(...corners.map(p => p[1]!)));
    const width = Math.ceil(Math.max(...corners.map(p => p[0]!))) - x + 1, height = Math.ceil(Math.max(...corners.map(p => p[1]!))) - y + 1;
    const degrees = radians * 180 / Math.PI;
    // Native affine distortion scales the original page when cloning the raster.
    const canvasWidth = page?.width ? Math.round(width / image.width * page.width) : width;
    const canvasHeight = page?.height ? Math.round(height / image.height * page.height) : height;
    return { width, height, hasAlpha: image.hasAlpha || background.a < 255, virtualCanvas: { width: canvasWidth, height: canvasHeight, x, y },
        properties: { ...image.properties, "artifact:deskew:angle": Object.is(degrees, -0) ? "-0" : degrees.toPrecision(17) },
        // Point disables elliptical filtering and uses the selected interpolation method.
        ...(pointFilter ? { interpolation } : { derivatives: () => [cos, sin, -sin, cos] as const }),
        map: (px, py) => [(px + x + 0.5) * cos + (py + y + 0.5) * sin - left - 0.5, -(px + x + 0.5) * sin + (py + y + 0.5) * cos - top - 0.5] } satisfies WarpPlan & Pick<RgbaImage, "properties">;
}

// Numeric true samples the border before rotation; textual true keeps the
// configured background. Native sampling advances only for selected pixels.
export function deskewBackground(image: Pick<RgbaImage, "width" | "hasAlpha">, background: RgbaColor, borders: readonly Uint8Array[]): RgbaColor {
    const sums = [0, 0, 0, 0];
    let count = 0;
    for (const pixels of borders) {
        if (pixels.length !== Math.min(2, image.width) * 4) throw new Error("Truncated deskew background pixels");
        for (let i = 0; i < pixels.length; i += 4) {
            for (let c = 0; c < 4; c++) sums[c]! += pixels[i + c]!;
            count++;
        }
    }
    return { r: sums[0]! / count, g: sums[1]! / count, b: sums[2]! / count, a: image.hasAlpha ? sums[3]! / count : background.a };
}
