import type { LookupInterpolation } from "./sequence-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";
import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { resizeFilter, type MagickResizeKernel, type ResizeFilterSettings } from "./resize-kernel.js";
export interface WarpPlan {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
    readonly nearest?: boolean;
    readonly interpolation?: LookupInterpolation;
    readonly channels?: readonly boolean[] | undefined;
    readonly virtualCanvas?: RgbaImage["virtualCanvas"];
    derivatives?(x: number, y: number): readonly [number, number, number, number];
    map(x: number, y: number): readonly [x: number, y: number, copy?: boolean];
}
export type VirtualPixelMethod = "edge" | "dither" | "background" | "transparent" | "black" | "white" | "gray" | "tile" | "mirror" | "horizontal-tile" | "vertical-tile" | "checker-tile" | "horizontal-tile-edge" | "vertical-tile-edge";

// ImageMagick's default radial Robidoux filter, indexed by squared distance.
const robidoux = Float64Array.from({ length: 1024 }, (_, i) => {
    const x = Math.sqrt(i) / 16, b = 0.3782157550939987, c = 0.3108921224530007;
    return x < 1
        ? ((12 - 9 * b - 6 * c) * x ** 3 + (-18 + 12 * b + 6 * c) * x * x + 6 - 2 * b) / 6
        : ((-b - 6 * c) * x ** 3 + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + 8 * b + 24 * c) / 6;
});

function* catromSamples(sx: number, sy: number): Generator<readonly [number, number, number]> {
    const left = Math.floor(sx), top = Math.floor(sy);
    const weights = [sx - left, sy - top].map(x => {
        const alpha = 1 - x, beta = -0.5 * x * alpha;
        const first = alpha * beta, last = x * beta, gamma = last - first;
        return [first, alpha - first + gamma, x - last - gamma, last];
    });
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        yield [left + column - 1, top + row - 1, weights[0]![column]! * weights[1]![row]!];
    }
}

function* ellipseSamples(sx: number, sy: number, [ux, uy, vx, vy]: readonly [number, number, number, number], weights: Float64Array, support: number): Generator<readonly [number, number, number] | undefined> {
    // Singular values of the inverse mapping, clamped to at least one source pixel.
    const xx = ux * ux + uy * uy, yy = vx * vx + vy * vy, xy = ux * vx + uy * vy;
    const delta = Math.hypot(xx - yy, 2 * xy), major = Math.max(1, (xx + yy + delta) / 2), minor = Math.max(1, (xx + yy - delta) / 2);
    const angle = Math.atan2(2 * xy, xx - yy) / 2, cos = Math.cos(angle), sin = Math.sin(angle);
    const a = major * sin * sin + minor * cos * cos, b = -2 * (major - minor) * cos * sin, c = major * cos * cos + minor * sin * sin;
    const f = support * support * major * minor, vLimit = Math.sqrt(a * f / (a * c - b * b / 4)), uWidth = Math.sqrt(f / a), slope = -b / (2 * a);
    if (![sx, sy, vLimit, uWidth].every(Number.isFinite) || uWidth * vLimit > 1_000_000
        || !Number.isSafeInteger(Math.ceil(Math.abs(sx) + uWidth + Math.abs(slope * vLimit)))
        || !Number.isSafeInteger(Math.ceil(Math.abs(sy) + vLimit)))
        throw new Error("Distortion sampling area exceeds limit");
    const scale = 1024 / f, A = a * scale, B = b * scale, C = c * scale;
    const firstY = Math.ceil(sy - vLimit), lastY = Math.floor(sy + vLimit), count = Math.floor(2 * uWidth) + 1;
    let left = sx + (firstY - sy) * slope - uWidth, scanned = 0;
    for (let y = firstY; y <= lastY; y++, left += slope) {
        const firstX = Math.ceil(left), u = firstX - sx, v = y - sy;
        let q = (A * u + B * v) * u + C * v * v, dq = A * (2 * u + 1) + B * v;
        for (let i = 0; i < count; i++, q += dq, dq += 2 * A) {
            if (++scanned % 1024 === 0) yield;
            const index = Math.trunc(q);
            if (index >= 0 && index < 1024) yield [firstX + i, y, weights[index]!];
        }
    }
}

function* splineSamples(x: number, y: number): Generator<readonly [number, number, number]> {
    const left = Math.floor(x), top = Math.floor(y);
    const weights = [x - left, y - top].map(delta => {
        const alpha = 1 - delta, last = delta * delta * delta / 6, first = alpha * alpha * alpha / 6;
        const beta = last - first;
        return [first, alpha - first + beta, delta - last - beta, last];
    });
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
        yield [left + column - 1, top + row - 1, weights[0]![column]! * weights[1]![row]!];
    }
}

function* averageSamples(x: number, y: number, size: number): Generator<readonly [number, number, number]> {
    // Odd footprints center on the nearest pixel; even ones straddle floor(x/y).
    const left = Math.floor(x + (size === 3 ? 0.5 : 0)) - (size > 2 ? 1 : 0);
    const top = Math.floor(y + (size === 3 ? 0.5 : 0)) - (size > 2 ? 1 : 0);
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++)
        yield [left + column, top + row, 1];
}

export function* warpPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16" | "evaluateSamples" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "space" | "storedData16" | "storedEvaluateSamples" | "storedHueSamples">> & { alphaBlend?: boolean | undefined }, plan: WarpPlan, background: RgbaColor, virtualPixel?: VirtualPixelMethod, kernel?: MagickResizeKernel, settings?: ResizeFilterSettings): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = source;
    const filter = kernel === "nearest" ? undefined : resizeFilter(kernel ?? "robidoux", settings, true);
    const blur = Math.max(1e-12, (settings?.blur ?? 1) * (kernel === "lanczos2sharp" ? 0.9549963639785485 : kernel === "lanczossharp" ? 0.9812505644269356 : 1));
    const support = filter ? filter.radius * blur : 2;
    const weights = filter ? Float64Array.from({ length: 1024 }, (_, i) => filter.weight(Math.sqrt(i / 1024) * filter.radius)) : robidoux;
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    // Hue/Lab planes hold the working channels; CMYK keeps black in the alpha slot.
    const hue = source.space !== "cmyk" && (!!source.hueSamples || source.storedHueSamples !== undefined);
    const evaluate = !!source.evaluateSamples || source.storedEvaluateSamples !== undefined;
    const cmyk = source.space === "cmyk";
    const cache = new Map<number, Float64Array>(), inkCache = new Map<number, Float64Array>();
    function* readPixel(x: number, y: number): Generator<ConvolveRequest, ArrayLike<number>, Uint8Array | undefined> {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            const index = virtualPixelIndex(x, y, width, height, virtualPixel);
            if (index >= 0) {
                x = index % width; y = Math.floor(index / width);
            } else {
                const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
                return (virtualPixel === "background" || virtualPixel?.endsWith("-tile"))
                    ? [background.r * scale, background.g * scale, background.b * scale, background.a * scale, 0]
                    : [gray * scale, gray * scale, gray * scale, virtualPixel === "transparent" ? 0 : maximum, 0];
            }
        }
        const position = (y * width + x) * 4;
        let pixel: ArrayLike<number>;
        if (hue || evaluate) {
            const page = Math.floor(position / 1024) * 1024;
            let samples = cache.get(page);
            if (!samples) {
                const length = Math.min(1024, width * height * 4 - page);
                const bytes = yield { kind: "read", hue, evaluate: !hue, position: page, length };
                if (!bytes || bytes.length !== length * 8) throw new Error("Truncated warp pixels");
                samples = new Float64Array(bytes.slice().buffer);
                if (cache.size === 32) cache.delete(cache.keys().next().value!);
                cache.set(page, samples);
            }
            pixel = samples.subarray(position - page, position - page + 4).map(value => value * (hue ? maximum : scale));
        } else {
            const bytes = yield { kind: "read", highDepth, position, length: 4 };
            if (!bytes || bytes.length !== (highDepth ? 8 : 4)) throw new Error("Truncated warp pixels");
            pixel = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
        }
        if (!cmyk) return pixel;
        const page = Math.floor(position / 1024) * 1024;
        let inks = inkCache.get(page);
        if (!inks) {
            const length = Math.min(1024, width * height * 4 - page);
            const bytes = yield { kind: "read", hue: true, position: page, length };
            if (!bytes || bytes.length !== length * 8) throw new Error("Truncated warp inks");
            inks = new Float64Array(bytes.slice().buffer);
            if (inkCache.size === 32) inkCache.delete(inkCache.keys().next().value!);
            inkCache.set(page, inks);
        }
        const offset = position - page;
        // K is independent of alpha, which remains in the RGBA backing.
        return [inks[offset]! * maximum, inks[offset + 1]! * maximum, inks[offset + 2]! * maximum, pixel[3]!, inks[offset + 3]! * maximum];
    }
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const evaluateSamples = new Float64Array(count * 4), hueSamples = cmyk ? new Float64Array(count * 4) : undefined;
        for (let i = 0; i < count; i++) {
            const px = (start + i) % plan.width, py = Math.floor((start + i) / plan.width);
            const [sx, sy, copy] = plan.map(px, py), offset = i * 4;
            if (copy) {
                const pixel = yield* readPixel(sx, sy);
                for (let c = 0; c < 4; c++) {
                    evaluateSamples[offset + c] = pixel[c]! / scale;
                    data[offset + c] = Math.max(0, Math.min(maximum, Math.round(pixel[c]!)));
                }
                if (hueSamples) hueSamples.set([pixel[0]! / maximum, pixel[1]! / maximum, pixel[2]! / maximum, pixel[4]! / maximum], offset);
                continue;
            }
            // Point resampling uses PixelInfo interpolation, whose background
            // mode returns the image background even inside the source raster.
            if (kernel === "nearest" && plan.interpolation === "background" || virtualPixel === undefined && (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5)) {
                evaluateSamples.set([background.r, background.g, background.b, background.a], offset);
                if (hueSamples) hueSamples.set([background.r / 255, background.g / 255, background.b / 255, 0], offset);
                data[offset] = background.r * scale; data[offset + 1] = background.g * scale; data[offset + 2] = background.b * scale; data[offset + 3] = background.a * scale;
                continue;
            }
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const x0 = virtualPixel ? Math.floor(sx) : Math.max(0, Math.min(width - 1, Math.floor(sx))), y0 = virtualPixel ? Math.floor(sy) : Math.max(0, Math.min(height - 1, Math.floor(sy)));
            const x1 = virtualPixel ? x0 + 1 : Math.max(0, Math.min(width - 1, x0 + 1)), y1 = virtualPixel ? y0 + 1 : Math.max(0, Math.min(height - 1, y0 + 1));
            let fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
            // Blend selects one neighbor at the edges and averages the middle half.
            if (plan.interpolation === "blend") {
                fx = fx >= 0.75 ? 1 : fx > 0.25 ? 0.5 : 0;
                fy = fy >= 0.75 ? 1 : fy > 0.25 ? 0.5 : 0;
            }
            const derivatives = plan.derivatives?.(px, py);
            // Native resampling uses an integer lookup when the entire filter
            // footprint lies beyond the raster's pixel centers.
            const outside = filter && virtualPixel === "background" && (sx + support < 0 || sy + support < 0 || sx - support > width - 1 || sy - support > height - 1);
            for (let filtered = !!derivatives && kernel !== "nearest" && !plan.nearest; ; filtered = false) {
                // Interpolation is the point-filter/fallback path, not the EWA filter.
                const interpolation = filtered ? undefined : plan.interpolation === "background" ? "bilinear" : plan.interpolation ?? "bilinear";
                const averageSize = interpolation === "average" ? 2 : interpolation === "average9" ? 3 : interpolation === "average16" ? 4 : 0;
                let meshPixels: ArrayLike<number>[] | undefined;
                let meshWeights: number[] | undefined;
                if (interpolation === "mesh") {
                    meshPixels = [yield* readPixel(x0, y0), yield* readPixel(x1, y0), yield* readPixel(x0, y1), yield* readPixel(x1, y1)];
                    const luma = meshPixels.map(pixel => 0.212656 * pixel[0]! + 0.715158 * pixel[1]! + 0.072186 * pixel[2]!);
                    // Split along the diagonal with the smaller luminance difference.
                    meshWeights = Math.abs(luma[0]! - luma[3]!) < Math.abs(luma[1]! - luma[2]!)
                        ? fx <= fy ? [1 - fy, 0, fy - fx, fx] : [1 - fx, fx - fy, 0, fy]
                        : fx <= 1 - fy ? [1 - fx - fy, fx, fy, 0] : [0, 1 - fy, 1 - fx, fx + fy - 1];
                }
                const samples: Iterable<readonly [number, number, number] | undefined> = outside ? [[Math.floor(sx), Math.floor(sy), 1]] : filtered ? ellipseSamples(sx, sy, derivatives!, weights, support) : plan.nearest || interpolation === "nearest" ? [[Math.floor(sx + 0.5), Math.floor(sy + 0.5), 1]] : interpolation === "integer" ? [[x0, y0, 1]] : averageSize ? averageSamples(sx, sy, averageSize) : interpolation === "catrom" ? catromSamples(sx, sy) : interpolation === "spline" ? splineSamples(sx, sy) : [
                    [x0, y0, meshWeights?.[0] ?? (1 - fx) * (1 - fy)], [x1, y0, meshWeights?.[1] ?? fx * (1 - fy)],
                    [x0, y1, meshWeights?.[2] ?? (1 - fx) * fy], [x1, y1, meshWeights?.[3] ?? fx * fy]
                ];
                let red = 0, green = 0, blue = 0, black = 0, alpha = 0, total = 0, colorTotal = 0;
                let sampleIndex = 0;
                for (const sample of samples) {
                    if (!sample) { yield; continue; }
                    const [x, y] = sample;
                    let weight = sample[2];
                    const pixel = meshPixels?.[sampleIndex++] ?? (yield* readPixel(x, y));
                    const opacity = source.alphaBlend === false ? maximum : pixel[3]!, unassociatedWeight = weight;
                    // Stored alpha survives even when it does not weight colors.
                    alpha += pixel[3]! * weight; total += weight;
                    // Native mesh divides unassociated colors by interpolated alpha;
                    // average excludes transparent RGB.
                    if (interpolation === "mesh") colorTotal += weight * opacity / maximum;
                    else if (averageSize || interpolation === "catrom" || interpolation === "spline") colorTotal += weight;
                    // Native Catrom and spline keep the interpolated premultiplied colors.
                    if (filtered || interpolation === "blend" || interpolation === "bilinear" || interpolation === "catrom" || interpolation === "spline") weight *= opacity / maximum;
                    else if (averageSize) weight *= Number(opacity > 0);
                    red += pixel[0]! * (plan.channels?.[0] === false ? unassociatedWeight : weight);
                    green += pixel[1]! * (plan.channels?.[1] === false ? unassociatedWeight : weight);
                    blue += pixel[2]! * (plan.channels?.[2] === false ? unassociatedWeight : weight);
                    if (cmyk) black += pixel[4]! * weight;
                    if (interpolation !== "mesh" && !averageSize && interpolation !== "catrom" && interpolation !== "spline") colorTotal += weight;
                }
                // Native EWA falls back to interpolation for nonpositive filter coverage.
                if (filtered && (total <= 1e-12 || colorTotal <= 1e-12)) continue;
                const colorScale = 1 / Math.max(1e-12, colorTotal), alphaScale = 1 / total;
                // Unselected colors are still interpolated, but without alpha weighting.
                const values = [red, green, blue].map((value, channel) => value * (plan.channels?.[channel] === false ? alphaScale : colorScale));
                values.push(alpha * alphaScale);
                // Q16-HDRI stores float32 quantum samples before output-depth rounding.
                const quantumScale = highDepth ? 1 : 257;
                for (let c = 0; c < 4; c++) {
                    const quantum = Math.fround(values[c]! * quantumScale);
                    evaluateSamples[offset + c] = quantum / 257;
                    data[offset + c] = Math.max(0, Math.min(maximum, Math.round(quantum / quantumScale)));
                }
                if (hueSamples) hueSamples.set([
                    ...values.slice(0, 3).map(value => Math.fround(value * quantumScale) / 65535),
                    Math.fround(black * colorScale * quantumScale) / 65535
                ], offset);
                break;
            }
        }
        if (hueSamples) {
            for (let offset = 0; offset < data.length; offset += 4) for (let channel = 0; channel < 3; channel++) {
                const value = Math.fround((1 - hueSamples[offset + channel]!) * (1 - hueSamples[offset + 3]!) * 65535);
                evaluateSamples[offset + channel] = value / 257;
                data[offset + channel] = Math.max(0, Math.min(maximum, Math.round(value / (highDepth ? 1 : 257))));
            }
            yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(hueSamples.buffer) };
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(evaluateSamples.buffer) };
        if (hue) yield { kind: "write", hue: true, position: start * 4, data: new Uint8Array(evaluateSamples.map(value => value / 255).buffer) };
    }
}
