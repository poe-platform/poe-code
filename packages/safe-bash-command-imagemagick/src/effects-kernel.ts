import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { rgbToCmyk } from "./colorspace-cmyk.js";
import { magickCompositeMode } from "./composite-pixels.js";
import { regionContains, type Region } from "./region.js";
export interface ShadowLayout {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly opacity: number;
    readonly sigma: number;
}
export function* shadowPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16" | "hasAlpha" | "space"> & Partial<Pick<StoredRgbaImage, "storedData16">>, layout: ShadowLayout, color: RgbaColor, alpha = true): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    // Native assigns the background components directly to C, M and Y, with K zero.
    const inks = source.space === "cmyk" ? [color.r / 255, color.g / 255, color.b / 255, 0] : undefined;
    if (inks) color = { ...color, r: 255 - color.r, g: 255 - color.g, b: 255 - color.b };
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
            // Native leaves the shadow transparent when alpha is not selected.
            for (let ky = -half; alpha && ky <= half; ky++) {
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
                                if (sx >= first && sx <= last) row[x]! += (source.hasAlpha ? samples[(sx - first) * 4 + 3]! : maximum) * weights[k + half]!;
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
            if (inks) {
                const samples = new Float64Array(count * 4);
                for (let x = 0; x < count; x++) samples.set(inks, x * 4);
                yield { kind: "write", hue: true, position: (y * layout.width + left) * 4, data: new Uint8Array(samples.buffer) };
            }
        }
    }
}

export function vignetteLayout(source: Pick<RgbaImage, "width" | "height" | "virtualCanvas">) {
    const width = source.virtualCanvas?.width || source.width, height = source.virtualCanvas?.height || source.height;
    return { width, height, hasAlpha: true, virtualCanvas: { width, height, x: 0, y: 0 } };
}
export function* vignettePixelSteps(source: Pick<RgbaImage, "width" | "height" | "virtualCanvas" | "data16" | "space" | "hasAlpha" | "hueSamples"> & Partial<Pick<StoredRgbaImage, "storedData16" | "storedHueSamples">> & { region?: Region | undefined }, background: RgbaColor,
    geometry: { width?: number; height?: number; x: number; y: number; hasOffset: boolean; hasYOffset: boolean; isPercent: boolean }, channels?: { r: boolean; g: boolean; b: boolean; a: boolean; k?: boolean }, compose = "Over"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { name } = magickCompositeMode(compose);
    const sourceIn = name === "srcin" || name === "in", destinationOut = name === "dstout" || name === "destout";
    const copySource = ["src", "source", "copy"].includes(name), copyDestination = ["dst", "destination"].includes(name);
    const blend = name === "multiply" || name === "screen" || name === "difference";
    const copyAlpha = name === "copyalpha" || name === "copyopacity";
    const { width, height } = source, cx = width / 2, cy = height / 2;
    const insetX = geometry.hasOffset ? geometry.x : width * 0.1, insetY = geometry.hasYOffset ? geometry.y : height * 0.1;
    const rx = cx - Math.ceil(insetX * (geometry.isPercent ? width / 100 : 1) - 0.5);
    const ry = cy - Math.ceil(insetY * (geometry.isPercent ? height / 100 : 1) - 0.5);
    if (rx < 0 || ry < 0) throw new Error("non-conforming drawing primitive definition 'ellipse'");
    const canvas = vignetteLayout(source), offsetX = source.virtualCanvas?.x ?? 0, offsetY = source.virtualCanvas?.y ?? 0;
    const highDepth = !!(source.data16 || source.storedData16);
    const hue = source.space !== "cmyk" && (!!source.hueSamples || source.storedHueSamples !== undefined);
    const scale = hue ? 1 / 255 : highDepth ? 257 : 1;
    const quantum = (value: number) => hue ? Math.fround(value * 65535) / 65535 : Math.round(value);
    if (source.space === "b-w" || source.space === "grey16") {
        // Native converts the canvas background to the source's gray colorspace.
        const gray = 0.212656 * background.r + 0.715158 * background.g + 0.072186 * background.b;
        background = { r: gray, g: gray, b: gray, a: background.a };
    }
    let backgroundInks: number[] | undefined;
    if (source.space === "cmyk") {
        // Native conforms the canvas background through linear RGB to CMYK.
        const rgb = [background.r, background.g, background.b].map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        backgroundInks = rgbToCmyk(rgb[0]!, rgb[1]!, rgb[2]!);
        background = { r: rgb[0]! * 255, g: rgb[1]! * 255, b: rgb[2]! * 255, a: background.a };
    }
    // Fill the virtual canvas, then paint only the visible portion of the vignette.
    for (let position = 0; position < canvas.width * canvas.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, canvas.width * canvas.height * 4 - position);
        const data = hue ? new Float64Array(length) : highDepth ? new Uint16Array(length) : new Uint8Array(length);
        for (let i = 0; i < length; i += 4) {
            for (const [channel, value] of [background.r, background.g, background.b, background.a].entries())
                data[i + channel] = hue ? value / 255 : Math.round(value * scale);
        }
        if (hue) yield { kind: "write", hue: true, position, data: new Uint8Array(data.buffer) };
        const bounded = hue ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(1, value)) * 65535)) : data;
        yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
        if (backgroundInks) {
            const inks = new Float64Array(length);
            for (let i = 0; i < length; i += 4) inks.set(backgroundInks, i);
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        }
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
            const position = (y * width + left) * 4, bytes = yield { kind: "read", hue, highDepth, position, length: count * 4 };
            if (!bytes || bytes.length !== count * 4 * (hue ? 8 : highDepth ? 2 : 1)) throw new Error("Truncated vignette pixels");
            const data = hue ? new Float64Array(bytes.slice().buffer) : highDepth ? new Uint16Array(bytes.slice().buffer) : new Uint8Array(bytes);
            const inkBytes = backgroundInks ? yield { kind: "read", hue: true, position, length: count * 4 } : undefined;
            const inks = inkBytes?.length ? new Float64Array(inkBytes.slice().buffer) : backgroundInks ? new Float64Array(count * 4) : undefined;
            if (inks && !inkBytes?.length) for (let i = 0; i < data.length; i += 4)
                inks.set(rgbToCmyk(data[i]! / (255 * scale), data[i + 1]! / (255 * scale), data[i + 2]! / (255 * scale)), i);
            const samples = inks ?? data, pixelScale = inks ? 1 / 255 : scale;
            const round = inks ? (value: number) => Math.fround(value * 65535) / 65535 : quantum;
            for (let x = 0; x < count; x++) {
                const protectedPixel = source.region && !regionContains(source.region, left + x, y);
                // Intensity compositing clips RGB and restores the original alpha before flattening.
                // Activating a previously absent alpha channel initializes it to transparent.
                const sourceAlpha = source.hasAlpha ? data[x * 4 + 3]! / (255 * scale) : 0;
                const foreground = protectedPixel ? sourceAlpha : coverage[x]!;
                const intensity = protectedPixel ? sourceAlpha + coverage[x]! * (1 - sourceAlpha) : 1;
                const back = (name === "plus" ? 1 : 1 - foreground) * background.a / 255;
                const alpha = sourceIn ? foreground * background.a / 255 : destinationOut ? back : Math.min(1, foreground + back);
                for (let channel = 0; channel < (inks ? 4 : 3); channel++) {
                    const color = backgroundInks ? backgroundInks[channel]! * 255 : channel === 0 ? background.r : channel === 1 ? background.g : background.b;
                    const selected = !channels || (channel === 0 ? channels.r : channel === 1 ? channels.g : channel === 2 ? channels.b : channels.k);
                    const sourceColor = protectedPixel ? Math.fround(samples[x * 4 + channel]! / pixelScale * intensity * 257) / 257 * pixelScale : samples[x * 4 + channel]!;
                    if (selected && blend) {
                        const source = sourceColor / pixelScale, destinationAlpha = background.a / 255;
                        const mixed = name === "multiply" ? source * color / 255
                            : name === "screen" ? source + color - source * color / 255 : Math.abs(source - color);
                        const value = mixed * foreground * destinationAlpha + source * foreground * (1 - destinationAlpha) + color * back;
                        // Native Screen keeps premultiplied RGB; Multiply and Difference unpremultiply.
                        samples[x * 4 + channel] = round((name === "screen" ? value : alpha === 0 ? 0 : value / alpha) * pixelScale);
                        continue;
                    }
                    samples[x * 4 + channel] = !selected || copyDestination || copyAlpha ? round(color * pixelScale) : copySource ? round(sourceColor)
                        : sourceIn ? round(sourceColor * alpha)
                        : destinationOut ? (alpha === 0 ? 0 : round(color * pixelScale))
                        // Plus adds alpha-weighted channels without unpremultiplying.
                        : name === "plus" ? round(Math.min(255 * pixelScale, sourceColor * foreground + color * pixelScale * back))
                        : alpha === 0 ? 0 : round((sourceColor * foreground + color * pixelScale * back) / alpha);
                }
                if (inks) for (let channel = 0; channel < 3; channel++)
                    data[x * 4 + channel] = Math.round((1 - inks[x * 4 + channel]!) * (1 - inks[x * 4 + 3]!) * 255 * scale);
                data[x * 4 + 3] = quantum(((!channels || channels.a) && !copyDestination ? (copySource || copyAlpha ? foreground
                    : name === "difference" ? Math.abs(foreground - background.a / 255) : alpha) * 255 : background.a) * scale);
            }
            // Replace the working channels too, so later colorspace conversion sees the rendered vignette.
            const target = ((y + offsetY) * canvas.width + left + offsetX) * 4;
            if (inks) yield { kind: "write", hue: true, position: target, data: new Uint8Array(inks.buffer) };
            if (hue) yield { kind: "write", hue: true, position: target, data: new Uint8Array(data.buffer) };
            const bounded = hue ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(1, value)) * 65535)) : data;
            yield { kind: "write", highDepth, position: target, data: new Uint8Array(bounded.buffer) };
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
        const inkBytes = image.space === "cmyk" ? yield { kind: "read", hue: true, position, length: data.length } : undefined;
        const inks = inkBytes?.length ? new Float64Array(inkBytes.slice().buffer) : image.space === "cmyk" ? new Float64Array(data.length) : undefined;
        if (inks && !inkBytes?.length) for (let offset = 0; offset < data.length; offset += 4)
            inks.set(rgbToCmyk(data[offset]! / 255, data[offset + 1]! / 255, data[offset + 2]! / 255), offset);
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
            if (inks) {
                for (let channel = 0; channel < 4; channel++) if (channels[channel === 3 ? 4 : channel])
                    inks[offset + channel] = (inks[offset + channel]! * factor + (foreground === raised ? 255 - factor : 0)) / 255;
                for (let channel = 0; channel < 3; channel++)
                    data[offset + channel] = (1 - inks[offset + channel]!) * (1 - inks[offset + 3]!) * 255;
            }
            for (let channel = inks ? 3 : 0; channel < (image.hasAlpha ? 4 : 3); channel++) if (channels[channel])
                data[offset + channel] = Math.fround((data[offset + channel]! * factor + target * (255 - factor)) / 255 * quantum) / quantum;
        }
        if (inks) yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        // Keep working values for later arithmetic; only the encoded backing is bounded.
        yield { kind: "write", hue, evaluate: !hue, position, data: new Uint8Array(data.buffer) };
        const bounded = highDepth ? Uint16Array.from(data, value => Math.round(Math.max(0, Math.min(65535, value * quantum))))
            : Uint8Array.from(data, value => Math.round(Math.max(0, Math.min(255, value * 255 / maximum))));
        yield { kind: "write", highDepth, position, data: new Uint8Array(bounded.buffer) };
    }
}
