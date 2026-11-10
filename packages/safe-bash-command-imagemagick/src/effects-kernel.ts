import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { magickCompositeMode } from "./composite-pixels.js";
export interface ShadowLayout {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly opacity: number;
    readonly sigma: number;
}
export function* shadowPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, layout: ShadowLayout, color: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    const sigma = layout.sigma;
    let half = 0;
    if (sigma > 0) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            yield;
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / sum < 1 / 65535) { half--; break; }
        }
    }
    if (!Number.isFinite(half) || half >= 5000) throw new Error("Blur radius exceeds 5000");
    // Native's separable blur averages three Gaussian samples per tap.
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        let weight = sigma === 0 ? 1 : 0;
        if (sigma > 0) for (let sub = -1; sub <= 1; sub++) weight += Math.exp(-((k + sub / 3) ** 2) / (2 * sigma * sigma));
        weights[k + half] = weight; total += weight;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    // Keep fractional alpha through both passes; opacity is linear, so it can be
    // applied at the end without an intermediate rounded or clamped raster.
    for (let left = 0; left < layout.width; left += 1024) {
        const count = Math.min(1024, layout.width - left), rows = new Map<number, Float64Array>();
        for (let y = 0; y < layout.height; y++) {
            yield;
            const sums = new Float64Array(count);
            for (let ky = -half; ky <= half; ky++) {
                yield;
                const sy = Math.max(0, Math.min(layout.height - 1, y + ky)) - layout.offsetY;
                if (sy < 0 || sy >= source.height) continue;
                let row = rows.get(sy);
                if (!row) {
                    row = new Float64Array(count);
                    const first = Math.max(0, left - half - layout.offsetX), last = Math.min(source.width - 1, left + count - 1 + half - layout.offsetX);
                    if (last >= first) {
                        const length = (last - first + 1) * 4;
                        const bytes = yield { kind: "read", highDepth, position: (sy * source.width + first) * 4, length };
                        if (!bytes || bytes.length !== length * (highDepth ? 2 : 1)) throw new Error("Truncated shadow pixels");
                        const samples = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
                        for (let x = 0; x < count; x++) {
                            if (x % 32 === 0) yield;
                            for (let k = -half; k <= half; k++) {
                                const sx = Math.max(0, Math.min(layout.width - 1, left + x + k)) - layout.offsetX;
                                if (sx >= first && sx <= last) row[x]! += samples[(sx - first) * 4 + 3]! * weights[k + half]!;
                            }
                        }
                    }
                    if (rows.size >= 32) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let x = 0; x < count; x++) sums[x]! += row[x]! * weights[ky + half]!;
            }
            const data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
            for (let x = 0; x < count; x++) {
                const offset = x * 4, value = sums[x]! * layout.opacity;
                data[offset] = Math.round(color.r * scale); data[offset + 1] = Math.round(color.g * scale); data[offset + 2] = Math.round(color.b * scale);
                data[offset + 3] = Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : 0;
            }
            yield { kind: "write", highDepth, position: (y * layout.width + left) * 4, data: new Uint8Array(data.buffer) };
        }
    }
}

export function vignetteLayout(source: Pick<RgbaImage, "width" | "height" | "virtualCanvas">) {
    const width = source.virtualCanvas?.width || source.width, height = source.virtualCanvas?.height || source.height;
    return { width, height, hasAlpha: true, virtualCanvas: { width, height, x: 0, y: 0 } };
}
export function* vignettePixelSteps(source: Pick<RgbaImage, "width" | "height" | "virtualCanvas" | "data16" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16">>, background: RgbaColor,
    geometry: { width?: number; height?: number; x: number; y: number; hasOffset: boolean; hasYOffset: boolean; isPercent: boolean }, channels?: { r: boolean; g: boolean; b: boolean; a: boolean }, compose = "Over"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { name } = magickCompositeMode(compose);
    const copySource = ["src", "source", "copy"].includes(name), copyDestination = ["dst", "destination"].includes(name);
    const { width, height } = source, cx = width / 2, cy = height / 2;
    const insetX = geometry.hasOffset ? geometry.x : width * 0.1, insetY = geometry.hasYOffset ? geometry.y : height * 0.1;
    const rx = cx - Math.ceil(insetX * (geometry.isPercent ? width / 100 : 1) - 0.5);
    const ry = cy - Math.ceil(insetY * (geometry.isPercent ? height / 100 : 1) - 0.5);
    if (rx < 0 || ry < 0) throw new Error("non-conforming drawing primitive definition 'ellipse'");
    const canvas = vignetteLayout(source), offsetX = source.virtualCanvas?.x ?? 0, offsetY = source.virtualCanvas?.y ?? 0;
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1;
    if (source.space === "b-w" || source.space === "grey16") {
        // Native converts the canvas background to the source's gray colorspace.
        const gray = 0.212656 * background.r + 0.715158 * background.g + 0.072186 * background.b;
        background = { r: gray, g: gray, b: gray, a: background.a };
    }
    // Fill the virtual canvas, then paint only the visible portion of the vignette.
    for (let position = 0; position < canvas.width * canvas.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, canvas.width * canvas.height * 4 - position);
        const data = highDepth ? new Uint16Array(length) : new Uint8Array(length);
        for (let i = 0; i < length; i += 4) {
            data[i] = Math.round(background.r * scale); data[i + 1] = Math.round(background.g * scale);
            data[i + 2] = Math.round(background.b * scale); data[i + 3] = Math.round(background.a * scale);
        }
        yield { kind: "write", highDepth, position, data: new Uint8Array(data.buffer) };
    }
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
        if (rx <= 0 || ry <= 0 || x <= cx - rx - 1 || x > cx + rx + 1 || y <= cy - ry - 1 || y >= cy + ry + 1) return 0;
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
    for (let left = Math.max(0, -offsetX); left < Math.min(width, canvas.width - offsetX); left += 1024) {
        const count = Math.min(1024, width - left, canvas.width - offsetX - left), rows = new Map<number, Float64Array>();
        for (let y = Math.max(0, -offsetY); y < Math.min(height, canvas.height - offsetY); y++) {
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
            const position = (y * width + left) * 4, bytes = yield { kind: "read", highDepth, position, length: count * 4 };
            if (!bytes || bytes.length !== count * 4 * (highDepth ? 2 : 1)) throw new Error("Truncated vignette pixels");
            const data = highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
            for (let x = 0; x < count; x++) {
                const foreground = coverage[x]!, back = (1 - foreground) * background.a / 255, alpha = foreground + back;
                for (let channel = 0; channel < 3; channel++) {
                    const color = channel === 0 ? background.r : channel === 1 ? background.g : background.b;
                    const selected = !channels || (channel === 0 ? channels.r : channel === 1 ? channels.g : channels.b);
                    data[x * 4 + channel] = !selected || copyDestination ? Math.round(color * scale) : copySource ? data[x * 4 + channel]!
                        : alpha === 0 ? 0 : Math.round((data[x * 4 + channel]! * foreground + color * scale * back) / alpha);
                }
                data[x * 4 + 3] = Math.round(((!channels || channels.a) && !copyDestination ? (copySource ? foreground : alpha) * 255 : background.a) * scale);
            }
            yield { kind: "write", highDepth, position: ((y + offsetY) * canvas.width + left + offsetX) * 4, data: new Uint8Array(data.buffer) };
        }
    }
}

export function* raisePixelSteps(image: Pick<RgbaImage, "width" | "height" | "data16" | "hasAlpha" | "space" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">>, borderWidth: number, borderHeight: number, raised: boolean, channels: readonly boolean[]): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (2 * borderWidth >= image.width || 2 * borderHeight >= image.height) throw new Error("size must exceed bevel width");
    // Gray's three projected RGB samples share the logical red/gray channel.
    if (image.space === "b-w" || image.space === "grey16") channels = [channels[0]!, channels[0]!, channels[0]!, channels[3]!];
    const highDepth = !!(image.data16 || image.storedData16);
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const maximum = hue ? 1 : 255, quantum = 65535 / maximum;
    const size = image.width * image.height * 4;
    for (let position = 0; position < size; position += 2048) {
        yield;
        const length = Math.min(2048, size - position);
        const working = yield { kind: "read", hue, evaluate: !hue, position, length };
        const data = working?.length ? new Float64Array(working.slice().buffer)
            : Float64Array.from(highDepth ? new Uint16Array((yield { kind: "read", highDepth, position, length })!.slice().buffer)
                : (yield { kind: "read", position, length })!, value => highDepth ? value / 257 : value);
        for (let offset = 0; offset < data.length; offset += 4) {
            const pixel = (position + offset) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
            // ImageMagick uses stronger top/bottom blends and diagonal corner boundaries.
            let factor = 190, foreground: boolean;
            if (y < borderHeight) {
                foreground = x < image.width - y;
                if (x >= y && foreground) factor = 135;
            } else if (y >= image.height - borderHeight) {
                foreground = x < image.height - y;
                if (!foreground && x < image.width - (image.height - y)) factor = 135;
            } else {
                if (x >= borderWidth && x < image.width - borderWidth) continue;
                foreground = x < borderWidth;
            }
            const target = foreground === raised ? maximum : 0;
            for (let channel = 0; channel < (image.hasAlpha ? 4 : 3); channel++) if (channels[channel])
                data[offset + channel] = Math.fround((data[offset + channel]! * factor + target * (255 - factor)) / 255 * quantum) / quantum;
        }
        // Keep working values for later arithmetic; only the encoded backing is bounded.
        yield { kind: "write", hue, evaluate: !hue, position, data: new Uint8Array(data.buffer) };
        const bounded = highDepth ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(65535, value * quantum))))
            : Uint8Array.from(data, value => Math.round(Math.max(0, Math.min(255, value * 255 / maximum))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
    }
}
