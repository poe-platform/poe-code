import { expect, it } from "vitest";
import { rawRasterInput } from "./raw-rgb.js";

for (const depth of [16, 32]) it.each([
    ["plane", "0155a9085cb00f63b7166abe1d71c52478cc2b7fd33286da398de14094e8479bef4ea2f6"],
    ["line", "01162b081d320f243940556a475c714e63787f94a9869bb08da2b7bed3e8c5daefcce1f6"]
] as const)(`supports partial byte reads of %s RGB${depth}`, (interlace, hex) => {
    const input = Uint8Array.from(Array.from({ length: 36 }, (_, index) => Array.from({ length: depth / 16 }, () => [254 - 7 * index, 7 * index + 1]).flat()).flat());
    const expected = Buffer.concat([Buffer.from("P6\n3 4\n65535\n"), Buffer.from(Array.from(Buffer.from(hex, "hex"), value => [value, 255 - value]).flat())]);
    const raw = rawRasterInput(3, 4, depth, "lsb", input.length, 3, 0, interlace);
    for (let position = 0; position < raw.size; position++) {
        const length = Math.min(7, raw.size - position), steps = raw.read(position, length);
        let next = steps.next();
        while (!next.done) {
            expect(next.value.length).toBeLessThanOrEqual(8192);
            next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        }
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});
