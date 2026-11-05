import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-shadow", "80x3+5+5"], ["-shadow", "35x0.5-2+3"], ["-shadow", "0x1"], ["-shadow", "120x2"],
    ["-background", "#12345600", "-shadow", "80x1-3-2"],
    ["-vignette", "0x2"], ["-vignette", "ignored"], ["-background", "#12345680", "-vignette", "2x3"],
    ["-colorspace", "gray", "-background", "red", "-shadow", "80x1+1+1"],
    ["-colorspace", "gray", "-background", "red", "-vignette", "0x2"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original effect pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "63db7e414d50e3057c504b7a594d422a172184629d008cbed0977c9bfb5b51fb",
        "378859264e8b049bb4c79afcb1409d11cc823b2ef10018ae400261abb579673a",
        "ae1d3a66655936496bb732485b9a2737c1873c28e2d9d551fc87a32a094ad242",
        "cfacf4338b0872fc60f21845c459c43ec163b302c929c57fd1e062a3859fa082",
        "9789852355d5966e57453410fd9662b6ac164b22eea1880d541659bfc3e06391",
        "5b0c5cec64c447c9d11b986df5e9f50137ab3b8bf0469b027cd3cbc99735b5e9",
        "002a7eab6396abfde478490c933a5d3f8d0e3810aa1fffbf3b4fb4515623feab",
        "2dfba1114cdf6c7f8397d9191201426c6a57e2e957bcf45743481b37fe86c789",
        "eb92ee19ffa8dcb95ba3f50b36b00a3ab55cbec4d9f4f6ade2b8e3f492a5c21a",
        "30d6b5b7f81a33df3ffe14ac841bc71fab4f832592fa42d04f13803fd6fa8cdf",
      ]
    `);
});
it.each(operators.flatMap(args => [[13, 17], [1031, 3], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file effect I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
