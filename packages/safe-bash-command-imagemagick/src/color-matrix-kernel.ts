import type { MagickGeometry } from "./index.js";
import { gaussianKernelWeights } from "./named-kernel.js";

// The first native kernel in each set is the one used by -color-matrix.
const defaultKernels: Record<string, number[]> = {
    freichen: [1, 0, -1, Math.SQRT2, 0, -Math.SQRT2, 1, 0, -1],
    roberts: [0, 0, 0, 1, -1, 0, 0, 0, 0],
    prewitt: [1, 0, -1, 1, 0, -1, 1, 0, -1],
    compass: [1, 1, -1, 1, -2, -1, 1, 1, -1],
    kirsch: [5, -3, -3, 5, 0, -3, 5, -3, -3],
    edges: [0, NaN, 1, 0, NaN, 1, 0, NaN, 1],
    corners: [NaN, 1, NaN, 0, NaN, 1, 0, 0, NaN],
    diagonals: [0, 0, 0, 0, NaN, 1, 1, 1, NaN],
    lineends: [0, 0, NaN, 0, 1, 1, 0, 0, NaN],
    linejunctions: [1, NaN, 1, NaN, 1, NaN, NaN, 1, NaN],
    ridges: [0, 1, 0],
    convexhull: [1, 1, NaN, 1, 0, NaN, 1, NaN, 0],
    thinse: [0, NaN, 1, 0, NaN, 1, 0, NaN, 1],
    skeleton: [0, NaN, 1, 0, NaN, 1, 0, NaN, 1],
};

export function namedColorMatrixKernel(name: string, geometry: MagickGeometry): { m: number[]; cols: number; rows: number } | undefined {
    const fixed = Object.hasOwn(defaultKernels, name) ? defaultKernels[name] : undefined;
    const generated = ["dog", "log", "comet", "binomial", "ring", "plus", "cross", "peaks", "chebyshev", "manhattan", "octagonal", "euclidean"].includes(name);
    if (!fixed && !generated) return undefined;
    const radius = geometry.width ?? 0, sigma = Math.abs(geometry.height ?? 0);
    if (![radius, sigma, geometry.x].every(Number.isFinite) || Math.abs(radius) >= 5000 || sigma >= 5000)
        throw new Error("Invalid color matrix: kernel radius exceeds 5000");
    if (fixed) {
        // These hit-and-miss sets and FreiChen are currently supported at their native defaults.
        if (radius !== 0 || sigma !== 0 || geometry.hasOffset)
            throw new Error("Invalid color matrix: unsupported named kernel arguments");
        return { m: fixed, cols: 3, rows: fixed.length / 3 };
    }

    let width: number, height: number;
    let weights: number[] | undefined;
    let positive = 0, negative = 0;
    if (name === "dog" || name === "log") {
        const sigma2 = Math.abs(geometry.x);
        if (sigma2 >= 5000) throw new Error("Invalid color matrix: kernel radius exceeds 5000");
        width = height = gaussianKernelWeights(radius, Math.max(sigma, name === "dog" ? sigma2 : 0), true).length;
        // Normalization needs the full kernel, while color-matrix consumes
        // only its top-left six columns/five rows.
        const half = (width - 1) / 2;
        const gaussian = (distance: number, deviation: number): number => deviation > 1e-12
            ? Math.exp(-distance / (2 * deviation * deviation)) / (2 * Math.PI * deviation * deviation)
            : Number(distance === 0);
        const coefficient = (x: number, y: number): number => {
            const distance = (x - half) ** 2 + (y - half) ** 2;
            if (name === "dog") return gaussian(distance, sigma) - gaussian(distance, sigma2);
            if (sigma <= 1e-12) return Number(distance === 0);
            const r = distance / (2 * sigma * sigma);
            return (1 - r) * Math.exp(-r) / (Math.PI * sigma ** 4);
        };
        // Symmetry bounds normalization work to one quadrant without allocating
        // a spatial-sized matrix. Account for reflected axes and diagonals.
        for (let y = 0; y <= half; y++) for (let x = 0; x <= y; x++) {
            const value = coefficient(x, y);
            const count = (x === half ? 1 : 2) * (y === half ? 1 : 2) * (x === y ? 1 : 2);
            positive += Math.max(0, value) * count;
            negative -= Math.min(0, value) * count;
        }
        weights = [];
        for (let y = 0; y < Math.min(5, height); y++) for (let x = 0; x < Math.min(6, width); x++) {
            const value = coefficient(x, y);
            const sum = value >= 0 ? positive : negative;
            weights.push(value / (sum >= 1e-12 ? sum : 1));
        }
    } else if (name === "comet") {
        width = radius >= 1 ? Math.floor(radius) : (gaussianKernelWeights(radius, sigma, false).length + 1) / 2;
        height = 1;
        weights = [];
        for (let x = 0; x < width; x++) {
            let weight = sigma <= 1e-12 ? Number(x === 0) : 0;
            if (sigma > 1e-12) for (let sub = 0; sub < 3; sub++)
                weight += Math.exp(-((x + sub / 3) ** 2) / (2 * sigma * sigma));
            weights.push(weight);
            positive += weight;
        }
        weights = weights.map(weight => weight / positive);
        const angle = (geometry.x % 360 + 360) % 360;
        if (angle > 135 && angle <= 315) weights.reverse();
        if (angle > 45 && angle <= 135 || angle > 225 && angle <= 315) [width, height] = [height, width];
    } else {
        const half = name === "ring" || name === "peaks" ? Math.max(radius, sigma) < 1 ? 3 : Math.floor(Math.max(radius, sigma))
            : Math.max(name === "octagonal" ? 2 : radius < 1 && (name === "plus" || name === "cross") ? 2 : 1, Math.floor(radius));
        width = height = half * 2 + 1;
        if (name === "binomial") {
            if (half > 10) throw new Error("Invalid color matrix: Binomial radius exceeds 10");
            weights = [1];
            for (let x = 1; x < width; x++) weights.push(weights[x - 1]! * (width - x) / x);
        }
    }
    const cols = Math.min(6, width), rows = Math.min(5, height);
    if (name === "dog" || name === "log") return { m: weights!, cols, rows };
    const half = (width - 1) / 2;
    const distanceScale = geometry.height === undefined ? 100 : geometry.forceExact ? 65535 / (geometry.height + 1)
        : geometry.isPercent ? geometry.height * 65535 / 100 : geometry.height;
    const m: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const dx = Math.abs(x - half), dy = Math.abs(y - half);
        if (name === "comet") m.push(weights![height === 1 ? x : y]!);
        else if (name === "binomial") m.push(weights![x]! * weights![y]!);
        else if (name === "plus") m.push(dx === 0 || dy === 0 ? geometry.height ?? 1 : NaN);
        else if (name === "cross") m.push(dx === dy ? geometry.height ?? 1 : NaN);
        else if (name === "ring" || name === "peaks") {
            const outer = Math.trunc(Math.max(radius * radius, sigma * sigma));
            const inner = Math.trunc(Math.min(radius * radius, sigma * sigma));
            const distance = dx * dx + dy * dy;
            const inside = (outer > 0 ? inner : 7) < distance && distance <= (outer > 0 ? outer : 11);
            m.push(name === "peaks" && distance === 0 ? 1 : inside ? name === "peaks" ? 0 : Math.trunc(geometry.hasOffset ? geometry.x : 1) : NaN);
        } else {
            const distance = name === "chebyshev" ? Math.max(dx, dy) : name === "manhattan" ? dx + dy
                : name === "octagonal" ? Math.max(Math.max(dx, dy), Math.floor((dx + dy + 1) / 1.5)) : Math.hypot(dx, dy);
            m.push(distance * distanceScale);
        }
    }
    return { m, cols, rows };
}
