import type { ConvolveRequest } from "./convolve-kernel.js";

/** Canny smoothing, directional suppression and connected hysteresis edges. */
export function* cannyPixelSteps(image: { width: number; height: number }, spec: string): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
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
    let values = new Float64Array(size), scratch = new Float64Array(size);
    for (let position = 0; position < size; position += 1024) {
        yield;
        const count = Math.min(1024, size - position);
        const bytes = yield { kind: "read", position: position * 4, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated Canny pixels");
        for (let i = 0; i < count; i++) values[position + i] = 0.212656 * bytes[i * 4]! + 0.715158 * bytes[i * 4 + 1]! + 0.072186 * bytes[i * 4 + 2]!;
    }
    for (const vertical of [false, true]) {
        for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
            yield;
            for (let x = left; x < Math.min(width, left + 1024); x++) {
                let sum = 0;
                for (let k = -half; k <= half; k++) {
                    const sx = vertical ? x : Math.max(0, Math.min(width - 1, x + k));
                    const sy = vertical ? Math.max(0, Math.min(height - 1, y + k)) : y;
                    sum += values[sy * width + sx]! * weights[k + half]!;
                }
                scratch[y * width + x] = sum;
            }
        }
        [values, scratch] = [scratch, values];
    }
    const directions = new Uint8Array(size);
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        for (let x = left; x < Math.min(width, left + 1024); x++) {
            const i = y * width + x, right = Math.min(width - 1, x + 1), bottom = Math.min(height - 1, y + 1);
            const a = values[i]!, b = values[y * width + right]!, c = values[bottom * width + x]!, d = values[bottom * width + right]!;
            const dx = (b - a + d - c) / 2, dy = (a + b - c - d) / 2;
            scratch[i] = Math.hypot(dx, dy);
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
