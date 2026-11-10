import type { ConvolveRequest } from "./convolve-kernel.js";
import type { RgbaColor } from "@poe-code/image-ast/portable";
import type { VirtualPixelMethod } from "./warp-kernel.js";
import { virtualPixelIndex } from "./virtual-pixel.js";

export type MagnifyMethod = "epbx2x" | "scale2x" | "eagle2x" | "scale3x";

export function parseMagnifyMethod(value: string): MagnifyMethod {
    const method = value.toLowerCase();
    if (method === "epbx2x" || method === "scale2x" || method === "eagle2x" || method === "scale3x") return method;
    // Native defaults unknown names to Scale2x, but these names select distinct algorithms.
    if (["eagle3x", "eagle3xb", "fish2x", "hq2x", "xbr2x"].includes(method)) {
        throw new Error(`Unsupported magnify method: ${value}`);
    }
    return "scale2x";
}

// Bounded three-row neighborhoods serve both in-memory and retained rasters.
// Copy complete Q16 pixels so equality and output preserve alpha and precision.
export function* magnifyPixelSteps(image: { width: number; height: number; hasAlpha: boolean }, method: MagnifyMethod = "scale2x", background: RgbaColor, virtualPixel: VirtualPixelMethod = "edge"): Generator<ConvolveRequest | undefined, void, Uint8Array | undefined> {
    const factor = method === "scale3x" ? 3 : 2;
    const gray = virtualPixel === "white" ? 65535 : virtualPixel === "gray" ? 32768 : 0;
    const fill = virtualPixel === "background" || virtualPixel.endsWith("-tile")
        ? [background.r, background.g, background.b, background.a].map(value => Math.round(value * 257))
        : [gray, gray, gray, virtualPixel === "transparent" ? 0 : 65535];
    for (let y = 0; y < image.height; y++) for (let left = 0; left < image.width; left += 1024) {
        yield;
        const count = Math.min(1024, image.width - left);
        const rows: Uint16Array[] = [];
        for (let dy = -1; dy <= 1; dy++) {
            const row = new Uint16Array((count + 2) * 4);
            for (let column = 0; column < count + 2;) {
                const pixel = virtualPixelIndex(left + column - 1, y + dy, image.width, image.height, virtualPixel);
                if (pixel < 0) {
                    row.set(fill, column++ * 4);
                    continue;
                }
                // Keep contiguous reads bounded, splitting where virtual pixels wrap.
                let length = 1;
                while (column + length < count + 2 && virtualPixelIndex(left + column + length - 1, y + dy, image.width, image.height, virtualPixel) === pixel + length) length++;
                const bytes = yield { kind: "read", highDepth: true, position: pixel * 4, length: length * 4 };
                if (!bytes || bytes.length !== length * 8) throw new Error("Truncated magnify pixels");
                row.set(new Uint16Array(bytes.slice().buffer), column * 4);
                column += length;
            }
            rows.push(row);
        }
        const output = Array.from({ length: factor }, () => new Uint16Array(count * factor * 4));
        for (let x = 0; x < count; x++) {
            const pixels = rows.flatMap(row => [-1, 0, 1].map(dx => {
                const offset = (x + dx + 1) * 4;
                return row.subarray(offset, offset + 4);
            }));
            const eq = (a: number, b: number) => pixels[a]!.every((value, channel) => channel === 3 && !image.hasAlpha || value === pixels[b]![channel]);
            const selected = new Array<number>(factor * factor).fill(4);
            if (method === "eagle2x") {
                if (eq(0, 1) && eq(1, 3)) selected[0] = 0;
                if (eq(1, 2) && eq(2, 5)) selected[1] = 2;
                if (eq(3, 6) && eq(6, 7)) selected[2] = 6;
                if (eq(5, 8) && eq(8, 7)) selected[3] = 8;
            } else if (method === "epbx2x") {
                if (!eq(3, 5) && !eq(1, 7) && (
                    eq(4, 3) || eq(4, 7) || eq(4, 5) || eq(4, 1) ||
                    ((!eq(0, 8) || eq(4, 6) || eq(3, 2)) && (!eq(6, 2) || eq(4, 0) || eq(4, 8)))
                )) {
                    // Native averages equal neighbors; copying preserves the same Q16 samples.
                    if (eq(1, 3) && (eq(4, 0) || eq(4, 8) || eq(1, 2) || eq(3, 6))) selected[0] = 1;
                    if (eq(5, 1) && (eq(4, 2) || eq(4, 6) || eq(5, 8) || eq(1, 0))) selected[1] = 5;
                    if (eq(3, 7) && (eq(4, 6) || eq(4, 2) || eq(3, 0) || eq(7, 8))) selected[2] = 3;
                    if (eq(7, 5) && (eq(4, 8) || eq(4, 0) || eq(7, 6) || eq(5, 2))) selected[3] = 7;
                }
            } else if (!eq(1, 7) && !eq(3, 5)) {
                selected[0] = eq(3, 1) ? 3 : 4;
                selected[factor - 1] = eq(5, 1) ? 5 : 4;
                selected[factor * (factor - 1)] = eq(3, 7) ? 3 : 4;
                selected[factor * factor - 1] = eq(5, 7) ? 5 : 4;
                if (factor === 3) {
                    selected[1] = (eq(3, 1) && !eq(4, 2)) || (eq(5, 1) && !eq(4, 0)) ? 1 : 4;
                    selected[3] = (eq(3, 1) && !eq(4, 6)) || (eq(3, 7) && !eq(4, 0)) ? 3 : 4;
                    selected[5] = (eq(5, 1) && !eq(4, 8)) || (eq(5, 7) && !eq(4, 2)) ? 5 : 4;
                    selected[7] = (eq(3, 7) && !eq(4, 8)) || (eq(5, 7) && !eq(4, 6)) ? 7 : 4;
                }
            }
            for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
                output[dy]!.set(pixels[selected[dy * factor + dx]!]!, (x * factor + dx) * 4);
            }
        }
        for (let dy = 0; dy < factor; dy++) yield { kind: "write", highDepth: true, position: ((y * factor + dy) * image.width * factor + left * factor) * 4, data: new Uint8Array(output[dy]!.buffer) };
    }
}
