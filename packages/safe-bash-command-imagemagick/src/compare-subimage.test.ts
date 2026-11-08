import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runConvertCli } from "./index.js";

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
        const diff = await sharp(files.get("diff-0.png")!).ensureAlpha().raw().toBuffer();
        expect([...diff.subarray(0, 4)]).toEqual([255, 204, 204, 255]);
        expect([...diff.subarray(16, 20)]).toEqual(blue === 255 ? [204, 204, 255, 255] : [193, 0, 75, 255]);
        expect(await sharp(await filesystem.readFile('/diff-0.png')).raw().toBuffer()).toEqual(await sharp(files.get('diff-0.png')!).raw().toBuffer());
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
    for (const metric of ["AE", "MAE", "MSE", "RMSE", "PAE", "PSNR", "SSIM", "DSSIM", "NCC", "DPC", "PDC", "PHASE", "PHASH"]) {
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

for (const mode of ["sync", "async", "filesystem"] as const) {
    it(`publishes comparison and similarity pixels through ${mode}`, async () => {
        const a = await sharp(Buffer.from("102030ff8090a0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const b = await sharp(Buffer.from("8090a0ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        for (const output of ["o.png", "o-%02d.png", "o.miff", "o.tiff", "o.gif"]) {
            const files = new Map([["a.png", a], ["b.png", b]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-metric", "RMSE", "-subimage-search", "a.png", "b.png", output];
            const result = mode === "sync" ? runCompareCliSync(args, files) : await runCompareCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0) @ 1,0 [0]\n" });
            const read = async (name: string) => mode === "filesystem" ? filesystem.readFile(`/${name}`) : files.get(name)!;
            if (output.endsWith("png")) {
                const prefix = output.includes("%") ? "o-0" : "o-";
                expect([...await sharp(await read(`${prefix}0.png`)).ensureAlpha().raw().toBuffer()]).toEqual([...Buffer.from("cfd2d6ffe6e9ecff", "hex")]);
                expect([...await sharp(await read(`${prefix}1.png`)).ensureAlpha().raw().toBuffer()]).toEqual([158,158,158,255,255,255,255,255]);
            } else {
                const bytes = await read(output);
                if (!native.error) {
                    const decoded = spawnSync("magick", [`${output.slice(2)}:-`, "-depth", "8", "rgba:-"], { input: bytes });
                    expect(decoded.status).toBe(0);
                    expect([...decoded.stdout]).toEqual([207,210,214,255,230,233,236,255,158,158,158,255,255,255,255,255]);
                }
                if (output.endsWith("miff")) {
                    let offset = 0;
                    for (const pixels of [[207,210,214,255,230,233,236,255], [158,158,158,255,255,255,255,255]]) {
                        const end = bytes.indexOf(26, offset);
                        expect(new TextDecoder().decode(bytes.subarray(offset, end))).toContain("id=ImageMagick");
                        expect([...bytes.subarray(end + 1, end + 9)]).toEqual(pixels);
                        offset = end + 9;
                    }
                    expect(offset).toBe(bytes.length);
                    continue;
                }
                if (output.endsWith("tiff")) {
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                    const pages = [];
                    for (let offset = view.getUint32(4, true); offset !== 0;) {
                        const page = bytes.slice();
                        new DataView(page.buffer).setUint32(4, offset, true);
                        pages.push([...await sharp(page).ensureAlpha().raw().toBuffer()]);
                        offset = view.getUint32(offset + 2 + view.getUint16(offset, true) * 12, true);
                        expect(pages.length).toBeLessThanOrEqual(2);
                    }
                    expect(pages).toEqual([[207,210,214,255,230,233,236,255], [158,158,158,255,255,255,255,255]]);
                    continue;
                }
                const decoded = new Map([[output, bytes]]);
                expect(await runConvertCli([output, "frames.png"], decoded)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                expect([...decoded.keys()]).toEqual([output, "frames-0.png", "frames-1.png"]);
                expect([...await sharp(decoded.get("frames-1.png")!).ensureAlpha().raw().toBuffer()]).toEqual([158,158,158,255,255,255,255,255]);
            }
        }
    });
}

it("fills the map after an exact match, including edge-extended offsets", async () => {
    const a = await sharp(Buffer.from([0,0,0, 128,128,128, 255,255,255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const b = await sharp(Buffer.from([0,0,0, 128,128,128]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["a.png", a], ["b.png", b]]);
    const result = await runCompareCli(["-metric", "RMSE", "-subimage-search", "a.png", "b.png", "o.png"], files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "0 (0) @ 0,0 [0]\n" });
    expect([...await sharp(files.get("o-1.png")!).ensureAlpha().raw().toBuffer()]).toEqual([255,255,255,255,127,127,127,255,54,54,54,255]);
});

it("keeps ordinary output singular and writes both search images to stdout", async () => {
    const a = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    for (const retained of [false, true]) {
        const files = new Map([["a.png", a]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.png", a);
        const input = retained ? { filesystem, cwd: "/" } : files;
        expect(await runCompareCli(["a.png", "a.png", "o.png"], input)).toMatchObject({ exitCode: 0 });
        expect(retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(["a.png", "o.png"]);
        const result = await runCompareCli(["-metric", "RMSE", "-subimage-search", "a.png", "a.png", "rgba:-"], input);
        expect([...result.stdoutBytes!]).toEqual([255,204,204,255,255,255,255,255]);
    }
});
