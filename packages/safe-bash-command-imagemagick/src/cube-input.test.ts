import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function cube(invert: boolean, side = 2): Uint8Array {
    const rows: string[] = [];
    for (let b = 0; b < side; b++) for (let g = 0; g < side; g++) for (let r = 0; r < side; r++)
        rows.push([r, g, b].map(value => invert ? 1 - value / (side - 1) : value / (side - 1)).join(" "));
    return new TextEncoder().encode(`# lookup table\nTITLE "Test"\nLUT_3D_SIZE ${side}\n${rows.join("\n")}\n`);
}

for (const mode of ["sync", "map", "retained"] as const) {
    for (const invert of [false, true]) {
        it(`${mode}: applies an explicit ${invert ? "invert" : "identity"} CUBE lookup`, async () => {
            const input = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 0 0 255 255 0 0\n");
            const files = new Map([["/in.ppm", input], ["/lut.cube", cube(invert)]]), filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/in.ppm", "CUBE:/lut.cube", "-hald-clut", "-depth", "8", "rgb:/out"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Array.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!))
                .toEqual(invert ? [0, 255, 255, 255, 255, 0, 0, 255, 255] : [255, 0, 0, 0, 0, 255, 255, 0, 0]);
        });
    }
}

for (const mode of ["sync", "map", "retained"] as const) {
    it(`${mode}: reads stdin, whitespace and fractional colors from a larger CUBE table`, async () => {
        const bytes = new TextEncoder().encode(new TextDecoder().decode(cube(true, 12)).replaceAll("\n", "\r\n").replaceAll(" ", "\t").trimEnd());
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#4080c0", "cube:-", "-hald-clut", "-depth", "16", "-endian", "MSB", "rgb:/out"];
        const result = mode === "sync" ? runConvertCliSync(args, files, bytes) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" }, bytes);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Array.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!))
            .toEqual([191, 191, 127, 127, 63, 63]);
    });

    it.each([
        "", "LUT_3D_SIZE 1\n", "LUT_3D_SIZE 257\n", "LUT_3D_SIZE 2.5\n",
        "LUT_3D_SIZE 2\n0 0 0\n", "LUT_3D_SIZE 2\nNaN 0 0\n", "LUT_3D_SIZE 2\n0 0\n",
        "LUT_3D_SIZE 2\nLUT_3D_SIZE 2\n", `#${"x".repeat(4096)}\n`,
    ])(`${mode}: preserves the destination on malformed CUBE input (%s)`, async text => {
        const original = Uint8Array.of(42), bytes = new TextEncoder().encode(text);
        const files = new Map([["/lut", bytes], ["/out", original]]), filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["xc:red", "CUBE:/lut", "-hald-clut", "rgb:/out"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("CUBE");
        expect(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")).toEqual(original);
    });
}

it("expands an explicit CUBE into the native 512 by 512 Hald dimensions", async () => {
    const files = new Map([["/lut", cube(false)]]);
    expect(await runConvertCli(["CUBE:/lut", "-format", "%wx%h", "info:"], files))
        .toMatchObject({ exitCode: 0, stdout: "512x512", stderr: "" });
});

it("reports a missing CUBE file without replacing output", async () => {
    const original = Uint8Array.of(42), files = new Map([["/out", original]]);
    expect(await runConvertCli(["xc:red", "CUBE:/missing", "-hald-clut", "rgb:/out"], files))
        .toMatchObject({ exitCode: 1, stderr: "magick: unable to open image 'CUBE:/missing'\n" });
    expect(files.get("/out")).toEqual(original);
});
