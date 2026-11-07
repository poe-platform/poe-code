import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const option of ["-raise", "+raise"]) {
        it.each(["2x1", "1x3"])(`preserves the interior for ${option} %s, ${mode}`, async geometry => {
            const args = ["-size", "12x10", "xc:#406080", option, geometry, "png:-"];
            const result = mode === "sync" ? runConvertCliSync(args, new Map())
                : await runConvertCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
            expect(result.exitCode, result.stderr).toBe(0);
            const image = decodeImage(result.stdoutBytes!);
            const offset = (geometry === "2x1" ? 1 * 12 + 2 : 3 * 12 + 1) * 4;
            expect([...image.data.slice(offset, offset + 4)]).toEqual([64, 96, 128, 255]);
        });
        it.each(["50%", "60x20%", "20x60%"])(`rejects oversized resolved bevels for ${option} %s, ${mode}`, async geometry => {
            const args = ["-size", "12x10", "xc:#406080", option, geometry, "png:-"];
            const result = mode === "sync" ? runConvertCliSync(args, new Map())
                : await runConvertCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("size must exceed bevel width");
        });
        for (const depth of [8, 16]) {
            it.skipIf(!nativeAvailable).each(["2x1", "1x3", "2", "2x2", "20x20%", "20x10%", "20%", "5%"])(`matches native ${option} %s at depth ${depth}, ${mode}`, async geometry => {
                const input = spawnSync("magick", ["-size", "12x10", "xc:#406180", "-depth", String(depth), depth === 16 ? "PNG48:-" : "PNG24:-"]);
                expect(input.status).toBe(0);
                const args = ["input.png", option, geometry, "out.png"];
                const files = new Map([["input.png", new Uint8Array(input.stdout)]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input.stdout);
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode, result.stderr).toBe(0);
                const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
                const reference = spawnSync("magick", ["png:-", option, geometry, "-depth", String(depth), "rgba:-"], { input: input.stdout });
                const actual = spawnSync("magick", ["png:-", "-depth", String(depth), "rgba:-"], { input: output });
                expect(reference.status).toBe(0);
                expect(actual.status).toBe(0);
                expect(actual.stdout.equals(reference.stdout)).toBe(true);
            });
        }
    }
}
