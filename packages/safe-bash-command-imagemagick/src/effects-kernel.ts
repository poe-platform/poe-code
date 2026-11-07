import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
export interface ShadowLayout {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly opacity: number;
}
export function* shadowPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, layout: ShadowLayout, color: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    for (let y = 0; y < layout.height; y++) for (let left = 0; left < layout.width; left += 1024) {
        yield;
        const count = Math.min(1024, layout.width - left), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4), sy = y - layout.offsetY;
        const first = Math.max(left, layout.offsetX), end = Math.min(left + count, layout.offsetX + source.width);
        if (sy >= 0 && sy < source.height && end > first) {
            const length = (end - first) * 4;
            const bytes = yield { kind: "read", highDepth, position: (sy * source.width + first - layout.offsetX) * 4, length };
            if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated shadow pixels");
            const samples = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            for (let x = first; x < end; x++) {
                const offset = (x - left) * 4;
                data[offset] = Math.round(color.r * scale); data[offset + 1] = Math.round(color.g * scale); data[offset + 2] = Math.round(color.b * scale);
                const value = samples[(x - first) * 4 + 3]! * layout.opacity;
                data[offset + 3] = Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : 0;
            }
        }
        yield { kind: "write", highDepth, position: (y * layout.width + left) * 4, data: new Uint8Array(data.buffer) };
    }
}
export function* vignettePixelSteps(source: { width: number; height: number }, background: RgbaColor,
    geometry: { width?: number; height?: number; x: number; y: number; hasOffset: boolean; isPercent: boolean }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = source, cx = width / 2, cy = height / 2;
    const insetX = geometry.hasOffset ? geometry.x : width * 0.1, insetY = geometry.hasOffset ? geometry.y : height * 0.1;
    const rx = cx - Math.ceil(insetX * (geometry.isPercent ? width / 100 : 1) - 0.5);
    const ry = cy - Math.ceil(insetY * (geometry.isPercent ? height / 100 : 1) - 0.5);
    const sigma = Math.abs(geometry.height ?? 1), radius = geometry.width ?? 0;
    let half = 0;
    if (sigma > 0) {
        if (radius > 0) half = radius >= 1 ? Math.floor(radius) : Math.ceil(radius);
        else {
            let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
            for (half = 2; half < 5000; half++) {
                const edge = Math.exp(-half * half / (2 * sigma * sigma));
                sum += 2 * edge;
                if (edge / sum < 1 / 65535) { half--; break; }
            }
        }
    }
    if (!Number.isFinite(half) || half > 5000) throw new Error("Vignette blur radius exceeds 5000");
    // ImageMagick's separable blur averages three Gaussian samples per tap.
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let i = -half; i <= half; i++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = -1; sub <= 1; sub++) weight += Math.exp(-((i + sub / 3) ** 2) / (2 * sigma * sigma));
        weights[i + half] = weight; total += weight;
    }
    for (let i = 0; i < weights.length; i++) weights[i]! /= total;
    const step = 1 / (8 * Math.max(rx, ry));
    const segments = Math.ceil(2 * Math.PI / step);
    const mask = (x: number, y: number): number => {
        if (rx <= 0 || ry <= 0 || x <= cx - rx - 1 || x > cx + rx + 1 || y <= cy - ry - 1 || y > cy + ry + 1) return 0;
        const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) return 1;
        // Closest point on the ellipse, followed by native fill/stroke coverage.
        let low = 0, high = Math.hypot(rx * dx, ry * dy);
        for (let i = 0; i < 32; i++) {
            const t = (low + high) / 2;
            if ((rx * dx / (t + rx * rx)) ** 2 + (ry * dy / (t + ry * ry)) ** 2 > 1) low = t;
            else high = t;
        }
        // Native drawing traces an ellipse as chords spaced by 1/(8*maxRadius).
        // Use those chords, rather than the ideal curve, for edge coverage.
        let angle = Math.atan2(ry * (y - cy) / (high + ry * ry), rx * (x - cx) / (high + rx * rx));
        if (angle < 0) angle += 2 * Math.PI;
        // Check the neighboring chords too, including the closing chord at 2π.
        const segment = Math.floor(angle / step);
        let distance = Infinity;
        for (let neighbor = segment - 1; neighbor <= segment + 1; neighbor++) {
            const i = (neighbor + segments) % segments;
            const start = i * step, end = Math.min((i + 1) * step, 2 * Math.PI);
            const ax = cx + rx * Math.cos(start), ay = cy + ry * Math.sin(start);
            const ex = cx + rx * Math.cos(end) - ax, ey = cy + ry * Math.sin(end) - ay;
            const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
            distance = Math.min(distance, Math.hypot(x - ax - t * ex, y - ay - t * ey));
        }
        const fill = distance < 1 ? (1 - distance) ** 2 : 0;
        const stroke = distance <= 0.25 ? 1 : distance < 1.25 ? (1.25 - distance) ** 2 : 0;
        return fill + stroke * (1 - fill);
    };
    for (let left = 0; left < width; left += 1024) {
        const count = Math.min(1024, width - left), rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const coverage = new Float64Array(count);
            for (let ky = -half; ky <= half; ky++) {
                yield;
                const sy = Math.max(0, Math.min(height - 1, y + ky));
                let row = rows.get(sy);
                if (!row) {
                    const samples = new Float64Array(count + half * 2);
                    for (let x = 0; x < samples.length; x++) samples[x] = mask(Math.max(0, Math.min(width - 1, left + x - half)), sy);
                    row = new Float64Array(count);
                    for (let x = 0; x < count; x++) for (let k = 0; k < weights.length; k++) row[x]! += samples[x + k]! * weights[k]!;
                    if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let x = 0; x < count; x++) coverage[x]! += row[x]! * weights[ky + half]!;
            }
            const position = (y * width + left) * 4, bytes = yield { kind: "read", position, length: count * 4 };
            if (!bytes || bytes.length !== count * 4) throw new Error("Truncated vignette pixels");
            const data = new Uint8Array(bytes);
            for (let x = 0; x < count; x++) {
                const foreground = coverage[x]!, back = (1 - foreground) * background.a / 255, alpha = foreground + back;
                for (let channel = 0; channel < 3; channel++) {
                    const color = channel === 0 ? background.r : channel === 1 ? background.g : background.b;
                    data[x * 4 + channel] = alpha === 0 ? 0 : Math.round((data[x * 4 + channel]! * foreground + color * back) / alpha);
                }
                data[x * 4 + 3] = Math.round(alpha * 255);
            }
            yield { kind: "write", position, data };
        }
    }
}

export function* raisePixelSteps(image: { width: number; height: number }, border: number, raised: boolean): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const size = image.width * image.height * 4;
    for (let position = 0; position < size; position += 16384) {
        yield;
        const data = new Uint8Array((yield { kind: "read", position, length: Math.min(16384, size - position) })!);
        for (let offset = 0; offset < data.length; offset += 4) {
            const pixel = (position + offset) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
            // ImageMagick uses stronger top/bottom blends and diagonal corner boundaries.
            let factor = 190, foreground: boolean;
            if (y < border) {
                foreground = x < image.width - y;
                if (x >= y && foreground) factor = 135;
            } else if (y >= image.height - border) {
                foreground = x < image.height - y;
                if (!foreground && x < image.width - (image.height - y)) factor = 135;
            } else {
                if (x >= border && x < image.width - border) continue;
                foreground = x < border;
            }
            const target = foreground === raised ? 255 : 0;
            for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round((data[offset + channel]! * factor + target * (255 - factor)) / 255);
        }
        yield { kind: "write", position, data };
    }
}
