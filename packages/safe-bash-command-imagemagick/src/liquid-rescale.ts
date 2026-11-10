import type { ConvolveRequest } from "./convolve-kernel.js";

/** Width-first seam carving with liblqr's brightness gradient and leftmost ties. */
export function* liquidRescalePixelSteps(image: { width: number; height: number; hasAlpha: boolean; depth: string; space?: string; hueSamples?: Float64Array; storedHueSamples?: number; isPalette?: boolean; pngPalette?: { readonly bytes: Uint8Array }; indexedColors?: readonly number[] }, width: number, height: number, delta = 1, rigidity = 0): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Account for source/output samples, seam indices, brightness and path maps.
    const pixels = Math.max(image.width, width) * Math.max(image.height, height);
    if (!Number.isSafeInteger(pixels) || pixels * 64 > 0x7fffffff) throw new Error("Liquid rescale dimensions exceed resource limits");
    // Carve the working colorspace plane used by the later sRGB conversion.
    const hue = image.space !== "cmyk" && (!!image.hueSamples || image.storedHueSamples !== undefined);
    const palette = new Map<number, number>();
    if (image.isPalette && image.pngPalette) {
        const colors = image.pngPalette.bytes;
        for (let i = 0; i < colors.length; i += 3) palette.set(colors[i]! * 65536 + colors[i + 1]! * 256 + colors[i + 2]!, i / 3);
    } else if (image.isPalette && image.indexedColors) {
        image.indexedColors.forEach((color, index) => palette.set(color % 16777216, index));
    }
    const stride = palette.size ? 5 : 4;
    let data = new Float32Array(image.width * image.height * stride);
    for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
        yield;
        const length = Math.min(4096, image.width * image.height * 4 - offset);
        const bytes = yield { kind: "read", hue, highDepth: !hue, position: offset, length };
        if (!bytes || bytes.length !== length * (hue ? 8 : 2)) throw new Error("Truncated liquid rescale pixels");
        const samples = hue ? new Float64Array(bytes.slice().buffer) : new Uint16Array(bytes.slice().buffer);
        for (let i = 0; i < length; i += 4) {
            const p = (offset + i) / 4 * stride;
            for (let c = 0; c < 4; c++) data[p + c] = samples[i + c]! / (hue ? 1 : 65535);
            if (palette.size) {
                const color = Math.round(samples[i]! / 257) * 65536 + Math.round(samples[i + 1]! / 257) * 256 + Math.round(samples[i + 2]! / 257);
                data[p + 4] = (palette.get(color) ?? 0) / 65535;
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
                // liblqr interprets RGB+index as RGBA and RGBA+index as CMYKA.
                brightness[index] = palette.size
                    ? (image.hasAlpha ? (1 - average) * (1 - data[p + 3]!) : average) * data[p + 4]!
                    : average * (image.hasAlpha ? data[p + 3]! : 1);
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
        const evaluated = new Float64Array(length);
        for (let i = 0; i < length; i++) {
            const quantum = Math.fround(data[Math.floor((offset + i) / 4) * stride + i % 4]! * 65535);
            samples[i] = !hue && (image.depth === "uchar" || image.depth === "bit") ? Math.round(quantum / 257) * 257 : Math.round(quantum);
            if (hueSamples) hueSamples[i] = quantum / 65535;
        }
        // Keep fractional samples for high-depth output, as the resize kernel does.
        yield { kind: "write", evaluate: true, position: offset, data: new Uint8Array(evaluated.buffer) };
        yield { kind: "write", highDepth: true, position: offset, data: new Uint8Array(samples.buffer) };
        if (hueSamples) yield { kind: "write", hue: true, position: offset, data: new Uint8Array(hueSamples.buffer) };
    }
}
