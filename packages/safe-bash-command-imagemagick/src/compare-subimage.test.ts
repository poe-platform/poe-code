import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

for (const [blue, expected, status] of [[255, "0 (0) @ 1,1 [0]", 0], [240, "0.117647 (0.0196078) @ 1,1 [0.0196078]", 1]] as const) {
    it(`searches both axes for a ${blue === 255 ? "perfect" : "partial"} match across compare entry points`, async () => {
        const a = await sharp(Buffer.from([255,0,0, 0,255,0, 255,0,0, 0,255,0, 0,0,255, 255,0,0]), { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        const b = await sharp(Buffer.from([0,0,blue]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["a.png", a], ["b.png", b]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["-metric", "AE", "-subimage-search", "a.png", "b.png", "diff.png"];
        const result = { exitCode: status, stdout: "", stderr: `${expected}\n` };
        expect(runCompareCliSync(args, files)).toMatchObject(result);
        expect(await runCompareCli(args, files)).toMatchObject(result);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toMatchObject(result);
        const diff = await sharp(files.get("diff.png")!).ensureAlpha().raw().toBuffer();
        expect([...diff.subarray(0, 4)]).toEqual([255, 204, 204, 255]);
        expect([...diff.subarray(16, 20)]).toEqual(blue === 255 ? [204, 204, 255, 255] : [193, 0, 75, 255]);
        expect(await sharp(await filesystem.readFile('/diff.png')).raw().toBuffer()).toEqual(await sharp(files.get('diff.png')!).raw().toBuffer());
    });
}

it("finds the reported one-pixel match and keeps ordinary comparisons unchanged", async () => {
    const a = await sharp(Buffer.from([255,0,0, 0,0,255, 0,255,0]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const b = await sharp(Buffer.from([0,0,255]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["a.png", a], ["b.png", b]]);
    expect(await runCompareCli(["-metric", "AE", "-subimage-search", "a.png", "b.png", "null:"], files))
        .toMatchObject({ exitCode: 0, stderr: "0 (0) @ 1,0 [0]\n" });
    expect(await runCompareCli(["-metric", "AE", "-subimage-search", "+subimage-search", "a.png", "b.png", "null:"], files))
        .toMatchObject({ exitCode: 1, stderr: "1.33333 (0.444444)\n" });
    expect(await runCompareCli(["-subimage-search", "b.png", "a.png", "null:"], files))
        .toMatchObject({ exitCode: 2, stderr: "compare: geometry does not contain image 'b.png'\n" });
});

it("keeps the first offset when multiple regions match", async () => {
    const a = await sharp({ create: { width: 3, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    const b = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
    const result = await runCompareCli(["-metric", "AE", "-subimage-search", "a.png", "b.png", "null:"], new Map([["a.png", a], ["b.png", b]]));
    expect(result).toMatchObject({ exitCode: 0, stderr: "0 (0) @ 0,0 [0]\n" });
});

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("matches native search metrics for a multi-pixel region", async () => {
    const pixels = Buffer.from([255,0,0, 255,0,0, 255,0,0, 255,0,0, 255,0,0, 10,20,30, 40,50,60, 255,0,0, 255,0,0, 70,80,90, 100,110,120, 255,0,0]);
    const a = await sharp(pixels, { raw: { width: 4, height: 3, channels: 3 } }).png().toBuffer();
    const b = await sharp(Buffer.from([10,20,31, 40,50,60, 70,80,90, 100,110,120]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
    for (const metric of ["AE", "MAE", "MSE", "RMSE", "PAE", "PSNR", "SSIM", "DSSIM", "NCC", "DPC", "PDC", "PHASE"]) {
        const result = await runCompareCli(["-metric", metric, "-subimage-search", "a.png", "b.png", "null:"], new Map([["a.png", a], ["b.png", b]]));
        const reference = spawnSync("magick", ["compare", "-metric", metric, "-subimage-search", ...[a, b].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "null:"], { encoding: "utf8" });
        expect(result.exitCode, metric).toBe(reference.status);
        expect(result.stderr.split("\n")[0], metric).toBe(reference.stderr.split("compare:")[0]);
        expect(result.stderr.includes("images too dissimilar"), metric).toBe(reference.stderr.includes("images too dissimilar"));
    }
});

it("applies the dissimilarity warning threshold without hiding differences", async () => {
    const a = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    const b = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
    for (const [threshold, warning] of [["0.6", true], ["70%", false]] as const) {
        const result = await runCompareCli(["-metric", "AE", "-subimage-search", "-dissimilarity-threshold", threshold, "a.png", "b.png", "null:"], new Map([["a.png", a], ["b.png", b]]));
        expect(result.exitCode).toBe(1);
        expect(result.stderr.startsWith("0.666667 (0.666667) @ 0,0 [0.666667]\n")).toBe(true);
        expect(result.stderr.includes("images too dissimilar")).toBe(warning);
    }
});
