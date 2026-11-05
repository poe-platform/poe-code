import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

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
            const result = await runConvertCli(["-size", "1x1", `xc:${color}`, option, space, "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = retained ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([gray, gray, gray, alpha]);
        });
    }
}
