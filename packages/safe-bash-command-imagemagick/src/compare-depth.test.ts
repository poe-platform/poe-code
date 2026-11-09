import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: only one of two gray samples differs.
for (const [metric, stderr, exitCode] of [
    ["RMSE", "0.707107 (1.07898e-05)", 1],
    ["MAE", "0.5 (7.62951e-06)", 1],
    ["AE", "1.5259e-05 (7.62951e-06)", 1],
    ["SSIM", "9.50364e-06 (1.45016e-10)", 0]
] as const) {
    it(`preserves low 16-bit samples and ${metric} status across runners`, async () => {
        const images = [0x1234, 0x1235].map(value => {
            const data16 = Uint16Array.of(value, value, value, 65535, 65535, 65535, 65535, 65535);
            const bytes = encodeImage({ width: 2, height: 1, format: "png", density: 72, channels: 1,
                hasAlpha: false, space: "b-w", depth: "ushort", data16,
                data: Uint8Array.from(data16, sample => Math.round(sample / 257)) }, { format: "png" }).data;
            expect(decodeImage(bytes).data16).toEqual(data16);
            return bytes;
        });
        const files = new Map([["a.png", images[0]!], ["b.png", images[1]!]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        for (const same of [false, true]) {
            const args = ["-metric", metric, "a.png", same ? "a.png" : "b.png", "null:"];
            const expected = { exitCode: same ? 0 : exitCode, stdout: "", stderr: same ? "0 (0)" : stderr };
            const result = await runCompareCli(args, files);
            if (metric === "SSIM" && !same) {
                // Floating-point cancellation affects the last scaled digits.
                expect(result).toMatchObject({ exitCode, stdout: "" });
                expect(Number(result.stderr.split(" ")[0])).toBeCloseTo(9.50364e-6, 10);
                expect(result.stderr).toContain("(1.45016e-10)");
            } else expect(result).toMatchObject(expected);
            expect(runCompareCliSync(args, files)).toEqual(result);
            expect(await runMagickCli(["compare", ...args], files)).toEqual(result);
            expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
            const native = spawnSync("magick", ["compare", "-metric", metric,
                ...[images[0]!, images[same ? 0 : 1]!].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
            if (!native.error) {
                expect(native.status).toBe(expected.exitCode);
                if (metric === "SSIM" && !same) expect(Number(native.stderr.split(" ")[0])).toBeCloseTo(9.50364e-6, 10);
                else expect(native.stderr.trim()).toBe(expected.stderr.trim());
            }
        }
    });
}

it("compares mixed depths and searches low-bit samples without truncating virtual crops", async () => {
    const encode = (values: number[], highDepth: boolean) => {
        const samples = values.flatMap(value => [value, value, value, highDepth ? 65535 : 255]);
        return encodeImage({ width: values.length, height: 1, format: "png", density: 72, channels: 3,
            hasAlpha: false, space: "srgb", depth: highDepth ? "ushort" : "uchar",
            ...(highDepth ? { data16: Uint16Array.from(samples) } : {}),
            data: Uint8Array.from(samples, value => highDepth ? Math.round(value / 257) : value) }, { format: "png" }).data;
    };
    const files = new Map([["a.png", encode([0x1212, 0x1213], true)], ["b.png", encode([0x1213], true)],
        ["eight.png", encode([18, 18], false)]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    for (const args of [
        ["-metric", "RMSE", "a.png", "eight.png", "null:"],
        ["-metric", "RMSE", "-subimage-search", "a.png", "b.png", "null:"],
        ["-metric", "RMSE", "-subimage-search", "eight.png", "b.png", "diff.png"]
    ]) {
        const result = await runCompareCli(args, new Map(files));
        if (!args.includes("-subimage-search")) expect(result).toMatchObject({ exitCode: 1, stderr: "0.707107 (1.07898e-05)" });
        else if (args.includes("null:")) expect(result).toMatchObject({ exitCode: 0, stderr: "0 (0) @ 1,0 [0]" });
        else expect(result).toMatchObject({ exitCode: 1, stderr: "1 (1.5259e-05) @ 0,0 [1.5259e-05]" });
        expect(runCompareCliSync(args, new Map(files))).toEqual(result);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(result);
    }
});
