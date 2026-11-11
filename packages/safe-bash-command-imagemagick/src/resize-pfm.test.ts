import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded directly from PFM output.
const inputRow = [-0.25, 0.125, 1.5, 0.1, 0.5001, 0.9999];
const triangleRow = [-0.25, 0.125, 1.5, -0.075000003, 0.312550008, 1.249949932, 0.1, 0.5001, 0.9999];

for (const mode of ["sync", "buffered", "retained"] as const)
for (const little of [false, true])
for (const color of [false, true])
it.each(["triangle", "point", "unchanged"])(`preserves extended-range PFM resize samples (${mode}, little=${little}, color=${color}, %s)`, async filter => {
    const header = Buffer.from(`${color ? "PF" : "Pf"}\n${color ? "2 1" : "1 2"}\n${little ? "-1.0" : "1.0"}\n`);
    const values = color ? inputRow : [-0.25, 1.5];
    const input = Buffer.alloc(header.length + values.length * 4); input.set(header);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    values.forEach((value, index) => view.setFloat32(header.length + index * 4, value, little));
    const files = new Map([["/in.pfm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pfm", input);
    const args = ["/in.pfm", ...(filter === "unchanged" ? [] : ["-filter", filter, "-resize", color ? "3x2!" : "2x3!"]), "/out.pfm"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
    const expectedHeader = filter === "unchanged" ? header
        : Buffer.from(`${color ? "PF\n3 2" : "Pf\n2 3"}\n${little ? "-1.0" : "1.0"}\n`);
    expect(Buffer.from(output.subarray(0, expectedHeader.length))).toEqual(expectedHeader);
    const row = filter === "triangle" ? triangleRow : [...inputRow.slice(0, 3), ...inputRow.slice(3), ...inputRow.slice(3)];
    const expected = filter === "unchanged" ? values : color ? [...row, ...row]
        : filter === "triangle" ? [-0.25, -0.25, 0.625, 0.625, 1.5, 1.5] : [-0.25, -0.25, -0.25, -0.25, 1.5, 1.5];
    expect(output.length).toBe(expectedHeader.length + expected.length * 4);
    const samples = new DataView(output.buffer, output.byteOffset, output.byteLength);
    expected.forEach((value, index) => expect(samples.getFloat32(expectedHeader.length + index * 4, little)).toBeCloseTo(value, 7));
});
