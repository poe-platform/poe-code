import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded directly from PFM output.
const gray = [-0.25, 0.125, 1.5, 0.1, 0.5001, 0.9999];
const color = [...gray, 0.05, 0.08, 0.02, 1.2, -0.4, 0.65];
const cases = [
    { input: gray, operators: [], expected: gray },
    { input: gray, operators: ["-equalize"], expected: [0, 0.4, 1, 0.2, 0.6, 0.8] },
    { input: gray, operators: ["-equalize", "-equalize"], expected: [0, 0.4, 1, 0.2, 0.6, 0.8] },
    { input: color, operators: [], expected: color },
    { input: color, operators: ["-equalize"], expected: [0, 0.5, 1, 0.5, 1, 1, 0.25, 0.5, 0.25, 1, 0, 1] },
    { input: color, operators: ["-equalize", "-equalize"], expected: [0, 0.75, 1, 0.75, 1, 1, 0, 0.75, 0, 1, 0, 1] },
    { input: color, operators: ["-channel", "R", "-equalize", "+channel"], expected: [0, 0.125, 1.5, 2 / 3, 0.5001, 0.9999, 1 / 3, 0.08, 0.02, 1, -0.4, 0.65] },
    { input: color, operators: ["-channel", "RGB", "-equalize", "+channel"], expected: [0, 2 / 3, 1, 2 / 3, 1, 0.75, 1 / 3, 1 / 3, 0.25, 1, 0, 0.5] },
    { input: Array(6).fill(-0.25) as number[], operators: ["-equalize"], expected: Array(6).fill(-0.25) as number[] },
];

for (const mode of ["sync", "buffered", "retained"] as const) for (const little of [false, true]) {
    it.each(cases)(`equalizes PFM floats via ${mode}, little=${little}: %j`, async ({ input, operators, expected }) => {
        const header = Buffer.from(`${input.length === 6 ? "Pf\n3 2" : "PF\n2 2"}\n${little ? "-1.0" : "1.0"}\n`);
        const bytes = new Uint8Array(header.length + input.length * 4);
        bytes.set(header);
        const view = new DataView(bytes.buffer);
        input.forEach((value, index) => view.setFloat32(header.length + index * 4, value, little));
        const files = new Map([["/in.pfm", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", bytes);
        const args = ["/in.pfm", ...operators, "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        expect(output.subarray(0, header.length)).toEqual(new Uint8Array(header));
        expect(output.length).toBe(header.length + expected.length * 4);
        const samples = new DataView(output.buffer, output.byteOffset + header.length, output.byteLength - header.length);
        expect(Array.from({ length: expected.length }, (_, index) => samples.getFloat32(index * 4, little))).toEqual(expected.map(Math.fround));
    });
}
