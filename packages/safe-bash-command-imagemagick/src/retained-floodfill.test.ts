import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-fill", "red", "-floodfill", "+0+0"],
    ["-fill", "#12345680", "-floodfill", "+4+4"],
    ["-fill", "none", "-fuzz", "100%", "-floodfill", "+0+0"],
    ["-fill", "blue", "-fuzz", "20%", "-floodfill", "4x7"],
    ["-fill", "green", "-floodfill", "+999+999"],
    ["-fill", "blue", "-floodfill", "+0+0", "red"],
    ["-fill", "blue", "-floodfill", "+0+0", "#000000"],
    ["-fill", "#10203040", "-fuzz", "100%", "-floodfill", "+5+7", "white"]
];
async function fixture(width = 53, height = 37) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => Math.floor(i / 4) % width < width / 2 ? (i % 4 === 3 ? 255 : 0) : (i % 4 === 3 ? 128 : 200)), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original floodfill pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "1376cb781375f6492d0ead21fc2ddb67a1b3b131a6d6d71076f67414314d7e60",
        "74f81aebc3fc745f290152a2bb3fe26f960385bb77e914fb0029eed21c9c29cc",
        "569b12d2ba9fdf8ac87b8675f6d32ffb98bc8183c53029b0f73a777ccf94c09c",
        "3da7a6e516999b7b59207049517b789ba0ef19020865bab1838b396cf7037b1c",
        "0868a5aa4841122db7219ed0a699fe517e7ad0886ebad2af8fac0a60a235c7c2",
        "cdf6882cb8db5ba218f7197385a15bb3463041d8f4010dd896d1f10fd85e16e4",
        "3da7a6e516999b7b59207049517b789ba0ef19020865bab1838b396cf7037b1c",
        "dd1d93f43d9cdc9e2bdf848022663d3baf0a903d66dbabd262643f23aa95bcfd",
      ]
    `);
});
it.each(operators.flatMap(args => [[53, 37], [1031, 31], [1, 1]].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file floodfill I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
it("preserves disconnected regions and ignores alpha when matching across cached pages", async () => {
    const width = 257, height = 129, pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const barrier = ((x === 5 || x === width - 6) && y >= 5 && y <= height - 6) || ((y === 5 || y === height - 6) && x >= 5 && x <= width - 6);
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = barrier ? 255 : 0;
        pixels[offset + 3] = (x + y) % 256;
    }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file floodfill I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await runConvertCli(["input", "-fill", "red", "-floodfill", "+6+6", "out.png"], { filesystem, cwd: "/" })).exitCode).toBe(0);
    const actual = decodeImage(await fs.readFile("/out.png"));
    for (let y = 6; y < height - 6; y++) for (let x = 6; x < width - 6; x++) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 255; pixels[offset + 3] = 255;
    }
    expect(actual.data).toEqual(pixels);
});
