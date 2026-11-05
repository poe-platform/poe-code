import type { RgbaColor, RgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";

/** Native shear uses pixel-edge centers and crops the bordered, sequential X/Y shear. */
export function shearPlan(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, spec: string) {
    const [xAngle = "0", yAngle = "0"] = spec.toLowerCase().split("x");
    const tx = -Math.tan((parseFloat(xAngle) || 0) * Math.PI / 180), ty = Math.tan((parseFloat(yAngle) || 0) * Math.PI / 180);
    const w = image.width, h = image.height;
    const spanX = w + Math.abs(tx) * h, spanY = Math.abs(ty) * w + Math.abs(1 + tx * ty) * h;
    const width = Math.max(1, Math.round(spanX)), height = Math.max(1, Math.round(spanY));
    const borderX = Math.ceil(spanX / 2 - 0.5), borderY = Math.ceil((h + Math.abs(ty) * width) / 2 - 0.5);
    const fullWidth = w + 2 * borderX, fullHeight = h + 2 * borderY;
    return { width, height, hasAlpha: image.hasAlpha, tx, ty, borderX,
        offsetX: Math.ceil((fullWidth - spanX) / 2 - 0.5),
        offsetY: Math.ceil((fullHeight - spanY) / 2 - 0.5) - borderY,
        columnOffset: Math.floor((fullWidth - width) / 2) };
}

export function* shearPixelSteps(source: { width: number; height: number }, plan: ReturnType<typeof shearPlan>, background: RgbaColor): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const bg = [background.r, background.g, background.b, background.a];
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = new Uint8Array(count * 4);
        if (plan.tx === 0 && plan.ty === 0) {
            const bytes = yield { kind: "read", position: start * 4, length: count * 4 };
            if (!bytes || bytes.length !== count * 4) throw new Error("Truncated shear pixels");
            yield { kind: "write", position: start * 4, data: bytes };
            continue;
        }
        for (let i = 0; i < count; i++) {
            const x = (start + i) % plan.width + plan.offsetX;
            const column = x - plan.columnOffset;
            const displacement = column >= 0 && column < plan.width ? plan.ty * (column - plan.width / 2) : 0;
            const sy = Math.floor((start + i) / plan.width) + plan.offsetY - displacement;
            const y0 = Math.floor(sy), fy = sy - y0;
            const channels = [0, 0, 0, 0];
            // Keep the horizontal blend unrounded until the vertical blend completes.
            // Premultiplied colors also interpolate correctly against transparent background.
            for (let row = 0; row < 2; row++) {
                const y = y0 + row, wy = row === 0 ? 1 - fy : fy;
                if (wy === 0) continue;
                const sx = x - plan.borderX - plan.tx * (y - source.height / 2), x0 = Math.floor(sx), fx = sx - x0;
                for (let col = 0; col < 2; col++) {
                    const px = x0 + col, weight = wy * (col === 0 ? 1 - fx : fx);
                    if (weight === 0) continue;
                    let pixel: number[] | Uint8Array = bg;
                    if (px >= 0 && px < source.width && y >= 0 && y < source.height) {
                        const bytes = yield { kind: "read", position: (y * source.width + px) * 4, length: 4 };
                        if (!bytes || bytes.length !== 4) throw new Error("Truncated shear pixels");
                        // Native BorderImage composites the input over its background before shearing.
                        const remaining = background.a * (1 - bytes[3]! / 255), alpha = bytes[3]! + remaining;
                        pixel = [0, 0, 0, alpha];
                        for (let c = 0; c < 3; c++) pixel[c] = alpha > 0 ? (bytes[c]! * bytes[3]! + bg[c]! * remaining) / alpha : 0;
                    }
                    const alpha = weight * pixel[3]!;
                    for (let c = 0; c < 3; c++) channels[c]! += alpha * pixel[c]!;
                    channels[3]! += alpha;
                }
            }
            // Avoid floating-point drift below exact half-byte ties (notably tan(45°)).
            for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(channels[3]! > 1e-10 ? channels[c]! / channels[3]! + 1e-10 : 0);
            data[i * 4 + 3] = Math.round(channels[3]!);
        }
        yield { kind: "write", position: start * 4, data };
    }
}
