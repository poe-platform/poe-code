import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["Lab", "XYZ", "HSL"])(`${mode}: preserves four remapped %s colors through sRGB conversion`, async space => {
        for (const output of [["-depth", "8", "rgba:out.raw"], ["-format", "%[colorspace]|%k", "info:"]]) {
            const files = new Map([
                ["in.ppm", Buffer.concat([Buffer.from("P6\n8 4\n255\n"), Buffer.from(Array.from({ length: 96 }, (_, i) => (13 * i + 9) % 256))])],
                ["pal.ppm", Buffer.concat([Buffer.from("P6\n4 1\n255\n"), Buffer.from("000000ff000000ff00ffffff", "hex")])]
            ]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.ppm", "-colorspace", space, "+dither", "-remap", "pal.ppm", "-colorspace", "sRGB", ...output];
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            if (output.includes("info:")) expect(result.stdout.trim()).toBe("sRGB|4");
            else {
                const bytes = mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
                expect(bytes.length).toBe(128);
                expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 0, 0, 255]);
                expect(new Set(Array.from({ length: 32 }, (_, i) => bytes.subarray(i * 4, i * 4 + 4).join(","))).size).toBe(4);
                expect(createHash("sha256").update(bytes).digest("hex")).toBe("28dd10cdfcfc3824a9a1b743c1a61d28cef3064ea02b02b06d474e9f087dc7f6");
            }
        }
    });
}
