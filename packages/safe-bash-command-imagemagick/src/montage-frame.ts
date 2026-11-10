import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

// Shared by convert frames and montage's 15-pixel matte with 3-pixel bevels.
export function* magickFramePixels(source: Pick<RgbaImage, "width" | "height" | "data16" | "space" | "hasAlpha"> & Partial<Pick<StoredRgbaImage, "storedData16">>, width: number, height: number,
    border: RgbaColor, matte: RgbaColor, frameX: number, frameY: number, outer: number, inner: number, compositeSource = true): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (outer < 0 || inner < 0 || outer + inner > Math.min(frameX, frameY)) throw new Error("frame is less than image size");
    // Native grayscale channel aliases leave the blue matte component in the gray channel.
    if (source.space === "b-w" || source.space === "grey16") matte = { ...matte, r: matte.b, g: matte.b };
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    const shade = (factor: number, lighten: boolean) => [matte.r, matte.g, matte.b].map(value =>
        Math.round((lighten ? value + (255 - value) * factor / 255 : value * factor / 255) * scale)).concat(Math.round(matte.a * scale));
    const accent = shade(80, true), highlight = shade(125, true), shadow = shade(135, false), trough = shade(110, false);
    const flat = [matte.r, matte.g, matte.b, matte.a].map(value => Math.round(value * scale));
    const interior = [border.r, border.g, border.b, border.a].map(value => Math.round(value * scale));
    const insetX = Math.ceil((width - 2 * frameX - source.width) / 2), insetY = Math.ceil((height - 2 * frameY - source.height) / 2);
    const innerW = source.width + insetX * 2, innerH = source.height + insetY * 2;
    for (let y = 0; y < height; y++) for (let left = 0; left < width; left += 1024) {
        yield;
        const count = Math.min(1024, width - left), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            const x = left + i;
            let color = flat;
            if (y < outer) color = x < y ? highlight : x >= width - y ? shadow : accent;
            else if (y >= height - outer) color = x < height - 1 - y ? highlight : x >= width - (height - 1 - y) ? shadow : trough;
            else if (x < outer) color = highlight;
            else if (x >= width - outer) color = shadow;
            else if (x >= frameX - inner && x < frameX + innerW + inner && y >= frameY - inner && y < frameY + innerH + inner) {
                const dx = x - frameX + inner;
                if (y < frameY) color = dx < y - frameY + inner ? shadow : dx >= innerW + 2 * inner - (y - frameY + inner) ? highlight : trough;
                else if (y >= frameY + innerH) {
                    const edge = frameY + innerH + inner - 1 - y;
                    color = dx < edge ? shadow : dx >= innerW + 2 * inner - edge ? highlight : accent;
                } else color = x < frameX ? shadow : x >= frameX + innerW ? highlight : interior;
            }
            data.set(color, i * 4);
        }
        const sy = y - frameY - insetY, first = Math.max(left, frameX + insetX), end = Math.min(left + count, frameX + insetX + source.width);
        if (compositeSource && sy >= 0 && sy < source.height && end > first) {
            const bytes = yield { kind: "read", position: (sy * source.width + first - frameX - insetX) * 4, length: (end - first) * 4, highDepth };
            if (!bytes) throw new Error("Missing montage frame pixels");
            const samples = highDepth ? new Uint16Array(bytes.slice().buffer) : bytes;
            for (let x = first; x < end; x++) {
                const src = (x - first) * 4, dst = (x - left) * 4, alpha = source.hasAlpha ? samples[src + 3]! / maximum : 1;
                const outAlpha = alpha + border.a / 255 * (1 - alpha);
                for (let c = 0; c < 3; c++) data[dst + c] = outAlpha ? Math.round((samples[src + c]! * alpha + interior[c]! * border.a / 255 * (1 - alpha)) / outAlpha) : 0;
                data[dst + 3] = Math.round(outAlpha * maximum);
            }
        }
        yield { kind: "write", position: (y * width + left) * 4, data: new Uint8Array(data.buffer), highDepth };
    }
}

export function* montageShadowPixels(source: { width: number; height: number }): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Montage shadows are 30% opaque, sigma 5, padded by 10 pixels.
    const width = source.width + 20, height = source.height + 20;
    let half = 2, sum = 1 + 2 * Math.exp(-1 / 50);
    for (; half < 100; half++) {
        const edge = Math.exp(-half * half / 50);
        sum += 2 * edge;
        if (edge / sum < 1 / 65535) { half--; break; }
    }
    const weights = new Float64Array(half * 2 + 1);
    let total = 0;
    for (let k = -half; k <= half; k++) {
        for (let sub = -1; sub <= 1; sub++) weights[k + half]! += Math.exp(-((k + sub / 3) ** 2) / 50);
        total += weights[k + half]!;
    }
    for (let k = 0; k < weights.length; k++) weights[k]! /= total;
    for (let left = 0; left < width; left += 1024) {
        const count = Math.min(1024, width - left), rows = new Map<number, Float64Array>();
        for (let y = 0; y < height; y++) {
            yield;
            const coverage = new Float64Array(count);
            for (let ky = -half; ky <= half; ky++) {
                const sy = y + ky - 10;
                if (sy < 0 || sy >= source.height) continue;
                let row = rows.get(sy);
                if (!row) {
                    yield;
                    row = new Float64Array(count);
                    const first = Math.max(0, left - half - 10), end = Math.min(source.width, left + count + half - 10);
                    if (end > first) {
                        const bytes = yield { kind: "read", position: (sy * source.width + first) * 4, length: (end - first) * 4 };
                        if (!bytes) throw new Error("Missing montage shadow pixels");
                        for (let x = 0; x < count; x++) for (let k = -half; k <= half; k++) {
                            const sx = left + x + k - 10;
                            if (sx >= first && sx < end) row[x]! += bytes[(sx - first) * 4 + 3]! * weights[k + half]!;
                        }
                    }
                    if (rows.size >= weights.length) rows.delete(rows.keys().next().value!);
                    rows.set(sy, row);
                }
                for (let x = 0; x < count; x++) coverage[x]! += row[x]! * weights[ky + half]!;
            }
            const data = new Uint8Array(count * 4);
            for (let x = 0; x < count; x++) data[x * 4 + 3] = Math.floor(coverage[x]! * 0.3);
            yield { kind: "write", position: (y * width + left) * 4, data };
        }
    }
}
