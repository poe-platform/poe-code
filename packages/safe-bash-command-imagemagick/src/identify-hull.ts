import type { RgbaImage, StoredRgbaImage, ImageByteStorage } from "@poe-code/image-ast/portable";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatSignificantMetric } from "./compare-kernel.js";

type Point = { x: number; y: number };
type Read = { position: number; length: number };
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function* identifyHullSteps(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, precision: number): Generator<Read | undefined, Record<string, string>, Uint8Array | Uint16Array | undefined> {
    // Only the endpoints of each foreground row can be hull vertices.
    const points: Point[] = [];
    let background: number[] | undefined, first = -1, last = -1;
    for (let position = 0; position < image.width * image.height * 4; position += 4096) {
        yield;
        const length = Math.min(4096, image.width * image.height * 4 - position);
        const samples = yield { position, length };
        if (!samples || samples.length !== length) throw new Error("Truncated convex hull pixels");
        background ??= Array.from(samples.subarray(0, 4));
        for (let i = 0; i < length; i += 4) {
            const pixel = (position + i) / 4, x = pixel % image.width, y = Math.floor(pixel / image.width);
            const transparent = image.hasAlpha && samples[i + 3] === 0 && background[3] === 0;
            if (!transparent && (samples[i] !== background[0] || samples[i + 1] !== background[1] || samples[i + 2] !== background[2] || (image.hasAlpha && samples[i + 3] !== background[3]))) {
                if (first < 0) first = x;
                last = x;
            }
            if (x === image.width - 1) {
                if (first >= 0) { points.push({ x: first, y }); if (last !== first) points.push({ x: last, y }); }
                first = last = -1;
            }
        }
    }
    if (!points.length) return {};
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const lower: Point[] = [], upper: Point[] = [];
    for (let i = 0; i < points.length; i++) {
        if (i % 1024 === 0) yield;
        for (const [chain, point] of [[lower, points[i]!], [upper, points[points.length - 1 - i]!]] as const) {
            while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) chain.pop();
            chain.push(point);
        }
    }
    const hull = points.length === 1 ? points : [...lower.slice(0, -1), ...upper.slice(0, -1)];
    let start = 0;
    for (let i = 1; i < hull.length; i++) if (hull[i]!.y < hull[start]!.y || (hull[i]!.y === hull[start]!.y && hull[i]!.x < hull[start]!.x)) start = i;
    const ordered = [...hull.slice(start), ...hull.slice(0, start)];
    let area = Infinity, box: Point[] = [];
    for (let i = 0; i < ordered.length && ordered.length > 1; i++) {
        const a = ordered[i]!, b = ordered[(i + 1) % ordered.length]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (let j = 0; j < ordered.length; j++) {
            if (j % 1024 === 0) yield;
            const p = ordered[j]!, u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux;
            minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        const candidate = (maxU - minU) * (maxV - minV);
        if (candidate < area - 1e-10) {
            area = candidate;
            box = [{ x: maxU * ux - minV * uy, y: maxU * uy + minV * ux }];
            // ImageMagick keeps the first corner fractional, then rounds each
            // subsequent corner before using it as the next edge's origin.
            for (const [du, dv] of [[0, maxV - minV], [minU - maxU, 0], [0, minV - maxV]] as const) {
                const previous = box[box.length - 1]!;
                box.push({ x: Math.floor(previous.x + du * ux - dv * uy + 0.5), y: Math.floor(previous.y + du * uy + dv * ux + 0.5) });
            }
        }
    }
    const format = (p: Point) => `${formatSignificantMetric(Math.abs(p.x) < 1e-10 ? 0 : p.x, precision)},${formatSignificantMetric(Math.abs(p.y) < 1e-10 ? 0 : p.y, precision)}`;
    return {
        "convex-hull": `${[...ordered, ...(ordered.length > 1 ? [ordered[0]!] : [])].map(format).join(" ")} `,
        "minimum-bounding-box": `${box.length ? box.map(format).join(" ") : "0,0 inf,inf inf,inf nan,nan"} `
    };
}

export function formatIdentifyHull(properties: Record<string, string>): string {
    return properties["convex-hull"] === undefined ? "" : `  Convex hull: ${properties["convex-hull"]}\n  Minimum bounding box: ${properties["minimum-bounding-box"]}\n`;
}

export async function identifyStoredHull(image: StoredRgbaImage, storage: ImageByteStorage, precision: number, signal: AbortSignal): Promise<string> {
    const steps = identifyHullSteps(image, precision);
    let next = steps.next();
    while (!next.done) {
        signal.throwIfAborted();
        if (!next.value) { await yieldTurn(signal); next = steps.next(); }
        else {
            const { position, length } = next.value, size = image.storedData16 ? 2 : 1;
            const bytes = await storage.read((image.storedData16?.position ?? image.position) + position * size, length * size, { signal });
            next = steps.next(size === 2 ? new Uint16Array(new Uint8Array(bytes).buffer) : bytes);
        }
    }
    return formatIdentifyHull(next.value);
}
