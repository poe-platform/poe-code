import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const retained of [false, true]) {
    it.skipIf(!nativeAvailable)(`preserves grayscale TIFF channels from truecolor PNG, retained=${retained}`, async () => {
        const input = spawnSync("magick", ["-size", "2x1", "xc:red", "-fill", "blue", "-draw", "point 1,0", "PNG24:-"]);
        expect(input.status).toBe(0);
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["in.png", input.stdout]]);
        await fs.writeFile("/in.png", input.stdout);
        const result = await runConvertCli(["in.png", "-colorspace", "Gray", "out.tiff"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = retained ? await fs.readFile("/out.tiff") : files.get("out.tiff")!;
        const metadata = spawnSync("magick", ["identify", "-format", "%[colorspace] %[channels]", "tiff:-"], { input: output, encoding: "utf8" });
        expect(metadata.status).toBe(0);
        expect(metadata.stdout.trim()).toBe("Gray gray  1.0");
        const pixels = spawnSync("magick", ["tiff:-", "-depth", "8", "rgb:-"], { input: output });
        expect(pixels.status).toBe(0);
        expect([...pixels.stdout]).toEqual([54, 54, 54, 18, 18, 18]);
    });
}

// Native ImageMagick: magick -size 1x1 xc:<color> -colorspace gray -depth 8 rgba:-
for (const retained of [false, true]) {
    for (const [option, space] of [["-colorspace", "gray"], ["-grayscale", "Rec709Luma"], ["-grayscale", "Rec601Luma"]] as const) {
        it.each([
            ["#ff0000", 54, 255, 76],
            ["#00ff00", 182, 255, 150],
            ["#0000ff", 18, 255, 29],
            ["#356acb80", 102, 128, 101]
        ] as const)(`matches native ${space} for %s, retained=${retained}`, async (color, gray709, alpha, gray601) => {
            const gray = space === "Rec601Luma" ? gray601 : gray709;
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const filesystem = new Proxy(fs, { get(target, key) {
                if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion forbidden"); };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
            const result = await runConvertCli(["-size", "1x1", `xc:${color}`, option, space, "-depth", "8", "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = retained ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([gray, gray, gray, alpha]);
        });
    }
}
