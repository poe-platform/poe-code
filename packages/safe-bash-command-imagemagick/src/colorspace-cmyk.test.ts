import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each(["CMYK", "cmyk"])(`rejects unsupported %s conversion without overwriting TIFF, retained=${retained}`, async space => {
        const fs = new MemoryFileSystem();
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map<string, Uint8Array>([["out.tiff", original]]);
        await fs.writeFile("/out.tiff", original);
        const result = await runConvertCli(["-size", "2x1", "xc:red", "-colorspace", space, "out.tiff"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unsupported colorspace 'CMYK'");
        expect(result.stdout).toBe("");
        expect(retained ? await fs.readFile("/out.tiff") : files.get("out.tiff")).toEqual(original);
    });
}

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable)("rejects the native CMYK TIFF workflow instead of emitting an RGB TIFF", async () => {
    const input = spawnSync("magick", ["-size", "2x1", "xc:red", "-fill", "blue", "-draw", "point 1,0", "PNG24:-"]);
    expect(input.status).toBe(0);
    const native = spawnSync("magick", ["png:-", "-colorspace", "CMYK", "tiff:-"], { input: input.stdout });
    expect(native.status).toBe(0);
    const metadata = spawnSync("magick", ["identify", "-format", "%[colorspace] %[channels]", "tiff:-"], { input: native.stdout, encoding: "utf8" });
    expect(metadata.status).toBe(0);
    expect(metadata.stdout.trim()).toBe("CMYK cmyk  4.0");
    for (const retained of [false, true]) {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["png:-", "-colorspace", "CMYK", "tiff:-"], retained ? { filesystem: fs, cwd: "/" } : files, input.stdout);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unsupported colorspace 'CMYK'");
        expect(result.stdout).toBe("");
    }
});
