import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
export interface WarpPlan {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
    readonly virtualCanvas?: RgbaImage["virtualCanvas"];
    derivatives?(x: number, y: number): readonly [number, number, number, number];
    map(x: number, y: number): readonly [number, number];
}
export type VirtualPixelMethod = "edge" | "background" | "transparent" | "black" | "white" | "gray" | "tile" | "mirror";

// ImageMagick's default radial Robidoux filter, indexed by squared distance.
const robidoux = Float64Array.from({ length: 1024 }, (_, i) => {
    const x = Math.sqrt(i) / 16, b = 0.3782157550939987, c = 0.3108921224530007;
    return x < 1
        ? ((12 - 9 * b - 6 * c) * x ** 3 + (-18 + 12 * b + 6 * c) * x * x + 6 - 2 * b) / 6
        : ((-b - 6 * c) * x ** 3 + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + 8 * b + 24 * c) / 6;
});

function* ellipseSamples(sx: number, sy: number, [ux, uy, vx, vy]: readonly [number, number, number, number]): Generator<readonly [number, number, number] | undefined> {
    // Singular values of the inverse mapping, clamped to at least one source pixel.
    const xx = ux * ux + uy * uy, yy = vx * vx + vy * vy, xy = ux * vx + uy * vy;
    const delta = Math.hypot(xx - yy, 2 * xy), major = Math.max(1, (xx + yy + delta) / 2), minor = Math.max(1, (xx + yy - delta) / 2);
    const angle = Math.atan2(2 * xy, xx - yy) / 2, cos = Math.cos(angle), sin = Math.sin(angle);
    const a = major * sin * sin + minor * cos * cos, b = -2 * (major - minor) * cos * sin, c = major * cos * cos + minor * sin * sin;
    const f = 4 * major * minor, vLimit = Math.sqrt(a * f / (a * c - b * b / 4)), uWidth = Math.sqrt(f / a), slope = -b / (2 * a);
    if (![sx, sy, vLimit, uWidth].every(Number.isFinite) || uWidth * vLimit > 1_000_000
        || !Number.isSafeInteger(Math.ceil(Math.abs(sx) + uWidth + Math.abs(slope * vLimit)))
        || !Number.isSafeInteger(Math.ceil(Math.abs(sy) + vLimit)))
        throw new Error("Distortion sampling area exceeds limit");
    const scale = 1024 / f, A = a * scale, B = b * scale, C = c * scale;
    const firstY = Math.ceil(sy - vLimit), lastY = Math.floor(sy + vLimit), count = Math.floor(2 * uWidth) + 1;
    let left = sx + (firstY - sy) * slope - uWidth, scanned = 0;
    for (let y = firstY; y <= lastY; y++, left += slope) {
        const firstX = Math.ceil(left), u = firstX - sx, v = y - sy;
        let q = (A * u + B * v) * u + C * v * v, dq = A * (2 * u + 1) + B * v;
        for (let i = 0; i < count; i++, q += dq, dq += 2 * A) {
            if (++scanned % 1024 === 0) yield;
            const index = Math.trunc(q);
            if (index >= 0 && index < 1024) yield [firstX + i, y, robidoux[index]!];
        }
    }
}

export function* warpPixelSteps(source: { width: number; height: number }, plan: WarpPlan, background: RgbaColor, virtualPixel?: VirtualPixelMethod): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = source;
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            const px = (start + i) % plan.width, py = Math.floor((start + i) / plan.width);
            const [sx, sy] = plan.map(px, py), offset = i * 4;
            if (virtualPixel === undefined && (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5)) {
                data[offset] = background.r; data[offset + 1] = background.g; data[offset + 2] = background.b; data[offset + 3] = background.a;
                continue;
            }
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const x0 = virtualPixel ? Math.floor(sx) : Math.max(0, Math.min(width - 1, Math.floor(sx))), y0 = virtualPixel ? Math.floor(sy) : Math.max(0, Math.min(height - 1, Math.floor(sy)));
            const x1 = virtualPixel ? x0 + 1 : Math.max(0, Math.min(width - 1, x0 + 1)), y1 = virtualPixel ? y0 + 1 : Math.max(0, Math.min(height - 1, y0 + 1));
            const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
            const derivatives = plan.derivatives?.(px, py);
            const samples: Iterable<readonly [number, number, number] | undefined> = derivatives ? ellipseSamples(sx, sy, derivatives) : [
                [x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)],
                [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]
            ];
            let red = 0, green = 0, blue = 0, alpha = 0, total = 0, colorTotal = 0;
            for (const sample of samples) {
                if (!sample) { yield; continue; }
                let [x, y, weight] = sample;
                let pixel: number | undefined;
                if (x < 0 || y < 0 || x >= width || y >= height) {
                    if (virtualPixel === "tile" || virtualPixel === "mirror") {
                        const period = virtualPixel === "mirror" ? 2 : 1;
                        x = ((x % (width * period)) + width * period) % (width * period);
                        y = ((y % (height * period)) + height * period) % (height * period);
                        if (x >= width) x = width * 2 - x - 1;
                        if (y >= height) y = height * 2 - y - 1;
                    } else if (virtualPixel === "edge") {
                        x = Math.max(0, Math.min(width - 1, x));
                        y = Math.max(0, Math.min(height - 1, y));
                    } else {
                        const gray = virtualPixel === "white" ? 255 : virtualPixel === "gray" ? 128 : 0;
                        pixel = virtualPixel === "background"
                            ? background.r | background.g << 8 | background.b << 16 | background.a << 24
                            : gray | gray << 8 | gray << 16 | (virtualPixel === "transparent" ? 0 : 255) << 24;
                    }
                }
                if (pixel === undefined) {
                    const bytes = yield { kind: "read", position: (y * width + x) * 4, length: 4 };
                    if (!bytes || bytes.length !== 4) throw new Error("Truncated warp pixels");
                    pixel = bytes[0]! | bytes[1]! << 8 | bytes[2]! << 16 | bytes[3]! << 24;
                }
                const opacity = pixel >>> 24;
                alpha += opacity * weight; total += weight;
                if (derivatives) weight *= opacity / 255;
                red += (pixel & 255) * weight;
                green += (pixel >>> 8 & 255) * weight;
                blue += (pixel >>> 16 & 255) * weight;
                colorTotal += weight;
            }
            const values = [red / colorTotal, green / colorTotal, blue / colorTotal, alpha / total];
            for (let c = 0; c < 4; c++) data[offset + c] = Math.max(0, Math.min(255, Math.round(values[c]!)));
        }
        yield { kind: "write", position: start * 4, data };
    }
}
