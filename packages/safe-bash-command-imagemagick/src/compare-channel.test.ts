import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli } from "./index.js";

const cases = [
    { channel: "R", metric: "0 (0)", pixels: "cfffffffe6ffffff" },
    { channel: "Green", metric: "0 (0)", pixels: "ffd2ffffffe9ffff" },
    { channel: "B", metric: "14538.1 (0.221837)", pixels: "ffffd6fff10038ff" },
    { channel: "A", metric: "0 (0)", pixels: "ffffffffffffffff" },
    { channel: "RGB", metric: "8393.58 (0.128078)", pixels: "cfd2d6ffda1d38ff" },
    { channel: "All", metric: "7269.06 (0.110919)", pixels: "cfd2d6ffda1d38ff" },
    { channel: "R,B", metric: "10280 (0.156863)", pixels: "cfffd6ffda0038ff" },
];
async function images() {
    return Promise.all(["102030ff8090a0ff", "102030ff8090f0ff"].map(hex =>
        sharp(Buffer.from(hex, "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()));
}
for (const { channel, metric, pixels } of cases) {
    it(`compares only ${channel} in memory and filesystem execution`, async () => {
        const [a, b] = await images();
        const files = new Map([["a.png", a!], ["b.png", b!]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        for (const input of [files, { filesystem: fs, cwd: "/" }]) {
            expect(await runCompareCli(["-channel", channel, "a.png", "b.png", "diff.png"], input))
                .toMatchObject({ exitCode: metric === "0 (0)" ? 0 : 1, stdout: "", stderr: `${metric}\n` });
            const output = input === files ? files.get("diff.png")! : await fs.readFile("/diff.png");
            expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(pixels);
        }
    });
}
it("resets channel selection and rejects invalid channel names without writing output", async () => {
    const [a, b] = await images(), files = new Map([["a.png", a!], ["b.png", b!]]);
    expect(await runCompareCli(["-channel", "R", "+channel", "a.png", "b.png", "null:"], files))
        .toMatchObject({ exitCode: 1, stderr: "7269.06 (0.110919)\n" });
    expect(await runCompareCli(["-channel", "bogus", "a.png", "b.png", "diff.png"], files))
        .toMatchObject({ exitCode: 2 });
    expect(files.has("diff.png")).toBe(false);
    for (const args of [["-channel"], ["-channel", "constructor"], ["-channel", ""]]) {
        expect(await runCompareCli(args, files)).toMatchObject({ exitCode: 2 });
    }
});
it("compares alpha changes and preserves alpha weighting for selected colors", async () => {
    const [a] = await images();
    const b = await sharp(Buffer.from("102030ff8090a080", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    for (const [channel, metric, pixels] of [
        ["R", "11584.9 (0.176774)", "cfffffffda001eff"],
        ["A", "23079.3 (0.352167)", "fffffffff1001eff"],
    ]) {
        const files = new Map([["a.png", a!], ["b.png", b]]);
        expect(await runCompareCli(["-channel", channel!, "a.png", "b.png", "diff.png"], files))
            .toMatchObject({ exitCode: 1, stderr: `${metric}\n` });
        expect(Buffer.from(decodeImage(files.get("diff.png")!).data).toString("hex")).toBe(pixels);
    }
});
const native = spawnSync("magick", ["-version"]);
for (const [metric, red, blue] of [
    ["AE", "0 (0)", "0.313725 (0.156863)"],
    ["MAE", "0 (0)", "10280 (0.156863)"],
    ["MEPP", "0 (0, 0)", "10280 (0.156863, 0.313725)"],
    ["MSE", "0 (0)", "3225.1 (0.0492118)"],
    ["Fuzz", "0 (0)", "6450.2 (0.0984237)"],
    ["PAE", "0 (0)", "20560 (0.313725)"],
    ["PSNR", "120 (1)", "13.0793 (0.108994)"],
    ["SSIM", "0 (0)", "5636.13 (0.0860019)"],
    ["DSSIM", "0 (0)", "5636.13 (0.0860019)"],
    ["NCC", "0 (0)", "0 (0)"],
    ["DPC", "0 (0)", "0 (0)"],
    ["PDC", "0 (0)", "1 (0.5)"],
    ["PHASE", "0 (0)", "0 (0)"],
    ["PHASH", "2.87513 (2.87513)", "1.02371 (1.02371)"],
] as const) {
    it(`honors selected channels with ${metric}`, async () => {
        const [a, b] = await images();
        for (const [channel, expected] of [["R", red], ["B", blue]]) {
            const files = new Map([["a.png", a!], ["b.png", b!]]);
            const args = ["-metric", metric, "-channel", channel!, "a.png", "b.png", "null:"];
            expect(await runCompareCli(args, files)).toMatchObject({
                exitCode: expected!.startsWith("0 (") ? 0 : 1, stderr: `${expected}\n`
            });
        }
    });
}
it.skipIf(native.error !== undefined)("checks channel references against native ImageMagick", async () => {
    const inputs = (await images()).map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    for (const { channel, metric, pixels } of cases) {
        const result = spawnSync("magick", ["compare", "-channel", channel, ...inputs, "png:-"]);
        expect(result.status).toBe(metric === "0 (0)" ? 0 : 1);
        expect(result.stderr.toString().trim()).toBe(metric);
        expect(Buffer.from(decodeImage(result.stdout).data).toString("hex")).toBe(pixels);
    }
});
