import type { ConvolveRequest } from "./convolve-kernel.js";
import { regionContains, type Region } from "./region.js";
import { blendMaskedPixel, type MaskChannels } from "./write-mask.js";

/** Quantize packed list pixels without adding canvas padding. */
export function* quantizeImageListSteps(images: readonly { length: number; hasAlpha: boolean }[], requested: number, grayscale = false, treeDepth = 0): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const steps = quantizePixelSteps(images.reduce((sum, image) => sum + image.length, 0), requested, grayscale, treeDepth);
    let next = steps.next(), image = 0, start = 0;
    while (!next.done) {
        const request = next.value;
        if (!request || request.kind !== "read") { yield request; next = steps.next(); continue; }
        if (request.position < start) { image = 0; start = 0; }
        const data = new Uint8Array(request.length);
        for (let offset = 0; offset < data.length;) {
            const position = request.position + offset;
            while (position >= start + images[image]!.length) start += images[image++]!.length;
            const length = Math.min(data.length - offset, start + images[image]!.length - position);
            const bytes = yield { kind: "read", image, position: position - start, length };
            if (!bytes || bytes.length !== length) throw new Error("Truncated quantization pixels");
            data.set(bytes, offset);
            if (!images[image]!.hasAlpha) for (let i = offset + 3; i < offset + length; i += 4) data[i] = 255;
            offset += length;
        }
        next = steps.next(data);
    }
}

// Sums retain RGBA and RGB multiplied by alpha, so merged bins keep exact weights.
interface ColorBin { count: number; sums: number[]; color: number[]; node?: ColorNode }
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
export function* quantizePixelSteps(length: number, requested: number, grayscale = false, treeDepth = 0, hasAlpha = true, highDepth = false, cycle?: { amount: number; width: number; region?: Region | undefined; alphaActive: boolean; channels?: MaskChannels | undefined }): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("colors must be a positive integer");
    // Keep fractional palette means alongside byte output for later arithmetic and deeper output.
    const round = (value: number) => highDepth ? Math.round(value * 257) / 257 : Math.fround(value * 257) / 257;
    const prepare = (source: Uint8Array): Float64Array => {
        const data = highDepth ? Float64Array.from(new Uint16Array(source.slice().buffer), value => value / 257) : Float64Array.from(source);
        for (let i = 0; i < data.length; i += 4) {
            if (!hasAlpha) data[i + 3] = 255;
            if (grayscale) {
                const luma = 0.212656 * data[i]! + 0.715158 * data[i + 1]! + 0.072186 * data[i + 2]!;
                data[i] = data[i + 1] = data[i + 2] = requested === 2 ? (luma >= 127.5 ? 255 : 0) : Math.round(luma);
                // ImageMagick's two-color gray shortcut produces an opaque bilevel image.
                if (requested === 2) data[i + 3] = 255;
            }
            // Hidden RGB shares one transparent entry during classification and assignment.
            if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 0;
        }
        return data;
    };
    let bins = new Map<number | string, ColorBin>(), mask = 0xffffffff, precision = 8;
    const key = (data: Float64Array, i: number) => {
        // Native palette conversion classifies Q16 samples in byte-sized cubes,
        // but keeps full-precision sums for each cube's mean color.
        if (cycle !== undefined) {
            const alpha = data[i + 3]! / 255;
            return (Math.round(data[i]! * alpha) << 24 | Math.round(data[i + 1]! * alpha) << 16 | Math.round(data[i + 2]! * alpha) << 8 | Math.round(data[i + 3]!)) & mask;
        }
        return highDepth && precision === 8 ? data.subarray(i, i + 4).join(",") : (data[i]! << 24 | data[i + 1]! << 16 | data[i + 2]! << 8 | data[i + 3]!) & mask;
    };
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position), source = yield { kind: "read", highDepth, position, length: size };
        if (!source || source.length !== size * (highDepth ? 2 : 1)) throw new Error("Truncated quantization pixels");
        const data = prepare(source);
        if (grayscale && requested === 2) {
            yield { kind: "write", highDepth, position, data: highDepth ? new Uint8Array(Uint16Array.from(data, value => Math.round(value * 257)).buffer) : Uint8Array.from(data) };
            continue;
        }
        for (let i = 0; i < size; i += 4) {
            const id = key(data, i);
            let bin = bins.get(id);
            if (!bin) { bin = { count: 0, sums: [0, 0, 0, 0, 0, 0, 0], color: [] }; bins.set(id, bin); }
            bin.count++;
            for (let c = 0; c < 4; c++) bin.sums[c]! += data[i + c]!;
            for (let c = 0; c < 3; c++) bin.sums[c + 4]! += data[i + c]! * data[i + 3]!;
        }
        // Reduce histogram precision only when necessary; small palettes stay exact.
        if (bins.size > 65536) {
            const channelMask = (255 << (8 - --precision)) & 255;
            mask = channelMask * 0x01010101;
            const reduced = new Map<number | string, ColorBin>();
            let work = 0;
            for (const [id, bin] of bins) {
                if (++work % 1024 === 0) yield;
                const next = typeof id === "number" ? id & mask : key(Float64Array.from(id.split(","), Number), 0), existing = reduced.get(next);
                if (!existing) reduced.set(next, bin);
                else { existing.count += bin.count; for (let c = 0; c < 7; c++) existing.sums[c]! += bin.sums[c]!; }
            }
            bins = reduced;
        }
    }
    if (grayscale && requested === 2) return [0xff000000, 0xffffffff];
    const palette: number[][] = [];
    let work = 0;
    const channels = [...bins.values()].some(bin => bin.sums[3] !== 255 * bin.count) ? 4 : 3;
    if (bins.size <= requested && (channels === 3 || cycle !== undefined)) {
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
            const pixel = bin.sums.slice(0, 4).map((value, c) => c < 3 ? bin.sums[c + 4]! / bin.count / 255 : value / bin.count), midpoint = [127.5, 127.5, 127.5, 127.5];
            let node = root;
            for (let bit = 7; bit >= 0; bit--) {
                let id = 0, distance = 0;
                for (let c = 0; c < channels; c++) {
                    const high = (Math.round(pixel[c]!) >>> bit) & 1;
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
            bin.node = node;
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
        // palette in tree nodes, then prunes complete equal-error groups.
        const threshold = colors > requested ? remaining[Math.max(0, nodes - Math.floor(1.1 * (requested + 1)))]?.error ?? 0 : -1;
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
        for (const bin of bins.values()) {
            if (++work % 1024 === 0) yield;
            let node = bin.node!;
            while (node.removed) node = node.parent!;
            const pixel = bin.sums.slice(0, 4).map((value, c) => c < 3 ? bin.sums[c + 4]! / bin.count / 255 : value / bin.count);
            // Native assignment searches the deepest surviving cube's
            // siblings and descendants, comparing unrounded palette means.
            let cube = root;
            for (let bit = 7; bit > 0; bit--) {
                let id = 0;
                for (let c = 0; c < channels; c++) id |= ((Math.round(pixel[c]!) >>> bit) & 1) << c;
                const child = cube.children.get(id);
                if (!child || child.removed) break;
                cube = child;
            }
            let closest = Infinity;
            function* search(candidate: ColorNode): Generator<undefined> {
                if (++work % 1024 === 0) yield;
                for (let id = 0; id < 1 << channels; id++) {
                    const child = candidate.children.get(id);
                    if (child && !child.removed) yield* search(child);
                }
                if (!candidate.count) return;
                let distance = 0;
                for (let c = 0; c < channels; c++) {
                    const color = c < 3 ? candidate.sums[c + 4]! / candidate.count / 255 : candidate.sums[c]! / candidate.count;
                    // Native distance associates the already associated target again.
                    const target = c < 3 ? pixel[c]! * pixel[3]! / 255 : pixel[c]!;
                    distance += (color - target) ** 2;
                }
                if (distance <= closest) { closest = distance; node = candidate; }
            }
            yield* search(cube.parent ?? root);
            bin.color = nodeColors.get(node)!;
        }
    }
    const assigned = new Float64Array(4), clipped = new Float64Array(4);
    const indices = cycle ? new Map(palette.map((color, index) => [color, index])) : undefined;
    const shift = cycle ? ((cycle.amount % palette.length) + palette.length) % palette.length : 0;
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position), source = yield { kind: "read", highDepth, position, length: size };
        if (!source || source.length !== size * (highDepth ? 2 : 1)) throw new Error("Truncated quantization pixels");
        const data = new Float64Array(size), pixels = prepare(source);
        for (let i = 0; i < size; i += 4) {
            const color = bins.get(key(pixels, i))!.color;
            const pixel = (position + i) / 4;
            if (cycle?.region && !regionContains(cycle.region, pixel % cycle.width, Math.floor(pixel / cycle.width))) {
                // Palette assignment and SyncImage each clip while alpha is active.
                // Cycling then disables alpha, so protected pixels keep that result.
                assigned.set(color);
                for (let channel = 0; channel < 4; channel++) clipped[channel] = pixels[i + channel]!;
                blendMaskedPixel(clipped, clipped, assigned, 0, 1, 255, cycle.channels, cycle.alphaActive);
                blendMaskedPixel(clipped, clipped, assigned, 0, 1, 255, cycle.channels, cycle.alphaActive);
                data.set(clipped, i);
            } else data.set(cycle ? palette[(indices!.get(color)! + shift) % palette.length]! : color, i);
            if (cycle) data[i + 3] = 255;
        }
        if (!highDepth || cycle?.region) yield { kind: "write", evaluate: true, position, data: new Uint8Array(data.buffer) };
        yield { kind: "write", highDepth, position, data: highDepth ? new Uint8Array(Uint16Array.from(data, value => Math.round(value * 257)).buffer) : Uint8Array.from(data, Math.round) };
    }
    if (cycle) for (const color of palette) color[3] = 255;
    return palette.map(color => Math.round(color[3]!) * 16777216 + Math.round(color[0]!) * 65536 + Math.round(color[1]!) * 256 + Math.round(color[2]!));
}
