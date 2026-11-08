import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const native = spawnSync("magick", ["-version"]);
const gradient = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];
const changed = [...gradient];
changed[9] = 120;

for (const [name, a, b, channels, expected, status] of [
    ["solid RGB", Array(6).fill([255, 0, 0]).flat(), Array(6).fill([0, 0, 255]).flat(), 3, "21842.8 (0.3333)", 1],
    ["gradient", gradient, changed, 3, "136.554 (0.00208368)", 1],
    ["identical", gradient, gradient, 3, "0 (0)", 0],
    ["transparent colors", Array(6).fill([255, 0, 0, 0]).flat(), Array(6).fill([0, 0, 255, 0]).flat(), 4, "16382.1 (0.249975)", 1],
    ["below status tolerance", Array(6).fill([255, 0, 0, 255]).flat(), Array(6).fill([254, 0, 0, 255]).flat(), 4, "0.0632345 (9.64897e-07)", 0]
] as const) {
    it(`matches native DSSIM for ${name} across compare runners`, async () => {
        const images = await Promise.all([a, b].map(pixels => sharp(Uint8Array.from(pixels), { raw: { width: 3, height: 2, channels } }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["-metric", "DSSIM", "a.png", "b.png", "null:"];
        const result = await runCompareCli(args, files);
        expect(result.exitCode).toBe(status);
        expect(result.stderr).toBe(`${expected}\n`);
        expect(runCompareCliSync(args, files)).toEqual(result);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
        if (!native.error) {
            const reference = spawnSync("magick", ["compare", "-metric", "DSSIM", ...images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            expect(result.stderr.trim()).toBe(reference.stderr);
            expect(result.exitCode).toBe(reference.status);
        }
    });
}
