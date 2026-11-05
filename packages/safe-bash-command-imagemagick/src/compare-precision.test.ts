import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const native = spawnSync("magick", ["-version"], { encoding: "utf8" });
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
            expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `${expected}\n` });
        });
    }
    it.skipIf(native.error !== undefined)(`verifies native ${metric} precision`, async () => {
        const images = await Promise.all([a, b].map(background => sharp({ create: { width: 3, height: 2, channels: 4, background } }).png().toBuffer()));
        const result = spawnSync("magick", ["compare", "-metric", metric, ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toBe(expected);
    });
}
