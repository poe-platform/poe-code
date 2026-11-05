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
        "832ccc9c156db1e0a0173a11e9ab0d54c9f8ee41c636c58ad8c70fd571c22747",
        "e650f238ac475851699d20302d94604e312ccc75ae1cd207f044cd786da14c15",
        "ae1d3a66655936496bb732485b9a2737c1873c28e2d9d551fc87a32a094ad242",
        "1669eeb2dcc404b58dd068a2a63bfb065644f80f104131b40a71ce65657f9816",
        "6cc8165d461dd1dc07487a8eeaf09a984d3d3ecf097bcaf9f45fb50c10cf59a6",
        "5b0c5cec64c447c9d11b986df5e9f50137ab3b8bf0469b027cd3cbc99735b5e9",
        "14e3d817d894c0c74760e5c5947785509eaec3ea454012394f5674eda1149f34",
        "545bf127968bee45a8d12368c75e54c38a834b1190d535decabe399617836b0d",
        "eff773c0468d0a021a7c508c42bed92722e0a7631ba5d1a6015097ab766c4d8c",
        "d8fd423edb4e6687ab98c71bd508c525b7aef1202b88149c55de41ee6953432c",
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
