import { sha256 } from "@noble/hashes/sha2.js";
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
export function* sketchPixelSteps(image: { width: number; height: number; hasAlpha: boolean }, geometry: { width?: number; height?: number; x?: number }, seed: number): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 1), angle = geometry.x ?? 0;
    if (![radius, sigma, angle].every(Number.isFinite) || radius < 0 || radius > 5000) throw new Error("Invalid sketch geometry");
    const width = image.width * 2, height = image.height * 2, size = width * height;
    const key = new DataView(new ArrayBuffer(8));
    key.setBigUint64(0, BigInt(seed), true);
    const digest = sha256(new Uint8Array(key.buffer)), view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
    let a = view.getBigUint64(0, true), b = view.getBigUint64(8, true), c = view.getBigUint64(16, true), d = view.getBigUint64(24, true);
    let values = new Float64Array(size), scratch = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        if (i % 1024 === 0) yield;
        values[i] = Number(BigInt.asUintN(64, a + d) >> 11n) / 9007199254740991;
        const shifted = BigInt.asUintN(64, b << 17n);
        c ^= a; d ^= b; b ^= c; a ^= d; c ^= shifted;
        d = BigInt.asUintN(64, d << 45n) | (d >> 19n);
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
            sum += weights[k]! * value * (image.hasAlpha ? value : 1); alpha += weights[k]! * value;
        }
        scratch[y * width + x] = image.hasAlpha ? sum / Math.max(1e-12, alpha) : sum;
    }
    [values, scratch] = [scratch, values];
    const edgeWidth = kernelWidth(radius, 0.5), half = (edgeWidth - 1) / 2, histogram = new Uint32Array(65536);
    // Separable sliding box sum avoids a quadratic radius cost for the edge kernel.
    for (let y = 0; y < height; y++) {
        yield;
        let sum = 0;
        for (let k = -half; k <= half; k++) sum += values[y * width + Math.max(0, Math.min(width - 1, k))]!;
        for (let x = 0; x < width; x++) {
            if (x % 1024 === 0) yield;
            scratch[y * width + x] = sum;
            sum += values[y * width + Math.min(width - 1, x + half + 1)]! - values[y * width + Math.max(0, x - half)]!;
        }
    }
    for (let x = 0; x < width; x++) {
        yield;
        let sum = 0;
        for (let k = -half; k <= half; k++) sum += scratch[Math.max(0, Math.min(height - 1, k)) * width + x]!;
        for (let y = 0; y < height; y++) {
            if (y % 1024 === 0) yield;
            const edge = edgeWidth * edgeWidth * values[y * width + x]! - sum;
            const bin = Math.round(Math.max(0, Math.min(1, edge)) * 65535);
            values[y * width + x] = bin; histogram[bin]!++;
            sum += scratch[Math.min(height - 1, y + half + 1) * width + x]! - scratch[Math.max(0, y - half) * width + x]!;
        }
    }
    let low = 0, high = 65535, count = 0;
    for (; low < 65535; low++) { count += histogram[low]!; if (count > size * 0.02) break; }
    count = 0;
    for (; high > 0; high--) { count += histogram[high]!; if (count > size * 0.01) break; }
    for (let i = 0; i < size; i++) { if (i % 1024 === 0) yield; values[i] = 1 - Math.max(0, Math.min(1, high === low ? values[i]! / 65535 : (values[i]! - low) / (high - low))); }
    // Native 50% resize uses a separable Lanczos filter, retaining HDRI precision.
    const sinc = (x: number): number => Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    for (let y = 0; y < height; y++) for (let x = 0; x < image.width; x++) {
        if (x % 1024 === 0) yield;
        const center = x * 2 + 0.5;
        let sum = 0, weight = 0;
        for (let sx = Math.max(0, Math.ceil(center - 6)); sx <= Math.min(width - 1, Math.floor(center + 6)); sx++) { const distance = (sx - center) / 2, w = sinc(distance) * sinc(distance / 3); sum += values[y * width + sx]! * w; weight += w; }
        scratch[y * image.width + x] = sum / weight;
    }
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left), position = (y * image.width + left) * 4;
        const bytes = yield { kind: "read", position, length: count * 4 };
        if (!bytes || bytes.length !== count * 4) throw new Error("Truncated sketch pixels");
        const data = new Uint8Array(bytes);
        for (let x = 0; x < count; x++) {
            const center = y * 2 + 0.5;
            let sum = 0, weight = 0;
            for (let sy = Math.max(0, Math.ceil(center - 6)); sy <= Math.min(height - 1, Math.floor(center + 6)); sy++) { const distance = (sy - center) / 2, w = sinc(distance) * sinc(distance / 3); sum += scratch[sy * image.width + left + x]! * w; weight += w; }
            const dodge = Math.max(0, Math.min(1, sum / weight));
            for (let channel = 0; channel < 3; channel++) { const original = bytes[x * 4 + channel]! / 255; const color = dodge >= 1 ? 1 : Math.min(1, original / Math.max(1e-12, 1 - dodge)); data[x * 4 + channel] = Math.round(255 * color); }
        }
        yield { kind: "write", position, data };
    }
}
