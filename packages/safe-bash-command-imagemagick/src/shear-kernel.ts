import type { RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { ConvolveRequest } from "./convolve-kernel.js";
import { compositePixelsSteps, magickCompositeMode } from "./composite-pixels.js";

/** Native shear uses pixel-edge centers and crops the bordered, sequential X/Y shear. */
export function shearPlan(image: Pick<RgbaImage, "width" | "height" | "hasAlpha">, spec: string) {
    // Native geometry permits modifiers, but requires a complete first angle.
    const geometry = [...spec].filter(char => char.trim() !== "" && !"%!<>#^@()".includes(char)).join("");
    const separator = [...geometry].findIndex(char => "xX,:/".includes(char));
    const firstAngle = separator < 0 ? geometry : geometry.slice(0, separator);
    if (!firstAngle || !Number.isFinite(Number(firstAngle)) || [...geometry].some(char => !"0123456789eExX+,-./:".includes(char))) {
        throw new Error(`invalid argument for option '-shear': ${spec}`);
    }
    const [xAngle = 0, yAngle = xAngle] = spec.toLowerCase().split("x").map(value => value === "" ? undefined : parseFloat(value) || 0);
    if ((xAngle !== 0 && xAngle % 90 === 0) || (yAngle !== 0 && yAngle % 90 === 0)) throw new Error("angle is discontinuous");
    const tx = -Math.tan(xAngle * Math.PI / 180), ty = Math.tan(yAngle * Math.PI / 180);
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

export function* shearPixelSteps(source: Pick<RgbaImage, "width" | "height" | "data16"> & Partial<Pick<StoredRgbaImage, "storedData16">>, plan: ReturnType<typeof shearPlan>, background: RgbaColor, compose: string, composeArgs?: string, fuzz = 0): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const highDepth = !!(source.data16 || source.storedData16), scale = highDepth ? 257 : 1, maximum = 255 * scale;
    const bg = [background.r, background.g, background.b, background.a].map(value => value * scale);
    const canvas = { width: 1, height: 1, hasAlpha: plan.hasAlpha, data: Float64Array.from(bg, value => value / scale) };
    const overlay = { ...canvas, data: new Float64Array(4) }, composite = new Float64Array(4);
    const { name: composeMode } = magickCompositeMode(compose);
    const over = composeMode === "over" || composeMode === "srcover";
    for (let start = 0; start < plan.width * plan.height; start += 1024) {
        yield;
        const count = Math.min(1024, plan.width * plan.height - start), data = highDepth ? new Uint16Array(count * 4) : new Uint8Array(count * 4);
        const values = new Float64Array(count * 4);
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
                    let pixel: ArrayLike<number> = bg;
                    if (px >= 0 && px < source.width && y >= 0 && y < source.height) {
                        const bytes = yield { kind: "read", highDepth, position: (y * source.width + px) * 4, length: 4 };
                        if (!bytes || bytes.length !== (highDepth ? 8 : 4)) throw new Error("Truncated shear pixels");
                        // Native BorderImage applies the selected compose operator before resampling.
                        const samples = highDepth ? new Uint16Array(bytes.buffer, bytes.byteOffset, 4) : bytes;
                        if (over) {
                            const remaining = bg[3]! * (1 - samples[3]! / maximum), alpha = samples[3]! + remaining;
                            for (let c = 0; c < 3; c++) composite[c] = alpha > 0 ? (samples[c]! * samples[3]! + bg[c]! * remaining) / alpha : 0;
                            composite[3] = alpha;
                        } else {
                            for (let c = 0; c < 4; c++) overlay.data[c] = samples[c]! / scale;
                            yield* compositePixelsSteps(canvas, overlay, composite, compose, 0, 0, composeArgs, fuzz, true);
                            for (let c = 0; c < 4; c++) composite[c]! *= scale;
                        }
                        pixel = composite;
                    }
                    const alpha = weight * pixel[3]!;
                    for (let c = 0; c < 3; c++) channels[c]! += alpha * pixel[c]!;
                    channels[3]! += alpha;
                }
            }
            // Retain Q16-HDRI working samples even when the input has only eight bits.
            for (let c = 0; c < 4; c++) {
                const value = c === 3 ? channels[3]! : channels[3]! > 1e-10 ? channels[c]! / channels[3]! : 0;
                values[i * 4 + c] = Math.fround(value * 257 / scale) / 257;
                data[i * 4 + c] = Math.round(values[i * 4 + c]! * scale);
            }
        }
        yield { kind: "write", highDepth, position: start * 4, data: new Uint8Array(data.buffer) };
        yield { kind: "write", evaluate: true, position: start * 4, data: new Uint8Array(values.buffer) };
    }
}
