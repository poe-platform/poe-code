import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, Pf input and output (bottom row first).
const gray = [-0.25, 0.125, 1.5, 0.1, 0.5001, 0.9999];
const blurred = [0.048337463, 0.462890029, 0.980653703, 0.163726509, 0.50060308, 0.89126271];

for (const mode of ["sync", "buffered", "retained"] as const)
for (const little of [false, true])
for (const color of [false, true])
it.each([
    { operations: [], expectedGray: gray },
    { operations: ["-blur", "0x0"], expectedGray: gray },
    { operations: ["-blur", "0x1"], expectedGray: blurred },
    { operations: ["-gaussian-blur", "0x1"], expectedGray: [0.035263829, 0.45694381, 0.993124545, 0.157457948, 0.498647124, 0.897957623] },
    { operations: ["-unsharp", "0x1"], expectedGray: [-0.54833746, -0.212890029, 2.019346237, 0.036273498, 0.500100017, 1.108537197] },
    { operations: ["-channel", "B", "-blur", "0x1"], expectedGray: gray },
    { operations: ["-region", "1x2+1+0", "-blur", "0x1", "+region"], expectedGray: [-0.25, 0.462890029, 1.5, 0.1, 0.50060308, 0.9999] }
])(`preserves PFM float samples (${mode}, little=${little}, color=${color}, $operations)`, async ({ operations, expectedGray }) => {
    const header = Buffer.from(`${color ? "PF" : "Pf"}\n3 2\n${little ? "-1.0" : "1.0"}\n`);
    const values = color ? gray.flatMap(value => [value, 0.125, 1.5]) : gray;
    const input = Buffer.alloc(header.length + values.length * 4); input.set(header);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    values.forEach((value, index) => view.setFloat32(header.length + index * 4, value, little));
    const files = new Map([["/in.pfm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pfm", input);
    const args = ["/in.pfm", ...operations, "/out.pfm"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
    expect(Buffer.from(output.subarray(0, header.length))).toEqual(header);
    const samples = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const expected = color ? expectedGray.flatMap(value => [value, 0.125, 1.5]) : expectedGray;
    expect(output.length).toBe(header.length + expected.length * 4);
    expected.forEach((value, index) => expect(samples.getFloat32(header.length + index * 4, little)).toBeCloseTo(value, 6));
});
