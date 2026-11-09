import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync, runMagickCli } from "./index.js";

for (const entry of ["sync", "async", "filesystem", "magick"] as const) {
    it(`accepts the reported similarity threshold through ${entry}`, async () => {
        const a = await sharp(Buffer.from("102030ff8090a0ff", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const p = await sharp(Buffer.from("8090a0ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["a.png", a], ["p.png", p]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["-subimage-search", "-similarity-threshold", "1", "a.png", "p.png", "o.png"];
        const result = entry === "sync" ? runCompareCliSync(args, files)
            : entry === "magick" ? await runMagickCli(["compare", ...args], files)
            : await runCompareCli(args, entry === "filesystem" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0) @ 1,0 [0]compare: images too dissimilar 'a.png'\n" });
        for (const [name, pixels] of [["o-0.png", "cfd2d6ffe6e9ecff"], ["o-1.png", "9e9e9effffffffff"]] as const) {
            const bytes = entry === "filesystem" ? await filesystem.readFile(`/${name}`) : files.get(name)!;
            expect([...await sharp(bytes).ensureAlpha().raw().toBuffer()]).toEqual([...Buffer.from(pixels, "hex")]);
        }
    });
}

it("stops after a qualifying row, independently of the dissimilarity warning", async () => {
    const a = await sharp(Buffer.from("707070ff909090ff808080ff808080ff", "hex"), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const p = await sharp(Buffer.from("808080ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    for (const threshold of ["0", "0.1", "10%", "-1"]) {
        for (const output of ["null:", "o.png"]) {
            for (const warning of [false, true]) {
                const files = new Map([["a.png", a], ["p.png", p]]);
                const result = await runCompareCli(["-metric", "RMSE", "-subimage-search", "-similarity-threshold", threshold, "-dissimilarity-threshold", warning ? "0" : "1", "a.png", "p.png", output], files);
                const stopped = threshold === "0.1" || threshold === "10%";
                expect(result.exitCode).toBe(stopped ? 1 : 0);
                expect(result.stderr.split("compare:")[0]).toBe(stopped ? "3561.1 (0.0543388) @ 0,0 [0.0543388]" : "0 (0) @ 0,1 [0]");
                expect(result.stderr.includes("images too dissimilar")).toBe(warning && stopped);
                if (output !== "null:") {
                    const expected = stopped ? "f1f1f1fff1f1f1ff000000ff000000ff" : "f1f1f1fff1f1f1ffffffffffffffffff";
                    expect([...await sharp(files.get("o-1.png")!).ensureAlpha().raw().toBuffer()]).toEqual([...Buffer.from(expected, "hex")]);
                }
            }
        }
    }
});

it("rejects malformed similarity thresholds without publishing output", async () => {
    for (const threshold of ["", "oops", "NaN", "Infinity", "%"]) {
        const files = new Map<string, Uint8Array>();
        expect(await runCompareCli(["-similarity-threshold", threshold, "a.png", "p.png", "o.png"], files))
            .toMatchObject({ exitCode: 2, stdout: "", stderr: `compare: invalid argument for option '-similarity-threshold': ${threshold}\n` });
        expect(files.size).toBe(0);
    }
});

// Golden metrics verified with ImageMagick 7.1.2-35 (without FFT acceleration).
it("uses strict error thresholds and inclusive similarity thresholds", async () => {
    const a = await sharp(Buffer.from("707070ff909090ff806040ff808080ff", "hex"), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const p = await sharp(Buffer.from("808080ff", "hex"), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    for (const [metric, threshold, expected] of [
        ["SSIM", "0.9", "169.457 (0.00258575) @ 1,0 [0.994828]"],
        ["PSNR", "0.1", "25.2978 (0.210815) @ 0,0 [0.210815]"],
        ["AE", "0.05", "0.188235 (0.0470588) @ 0,0 [0.0470588]"],
        ["AE", String(12 / 255), "0 (0) @ 1,1 [0]"]
    ] as const) {
        const result = await runCompareCli(["-metric", metric, "-subimage-search", "-similarity-threshold", threshold, "a.png", "p.png", "null:"], new Map([["a.png", a], ["p.png", p]]));
        expect(result.stderr.split("compare:")[0]).toBe(expected);
    }
});

it("does not apply the search threshold to ordinary comparisons", async () => {
    const a = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    const p = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
    const files = new Map([["a.png", a], ["p.png", p]]);
    const args = ["a.png", "p.png", "null:"];
    expect(await runCompareCli(["-similarity-threshold", "1", ...args], files)).toEqual(await runCompareCli(args, files));
});
