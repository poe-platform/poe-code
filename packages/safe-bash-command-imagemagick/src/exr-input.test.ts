import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./exr-fixtures.json" with { type: "json" };

// OpenEXR 3.5.2 scanline files: RGB half/float, 2x18, repeating [1,.25,0,0,.5,1.5].
// The grid is 8x2 RGB half, pixel i = [(i*17)%256,(10+i*31)%256,(40+i*47)%256]/255.
for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const [name, encoded] of Object.entries(fixtures).filter(([name]) => name !== "alpha")) it(`reads native EXR ${name} (${mode})`, async () => {
        const bytes = new Uint8Array(Buffer.from(encoded, "base64")), files = new Map([["/in.exr", bytes]]);
        const filesystem = new MemoryFileSystem(); await filesystem.writeFile("/in.exr", bytes);
        const run = (output: string) => mode === "sync" ? runConvertCliSync(["/in.exr", output], files) : runConvertCli(["/in.exr", output], mode === "retained" ? { filesystem, cwd: "/" } : files);
        const read = (path: string) => mode === "retained" ? filesystem.readFile(path) : files.get(path)!;
        expect(await run("/out.png")).toMatchObject({ exitCode: 0, stderr: "" });
        const png = decodeImage(await read("/out.png"));
        expect([png.width, png.height]).toEqual(name === "grid" ? [8, 2] : [2, 18]);
        expect(Array.from(png.data.slice(0, 4))).toEqual(name === "grid" ? [0, 10, 40, 255] : [255, 64, 0, 255]);
        if (name === "grid") {
            expect(Array.from(png.data)).toEqual(Array.from({ length: 16 }, (_, i) => [(i * 17) % 256, (10 + i * 31) % 256, (40 + i * 47) % 256, 255]).flat());
            return;
        }
        expect(await run("/out.pfm")).toMatchObject({ exitCode: 0, stderr: "" });
        const output = await read("/out.pfm"); let offset = 0;
        for (let i = 0; i < 3; i++) offset = output.indexOf(10, offset) + 1;
        const header = new TextDecoder().decode(output.subarray(0, offset));
        expect(header).toBe("PF\n2 18\n1.0\n");
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        expect(Array.from({ length: 108 }, (_, i) => view.getFloat32(offset + i * 4, false))).toEqual(Array.from({ length: 18 }, () => [1, .25, 0, 0, .5, 1.5]).flat());
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    const retained = mode === "retained";
    it(`preserves negative EXR samples and alpha at a shifted data window (${mode})`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixtures.alpha, "base64"));
        expect(readImageMetadata(bytes)).toMatchObject({ format: "exr", width: 2, height: 1, depth: "float", hasAlpha: true });
        expect(Array.from(decodeImage(bytes).dataFloat!)).toEqual([-.25, .125, 1.5, .5, 0, Math.fround(.5001), 1, 1]);
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.exr", bytes]]);
        await filesystem.writeFile("/in.exr", bytes);
        const context = retained ? { filesystem, cwd: "/" } : files;
        expect(await (mode === "sync" ? runConvertCliSync(["/in.exr", "/out.pfm"], files) : runConvertCli(["/in.exr", "/out.pfm"], context))).toMatchObject({ exitCode: 0, stderr: "" });
        const output = retained ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        const view = new DataView(output.buffer, output.byteOffset + output.length - 24, 24);
        expect(Array.from({ length: 6 }, (_, i) => view.getFloat32(i * 4, false))).toEqual([-.25, .125, 1.5, 0, .5, 1]);
        expect(await (mode === "sync" ? runConvertCliSync(["/in.exr", "/out.png"], files) : runConvertCli(["/in.exr", "/out.png"], context))).toMatchObject({ exitCode: 0, stderr: "" });
        const png = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(png.data)).toEqual([0, 32, 255, 128, 0, 128, 255, 255]);
    });
}


for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`rounds EXR FLOAT channels to nearest-even binary16 (${mode})`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixtures.alpha, "base64"));
        // Uncompressed scanline channels are A, B, G, R, with two samples each.
        const samples = [.5001, 1, 2 ** -25, 3 * 2 ** -25, .500244140625, .500732421875, -1.00048828125, 65504];
        const raster = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 32, 32);
        samples.forEach((sample, index) => raster.setFloat32(index * 4, sample, true));
        const files = new Map([["/in.exr", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.exr", bytes);
        const args = ["/in.exr", "/out.pfm"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!;
        const view = new DataView(output.buffer, output.byteOffset + output.length - 24, 24);
        expect(Array.from({ length: 6 }, (_, i) => view.getFloat32(i * 4, false))).toEqual([-1, .5, 0, 65504, .5009765625, 2 ** -23]);
        const alphaArgs = ["/in.exr", "-depth", "16", "/out.png"];
        expect(await (mode === "sync" ? runConvertCliSync(alphaArgs, files) : runConvertCli(alphaArgs, mode === "retained" ? { filesystem, cwd: "/" } : files))).toMatchObject({ exitCode: 0, stderr: "" });
        const png = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(Array.from(png.data16!)).toEqual([0, 32768, 0, 32768, 65535, 32831, 0, 65535]);
    });
}

for (const retained of [false, true]) {
    for (const damage of ["header", "raster", "tiled", "compression", "offset"] as const) it(`rejects invalid EXR ${damage} without replacing output (retained=${retained})`, async () => {
        let bytes = new Uint8Array(Buffer.from(fixtures["zip-half"], "base64"));
        if (damage === "header") bytes = bytes.slice(0, 24);
        if (damage === "raster") bytes = bytes.slice(0, -1);
        if (damage === "tiled") bytes[5] = 2;
        if (damage === "compression") {
            const key = Buffer.from(bytes).indexOf(Buffer.from("compression\0compression\0"));
            bytes[key + 28] = 9;
        }
        if (damage === "offset") {
            let p = 8;
            while (bytes[p]) { p = bytes.indexOf(0, p) + 1; p = bytes.indexOf(0, p) + 1; const length = new DataView(bytes.buffer).getUint32(p, true); p += 4 + length; }
            bytes.fill(255, p + 1, p + 9);
        }
        const original = Uint8Array.of(42), files = new Map([["/in.exr", bytes], ["/out.png", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.exr", bytes); await filesystem.writeFile("/out.png", original);
        const result = await runConvertCli(["/in.exr", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("EXR");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}

it("checks EXR pixel limits before allocating pixels", () => {
    expect(() => decodeImage(new Uint8Array(Buffer.from(fixtures["zip-half"], "base64")), { limitInputPixels: 1 })).toThrow("pixel limit");
});
