import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
import { solveLinearSystem } from "./linear-system.js";

type Point = { x: number; y: number; color: number[] };
type SparseColor = { method: string; points: Point[]; coefficients?: number[][] };

export function parseSparseColor(method: string, spec: string, parseColor: (value: string) => RgbaColor): SparseColor {
    const normalized = method.toLowerCase();
    if (!["voronoi", "manhattan", "shepards", "inverse", "barycentric", "bilinear"].includes(normalized))
        throw new Error(`unrecognized sparse color method '${method}'`);
    const tokens: string[] = [];
    let token = "", parentheses = 0, quote = "";
    for (const character of spec) {
        if (quote) {
            if (character === quote) quote = "";
            else token += character;
        } else if (character === "'" || character === '"') quote = character;
        else if (character === "(") { parentheses++; token += character; }
        else if (character === ")") { parentheses--; token += character; }
        else if (parentheses === 0 && (character === "," || character.trim() === "")) {
            if (token) { tokens.push(token); token = ""; }
        } else token += character;
    }
    if (token) tokens.push(token);
    if (quote || parentheses || !tokens.length || tokens.length % 3 !== 0)
        throw new Error("invalid argument for option '-sparse-color': control points require x,y,color");
    const points: Point[] = [];
    for (let index = 0; index < tokens.length; index += 3) {
        const x = Number(tokens[index]), y = Number(tokens[index + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error("invalid argument for option '-sparse-color': invalid coordinates");
        const color = parseColor(tokens[index + 2]!);
        points.push({ x, y, color: [color.r, color.g, color.b, color.a].map(value => value / 255) });
    }
    const plan: SparseColor = { method: normalized, points };
    if (normalized !== "barycentric" && normalized !== "bilinear") return plan;
    const bilinear = normalized === "bilinear" && points.length >= 4;
    if (points.length === 1) {
        plan.coefficients = points[0]!.color.map(value => [0, 0, value]);
        return plan;
    }
    const fitting = [...points];
    if (points.length === 2) {
        const [first, second] = points as [Point, Point];
        fitting.push({ x: first.x - (second.y - first.y), y: first.y + second.x - first.x, color: first.color });
    }
    const size = bilinear ? 4 : 3;
    const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const values = Array.from({ length: 4 }, () => Array<number>(size).fill(0));
    for (const point of fitting) {
        const terms = bilinear ? [point.x, point.y, point.x * point.y, 1] : [point.x, point.y, 1];
        for (let row = 0; row < size; row++) {
            for (let column = 0; column < size; column++) matrix[row]![column]! += terms[row]! * terms[column]!;
            for (let channel = 0; channel < 4; channel++) values[channel]![row]! += terms[row]! * point.color[channel]!;
        }
    }
    plan.coefficients = values.map(value => solveLinearSystem(matrix, value));
    return plan;
}

export function* sparseColorPixels(image: RgbaImage, plan: SparseColor, channels?: { r: boolean; g: boolean; b: boolean; a?: boolean }, pixelOffset = 0, imageWidth = image.width): Generator<void, RgbaImage, void> {
    const data = new Uint8Array(image.data.length), data16 = new Uint16Array(data.length), evaluateSamples = new Float64Array(data.length);
    const selected = [channels?.r ?? true, channels?.g ?? true, channels?.b ?? true, image.hasAlpha && (channels?.a ?? true)];
    let work = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
        const pixel = pixelOffset + offset / 4, x = pixel % imageWidth, y = Math.floor(pixel / imageWidth);
        let color = [0, 0, 0, 0];
        if (plan.coefficients) {
            color = plan.coefficients.map(coeff => coeff.length === 4
                ? coeff[0]! * x + coeff[1]! * y + coeff[2]! * x * y + coeff[3]!
                : coeff[0]! * x + coeff[1]! * y + coeff[2]!);
        } else {
            let minimum = Infinity, total = 0;
            for (const point of plan.points) {
                if (++work % 4096 === 0) yield;
                const dx = x - point.x, dy = y - point.y;
                const distance = plan.method === "manhattan" ? Math.abs(dx) + Math.abs(dy) : dx * dx + dy * dy;
                if (plan.method === "voronoi" || plan.method === "manhattan") {
                    if (distance < minimum) { minimum = distance; color = point.color; }
                } else {
                    // Native caps weights at one, including at a control point.
                    const weight = 1 / Math.max(1, plan.method === "inverse" ? Math.sqrt(distance) : distance);
                    total += weight;
                    for (let channel = 0; channel < 4; channel++) color[channel]! += point.color[channel]! * weight;
                }
            }
            if (total) color = color.map(value => value / total);
        }
        for (let channel = 0; channel < 4; channel++) {
            const index = offset + channel;
            const value = selected[channel] ? Math.fround(color[channel]! * 65535) / 257
                : image.evaluateSamples?.[index] ?? (image.data16 ? image.data16[index]! / 257 : image.data[index]!);
            // Native Q16-HDRI stores float32 quantum samples, then clamps.
            // Preserve that rounding before exporting 8-bit or 16-bit pixels.
            evaluateSamples[index] = selected[channel] ? Math.max(0, Math.min(255, value)) : value;
            data[index] = Math.round(Math.max(0, Math.min(255, value)));
            data16[index] = Math.round(Math.max(0, Math.min(65535, value * 257)));
        }
        if (++work % 4096 === 0) yield;
    }
    return { ...image, data, data16, evaluateSamples, space: "srgb", channels: image.hasAlpha ? 4 : 3, isPalette: false };
}
