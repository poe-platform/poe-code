import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { decodeBmpImage, encodeBmpImage, readBmpMetadata } from "./netpbm.js";

for (const bmpFormat of ["bmp3", "bmp4"] as const) {
    for (const resolution of [{ x: 150, y: 300, unit: "inch" }, { x: 59.06, y: 118.11, unit: "cm" }, { x: 5906, y: 11811, unit: "meter" }] as const) {
        it(`retains both resolution axes through ${bmpFormat} from ${resolution.unit}`, () => {
            const image: RgbaImage = { width: 1, height: 1, format: "png", channels: 3, depth: "uchar", space: "srgb", density: 150, hasAlpha: false, data: Uint8Array.of(255, 0, 0, 255), resolution };
            const bytes = encodeBmpImage(image, { bmpFormat });
            const view = new DataView(bytes.buffer);
            expect([view.getInt32(38, true), view.getInt32(42, true)]).toEqual([5906, 11811]);
            expect(readBmpMetadata(bytes).resolution).toEqual({ x: 5906, y: 11811, unit: "meter" });
            expect(encodeBmpImage(decodeBmpImage(bytes), { bmpFormat })).toEqual(bytes);
        });
    }
}
