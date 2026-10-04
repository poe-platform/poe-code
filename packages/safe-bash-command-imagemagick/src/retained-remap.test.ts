import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";
const operators = [
    ["-remap", "palette"], ["+dither", "-remap", "palette"],
    ["-dither", "none", "-remap", "palette"], ["-dither", "FloydSteinberg", "-remap", "palette"],
    ["-remap", "gradient:red-blue"], ["+dither", "-remap", "pattern:checkerboard"],
    ["-remap", "xc:red"], ["-remap", "missing"],
    ["-remap", "palette", "+dither", "-remap", "gradient:blue-red"]
];
async function paletteFixture() { return sharp(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer(); }
async function fixture(width = 53, height = 37) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it("preserves original remap pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes], ["palette", await paletteFixture()]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(files.get("out.png")!).digest("hex"));
    }
    expect(hashes).toMatchInlineSnapshot(`
      [
        "64b2607e453bb296e9b3f3c09f9904351810a4dd38c16d308c244098c090e52f",
        "75b3cc93a9e88c346d0a43a44eb31e01a12821cca3bd0aba3c890ffbf95e96a8",
        "75b3cc93a9e88c346d0a43a44eb31e01a12821cca3bd0aba3c890ffbf95e96a8",
        "64b2607e453bb296e9b3f3c09f9904351810a4dd38c16d308c244098c090e52f",
        "7b8aba3162ee03f8fefbc7f29815e76fe1a71a281fba8134c51f997933049a96",
        "c7f08c3023a6d5523725d8190d115b4ad721135c2b639ce849456d1590535eb4",
        "7b8aba3162ee03f8fefbc7f29815e76fe1a71a281fba8134c51f997933049a96",
        "d3b98c3d20a92e1f210c8fd9db66ed6be330b333920d38e38c3e1c05eb4c8156",
        "5ceca2dc3ec2651117dbdfd1fdf62195f7fc7d1dcbde4da0ea35df8b0a841a67",
      ]
    `);
});
it.each(operators.flatMap(args => [[53, 37], [1031, 3], [1, 1], ...(args === operators[0] ? [[12001, 3]] : [])].map(([width, height]) => ({ width: width!, height: height!, args }))))("retains $width x $height $args", async ({ width, height, args }) => {
    const bytes = await fixture(width, height), fs = new MemoryFileSystem(), files = new Map([["input", bytes], ["palette", await paletteFixture()]]);
    await fs.writeFile("/input", bytes);
    await fs.writeFile("/palette", await paletteFixture());
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file remap I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(await runConvertCli(argv, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
