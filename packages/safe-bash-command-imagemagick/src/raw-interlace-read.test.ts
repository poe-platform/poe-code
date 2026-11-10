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

it.each(["line", "plane"] as const)("reads padded RGB4 %s rows with offsets, scenes and partial reads", interlace => {
    // Each three-pixel channel row has one unused low nibble.
    const rows = ["123f", "456e", "789d", "abcc", "defb", "012a"].map(hex => Buffer.from(hex, "hex"));
    const frame = Buffer.concat(interlace === "line" ? rows : [rows[0]!, rows[3]!, rows[1]!, rows[4]!, rows[2]!, rows[5]!]);
    const input = Buffer.concat([Buffer.from("skip"), frame, frame]);
    const expected = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("114477225588336699aadd00bbee11ccff22", "hex")]);
    const raw = rawRasterInput(3, 2, 4, "lsb", input.length, 3, 4, interlace);
    expect(raw.pages).toBe(2);
    expect(raw.size).toBe(expected.length);
    for (let position = 0; position < raw.size; position++) {
        const length = Math.min(7, raw.size - position), steps = raw.read(position, length, 1);
        let next = steps.next();
        while (!next.done) {
            expect(Number.isInteger(next.value.position)).toBe(true);
            expect(Number.isInteger(next.value.length)).toBe(true);
            next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        }
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});

for (const depth of [8, 16]) it.each(["msb", "lsb"])(`preserves partial GRAYA${depth} plane reads, offsets and frames (%s)`, endian => {
    const samples = Buffer.from("1f364d647b92a9c0c0a9927b644d361f", "hex");
    const input = Buffer.concat([Buffer.from("pad"), depth === 8 ? samples : Buffer.from([...samples].flatMap(value => endian === "msb" ? [value, 255 - value] : [255 - value, value]))]);
    const raw = rawRasterInput(2, 2, depth, endian, input.length, 2, 3, "plane");
    expect(raw.pages).toBe(2);
    for (const [page, hex] of ["1f7b36924da964c0", "c064a94d92367b1f"].entries()) {
        const pixels = Buffer.from(hex, "hex");
        const expected = Buffer.concat([
            Buffer.from(`P7\nWIDTH 2\nHEIGHT 2\nDEPTH 2\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n`),
            depth === 8 ? pixels : Buffer.from([...pixels].flatMap(value => [value, 255 - value]))
        ]);
        for (let position = 0; position < raw.size; position++) {
            const length = Math.min(7, raw.size - position), steps = raw.read(position, length, page);
            let next = steps.next();
            while (!next.done) {
                expect(next.value.channel).toBe(0);
                expect(next.value.length).toBeLessThanOrEqual(8192);
                next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
            }
            expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
        }
    }
});
