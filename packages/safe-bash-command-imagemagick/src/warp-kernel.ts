import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
export interface WarpPlan {
    readonly width: number;
    readonly height: number;
    readonly hasAlpha: boolean;
    readonly virtualCanvas?: RgbaImage["virtualCanvas"];
    map(x: number, y: number): readonly [number, number];
}
export type VirtualPixelMethod = "edge" | "background" | "transparent" | "black" | "white" | "gray" | "tile" | "mirror";

/** Bilinear sampling resolves each neighbor through the selected virtual pixels. */
export function* warpPixelSteps(source: { width: number; height: number }, plan: WarpPlan, background: RgbaColor, virtualPixel?: VirtualPixelMethod): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const { width, height } = source, samples = new Int32Array(4);
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = new Uint8Array(count * 4);
        for (let i = 0; i < count; i++) {
            const [sx, sy] = plan.map((start + i) % plan.width, Math.floor((start + i) / plan.width)), offset = i * 4;
            if (virtualPixel === undefined && (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5)) {
                data[offset] = background.r; data[offset + 1] = background.g; data[offset + 2] = background.b; data[offset + 3] = background.a;
                continue;
            }
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const x0 = virtualPixel ? Math.floor(sx) : Math.max(0, Math.min(width - 1, Math.floor(sx))), y0 = virtualPixel ? Math.floor(sy) : Math.max(0, Math.min(height - 1, Math.floor(sy)));
            const x1 = virtualPixel ? x0 + 1 : Math.max(0, Math.min(width - 1, x0 + 1)), y1 = virtualPixel ? y0 + 1 : Math.max(0, Math.min(height - 1, y0 + 1));
            const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
            for (let corner = 0; corner < 4; corner++) {
                let x = corner % 2 === 0 ? x0 : x1, y = corner < 2 ? y0 : y1;
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
                        samples[corner] = virtualPixel === "background"
                            ? background.r | background.g << 8 | background.b << 16 | background.a << 24
                            : gray | gray << 8 | gray << 16 | (virtualPixel === "transparent" ? 0 : 255) << 24;
                        continue;
                    }
                }
                const position = (y * width + x) * 4;
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
