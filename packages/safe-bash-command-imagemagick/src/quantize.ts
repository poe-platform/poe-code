import type { ConvolveRequest } from "./convolve-kernel.js";

interface ColorBin { count: number; sums: number[]; color: number[] }

/** A bounded histogram and population median cuts shared by both raster backends. */
export function* quantizePixelSteps(length: number, requested: number, grayscale = false): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("colors must be a positive integer");
    const prepare = (source: Uint8Array): Uint8Array => {
        if (!grayscale) return source;
        const data = new Uint8Array(source);
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]!;
            data[i] = data[i + 1] = data[i + 2] = requested === 2 ? (luma >= 127.5 ? 255 : 0) : Math.round(luma);
            // ImageMagick's two-color gray shortcut produces an opaque bilevel image.
            if (requested === 2) data[i + 3] = 255;
        }
        return data;
    };
    let bins = new Map<number, ColorBin>(), mask = 0xffffffff, precision = 8;
    const key = (data: Uint8Array, i: number) => (data[i]! << 24 | data[i + 1]! << 16 | data[i + 2]! << 8 | data[i + 3]!) & mask;
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position), source = yield { kind: "read", position, length: size };
        if (!source || source.length !== size) throw new Error("Truncated quantization pixels");
        const data = prepare(source);
        if (grayscale && requested === 2) {
            yield { kind: "write", position, data };
            continue;
        }
        for (let i = 0; i < size; i += 4) {
            const id = key(data, i);
            let bin = bins.get(id);
            if (!bin) { bin = { count: 0, sums: [0, 0, 0, 0], color: [] }; bins.set(id, bin); }
            bin.count++;
            for (let c = 0; c < 4; c++) bin.sums[c]! += data[i + c]!;
        }
        // Reduce histogram precision only when necessary; small palettes stay exact.
        if (bins.size > 65536) {
            const channelMask = (255 << (8 - --precision)) & 255;
            mask = channelMask * 0x01010101;
            const reduced = new Map<number, ColorBin>();
            let work = 0;
            for (const [id, bin] of bins) {
                if (++work % 1024 === 0) yield;
                const next = id & mask, existing = reduced.get(next);
                if (!existing) reduced.set(next, bin);
                else { existing.count += bin.count; for (let c = 0; c < 4; c++) existing.sums[c]! += bin.sums[c]!; }
            }
            bins = reduced;
        }
    }
    if (grayscale && requested === 2) return;
    const pending = [{ colors: [...bins.values()], budget: requested }];
    while (pending.length) {
        yield;
        const { colors, budget } = pending.pop()!;
        if (!colors.length) continue;
        const sums = [0, 0, 0, 0], squares = [0, 0, 0, 0];
        let count = 0;
        for (let i = 0; i < colors.length; i++) {
            if (i % 1024 === 0) yield;
            const bin = colors[i]!;
            count += bin.count;
            for (let c = 0; c < 4; c++) { sums[c]! += bin.sums[c]!; squares[c]! += bin.sums[c]! ** 2 / bin.count; }
        }
        if (colors.length <= budget) {
            for (let i = 0; i < colors.length; i++) {
                if (i % 1024 === 0) yield;
                colors[i]!.color = colors[i]!.sums.map(value => Math.round(value / colors[i]!.count));
            }
        } else if (budget === 1) {
            const average = sums.map(value => Math.round(value / count));
            for (let i = 0; i < colors.length; i++) { if (i % 1024 === 0) yield; colors[i]!.color = average; }
        } else {
            let axis = 0, variance = -1;
            for (let c = 0; c < 4; c++) {
                const next = squares[c]! - sums[c]! ** 2 / count;
                if (next >= variance) { variance = next; axis = c; }
            }
            colors.sort((a, b) => a.sums[axis]! / a.count - b.sums[axis]! / b.count);
            let population = 0, split = 0;
            do { population += colors[split++]!.count; } while (population < count / 2 && split < colors.length - 1);
            const leftBudget = Math.min(split, Math.max(1, Math.floor(budget / 2)));
            pending.push({ colors: colors.slice(0, split), budget: leftBudget }, { colors: colors.slice(split), budget: budget - leftBudget });
        }
    }
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position), source = yield { kind: "read", position, length: size };
        if (!source || source.length !== size) throw new Error("Truncated quantization pixels");
        const data = new Uint8Array(size), pixels = prepare(source);
        for (let i = 0; i < size; i += 4) data.set(bins.get(key(pixels, i))!.color, i);
        yield { kind: "write", position, data };
    }
}
