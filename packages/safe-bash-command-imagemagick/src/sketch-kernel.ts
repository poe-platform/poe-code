import { createMagickRandom } from "./random.js";
import type { ConvolveRequest } from "./convolve-kernel.js";

function kernelWidth(radius: number, sigma: number): number {
    if (radius > 0) return 2 * Math.ceil(radius) + 1;
    if (sigma < 1e-12) return 3;
    let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
    for (let half = 2; half <= 5000; half++) {
        const edge = Math.exp(-half * half / (2 * sigma * sigma));
        sum += 2 * edge;
        if (edge / sum < 1 / 65535) return half * 2 - 1;
    }
    throw new Error("Sketch radius exceeds 5000");
}

/** ImageMagick's noise, directional blur, edge, normalize and color-dodge sketch. */
export function* sketchPixelSteps(image: { width: number; height: number; hasAlpha: boolean; inactiveAlpha?: boolean | undefined; alphaBlend?: boolean | undefined; alphaSeparate?: boolean | undefined }, geometry: { width?: number; height?: number; x?: number }, seed: bigint): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1), angle = geometry.x ?? 0;
    if (![radius, sigma, angle].every(Number.isFinite) || radius < 0 || radius > 5000) throw new Error("Invalid sketch geometry");
    const width = image.width * 2, height = image.height * 2, size = width * height;
    const hasAlpha = image.hasAlpha || image.inactiveAlpha === true && image.alphaBlend !== false;
    const copyAlpha = hasAlpha && !image.hasAlpha && image.alphaSeparate !== true;
    const alphas = hasAlpha ? new Float64Array(size) : undefined;
    const alphaScratch = hasAlpha ? new Float64Array(size) : undefined;
    const random = createMagickRandom(seed);
    let values = new Float64Array(size), scratch = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        if (i % 1024 === 0) yield;
        values[i] = random();
    }
    const length = kernelWidth(radius, sigma), weights = new Float64Array(length);
    let total = 0;
    for (let k = 0; k < length; k++) { weights[k] = sigma < 1e-12 ? (k === 0 ? 1 : 0) : Math.exp(-k * k / (2 * sigma * sigma)); total += weights[k]!; }
    const dx = new Int32Array(length), dy = new Int32Array(length);
    for (let k = 0; k < length; k++) { weights[k]! /= total; dx[k] = Math.ceil(k * Math.cos(angle * Math.PI / 180) - 0.5); dy[k] = Math.ceil(k * Math.sin(angle * Math.PI / 180) - 0.5); }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (x % 256 === 0) yield;
        let sum = 0, alpha = 0;
        for (let k = 0; k < length; k++) {
            const value = values[Math.max(0, Math.min(height - 1, y + dy[k]!)) * width + Math.max(0, Math.min(width - 1, x + dx[k]!))]!;
            sum += weights[k]! * value * (hasAlpha ? value : 1); alpha += weights[k]! * value;
        }
        scratch[y * width + x] = hasAlpha ? sum / Math.max(1e-12, alpha) : sum;
        if (alphas) alphas[y * width + x] = copyAlpha ? values[y * width + x]! : alpha;
    }
    [values, scratch] = [scratch, values];
    const edgeWidth = kernelWidth(radius, 0.5), half = (edgeWidth - 1) / 2, histogram = new Uint32Array(65536);
    // Edge convolution premultiplies only active alpha; inactive alpha still
    // participates in motion blur, resize and compositing.
    for (let y = 0; y < height; y++) {
        yield;
        let sum = 0, alphaSum = 0;
        for (let k = -half; k <= half; k++) {
            const i = y * width + Math.max(0, Math.min(width - 1, k));
            sum += values[i]! * (image.hasAlpha ? alphas![i]! : 1);
            alphaSum += alphas?.[i] ?? 0;
        }
        for (let x = 0; x < width; x++) {
            if (x % 1024 === 0) yield;
            scratch[y * width + x] = sum;
            if (alphaScratch) alphaScratch[y * width + x] = alphaSum;
            const incoming = y * width + Math.min(width - 1, x + half + 1), outgoing = y * width + Math.max(0, x - half);
            sum += values[incoming]! * (image.hasAlpha ? alphas![incoming]! : 1) - values[outgoing]! * (image.hasAlpha ? alphas![outgoing]! : 1);
            alphaSum += (alphas?.[incoming] ?? 0) - (alphas?.[outgoing] ?? 0);
        }
    }
    for (let x = 0; x < width; x++) {
        yield;
        let sum = 0, alphaSum = 0;
        for (let k = -half; k <= half; k++) {
            const i = Math.max(0, Math.min(height - 1, k)) * width + x;
            sum += scratch[i]!;
            alphaSum += alphaScratch?.[i] ?? 0;
        }
        for (let y = 0; y < height; y++) {
            if (y % 1024 === 0) yield;
            const i = y * width + x;
            const alpha = alphas ? edgeWidth * edgeWidth * alphas[i]! - alphaSum : 1;
            const divisor = image.hasAlpha ? alpha : 1;
            const edge = (edgeWidth * edgeWidth * values[i]! * (image.hasAlpha ? alphas![i]! : 1) - sum) / (Math.abs(divisor) < 1e-12 ? (divisor < 0 ? -1e-12 : 1e-12) : divisor);
            const bin = Math.round(Math.max(0, Math.min(1, edge)) * 65535);
            values[i] = bin; histogram[bin]!++;
            if (alphas && !copyAlpha) alphas[i] = Math.round(Math.max(0, Math.min(1, alpha)) * 65535);
            const incoming = Math.min(height - 1, y + half + 1) * width + x, outgoing = Math.max(0, y - half) * width + x;
            sum += scratch[incoming]! - scratch[outgoing]!;
            alphaSum += (alphaScratch?.[incoming] ?? 0) - (alphaScratch?.[outgoing] ?? 0);
        }
    }
    let low = 0, high = 65535, count = 0;
    for (; low < 65535; low++) { count += histogram[low]!; if (count > size * 0.02) break; }
    count = 0;
    for (; high > 0; high--) { count += histogram[high]!; if (count > size * 0.01) break; }
    for (let i = 0; i < size; i++) {
        if (i % 1024 === 0) yield;
        values[i] = 1 - Math.max(0, Math.min(1, high === low ? values[i]! / 65535 : (values[i]! - low) / (high - low)));
        if (alphas && !copyAlpha) alphas[i] = 1 - Math.max(0, Math.min(1, high === low ? alphas[i]! / 65535 : (alphas[i]! - low) / (high - low)));
    }
    // Native 50% resize filters vertically first; alpha selects Mitchell instead of Lanczos.
    const sinc = (x: number): number => Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const filter = (x: number): number => {
        x = Math.abs(x);
        if (!hasAlpha) return sinc(x) * sinc(x / 3);
        return x < 1 ? (7 * x * x * x - 12 * x * x + 16 / 3) / 6 : x < 2 ? (-7 / 3 * x * x * x + 12 * x * x - 20 * x + 32 / 3) / 6 : 0;
    };
    const support = hasAlpha ? 4 : 6;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
        if (x % 1024 === 0) yield;
        const center = y * 2 + 0.5;
        let sum = 0, weight = 0, alpha = 0;
        for (let sy = Math.max(0, Math.ceil(center - support)); sy <= Math.min(height - 1, Math.floor(center + support)); sy++) {
            const w = filter((sy - center) / 2), i = sy * width + x;
            sum += values[i]! * w * (alphas?.[i] ?? 1);
            alpha += w * (alphas?.[i] ?? 1); weight += w;
        }
        scratch[y * width + x] = sum / (Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha);
        if (alphaScratch) alphaScratch[y * width + x] = copyAlpha ? alphas![Math.min(height - 1, y * 2 + 1) * width + x]! : alpha / weight;
    }
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left), position = (y * image.width + left) * 4;
        const bytes = yield { kind: "read", position, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated sketch pixels");
        const data = new Uint8Array(bytes);
        for (let x = 0; x < count; x++) {
            const center = (left + x) * 2 + 0.5;
            let sum = 0, weight = 0, alpha = 0;
            for (let sx = Math.max(0, Math.ceil(center - support)); sx <= Math.min(width - 1, Math.floor(center + support)); sx++) {
                const w = filter((sx - center) / 2), i = y * width + sx;
                sum += scratch[i]! * w * (alphaScratch?.[i] ?? 1);
                alpha += w * (alphaScratch?.[i] ?? 1); weight += w;
            }
            // Keep resize overshoot until compositing; native clamps each composite result.
            const sourceColor = sum / (Math.abs(alpha) < 1e-12 ? (alpha < 0 ? -1e-12 : 1e-12) : alpha);
            const dodge = alpha > 0 ? Math.max(0, Math.min(1, sourceColor)) : 0;
            const sourceAlpha = copyAlpha ? alphaScratch![y * width + Math.min(width - 1, (left + x) * 2 + 1)]! : alpha / weight;
            const originalAlpha = hasAlpha ? bytes[x * 4 + 3]! / 255 : 1;
            const dodgeAlpha = Math.max(0, Math.min(1, sourceAlpha + originalAlpha - sourceAlpha * originalAlpha));
            // Sketch's final Blend adds the original when it has an alpha channel.
            const blendAlpha = image.hasAlpha ? originalAlpha : 0;
            const outputAlpha = Math.max(0, Math.min(1, blendAlpha + (copyAlpha ? originalAlpha : dodgeAlpha)));
            for (let channel = 0; channel < 3; channel++) {
                const original = bytes[x * 4 + channel]! / 255;
                const color = dodge >= 1 ? 1 : Math.min(1, original / Math.max(1e-12, 1 - dodge));
                const premultiplied = sourceAlpha * originalAlpha * color + sourceAlpha * (1 - originalAlpha) * sourceColor + originalAlpha * (1 - sourceAlpha) * original;
                const dodgeColor = Math.max(0, Math.min(1, premultiplied / Math.max(1e-12, dodgeAlpha)));
                data[x * 4 + channel] = Math.round(255 * Math.max(0, Math.min(1, (blendAlpha * original + (copyAlpha ? originalAlpha : dodgeAlpha) * dodgeColor) / Math.max(1e-12, outputAlpha))));
            }
            if (!copyAlpha) data[x * 4 + 3] = Math.round(255 * outputAlpha);
        }
        yield { kind: "write", position, data };
    }
}
