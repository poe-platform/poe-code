import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const space of ["RGB", "sRGB"]) {
        for (const convertBack of [false, true]) {
            it(`${mode}: remaps ${space} to sRGB${convertBack ? " with subsequent conversion" : ""}`, async () => {
                const prefix = ["in.ppm", "-colorspace", space, "+dither", "-remap", "pal.ppm", ...(convertBack ? ["-colorspace", "sRGB"] : [])];
                for (const info of [false, true]) {
                    const files = new Map([
                        ["in.ppm", Buffer.concat([Buffer.from("P6\n8 4\n255\n"), Buffer.from(Array.from({ length: 96 }, (_, i) => (13 * i + 9) % 256))])],
                        ["pal.ppm", Buffer.concat([Buffer.from("P6\n4 1\n255\n"), Buffer.from("000000ff000000ff00ffffff", "hex")])]
                    ]);
                    const fs = new MemoryFileSystem();
                    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
                    const argv = [...prefix, ...(info ? ["-format", "%[colorspace]|%k", "info:"] : ["-depth", "8", "rgba:out.raw"])];
                    const result = mode === "sync" ? runConvertCliSync(argv, files)
                        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    if (info) expect(result.stdout.trim()).toBe("sRGB|4");
                    else {
                        const output = mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
                        expect(output.length).toBe(128);
                        // Native ImageMagick 7.1.2-35 Q16-HDRI reference.
                        expect(createHash("sha256").update(output).digest("hex")).toBe("28dd10cdfcfc3824a9a1b743c1a61d28cef3064ea02b02b06d474e9f087dc7f6");
                    }
                }
            });
        }
    }
}
