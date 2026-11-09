import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
for (const [size, metric, expected, exitCode] of [
    [64, "MAE", "0.0209147 (3.19138e-07)", 0],
    [64, "MSE", "8.20185e-05 (1.25152e-09)", 0],
    [64, "RMSE", "2.31842 (3.53769e-05)", 1],
    [64, "PAE", "257 (0.00392157)", 1],
    [128, "MSE", "2.05046e-05 (3.1288e-10)", 0]
] as const) {
    it(`preserves small normalized ${metric} differences at ${size}x${size} across compare runners`, async () => {
        const a = new Uint8Array(size * size * 3).fill(100);
        const b = a.slice();
        b[0] = 101;
        const images = await Promise.all([a, b].map(pixels => sharp(pixels, {
            raw: { width: size, height: size, channels: 3 }
        }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const args = ["-metric", metric, "a.png", "b.png", "null:"];
        const result = await runCompareCli(args, files);
        expect(result).toMatchObject({ exitCode, stdout: "", stderr: expected });
        expect(runCompareCliSync(args, files)).toEqual(result);
        expect(await runMagickCli(["compare", ...args], files)).toEqual(result);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", "-metric", metric,
                ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(reference.stderr.trim()).toBe(expected);
            expect(reference.status).toBe(exitCode);
            expect(reference.error).toBeUndefined();
        }
    });
}
for (const [metric, a, b, expected] of [
    ["RMSE", { r: 255, g: 0, b: 0, alpha: 0.2 }, { r: 255, g: 0, b: 0, alpha: 0.8 }, "27804.1 (0.424264)"],
    ["MSE", { r: 255, g: 0, b: 0, alpha: 0.5 }, { r: 0, g: 255, b: 0, alpha: 0.5 }, "8256.25 (0.125982)"],
    ["MAE", { r: 255, g: 0, b: 0, alpha: 0.5 }, { r: 0, g: 255, b: 0, alpha: 0.5 }, "16448 (0.25098)"],
    ["PAE", { r: 255, g: 0, b: 0, alpha: 0.2 }, { r: 255, g: 0, b: 0, alpha: 0.8 }, "39321 (0.6)"]
] as const) {
    for (const retained of [false, true]) {
        it(`matches ImageMagick ${metric} precision, retained=${retained}`, async () => {
            const images = await Promise.all([a, b].map(background => sharp({ create: { width: 3, height: 2, channels: 4, background } }).png().toBuffer()));
            const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files)
                await filesystem.writeFile(`/${name}`, bytes);
            const result = await runCompareCli(["-metric", metric, "a.png", "b.png", "null:"], retained ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: expected });
        });
    }
    it.skipIf(native.error !== undefined)(`verifies native ${metric} precision`, async () => {
        const images = await Promise.all([a, b].map(background => sharp({ create: { width: 3, height: 2, channels: 4, background } }).png().toBuffer()));
        const result = spawnSync("magick", ["compare", "-metric", metric, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe(expected);
    });
}
