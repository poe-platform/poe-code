import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) for (const little of [false, true]) {
    it.each([false, true])(`reads PFM (${mode}, little=${little}, color=%s)`, async color => {
        const header = new TextEncoder().encode(`${color ? "PF\n2 1" : "Pf\n3 2"}\n${little ? "-1.0" : "1.0"}\n`);
        const values = (color ? [1, 0.25, 0, 0, 0.5, 1.5] : [-0.25, 0.125, 1.5, 0, 0.5001, 1]).map(Math.fround);
        const bytes = new Uint8Array(header.length + 24); bytes.set(header);
        const view = new DataView(bytes.buffer); values.forEach((value, i) => view.setFloat32(header.length + i * 4, value, little));
        const files = new Map([["/in.pfm", bytes]]), filesystem = new MemoryFileSystem(); await filesystem.writeFile("/in.pfm", bytes);
        const run = (output: string) => mode === "sync" ? runConvertCliSync(["/in.pfm", output], files) : runConvertCli(["/in.pfm", output], mode === "retained" ? { filesystem, cwd: "/" } : files);
        const read = (path: string) => mode === "retained" ? filesystem.readFile(path) : files.get(path)!;
        expect(await run("/out.png")).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(await read("/out.png"));
        if (color) expect(Array.from(image.data)).toEqual([255, 64, 0, 255, 0, 128, 255, 255]);
        else expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual([0, 32774, 65535, 0, 8192, 65535]);
        expect(await run("/out.pfm")).toMatchObject({ exitCode: 0, stderr: "" });
        const output = await read("/out.pfm"), lines: string[] = []; let offset = 0;
        while (lines.length < 3) { const end = output.indexOf(10, offset); expect(end).toBeGreaterThanOrEqual(offset); lines.push(new TextDecoder().decode(output.subarray(offset, end))); offset = end + 1; }
        expect(lines[0]).toBe(color ? "PF" : "Pf");
        expect(lines[2]).toBe(little ? "-1.0" : "1.0");
        const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
        expect(Array.from({ length: 6 }, (_, i) => outputView.getFloat32(offset + i * 4, Number(lines[2]) < 0))).toEqual(values);
    });
}

for (const retained of [false, true]) {
    it.each([
        "Pf\n0 2\n-1.0\n", "Pf\n3 2\n0\n", "PF\n2 1\n-1.0\n", "Pf\n9007199254740991 2\n-1\n"
    ])(`rejects invalid PFM without replacing output (retained=${retained}): %s`, async header => {
        const bytes = new TextEncoder().encode(header), original = Uint8Array.of(42), files = new Map([["/in.pfm", bytes], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", bytes); await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli(["/in.pfm", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("PFM");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) for (const little of [false, true]) {
    it.each([
        { name: "neutral RGB", magic: "PF", values: [0.2, 0.2, 0.2, 0.7, 0.7, 0.7], operators: [], expectedMagic: "Pf", expected: [0.2, 0.7] },
        { name: "thresholded RGB", magic: "PF", values: [0.1, 0.2, 0.3, 0.7, 0.8, 0.9], operators: ["-threshold", "50%"], expectedMagic: "Pf", expected: [0, 1] },
        { name: "colored RGB", magic: "PF", values: [0.2, 0.3, 0.4, 0.7, 0.8, 0.9], operators: [], expectedMagic: "PF", expected: [0.2, 0.3, 0.4, 0.7, 0.8, 0.9] },
        { name: "sub-16-bit color", magic: "PF", values: [0.2, 0.200001, 0.2, 0.7, 0.7, 0.7], operators: [], expectedMagic: "PF", expected: [0.2, 0.200001, 0.2, 0.7, 0.7, 0.7] },
        { name: "grayscale", magic: "Pf", values: [-0.2, 1.7], operators: [], expectedMagic: "Pf", expected: [-0.2, 1.7] }
    ])(`selects PFM channels from output samples: $name (${mode}, little=${little})`, async ({ magic, values, operators, expectedMagic, expected }) => {
        const header = Buffer.from(`${magic}\n2 1\n${little ? "-1.0" : "1.0"}\n`);
        const input = Buffer.alloc(header.length + values.length * 4); input.set(header);
        values.forEach((value, i) => little ? input.writeFloatLE(value, header.length + i * 4) : input.writeFloatBE(value, header.length + i * 4));
        const files = new Map<string, Uint8Array>([["/in.pfm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pfm", input);
        const args = ["/in.pfm", ...operators, "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = Buffer.from(mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!);
        expect(output.subarray(0, header.length).toString()).toBe(`${expectedMagic}\n2 1\n${little ? "-1.0" : "1.0"}\n`);
        expect(output.length).toBe(header.length + expected.length * 4);
        expect(expected.map((_, i) => little ? output.readFloatLE(header.length + i * 4) : output.readFloatBE(header.length + i * 4))).toEqual(expected.map(Math.fround));
    });
}
