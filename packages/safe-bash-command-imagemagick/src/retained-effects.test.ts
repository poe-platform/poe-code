import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-shadow", "80x3+5+5"], ["-shadow", "35x0.5-2+3"], ["-shadow", "0x1"], ["-shadow", "120x2"],
    ["-background", "#12345600", "-shadow", "80x1-3-2"],
    ["-vignette", "0x2"], ["-vignette", "0x1"], ["-background", "#12345680", "-vignette", "2x3"],
    ["-colorspace", "gray", "-background", "red", "-shadow", "80x1+1+1"],
    ["-colorspace", "gray", "-background", "red", "-vignette", "0x2"]
];
async function fixture(width = 13, height = 17) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves effect pixels and geometry", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        const image = decodeImage(files.get("out.png")!);
        hashes.push(createHash("sha256").update(image.data).update(JSON.stringify([image.width, image.height, image.virtualCanvas])).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "40c9cf3ba34544fdcc548bf2ee598535f37f5eccf6cbfb696c7294289adb809e",
        "a17ba66656a0721a229491f9ebf6fdf94876a2b1d89864e83ebe08db71d7a5e9",
        "0aeec4fe0cb8c49a1547bd5a88788e51a2a62b0abf81e2a7cef88e40bcb8c1ff",
        "dc9e4f0526b9960ac5019c0e13a47553b79e250ff5a02489b3e42b9d5e0c9210",
        "3e441f46944fa4f57fadbcecefb6cf35c1aaa75830dc6fdb4a8628bdaf54b2bd",
        "1620ee98360a99e5374e2d9e8d5f22836605b4b3332f80df70357a8f0557724d",
        "93a5072ee91515fe8062ef60899bbe86c8b59c70eb4010219b3af315198931ec",
        "196f0b863a5f1f73ef837ea6d156ff75e5c75841d88e3656ae69c6b22644bc33",
        "59150403c842472d799072e1a440f79dc00e584b3034eb2ba2232f50cbdf43d7",
        "be5ab223b221f5f8ad5dfdc87056fe2e338272fac3fd5e2fa004f92932a88f78",
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
