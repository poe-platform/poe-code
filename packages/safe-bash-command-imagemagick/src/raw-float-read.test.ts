import { expect, it } from "vitest";
import { rawRasterInput } from "./raw-rgb.js";

for (const depth of [16, 32, 64]) {
    for (const interlace of ["none", "plane", "line", "partition"] as const) {
        it(`bounds partial ${depth}-bit float reads with ${interlace} interlace, offsets and scenes`, () => {
            const width = 1501, height = 2, sampleBytes = depth / 8, pixels = width * height;
            const sources = Array.from({ length: interlace === "partition" ? 3 : 1 }, () => Buffer.alloc(3 + pixels * sampleBytes * (interlace === "partition" ? 1 : 3) * 2));
            for (let pixel = 0; pixel < pixels; pixel++) {
                for (let channel = 0; channel < 3; channel++) {
                    const index = interlace === "none" ? pixel * 3 + channel : interlace === "plane" ? channel * pixels + pixel : interlace === "line" ? (Math.floor(pixel / width) * 3 + channel) * width + pixel % width : pixel;
                    const source = sources[interlace === "partition" ? channel : 0]!;
                    const offset = 3 + (source.length - 3) / 2 + index * sampleBytes;
                    if (depth === 16) source.writeUInt16LE([0x3400, 0x3800, 0x3a00][channel]!, offset);
                    else if (depth === 32) source.writeFloatLE((channel + 1) / 4, offset);
                    else source.writeDoubleLE((channel + 1) / 4, offset);
                }
            }
            const raw = rawRasterInput(width, height, depth, "lsb", sources.reduce((sum, source) => sum + source.length, 0), 3, 3, interlace, true);
            const header = Buffer.from(`P6\n${width} ${height}\n65535\n`);
            const expected = Buffer.concat([header, Buffer.from("40008000bfff".repeat(pixels), "hex")]);
            expect(raw.pages).toBe(2);
            expect(raw.size).toBe(expected.length);
            for (let position = 0; position < raw.size; position += 4093) {
                const length = Math.min(4093, raw.size - position), steps = raw.read(position, length, 1);
                let next = steps.next();
                while (!next.done) {
                    expect(next.value.length).toBeLessThanOrEqual(8192);
                    const source = sources[next.value.channel]!;
                    next = steps.next(source.subarray(next.value.position, next.value.position + next.value.length));
                }
                expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
            }
        });
    }
}
