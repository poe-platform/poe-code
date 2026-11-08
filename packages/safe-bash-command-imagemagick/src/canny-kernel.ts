import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Canny smoothing, directional suppression and connected hysteresis edges. */
export function* cannyPixelSteps(image: { width: number; height: number; hasAlpha: boolean }, spec: string, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, method: VirtualPixelMethod = "edge", background?: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const [blur = "0x1", low = "10", high = "30"] = spec.split("+");
    const [radiusText = "0", sigmaText = "1"] = blur.split("x");
    const radius = Number(radiusText), sigma = Math.abs(Number(sigmaText));
    const lower = Number(low.replaceAll("%", "")) / 100, upper = Number(high.replaceAll("%", "")) / 100;
    if (![radius, sigma, lower, upper].every(Number.isFinite) || radius < 0) throw new Error("Invalid Canny geometry");
    let half = 0;
    if (sigma > 0) {
        if (radius > 0) half = Math.ceil(radius);
        else {
            let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
            for (half = 2; half < 5000; half++) {
                const edge = Math.exp(-half * half / (2 * sigma * sigma));
                sum += 2 * edge;
                if (edge / sum < 1 / 65535) { half--; break; }
            }
        }
    }
    if (half >= 5000) throw new Error("Canny blur radius exceeds 5000");
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = -1; sub <= 1; sub++) weight += Math.exp(-((k + sub / 3) ** 2) / (2 * sigma * sigma));
        weights[k + half] = weight; total += weight;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    const { width, height } = image, size = width * height;
    const gray = method === "white" ? 255 : method === "gray" ? 128 : 0;
    const fill = method === "background" && background ? [background.r, background.g, background.b, background.a] : [gray, gray, gray, method === "transparent" ? 0 : 255];
    const fillIntensity = fill[0]! * 0.212656 + fill[1]! * 0.715158 + fill[2]! * 0.072186;
    const pixelIndex = (x: number, y: number): number => {
        if (x < 0 || x >= width || y < 0 || y >= height) {
            if (method === "tile" || method === "mirror") {
                const period = method === "mirror" ? 2 : 1;
                x = (x % (width * period) + width * period) % (width * period);
                y = (y % (height * period) + height * period) % (height * period);
                if (x >= width) x = width * 2 - x - 1;
                if (y >= height) y = height * 2 - y - 1;
            } else if (method === "edge") {
                x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
            } else return -1;
        }
        return y * width + x;
    };
    let values = new Float64Array(size), scratch = new Float64Array(size);
    const unfiltered = channels && !(channels.r && channels.g && channels.b) ? new Float64Array(size) : undefined;
    const coefficients = [0.212656, 0.715158, 0.072186];
    const selected = channels ? [channels.r, channels.g, channels.b] : [true, true, true];
    const planes = unfiltered ? selected.map(enabled => enabled ? new Float64Array(size) : undefined) : undefined;
    let alpha = image.hasAlpha ? new Float64Array(size) : undefined;
    let alphaScratch = image.hasAlpha ? new Float64Array(size) : undefined;
    for (let position = 0; position < size; position += 1024) {
        yield;
        const count = Math.min(1024, size - position);
        const bytes = yield { kind: "read", highDepth: true, position: position * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 8) throw new Error("Truncated Canny pixels");
        const samples = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        // Preserve sub-8-bit contrast while keeping the existing gradient scale.
        for (let i = 0; i < count; i++) for (let channel = 0; channel < 3; channel++) {
            const value = coefficients[channel]! * (samples[i * 4 + channel]! / (planes ? 1 : 257));
            if (planes?.[channel]) planes[channel]![position + i] = samples[i * 4 + channel]!;
            else if (selected[channel]) values[position + i]! += value;
            else unfiltered![position + i]! += value;
        }
        if (alpha) for (let i = 0; i < count; i++) alpha[position + i] = samples[i * 4 + 3]! / 65535;
    }
    // Opaque inputs retain the original smoothing arithmetic.
    if (fill[3] === 255 && alpha?.every(value => value === 1)) alpha = alphaScratch = undefined;
    const originalAlpha = alpha;
    for (let channel = 0; channel < (planes ? 3 : 1); channel++) {
        if (planes && !planes[channel]) continue;
        if (planes) values = planes[channel]!;
        alpha = planes ? originalAlpha?.slice() : originalAlpha;
        for (const vertical of [false, true]) {
            for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
                yield;
                for (let x = left; x < Math.min(width, left + 1024); x++) {
                    let sum = 0, coverage = 0;
                    for (let k = -half; k <= half; k++) {
                        const index = pixelIndex(vertical ? x : x + k, vertical ? y + k : y);
                        const weight = weights[k + half]! * (alpha ? index < 0 ? fill[3]! / 255 : alpha[index]! : 1);
                        sum += (index < 0 ? planes ? fill[channel]! * 257 : fillIntensity : values[index]!) * weight;
                        coverage += weight;
                    }
                    scratch[y * width + x] = alpha ? sum / (Math.abs(coverage) < 1e-12 ? 1e-12 : coverage) : sum;
                    // Native Q16-HDRI stores each smoothed channel as a float.
                    if (planes) scratch[y * width + x] = Math.fround(scratch[y * width + x]!);
                    if (alphaScratch) alphaScratch[y * width + x] = coverage;
                }
            }
            [values, scratch] = [scratch, values];
            if (!channels || channels.a) [alpha, alphaScratch] = [alphaScratch, alpha];
        }
        if (unfiltered) for (let i = 0; i < size; i++) {
            if (i % 1024 === 0) yield;
            unfiltered[i]! += coefficients[channel]! * values[i]!;
        }
    }
    // Unselected color channels bypass smoothing but still contribute to intensity.
    if (unfiltered) {
        for (let i = 0; i < size; i++) {
            if (i % 1024 === 0) yield;
            unfiltered[i] = Math.fround(unfiltered[i]!);
        }
        values = unfiltered;
    }
    const intensity = (x: number, y: number): number => {
        const index = pixelIndex(x, y);
        return index < 0 ? fillIntensity * (planes ? 257 : 1) : values[index]!;
    };
    const directions = new Uint8Array(size);
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        for (let x = left; x < Math.min(width, left + 1024); x++) {
            const i = y * width + x;
            const a = values[i]!, b = intensity(x + 1, y), c = intensity(x, y + 1), d = intensity(x + 1, y + 1);
            const dx = (b - a + d - c) / 2, dy = (a + b - c - d) / 2;
            // Ignore rounding noise where a constant virtual pixel meets the blur.
            scratch[i] = Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12 ? 0 : Math.hypot(dx, dy);
            const slope = Math.abs(dx) < 1e-12 ? Infinity : dy / dx;
            directions[i] = Math.abs(slope) > 2.41421356237 ? 0 : Math.abs(slope) < 0.414213562373 ? 2 : slope < 0 ? 1 : 3;
        }
    }
    // ImageMagick clamps gradient-cache neighbors at the image boundary.
    const magnitude = (x: number, y: number): number => scratch[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;
    let maximum = 0;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        for (let x = left; x < Math.min(width, left + 1024); x++) {
            const i = y * width + x, direction = directions[i]!;
            const dx = direction === 0 ? 0 : 1, dy = direction === 2 ? 0 : direction === 3 ? -1 : 1;
            const value = scratch[i]!;
            values[i] = value < magnitude(x - dx, y - dy) || value < magnitude(x + dx, y + dy) ? 0 : value;
            maximum = Math.max(maximum, values[i]!);
        }
    }
    // Reuse the direction buffer as the visited edge mask.
    directions.fill(0);
    const stack = new Uint32Array(size);
    let visited = 0;
    for (let seed = 0; seed < size; seed++) {
        if (seed % 1024 === 0) yield;
        if (directions[seed] || values[seed]! < upper * maximum) continue;
        directions[seed] = 255;
        stack[0] = seed;
        let end = 1;
        while (end > 0) {
            if (visited++ % 1024 === 0) yield;
            const i = stack[--end]!;
            let x = i % width, y = Math.floor(i / width);
            // Native TraceEdges moves the current point as it discovers neighbors.
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const sx = x + dx, sy = y + dy;
                if ((dx === 0 && dy === 0) || sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
                const next = sy * width + sx;
                if (!directions[next] && values[next]! >= lower * maximum) {
                    directions[next] = 255;
                    stack[end++] = next;
                    x = sx; y = sy;
                }
            }
        }
    }
    for (let position = 0; position < size; position += 1024) {
        yield;
        const count = Math.min(1024, size - position), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            data.fill(directions[position + i]!, i * 4, i * 4 + 3);
            data[i * 4 + 3] = 255;
        }
        yield { kind: "write", position: position * 4, data };
    }
}
