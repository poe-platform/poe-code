import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { regionContains, type Region } from "./region.js";

/** Width-first seam carving with liblqr's brightness gradient and leftmost ties. */
export function liquidRescaleSteps(image: { width: number; height: number; hasAlpha: boolean; region?: Region | undefined; readMask?: { width: number; height: number } | undefined; writeMask?: { width: number; height: number } | undefined; depth: string; space?: string; hueSamples?: Float64Array; storedHueSamples?: number; isPalette?: boolean; pngPalette?: { readonly bytes: Uint8Array }; indexedColors?: readonly number[] }, width: number, height: number, delta = 1, rigidity = 0) {
    // Account for source/output samples, seam indices, brightness and path maps.
    const pixels = Math.max(image.width, width) * Math.max(image.height, height);
    // Carve the working colorspace plane used by the later sRGB conversion.
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const palette = new Map<number, number>();
    if (image.isPalette && image.pngPalette) {
        const colors = image.pngPalette.bytes;
        for (let i = 0; i < colors.length; i += 3) palette.set(colors[i]! * 65536 + colors[i + 1]! * 256 + colors[i + 2]!, i / 3);
    } else if (image.isPalette && image.indexedColors) {
        image.indexedColors.forEach((color, index) => palette.set(color % 16777216, index));
    }
    const cmyk = image.space === "cmyk";
    const masks = [image.readMask, image.writeMask].filter(mask => mask !== undefined);
    const baseStride = cmyk || palette.size ? 5 : 4;
    const stride = baseStride + masks.length + (image.region ? 1 : 0);
    if (!Number.isSafeInteger(pixels) || pixels * (stride * 8 + 32) > 0x7fffffff) throw new Error("Liquid rescale dimensions exceed resource limits");
    // ImageMagick passes all cache channels to liblqr, including masks. liblqr
    // infers RGB, RGBA, CMYKA, or custom brightness from that channel count.
    const channels = [0, 1, 2, ...(cmyk ? [3] : []), ...(image.hasAlpha ? [cmyk ? 4 : 3] : []),
        ...(!cmyk && palette.size ? [4] : []), ...Array.from({ length: stride - baseStride }, (_, i) => baseStride + i)];
    let data: Float32Array;
    return { pixels: carve(), writeMask: image.writeMask || image.region ? writeMaskPixels() : undefined };

    function* carve(): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
        data = new Float32Array(image.width * image.height * stride);
        for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
            yield;
            const length = Math.min(4096, image.width * image.height * 4 - offset);
            const working = !hue ? yield { kind: "read", evaluate: true, position: offset, length } : undefined;
            const evaluate = !!working?.length;
            const bytes = evaluate ? working : yield { kind: "read", hue, highDepth: !hue, position: offset, length };
            if (!bytes || bytes.length !== length * (hue || evaluate ? 8 : 2)) throw new Error("Truncated liquid rescale pixels");
            const samples = hue || evaluate ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer);
            const scale = hue ? 1 : evaluate ? 255 : 65535;
            const inkBytes = cmyk ? yield { kind: "read", hue: true, position: offset, length } : undefined;
            const inks = inkBytes?.length ? new Float64Array(inkBytes.slice().buffer) : undefined;
            for (let i = 0; i < length; i += 4) {
                const p = (offset + i) / 4 * stride;
                for (let c = 0; c < 4; c++) data[p + c] = samples[i + c]! / scale;
                if (cmyk) {
                    data.set(inks ? inks.subarray(i, i + 4) : rgbToCmyk(data[p]!, data[p + 1]!, data[p + 2]!), p);
                    data[p + 4] = samples[i + 3]! / scale;
                } else if (palette.size) {
                    const color = Math.round(samples[i]! / scale * 255) * 65536 + Math.round(samples[i + 1]! / scale * 255) * 256 + Math.round(samples[i + 2]! / scale * 255);
                    data[p + 4] = (palette.get(color) ?? 0) / 65535;
                }
            }
        }
        for (let channel = 0; channel < stride - baseStride; channel++) {
            const mask = masks[channel];
            for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x += 1024) {
                yield;
                const count = Math.min(1024, image.width - x);
                const available = mask && y < mask.height ? Math.max(0, Math.min(count, mask.width - x)) : 0;
                const samples = available ? new Uint16Array((yield { kind: "read", highDepth: true, image: channel + 1,
                    position: (y * mask!.width + x) * 4, length: available * 4 })!.slice().buffer) : undefined;
                for (let i = 0; i < count; i++) {
                    data[((y * image.width + x + i) * stride) + baseStride + channel] = mask
                        ? i < available ? (0.212656 * samples![i * 4]! + 0.715158 * samples![i * 4 + 1]! + 0.072186 * samples![i * 4 + 2]!) / 65535 : 0
                        : Number(!regionContains(image.region!, x + i, y));
                }
            }
        }
        let currentWidth = image.width, currentHeight = image.height;
        let work = 0;
        for (const horizontal of [true, false]) {
            const target = horizontal ? width : height;
            let size = horizontal ? currentWidth : currentHeight;
            const rows = horizontal ? currentHeight : currentWidth;
            while (size !== target) {
                const growing = target > size;
                // Insert a batch of distinct seams before finding the next batch.
                const count = growing ? Math.min(target - size, Math.max(1, size - 1)) : size - target;
                const resultSize = size + (growing ? count : -count);
                const order = new Uint32Array(size * rows), parent = new Uint32Array(size * rows);
                const brightness = new Float64Array(size * rows), removed = growing ? new Uint8Array(size * rows) : undefined;
                let previous = new Float32Array(size), costs = new Float32Array(size);
                const at = (x: number, y: number) => horizontal ? y * currentWidth + x : x * currentWidth + y;
                for (let y = 0; y < rows; y++) for (let x = 0; x < size; x++) {
                    if (++work % 1024 === 0) yield;
                    const p = at(x, y) * stride, index = y * size + x;
                    order[index] = x;
                    const average = (data[p]! + data[p + 1]! + data[p + 2]!) / 3;
                    brightness[index] = channels.length === 3 ? average
                        : channels.length === 4 ? average * data[p + channels[3]!]!
                        : channels.length === 5 ? (1 - average) * (1 - data[p + channels[3]!]!) * data[p + channels[4]!]!
                        : channels.reduce((sum, channel) => sum + data[p + channel]!, 0) / channels.length;
                }
                for (let seam = 0; seam < count; seam++) {
                    const active = size - seam;
                    for (let y = 0; y < rows; y++) {
                        const row = y * size;
                        for (let x = 0; x < active; x++) {
                            if (++work % 1024 === 0) yield;
                            const left = order[row + Math.max(0, x - 1)]!, right = order[row + Math.min(active - 1, x + 1)]!;
                            const energy = Math.fround(Math.abs(Math.fround((brightness[row + right]! - brightness[row + left]!) / (x > 0 && x < active - 1 ? 2 : 1))));
                            let best = 0, from = x;
                            if (y > 0) {
                                best = Infinity;
                                for (let candidate = Math.max(0, x - delta); candidate <= Math.min(active - 1, x + delta); candidate++) {
                                    if (++work % 1024 === 0) yield;
                                    const penalty = Math.fround(Math.fround(rigidity) * Math.fround(Math.abs(candidate - x) ** 1.5) / rows);
                                    const cost = Math.fround(previous[candidate]! + penalty);
                                    if (cost < best) { best = cost; from = candidate; }
                                }
                            }
                            parent[row + x] = from;
                            costs[x] = energy + best;
                        }
                        [previous, costs] = [costs, previous];
                    }
                    let end = 0;
                    for (let x = 1; x < active; x++) {
                        if (++work % 1024 === 0) yield;
                        if (previous[x]! < previous[end]!) end = x;
                    }
                    for (let y = rows - 1; y >= 0; y--) {
                        const row = y * size, from = parent[row + end]!;
                        if (removed) removed[row + order[row + end]!] = 1;
                        for (let x = end; x < active - 1; x++) {
                            if (++work % 1024 === 0) yield;
                            order[row + x] = order[row + x + 1]!;
                        }
                        end = from;
                    }
                }
                const outputWidth = horizontal ? resultSize : currentWidth;
                const output = new Float32Array(resultSize * rows * stride);
                for (let y = 0; y < rows; y++) {
                    let destination = 0;
                    for (let x = 0; x < (growing ? size : resultSize); x++) {
                        if (++work % 1024 === 0) yield;
                        const source = growing ? x : order[y * size + x]!;
                        const p = at(source, y) * stride;
                        if (removed?.[y * size + x]) {
                            const left = at(Math.max(0, source - 1), y) * stride;
                            const offset = (horizontal ? y * outputWidth + destination++ : destination++ * outputWidth + y) * stride;
                            for (let c = 0; c < stride; c++) output[offset + c] = Math.fround(data[left + c]! + data[p + c]!) / 2;
                        }
                        const offset = (horizontal ? y * outputWidth + destination++ : destination++ * outputWidth + y) * stride;
                        output.set(data.subarray(p, p + stride), offset);
                    }
                }
                data = output;
                size = resultSize;
                if (horizontal) currentWidth = size;
                else currentHeight = size;
            }
        }
        for (let offset = 0; offset < width * height * 4; offset += 4096) {
            yield;
            const length = Math.min(4096, width * height * 4 - offset), samples = new Uint16Array(length);
            const hueSamples = hue ? new Float64Array(length) : undefined;
            if (cmyk) {
                const inks = new Float64Array(length), evaluated = new Float64Array(length);
                for (let i = 0; i < length; i += 4) {
                    const p = (offset + i) / 4 * stride;
                    for (let c = 0; c < 4; c++) inks[i + c] = Math.fround(data[p + c]! * 65535) / 65535;
                    for (let c = 0; c < 4; c++) {
                        const value = c === 3 ? Math.fround(data[p + 4]! * 65535) / 65535
                            : (1 - inks[i + c]!) * (1 - inks[i + 3]!);
                        evaluated[i + c] = value * 255;
                        samples[i + c] = Math.max(0, Math.min(65535, Math.round(value * 65535)));
                    }
                }
                yield { kind: "write", hue: true, position: offset, data: new Uint8Array(inks.buffer) };
                yield { kind: "write", evaluate: true, position: offset, data: new Uint8Array(evaluated.buffer) };
                yield { kind: "write", highDepth: true, position: offset, data: new Uint8Array(samples.buffer) };
                continue;
            }
            const evaluated = new Float64Array(length);
            for (let i = 0; i < length; i++) {
                const quantum = Math.fround(data[Math.floor((offset + i) / 4) * stride + i % 4]! * 65535);
                evaluated[i] = quantum / 257;
                samples[i] = Math.max(0, Math.min(65535, !hue && (image.depth === "uchar" || image.depth === "bit") ? Math.round(quantum / 257) * 257 : Math.round(quantum)));
                if (hueSamples) hueSamples[i] = quantum / 65535;
            }
            // Keep fractional samples for high-depth output, as the resize kernel does.
            if (!hue) yield { kind: "write", evaluate: true, position: offset, data: new Uint8Array(evaluated.buffer) };
            yield { kind: "write", highDepth: true, position: offset, data: new Uint8Array(samples.buffer) };
            if (hueSamples) yield { kind: "write", hue: true, position: offset, data: new Uint8Array(hueSamples.buffer) };
        }
    }

    function* writeMaskPixels(): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
        const channel = stride - 1;
        for (let offset = 0; offset < width * height * 4; offset += 4096) {
            yield;
            const length = Math.min(4096, width * height * 4 - offset);
            const samples = new Float64Array(length);
            for (let i = 0; i < length; i++) samples[i] = i % 4 === 3 ? 255
                : Math.fround(data[Math.floor((offset + i) / 4) * stride + channel]! * 65535) / 257;
            yield { kind: "write", evaluate: true, position: offset, data: new Uint8Array(samples.buffer) };
            yield { kind: "write", highDepth: true, position: offset, data: new Uint8Array(Uint16Array.from(samples, value => Math.round(value * 257)).buffer) };
        }
    }
}
