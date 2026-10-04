import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
export interface WarpPlan {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
    map(x: number, y: number): readonly [number, number];
}
/** Bilinear sampling preserves the legacy edge extension, channel rounding and alpha. */
export function* warpPixelSteps(source: { width: number; height: number }, plan: WarpPlan, background: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = source, samples = new Int32Array(4);
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            const [sx, sy] = plan.map((start + i) % plan.width, Math.floor((start + i) / plan.width)), offset = i * 4;
            if (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5) {
                data[offset] = background.r; data[offset + 1] = background.g; data[offset + 2] = background.b; data[offset + 3] = background.a;
                continue;
            }
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
            const x1 = Math.max(0, Math.min(width - 1, x0 + 1)), y1 = Math.max(0, Math.min(height - 1, y0 + 1));
            const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
            for (let corner = 0; corner < 4; corner++) {
                const position = ((corner < 2 ? y0 : y1) * width + (corner % 2 === 0 ? x0 : x1)) * 4;
                const bytes = yield { kind: "read", position, length: 4 };
                if (!bytes || bytes.length !== 4) throw new Error("Truncated warp pixels");
                samples[corner] = bytes[0]! | bytes[1]! << 8 | bytes[2]! << 16 | bytes[3]! << 24;
            }
            for (let c = 0; c < 4; c++) {
                const v0 = (samples[0]! >>> (c * 8) & 255) * (1 - fx) + (samples[1]! >>> (c * 8) & 255) * fx;
                const v1 = (samples[2]! >>> (c * 8) & 255) * (1 - fx) + (samples[3]! >>> (c * 8) & 255) * fx;
                data[offset + c] = Math.max(0, Math.min(255, Math.round(v0 * (1 - fy) + v1 * fy)));
            }
        }
        yield { kind: "write", position: start * 4, data };
    }
}
