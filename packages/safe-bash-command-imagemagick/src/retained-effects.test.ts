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
        "29f6ea9ea058f7e83f342be0b462c4fd1d51d77ca8c7c01d4d2b4f62004f4387",
        "c108131e99e5603809491c313e523b4cf79a64d7bed4504a8d44e1b89916a11c",
        "3e441f46944fa4f57fadbcecefb6cf35c1aaa75830dc6fdb4a8628bdaf54b2bd",
        "58cbed50016e624ca817fdfb74703f9ba2d99ba1b763e52a86748b374ce20b06",
        "8ab0c1d85ced4200154940ed45f402a2bf31c2983b375d3ebcbc96b7bb465ee6",
        "1546cc6b1787f89d349b2a974665aa25d43ce745bedad963e5d014381dd193d4",
        "745c92bd63871ecb6cb5caeb2f15b72902541f399b411940ad4a9249a92867f3",
        "8e29ef57672a61b6cd648a09624cb55686bddbd5847143070329bc299b9280be",
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
