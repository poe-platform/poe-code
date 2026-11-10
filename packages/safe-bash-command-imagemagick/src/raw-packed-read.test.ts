import { expect, it } from "vitest";
import { rawRasterInput } from "./raw-rgb.js";

it.each([
    [10, "093e73a8dd12477cb1e61b5085baef24", "0902f9fe3a8e374e12441dc7b1ec9866b52d2148baeebcae"],
    [12, "093e73a8dd12477cb1e61b5085baef24598e", "0931e73ea8dad12c4774cb1ce61db50b85b8aefa245298e9"]
] as const)("retains %i-bit precision across partial reads, offsets and scenes", (depth, hex, decoded) => {
    const frame = Buffer.from(hex, "hex"), input = Buffer.concat([Buffer.from("skip"), frame, frame]);
    const expected = Buffer.concat([Buffer.from("P6\n2 2\n65535\n"), Buffer.from(decoded, "hex")]);
    const raw = rawRasterInput(2, 2, depth, "lsb", input.length, 3, 4);
    expect(raw.pages).toBe(2);
    expect(raw.size).toBe(expected.length);
    for (let position = 0; position < raw.size; position++) {
        const length = Math.min(7, raw.size - position), steps = raw.read(position, length, 1);
        let next = steps.next();
        while (!next.done) next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        expect(Buffer.from(next.value)).toEqual(expected.subarray(position, position + length));
    }
});

it.each(["plane", "line", "partition"] as const)("decodes packed 12-bit %s channel rows", (interlace) => {
    const planes = ["000fff800001", "123456789abc", "def000fff000"].map(hex => Buffer.from(hex, "hex"));
    const sources = interlace === "partition" ? planes : [Buffer.concat(interlace === "plane" ? planes : [0, 3].flatMap(row => planes.map(plane => plane.subarray(row, row + 3))))];
    const raw = rawRasterInput(2, 2, 12, "msb", 18, 3, 0, interlace);
    const steps = raw.read(0, raw.size);
    let next = steps.next();
    while (!next.done) next = steps.next(sources[next.value.channel]!.subarray(next.value.position, next.value.position + next.value.length));
    expect(Buffer.from(next.value)).toEqual(Buffer.concat([
        Buffer.from("P6\n2 2\n65535\n"),
        Buffer.from("00001231defdffff4564000080087897ffff0010abca0000", "hex")
    ]));
});

it.each([10, 12])("bounds reads for wide %i-bit rows", (depth) => {
    const width = 5001, input = new Uint8Array(Math.ceil(width * 3 * depth / 8) * 2).fill(0x55);
    const raw = rawRasterInput(width, 2, depth, "msb", input.length, 3);
    const steps = raw.read(0, raw.size);
    let next = steps.next();
    while (!next.done) {
        expect(next.value.length).toBeLessThanOrEqual(8192);
        next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
    }
    expect(Buffer.from(next.value)).toEqual(Buffer.concat([
        Buffer.from(`P6\n${width} 2\n65535\n`), Buffer.alloc(width * 2 * 6, 0x55)
    ]));
});
