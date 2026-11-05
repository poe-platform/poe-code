import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

const thresholds = ["0", "-1", "1e2", "0.9", "1", "100%", "65535", "100000"];
const metrics = ["AE", "MAE", "RMSE", "NCC", "SSIM"];

for (const metric of metrics) {
    it(`does not suppress ordinary ${metric} differences with a subimage threshold`, async () => {
        const images = await Promise.all(["red", "blue"].map(background =>
            sharp({ create: { width: 3, height: 2, channels: 3, background } }).png().toBuffer()));
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files)
            await filesystem.writeFile(`/${name}`, bytes);
        for (const input of [files, { filesystem, cwd: "/" }]) {
            const baseline = await runCompareCli(["-metric", metric, "a.png", "b.png", "null:"], input);
            expect(baseline.exitCode).toBe(1);
            for (const threshold of thresholds) {
                const result = await runCompareCli(["-metric", metric, "-dissimilarity-threshold", threshold, "a.png", "b.png", "null:"], input);
                expect(result).toEqual(baseline);
            }
            if (metric === "AE") {
                expect(baseline.stderr).toBe("4 (0.666667)\n");
                const identical = await runCompareCli(["-metric", metric, "-dissimilarity-threshold", "1", "a.png", "a.png", "null:"], input);
                expect(identical).toMatchObject({ exitCode: 0, stderr: "0 (0)\n" });
            }
        }
    });
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies ordinary threshold comparison statuses against native ImageMagick", async () => {
    expect(native.status).toBe(0);
    const images = await Promise.all(["red", "blue"].map(background =>
        sharp({ create: { width: 3, height: 2, channels: 3, background } }).png().toBuffer()));
    const inputs = images.map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    for (const metric of metrics) {
        for (const threshold of thresholds) {
            const result = spawnSync("magick", ["compare", "-metric", metric, "-dissimilarity-threshold", threshold, ...inputs, "null:"], { encoding: "utf8" });
            expect(result.status).toBe(1);
            if (metric === "AE")
                expect(result.stderr.trim()).toBe("4 (0.666667)");
        }
    }
});

const invalidThresholds = ["bogus", "NaN", "Infinity", "12bogus", "", " ", "bogus%"];

it("rejects invalid dissimilarity thresholds across compare entry points", async () => {
    const images = await Promise.all(["red", "blue"].map(background =>
        sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()));
    const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files)
        await filesystem.writeFile(`/${name}`, bytes);
    for (const threshold of invalidThresholds) {
        const args = ["-metric", "AE", "-dissimilarity-threshold", threshold, "a.png", "b.png", "null:"];
        const expected = { exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '-dissimilarity-threshold': ${threshold}\n` };
        expect(runCompareCliSync(args, files)).toEqual(expected);
        expect(await runCompareCli(args, files)).toEqual(expected);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(expected);
    }
    expect(await runCompareCli(["a.png", "b.png", "null:", "-dissimilarity-threshold"], files))
        .toMatchObject({ exitCode: 2, stdout: "", stderr: "compare: invalid argument for option '-dissimilarity-threshold': \n" });
});

it.skipIf(native.error !== undefined)("verifies invalid dissimilarity thresholds against native ImageMagick", () => {
    expect(native.status).toBe(0);
    for (const threshold of invalidThresholds) {
        const result = spawnSync("magick", ["compare", "-metric", "AE", "-dissimilarity-threshold", threshold, "xc:red", "xc:blue", "null:"], { encoding: "utf8" });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`invalid argument for option '-dissimilarity-threshold': ${threshold}`);
    }
});
