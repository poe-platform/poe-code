import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { hilbertPixels } from "./riemersma.js";
import { regionContains, type Region } from "./region.js";
import { blendMaskedPixel, type MaskChannels } from "./write-mask.js";

/** Quantize packed list pixels without adding canvas padding. */
export function* quantizeImageListSteps(images: readonly { length: number; hasAlpha: boolean }[], requested: number, grayscale = false, treeDepth = 0, dither = true): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    // Native list quantization uses log4(colors) + 2 levels, one fewer with dithering.
    if (!treeDepth && images.length > 1) {
        treeDepth = 1;
        for (let colors = requested; colors >= 1; colors = Math.floor(colors / 4)) treeDepth++;
        if (dither) treeDepth--;
    }
    const steps = quantizePixelSteps(images.reduce((sum, image) => sum + image.length, 0), requested, grayscale, treeDepth, true, false, undefined, undefined, true, undefined, images);
    let next = steps.next(), image = 0, start = 0;
    while (!next.done) {
        const request = next.value;
        if (!request || request.kind !== "read") { yield request; next = steps.next(); continue; }
        if (request.position < start) { image = 0; start = 0; }
        const data = new Float64Array(request.length);
        for (let offset = 0; offset < data.length;) {
            const position = request.position + offset;
            while (position >= start + images[image]!.length) start += images[image++]!.length;
            const length = Math.min(data.length - offset, start + images[image]!.length - position);
            const samples = yield { kind: "read", evaluate: true, image, position: position - start, length };
            if (samples?.length) data.set(new Float64Array(samples.slice().buffer), offset);
            else {
                const bytes = yield { kind: "read", highDepth: true, image, position: position - start, length };
                if (!bytes || bytes.length !== length * 2) throw new Error("Truncated quantization pixels");
                data.set(Float64Array.from(new Uint16Array(bytes.slice().buffer), value => value / 257), offset);
            }
            if (!images[image]!.hasAlpha) for (let i = offset + 3; i < offset + length; i += 4) data[i] = 255;
            offset += length;
        }
        next = steps.next(new Uint8Array(data.buffer));
    }
}

// Sums retain RGBA and RGB multiplied by alpha, so merged bins keep exact weights.
interface ColorBin { alpha?: boolean | undefined; count: number; sums: number[]; associated: number[]; color: number[] }
interface ColorNode {
    parent?: ColorNode;
    level: number;
    children: Map<number, ColorNode>;
    count: number;
    sums: number[];
    error: number;
    removed: boolean;
}

/** A bounded histogram and error-pruned color tree shared by both raster backends. */
export function* quantizePixelSteps(length: number, requested: number, grayscale: boolean | "bilevel" = false, treeDepth = 0, hasAlpha = true, highDepth = false, cycle?: { amount: number; width: number; region?: Region | undefined; writeMask?: boolean; alphaActive: boolean; channels?: MaskChannels | undefined }, dither?: { width: number; height: number; method: "riemersma" | "floydsteinberg"; diffusionAmount: number }, evaluate = false, working?: "hue" | "cmyk", images?: readonly { length: number; hasAlpha: boolean }[]): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("colors must be a positive integer");
    const clamp = (value: number) => Math.max(0, Math.min(255, value));
    // Keep fractional palette means alongside byte output for later arithmetic and deeper output.
    const round = (value: number) => highDepth ? Math.round(value * 257) / 257 : Math.fround(value * 257) / 257;
    function* readPixels(position: number, length: number): Generator<ConvolveRequest, Float64Array, Uint8Array | undefined> {
        const samples = working === "hue" ? yield { kind: "read", hue: true, position, length } : evaluate ? yield { kind: "read", evaluate: true, position, length } : undefined;
        let data: Float64Array;
        if (samples?.length) data = new Float64Array(samples.slice().buffer);
        else {
            const source = yield { kind: "read", highDepth: highDepth || evaluate, position, length };
            if (!source || source.length !== length * (highDepth || evaluate ? 2 : 1)) throw new Error("Truncated quantization pixels");
            data = highDepth || evaluate ? Float64Array.from(new Uint16Array(source.slice().buffer), value => value / 257) : Float64Array.from(source);
        }
        for (let i = 0; i < data.length; i += 4) {
            if (working === "hue" && samples?.length) for (let c = 0; c < 4; c++) data[i + c]! *= 255;
            if (!hasAlpha) data[i + 3] = 255;
            if (grayscale === true) {
                const luma = 0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]!;
                // Keep Q16-HDRI gray samples fractional when accumulating palette means.
                data[i] = data[i + 1] = data[i + 2] = requested === 2 ? (luma >= 127.5 ? 255 : 0) : Math.fround(luma * 257) / 257;
                // ImageMagick's two-color gray shortcut produces an opaque bilevel image.
                if (requested === 2) data[i + 3] = 255;
            }
            // Hidden RGB shares one transparent entry during classification and assignment.
            if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 0;
        }
        return data;
    }
    let bins = new Map<number | string, ColorBin>(), mask = 0xffffffff, precision = 8;
    const key = (data: Float64Array, i: number) => {
        // Native palette conversion classifies Q16 samples in byte-sized cubes,
        // but keeps full-precision sums for each cube's mean color.
        if (cycle !== undefined || evaluate) {
            const alpha = data[i + 3]! / 255;
            return (Math.round(clamp(data[i]! * alpha)) << 24 | Math.round(clamp(data[i + 1]! * alpha)) << 16 | Math.round(clamp(data[i + 2]! * alpha)) << 8 | Math.round(clamp(data[i + 3]!))) & mask;
        }
        return highDepth && precision === 8 ? data.subarray(i, i + 4).join(",") : (data[i]! << 24 | data[i + 1]! << 16 | data[i + 2]! << 8 | data[i + 3]!) & mask;
    };
    let imageIndex = 0, imageStart = 0;
    const chunkSize = evaluate ? 2048 : 4096;
    for (let position = 0; position < length; position += chunkSize) {
        yield;
        const size = Math.min(chunkSize, length - position), data = yield* readPixels(position, size);
        if (grayscale === true && requested === 2) {
            yield { kind: "write", pngIndices: true, position: position / 4, data: Uint8Array.from({ length: size / 4 }, (_, i) => data[i * 4]! / 255) };
            yield { kind: "write", highDepth, position, data: highDepth ? new Uint8Array(Uint16Array.from(data, value => Math.round(value * 257)).buffer) : Uint8Array.from(data) };
            continue;
        }
        for (let i = 0; i < size; i += 4) {
            while (images && position + i >= imageStart + images[imageIndex]!.length) imageStart += images[imageIndex++]!.length;
            // An active alpha channel selects different octants even when fully opaque.
            const alpha = images?.[imageIndex]?.hasAlpha;
            const sampleKey = key(data, i);
            const id = typeof sampleKey === "number" && alpha ? sampleKey + 0x100000000 : sampleKey;
            let bin = bins.get(id);
            if (!bin) { bin = { alpha, count: 0, sums: [0, 0, 0, 0, 0, 0, 0], associated: [0, 0, 0], color: [] }; bins.set(id, bin); }
            bin.count++;
            for (let c = 0; c < 4; c++) bin.sums[c]! += clamp(data[i + c]!);
            // Native clips palette sums after alpha association, but measures
            // tree errors and assignment distances using the original samples.
            for (let c = 0; c < 3; c++) {
                const associated = data[i + c]! * data[i + 3]!;
                bin.associated[c]! += associated;
                bin.sums[c + 4]! += Math.max(0, Math.min(255 * 255, associated));
            }
        }
        // Reduce histogram precision only when necessary; small palettes stay exact.
        if (bins.size > 65536) {
            const channelMask = (255 << (8 - --precision)) & 255;
            mask = channelMask * 0x01010101;
            const reduced = new Map<number | string, ColorBin>();
            let work = 0;
            for (const [id, bin] of bins) {
                if (++work % 1024 === 0) yield;
                const next = typeof id === "number" ? (id & mask) + (bin.alpha ? 0x100000000 : 0) : key(Float64Array.from(id.split(","), Number), 0), existing = reduced.get(next);
                if (!existing) reduced.set(next, bin);
                else {
                    existing.count += bin.count;
                    for (let c = 0; c < 7; c++) existing.sums[c]! += bin.sums[c]!;
                    for (let c = 0; c < 3; c++) existing.associated[c]! += bin.associated[c]!;
                }
            }
            bins = reduced;
        }
    }
    if (grayscale === true && requested === 2) return [0xff000000, 0xffffffff];
    const palette: number[][] = [];
    let findDitherColor: ((pixel: Float64Array) => Generator<undefined, number[]>) | undefined;
    let work = 0;
    const channels = [...bins.values()].some(bin => bin.alpha || bin.sums[3] !== 255 * bin.count) ? 4 : 3;
    if (working !== "cmyk" && bins.size <= requested && (channels === 3 || cycle !== undefined)) {
        for (const bin of bins.values()) {
            if (++work % 1024 === 0) yield;
            bin.color = bin.sums.slice(0, 4).map((value, channel) => round(
                cycle !== undefined && channel < 3 && bin.sums[3]! > 0 ? bin.sums[channel + 4]! / bin.sums[3]! : value / bin.count
            ));
        }
        // Match the color tree's octant order even when no reduction is needed.
        const ordered = [...bins.values()].map(bin => {
            let order = 0;
            for (let bit = 7; bit >= 0; bit--) {
                let octant = 0;
                for (let channel = 0; channel < 4; channel++) octant |= ((Math.round(bin.color[channel]! * (cycle !== undefined && channel < 3 ? bin.color[3]! / 255 : 1)) >>> bit) & 1) << channel;
                order = order * 16 + octant;
            }
            return { order, color: bin.color };
        }).sort((a, b) => a.order - b.order);
        for (const entry of ordered) {
            if (++work % 1024 === 0) yield;
            palette.push(entry.color);
        }
    } else {
        const depth = treeDepth === 0 ? 8 : Math.max(2, Math.min(8, treeDepth));
        const root: ColorNode = { level: 0, children: new Map(), count: 0, sums: [0, 0, 0, 0, 0, 0, 0], error: Infinity, removed: false };
        for (const bin of bins.values()) {
            if (++work % 1024 === 0) yield;
            const pixel = bin.sums.slice(0, 4).map((value, c) => c < 3 ? bin.associated[c]! / bin.count / 255 : value / bin.count), midpoint = [127.5, 127.5, 127.5, 127.5];
            let node = root;
            for (let bit = 7; bit >= 0; bit--) {
                let id = 0, distance = 0;
                for (let c = 0; c < (bin.alpha === false ? 3 : channels); c++) {
                    const high = (Math.round(clamp(pixel[c]!)) >>> bit) & 1;
                    id |= high << c;
                    // ImageMagick's Q16 cube centers, expressed in byte units.
                    midpoint[c]! += (high ? 1 : -1) * (128 << bit) / 257;
                    distance += (pixel[c]! - midpoint[c]!) ** 2;
                }
                let child = node.children.get(id);
                if (!child) {
                    child = { parent: node, level: 8 - bit, children: new Map(), count: 0, sums: [0, 0, 0, 0, 0, 0, 0], error: 0, removed: false };
                    node.children.set(id, child);
                }
                child.error += bin.count * Math.sqrt(distance);
                node = child;
            }
            node.count += bin.count;
            for (let c = 0; c < 7; c++) node.sums[c]! += bin.sums[c]!;
        }
        // Traverse octants in RGB bit order so equally costly colors reduce in
        // native order, independent of where pixels appeared in the image.
        const ordered: ColorNode[] = [];
        let colors = 0;
        function* visit(node: ColorNode): Generator<undefined> {
            if (++work % 1024 === 0) yield;
            for (let id = 0; id < 1 << channels; id++) {
                const child = node.children.get(id);
                if (child) yield* visit(child);
            }
            if (node.count) colors++;
            if (node !== root) ordered.push(node);
        }
        yield* visit(root);
        let nodes = ordered.length + 1;
        function* prune(node: ColorNode): Generator<undefined> {
            if (++work % 1024 === 0) yield;
            for (const child of node.children.values()) if (!child.removed) yield* prune(child);
            if (nodes <= requested) return;
            const parent = node.parent!;
            if (node.count) {
                if (parent.count) colors--;
                parent.count += node.count;
                for (let c = 0; c < 7; c++) parent.sums[c]! += node.sums[c]!;
            }
            node.children.clear();
            node.removed = true;
            nodes--;
        }
        for (const node of ordered) {
            if (++work % 1024 === 0) yield;
            if (node.level > depth && !node.removed) yield* prune(node);
        }
        const remaining = ordered.filter(node => !node.removed).sort((a, b) => a.error - b.error);
        // Native starts at a threshold that leaves roughly 110% of the requested
        // palette in tree nodes, then prunes complete equal-error groups. The first
        // pass uses the color count before depth pruning, even if pruning has
        // already brought the palette within the requested limit.
        const threshold = bins.size > requested ? remaining[Math.max(0, nodes - Math.floor(1.1 * (requested + 1)))]?.error ?? 0 : -1;
        // The initial pass includes different errors. Preserve tree order so the
        // node-count floor retains the same colors as native reduction.
        for (const node of ordered) {
            if (++work % 1024 === 0) yield;
            if (!node.removed && node.error <= threshold) yield* prune(node);
        }
        let lastError = threshold;
        for (const node of remaining) {
            if (++work % 1024 === 0) yield;
            if (colors <= requested && node.error > lastError) break;
            if (!node.removed) yield* prune(node);
            lastError = Math.max(lastError, node.error);
        }
        const nodeColors = new Map<ColorNode, number[]>();
        // Surviving children precede their parent, including a merged root color.
        for (const node of [...ordered, root]) {
            if (++work % 1024 === 0) yield;
            if (node.removed || !node.count) continue;
            const color = node.sums.slice(0, 4).map((value, channel) => round(
                channel < 3 && node.sums[3]! > 0 ? node.sums[channel + 4]! / node.sums[3]! : value / node.count
            ));
            nodeColors.set(node, color);
            palette.push(color);
        }
        function* nearestColor(pixel: ArrayLike<number>, activeChannels = channels): Generator<undefined, number[]> {
            // Native assignment searches the deepest surviving cube's
            // siblings and descendants, comparing unrounded palette means.
            let cube = root;
            for (let bit = 7; bit > 0; bit--) {
                let id = 0;
                for (let c = 0; c < activeChannels; c++) id |= ((Math.round(clamp(pixel[c]!)) >>> bit) & 1) << c;
                const child = cube.children.get(id);
                if (!child || child.removed) break;
                cube = child;
            }
            let closest = Infinity, node = root;
            function* search(candidate: ColorNode): Generator<undefined> {
                if (++work % 1024 === 0) yield;
                for (let id = 0; id < 1 << activeChannels; id++) {
                    const child = candidate.children.get(id);
                    if (child && !child.removed) yield* search(child);
                }
                if (!candidate.count) return;
                let distance = 0;
                for (let c = 0; c < activeChannels; c++) {
                    const color = c < 3 ? candidate.sums[c + 4]! / candidate.count / 255 : candidate.sums[c]! / candidate.count;
                    // Native distance associates the already associated target again.
                    const target = c < 3 ? pixel[c]! * pixel[3]! / 255 : pixel[c]!;
                    distance += (color - target) ** 2;
                }
                if (distance <= closest) { closest = distance; node = candidate; }
            }
            yield* search(cube.parent ?? root);
            return nodeColors.get(node)!;
        }
        findDitherColor = nearestColor;
        for (const bin of bins.values()) {
            if (++work % 1024 === 0) yield;
            const pixel = bin.sums.slice(0, 4).map((value, c) => c < 3 ? bin.associated[c]! / bin.count / 255 : value / bin.count);
            // CMYK classification uses RGB, but assignment compares the converted inks.
            if (working === "cmyk") {
                const inks = rgbToCmyk(bin.sums[0]! / bin.count / 255, bin.sums[1]! / bin.count / 255, bin.sums[2]! / bin.count / 255);
                for (let c = 0; c < 3; c++) pixel[c] = inks[c]! * pixel[3]!;
            }
            bin.color = yield* nearestColor(pixel, bin.alpha === false ? 3 : channels);
        }
    }
    // A masked Gray channel skips normalization and thresholding. Quantization
    // still assigns/diffuses the original grays before making its palette bilevel.
    // Native measures a lone Gray palette entry through sRGB gamma.
    const bilevelThreshold = palette.length === 1 ? 255 * ((0.5 + 0.055) / 1.055) ** 2.4
        : (palette[0]![0]! + palette[1]![0]!) / 2;
    function* writeWorkingPixels(position: number, data: Float64Array): Generator<ConvolveRequest, void, Uint8Array | undefined> {
        if (grayscale === "bilevel") for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i + 1] = data[i + 2] = data[i]! >= bilevelThreshold ? 255 : 0;
        }
        if (working === "hue") yield { kind: "write", hue: true, position, data: new Uint8Array(data.map(value => value / 255).buffer) };
        if (working === "cmyk") {
            const inks = new Float64Array(data.length);
            for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) {
                inks[i + c] = data[i + c]! / 255;
                data[i + c] = 255 - data[i + c]!;
            }
            // SyncImage copies a zero black component from the native colormap.
            yield { kind: "write", hue: true, position, data: new Uint8Array(inks.buffer) };
        }
    }
    const assigned = new Float64Array(4), clipped = new Float64Array(4);
    const indices = new Map(palette.map((color, index) => [color, index]));
    // Retain byte-sized palette indices before later masked edits separate RGB from the colormap.
    const retainIndices = palette.length <= 256;
    const shift = cycle ? ((cycle.amount % palette.length) + palette.length) % palette.length : 0;
    // An unreduced palette still goes through native dither assignment.
    // Its six-bit cache can reuse a nearby color; later pixels diffuse that error.
    let needsDither = bins.size > requested;
    if (dither && bins.size <= requested && cycle === undefined) {
        const keys = new Set<number>();
        for (const color of palette) {
            if (++work % 1024 === 0) yield;
            let id = 0;
            for (let c = 0; c < channels; c++) {
                const sample = color[c]! * (channels === 4 && c < 3 ? color[3]! / 255 : 1);
                id |= (Math.round(sample) >>> 2) << (c * 6);
            }
            if (keys.has(id)) { needsDither = true; break; }
            keys.add(id);
        }
    }
    // Reduced palettes and cache collisions both require error diffusion.
    if (dither && needsDither) {
        const cache = new Map<number, number[]>(), errors = new Float64Array(64);
        const weights = Float64Array.from({ length: 16 }, (_, i) => dither.diffusionAmount * 16 ** (-1 - i / 15));
        let row = new Float64Array(dither.method === "floydsteinberg" ? dither.width * channels : 0), nextRow = new Float64Array(row.length);
        function* scan() {
            for (let y = 0; y < dither!.height; y++) {
                for (let x = 0; x < dither!.width; x++) yield (y * dither!.width + (y % 2 ? dither!.width - x - 1 : x)) * 4;
                [row, nextRow] = [nextRow, row];
                nextRow.fill(0);
            }
        }
        for (const position of dither.method === "riemersma" ? hilbertPixels(dither) : scan()) {
            if (++work % 1024 === 0) yield;
            const target = yield* readPixels(position, 4), x = position / 4 % dither.width;
            if (working === "cmyk") {
                const inks = rgbToCmyk(target[0]! / 255, target[1]! / 255, target[2]! / 255);
                for (let c = 0; c < 3; c++) target[c] = inks[c]! * 255;
            }
            if (channels === 4) for (let c = 0; c < 3; c++) target[c]! *= target[3]! / 255;
            let id = 0;
            for (let c = 0; c < channels; c++) {
                if (dither.method === "riemersma") for (let i = 0; i < 16; i++) target[c]! += weights[i]! * errors[i * 4 + c]!;
                else target[c]! += row[x * channels + c]!;
                target[c] = Math.max(0, Math.min(255, target[c]!));
                id |= (Math.round(target[c]!) >>> 2) << (c * 6);
            }
            let color = cache.get(id);
            if (!color && findDitherColor) color = yield* findDitherColor(target);
            if (!color) {
                let distance = Infinity;
                for (const candidate of palette) {
                    if (++work % 1024 === 0) yield;
                    let next = 0;
                    for (let c = 0; c < channels; c++) next += (target[c]! - candidate[c]!) ** 2;
                    if (next <= distance) { color = candidate; distance = next; }
                }
            }
            cache.set(id, color!);
            if (dither.method === "riemersma") {
                errors.copyWithin(0, 4);
                for (let c = 0; c < channels; c++) errors[60 + c] = target[c]! - color![c]! * (channels === 4 && c < 3 ? color![3]! / 255 : 1);
            } else {
                const direction = Math.floor(position / 4 / dither.width) % 2 ? -1 : 1;
                for (let c = 0; c < channels; c++) {
                    const error = (target[c]! - color![c]! * (channels === 4 && c < 3 ? color![3]! / 255 : 1)) * dither.diffusionAmount / 16;
                    if (x + direction >= 0 && x + direction < dither.width) {
                        row[(x + direction) * channels + c]! += error * 7;
                        nextRow[(x + direction) * channels + c]! += error;
                    }
                    if (x - direction >= 0 && x - direction < dither.width) nextRow[(x - direction) * channels + c]! += error * 3;
                    nextRow[x * channels + c]! += error * 5;
                }
            }
            const data = Float64Array.from(color!);
            if (retainIndices) yield { kind: "write", pngIndices: true, position: position / 4, data: Uint8Array.of(indices.get(color!)!) };
            yield* writeWorkingPixels(position, data);
            if (evaluate) yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
            yield { kind: "write", highDepth, position, data: highDepth ? new Uint8Array(Uint16Array.from(data, value => Math.round(value * 257)).buffer) : Uint8Array.from(data, Math.round) };
        }
    } else for (let position = 0; position < length; position += chunkSize) {
        yield;
        const size = Math.min(chunkSize, length - position), pixels = yield* readPixels(position, size);
        const data = new Float64Array(size);
        const pixelIndices = retainIndices ? new Uint8Array(size / 4) : undefined;
        const mask = cycle?.writeMask ? new Uint16Array((yield { kind: "read", highDepth: true, image: 1, position, length: size })!.slice().buffer) : undefined;
        for (let i = 0; i < size; i += 4) {
            if (images && position + i < imageStart) { imageIndex = 0; imageStart = 0; }
            while (images && position + i >= imageStart + images[imageIndex]!.length) imageStart += images[imageIndex++]!.length;
            const sampleKey = key(pixels, i);
            const color = bins.get(typeof sampleKey === "number" && images?.[imageIndex]?.hasAlpha ? sampleKey + 0x100000000 : sampleKey)!.color;
            const index = (indices.get(color)! + shift) % palette.length;
            if (pixelIndices) pixelIndices[i / 4] = index;
            const pixel = (position + i) / 4;
            const protection = mask ? (0.212656 * mask[i]! + 0.715158 * mask[i + 1]! + 0.072186 * mask[i + 2]!) / 65535
                : cycle?.region && !regionContains(cycle.region, pixel % cycle.width, Math.floor(pixel / cycle.width)) ? 1 : 0;
            if (cycle && protection > 0) {
                // Palette assignment and SyncImage each clip while alpha is active.
                // Cycling then disables alpha, so protected pixels keep that result.
                assigned.set(color);
                for (let channel = 0; channel < 4; channel++) clipped[channel] = pixels[i + channel]!;
                blendMaskedPixel(clipped, clipped, assigned, 0, protection, 255, cycle.channels, cycle.alphaActive);
                blendMaskedPixel(clipped, clipped, assigned, 0, protection, 255, cycle.channels, cycle.alphaActive);
                assigned.set(palette[index]!);
                blendMaskedPixel(clipped, clipped, assigned, 0, protection, 255, cycle.channels, false);
                data.set(clipped, i);
            } else data.set(cycle ? palette[index]! : color, i);
            if (cycle) data[i + 3] = 255;
        }
        if (pixelIndices) yield { kind: "write", pngIndices: true, position: position / 4, data: pixelIndices };
        yield* writeWorkingPixels(position, data);
        if (!highDepth || cycle?.region || cycle?.writeMask) yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
        yield { kind: "write", highDepth, position, data: highDepth ? new Uint8Array(Uint16Array.from(data, value => Math.round(value * 257)).buffer) : Uint8Array.from(data, Math.round) };
    }
    if (working === "cmyk") for (const color of palette) for (let c = 0; c < 3; c++) color[c] = 255 - color[c]!;
    if (grayscale === "bilevel") for (const color of palette) color.fill(color[0]! >= bilevelThreshold ? 255 : 0, 0, 3);
    if (cycle) for (const color of palette) color[3] = 255;
    return palette.map(color => Math.round(color[3]!) * 16777216 + Math.round(color[0]!) * 65536 + Math.round(color[1]!) * 256 + Math.round(color[2]!));
}
