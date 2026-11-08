import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

for (const mode of ["sync", "memory", "retained", "magick"] as const) {
    it(`applies explicit metric precision without changing comparison results, ${mode}`, async () => {
        const a = await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 160, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const b = await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, 240, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["a.png", a], ["b.png", b]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const run = (args: string[]) => mode === "sync" ? runCompareCliSync(args, files)
            : mode === "magick" ? runMagickCli(["compare", ...args], files)
            : runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const control = await run(["-format", "%[distortion]", "a.png", "b.png", "control.png"]);
        for (const [precision, metric] of [["1", "7e+03 (0.1)"], ["3", "7.27e+03 (0.111)"], ["6", "7269.06 (0.110919)"], ["8", "7269.0577 (0.11091871)"]] as const) {
            expect(await run(["-precision", precision, "-format", "%[distortion]", "a.png", "b.png", "diff.png"]))
                .toEqual({ ...control, stderr: `${metric}\n` });
            const read = (name: string) => mode === "retained" ? filesystem.readFile(`/${name}`) : files.get(name)!;
            expect(decodeImage(await read("diff.png"))).toEqual(decodeImage(await read("control.png")));
        }
        expect(await run(["-precision", "3", "a.png", "a.png", "null:"])).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)\n" });
    });
}

for (const value of [undefined, "abc", "", "Infinity"]) {
    it(`rejects invalid precision ${String(value)}`, async () => {
        const result = await runCompareCli(value === undefined ? ["-precision"] : ["-precision", value], new Map());
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(value === undefined ? "missing an argument" : "invalid argument");
    });
}

it.skipIf(spawnSync("magick", ["-version"]).error !== undefined)("matches native metric and subimage precision", async () => {
    const images = await Promise.all([160, 240].map(blue => sharp(new Uint8Array([16, 32, 48, 255, 128, 144, blue, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
    const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
    for (const metric of ["RMSE", "MAE", "MEPP", "MSE", "PAE", "PSNR", "AE", "PDC"]) {
        for (const precision of ["3", "8"]) {
            for (const search of metric === "RMSE" ? [[], ["-subimage-search", "-dissimilarity-threshold", "1"]] : [[]]) {
                const args = ["-metric", metric, "-precision", precision, ...search];
                const native = spawnSync("magick", ["compare", ...args, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
                expect(native.error).toBeUndefined();
                const result = await runCompareCli([...args, "a.png", "b.png", "null:"], files);
                expect(result.exitCode).toBe(native.status);
                expect(result.stderr.trim()).toBe(native.stderr.trim());
            }
        }
    }
});
