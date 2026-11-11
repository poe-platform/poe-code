import type { ConvolveRequest } from "./convolve-kernel.js";

type Interval = { left: number; right: number; level: number; children: Interval[]; stability: number };
type Region = { left: number; right: number };

function derivative(histogram: Float64Array): Float64Array {
    const result = new Float64Array(256);
    result[0] = -1.5 * histogram[0]! + 2 * histogram[1]! - 0.5 * histogram[2]!;
    result[255] = 0.5 * histogram[253]! - 2 * histogram[254]! + 1.5 * histogram[255]!;
    for (let i = 1; i < 255; i++) result[i] = (histogram[i + 1]! - histogram[i - 1]!) / 2;
    return result;
}

/** Native scale-space intervals, including its endpoint and crossing conventions. */
function* histogramRegions(histogram: Float64Array, smoothing: number): Generator<undefined, Region[]> {
    const levels: { tau: number; histogram: Float64Array; crossings: Int16Array }[] = [];
    for (let tau = Math.fround(5.2); ; tau -= 0.5) {
        const original = tau < 0.2, filtered = original ? histogram : new Float64Array(256);
        if (!original) {
            const weights = new Float64Array(256);
            for (let x = 0; x < 256; x++) {
                weights[x] = Math.exp(-x * x / (2 * tau * tau));
                if (weights[x]! < 1e-12) break;
            }
            for (let x = 0; x < 256; x++) {
                yield;
                let sum = 0;
                for (let u = 0; u < 256; u++) sum += histogram[u]! * weights[Math.abs(x - u)]!;
                filtered[x] = sum / (tau * Math.sqrt(2 * Math.PI));
            }
        }
        const second = derivative(derivative(filtered)), crossings = new Int16Array(256);
        let parity = 0;
        for (let i = 0; i < 256; i++) {
            const value = second[i]! < smoothing && second[i]! >= -smoothing ? 0 : second[i]!;
            if (value < 0) {
                if (parity > 0) crossings[i] = -1;
                parity = 1;
            } else if (value > 0) {
                if (parity < 0) crossings[i] = 1;
                parity = -1;
            }
        }
        levels.push({ tau: original ? 0 : tau, histogram: filtered, crossings });
        if (original) break;
    }
    // Join adjacent scales while retaining an even number of intervening crossings.
    for (let i = levels.length - 2; i >= 0; i--) {
        const current = levels[i]!.crossings, finer = levels[i + 1]!.crossings;
        for (let j = 0; j < 256; j++) {
            if (!current[j]) continue;
            let left = j - 1, right = j + 1, previous = j - 1;
            while (left > 0 && !finer[left]) left--;
            while (right < 255 && !finer[right]) right++;
            while (previous > 0 && !current[previous]) previous--;
            left = Math.max(0, left); right = Math.min(255, right); previous = Math.max(0, previous);
            let correct = -1;
            for (const candidate of [...(finer[j] ? [j] : []), left, right]) {
                let count = 0;
                for (let k = previous + 1; k < candidate; k++) if (finer[k]) count++;
                if (count % 2 === 0 && candidate !== previous) { correct = candidate; break; }
            }
            const sign = current[j]!;
            current[j] = 0;
            if (correct >= 0) current[correct] = sign;
        }
    }
    for (const { crossings } of levels) {
        let first = 0, last = 255;
        while (first < 255 && !crossings[first]) first++;
        crossings[0] = -crossings[first]!;
        while (last > 0 && !crossings[last]) last--;
        crossings[255] = -crossings[last]!;
    }
    const root: Interval = { left: 0, right: 255, level: -1, children: [], stability: 0 };
    let leaves = [root];
    for (let level = 0; level < levels.length; level++) {
        const next: Interval[] = [];
        for (const node of leaves) {
            let left = node.left;
            for (let k = left + 1; k < node.right; k++) {
                if (!levels[level]!.crossings[k]) continue;
                node.children.push({ left, right: k, level, children: [], stability: 0 });
                left = k;
            }
            if (left !== node.left) {
                node.children.push({ left, right: node.right, level, children: [], stability: 0 });
                node.stability = (levels[node.level]?.tau ?? 0) - levels[level]!.tau;
                next.push(...node.children);
            } else next.push(node);
        }
        leaves = next;
    }
    const extrema = new Int16Array(256);
    function visit(node: Interval): void {
        const level = levels[node.level]!, peak = level.crossings[node.right] === -1;
        let index = node.left;
        for (let x = node.left; x <= node.right; x++) {
            if (peak ? level.histogram[x]! > level.histogram[index]! : level.histogram[x]! < level.histogram[index]!) index = x;
        }
        extrema.fill((peak ? 1 : -1) * (index || 256), node.left, node.right + 1);
    }
    // Native traverses siblings before descendants when a node is inactive.
    function active(nodes: Interval[]): Interval[] {
        if (!nodes.length) return [];
        const [node, ...siblings] = nodes;
        const mean = node!.children.reduce((sum, child) => sum + child.stability, 0) / (node!.children.length || 1);
        return node!.stability >= mean ? [node!, ...active(siblings)] : [...active(siblings), ...active(node!.children)];
    }
    active(root.children).forEach(visit);
    const regions: Region[] = [];
    for (let index = 0; index < 256;) {
        while (index < 256 && extrema[index]! <= 0) index++;
        if (index === 256) break;
        const left = index;
        while (index < 256 && extrema[index]! >= 0) index++;
        regions.push({ left, right: index - 1 });
    }
    return regions;
}

/** RGB segmentation with fixed 256-bin histograms and bounded pixel reads. */
export function* segmentPixelSteps(length: number, clusterThreshold: number, smoothing: number): Generator<ConvolveRequest | undefined, number[], Uint8Array | undefined> {
    const histograms = Array.from({ length: 3 }, () => new Float64Array(256));
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const pixels = yield { kind: "read", position, length: size };
        if (!pixels || pixels.length !== size) throw new Error("Truncated segment pixels");
        for (let i = 0; i < size; i += 4) for (let c = 0; c < 3; c++) histograms[c]![pixels[i + c]!]!++;
    }
    const regions: Region[][] = [];
    for (const histogram of histograms) regions.push(yield* histogramRegions(histogram, smoothing || 1));
    const missing = regions.findIndex(channel => channel.length === 0);
    if (missing >= 0) {
        // DefineRegion resets visited channels; unvisited channels remain zeroed.
        for (let c = 0; c < 3; c++) regions[c] = [{ left: 0, right: c <= missing ? 255 : 0 }];
    }
    const lookup = regions.map(channel => Int16Array.from({ length: 256 }, (_, value) => channel.findIndex(region => value >= region.left - 3 && value <= region.right + 3)));
    type Cluster = { key: number; regions: Region[]; count: number; center: number[] };
    const occupied = new Map<number, Cluster>();
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const pixels = yield { kind: "read", position, length: size };
        if (!pixels || pixels.length !== size) throw new Error("Truncated segment pixels");
        for (let i = 0; i < size; i += 4) {
            const indices = lookup.map((channel, c) => channel[pixels[i + c]!]!);
            if (indices.some(index => index < 0)) continue;
            const key = (indices[0]! * 256 + indices[1]!) * 256 + indices[2]!;
            let cluster = occupied.get(key);
            if (!cluster) {
                if (occupied.size >= 65536) throw new Error("Segment cluster limit exceeded");
                cluster = { key, regions: indices.map((index, c) => regions[c]![index]!), count: 0, center: [0, 0, 0] };
                occupied.set(key, cluster);
            }
            cluster.count++;
            for (let c = 0; c < 3; c++) cluster.center[c]! += pixels[i + c]!;
        }
    }
    const clusters: Cluster[] = [];
    for (const cluster of [...occupied.values()].sort((a, b) => a.key - b.key)) {
        // Native compares with the number of retained clusters, not pixel count.
        if (cluster.count < clusters.length * clusterThreshold / 100) continue;
        cluster.center = cluster.center.map(sum => Math.floor(sum / cluster.count + 0.5));
        clusters.push(cluster);
        if (clusters.length > 256) throw new Error("Too many segment clusters");
    }
    for (let position = 0; position < length; position += 4096) {
        yield;
        const size = Math.min(4096, length - position);
        const pixels = yield { kind: "read", position, length: size };
        if (!pixels || pixels.length !== size) throw new Error("Truncated segment pixels");
        const output = pixels.slice();
        for (let i = 0; i < size; i += 4) {
            if (i % 64 === 0) yield;
            let selected = clusters.find(cluster => cluster.regions.every((region, c) => pixels[i + c]! >= region.left - 3 && pixels[i + c]! <= region.right + 3));
            if (!selected) {
                let distance = Infinity;
                for (const cluster of clusters) {
                    const candidate = cluster.center.reduce((sum, value, c) => sum + (pixels[i + c]! - value) ** 2, 0);
                    if (candidate < distance) { selected = cluster; distance = candidate; }
                }
            }
            for (let c = 0; c < 3; c++) output[i + c] = selected?.center[c] ?? 0;
            output[i + 3] = 255;
        }
        const high = Uint16Array.from(output, value => value * 257);
        yield { kind: "write", highDepth: true, position, data: new Uint8Array(high.buffer) };
        const samples = Float64Array.from(output);
        yield { kind: "write", evaluate: true, position, data: new Uint8Array(samples.buffer) };
    }
    return (clusters.length ? clusters.map(cluster => cluster.center) : [[0, 0, 0]]).map(color => 0xff000000 + color[0]! * 65536 + color[1]! * 256 + color[2]!);
}
