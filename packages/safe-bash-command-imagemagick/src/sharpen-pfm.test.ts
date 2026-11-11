import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const gray = [-0.25, 0.125, 1.5, 0.1, 0.5001, 0.9999];
// ImageMagick 7.1.2-35 Q16-HDRI, read directly from the output PFM payload.
const sharpened = [-0.496096164, -0.161366835, 1.93727982, 0.050431211, 0.501353383, 1.087845325];
const cases = [
    { name: "grayscale control", color: false, input: gray, operations: [], expected: gray },
    { name: "color control", color: true, input: [1, 0.25, 0, 0, 0.5, 1.5], operations: [], expected: [1, 0.25, 0, 0, 0.5, 1.5] },
    { name: "grayscale sharpen", color: false, input: gray, operations: ["-sharpen", "0x1"], expected: sharpened },
    { name: "arithmetic after sharpen", color: false, input: gray, operations: ["-sharpen", "0x1", "-evaluate", "Multiply", "0.5"], expected: sharpened.map(value => value * 0.5) },
    { name: "color sharpen", color: true, input: gray.flatMap(value => [value, 0.5, 0.25]), operations: ["-sharpen", "0x1"], expected: sharpened.flatMap(value => [value, 0.5, 0.25]) },
];

for (const mode of ["sync", "buffered", "retained"] as const) for (const little of [false, true]) {
    it.each(cases)(`preserves PFM samples (${mode}, little=${little}, $name)`, async ({ color, input, operations, expected }) => {
        const header = Buffer.from(`${color ? "PF" : "Pf"}\n${input.length === 6 && color ? "2 1" : "3 2"}\n${little ? "-1.0" : "1.0"}\n`);
        const bytes = new Uint8Array(header.length + input.length * 4);
        bytes.set(header);
        const view = new DataView(bytes.buffer);
        input.forEach((value, index) => view.setFloat32(header.length + index * 4, value, little));
        const files = new Map([["/in.pfm", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", bytes);
        const args = ["/in.pfm", ...operations, "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        expect(output.subarray(0, header.length)).toEqual(new Uint8Array(header));
        expect(output.length).toBe(header.length + expected.length * 4);
        const samples = new DataView(output.buffer, output.byteOffset + header.length, output.byteLength - header.length);
        expected.forEach((value, index) => expect(samples.getFloat32(index * 4, little)).toBeCloseTo(Math.fround(value), 6));
    });
}
