import { expect, it } from "vitest";
import { encodeImage } from "./index.js";

for (const endian of ["msb", "lsb"]) it(`encodes ${endian} half-float boundaries, ties, signed zero and non-finite samples`, () => {
    const values = [0, -0, 2 ** -24, 2 ** -25, 3 * 2 ** -25, 2 ** -14, 1, 1 + 2 ** -11, 1 + 3 * 2 ** -11, -2, 65504, 65520, Infinity, -Infinity, NaN];
    const expected = [0, 0x8000, 1, 0, 2, 0x0400, 0x3c00, 0x3c00, 0x3c02, 0xc000, 0x7bff, 0x7c00, 0x7c00, 0xfc00, 0x7e00];
    const dataFloat = new Float32Array(values.flatMap(value => [value, value, value, 1]));
    const result = encodeImage({ width: values.length, height: 1, channels: 1, hasAlpha: false, format: "pfm", space: "b-w", depth: "float", data: new Uint8Array(dataFloat.length), dataFloat }, { format: "phm", endian });
    expect(result).toMatchObject({ format: "phm", channels: 1 });
    const header = new TextEncoder().encode(`Ph\n${values.length} 1\n${endian === "lsb" ? "-1.0" : "1.0"}\n`);
    expect(result.data.subarray(0, header.length)).toEqual(header);
    expect(result.data.length).toBe(header.length + values.length * 2);
    const view = new DataView(result.data.buffer, result.data.byteOffset);
    expect(values.map((_, index) => view.getUint16(header.length + index * 2, endian === "lsb"))).toEqual(expected);
});
