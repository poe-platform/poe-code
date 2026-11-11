import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
const operators = [
    ["-remap", "palette"], ["+dither", "-remap", "palette"],
    ["-dither", "none", "-remap", "palette"], ["-dither", "FloydSteinberg", "-remap", "palette"],
    ["-remap", "gradient:red-blue"], ["+dither", "-remap", "pattern:checkerboard"],
    ["-remap", "xc:red"],
    ["-remap", "palette", "+dither", "-remap", "gradient:blue-red"]
];
async function paletteFixture() { return sharp(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer(); }
async function fixture(width = 53, height = 37) {
    return sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
}
it.each([false, true])("uses palette RGBA with dithering %s", async (dither) => {
    for (const alpha of [0, 64, 160, 255]) {
        const input = await sharp(new Uint8Array([240, 30, 60, alpha]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        for (const [palette, expectedAlpha] of [["xc:blue", 255], ["xc:#0000ff80", 128], ["gradient:red-blue", 255]] as const) {
            const files = new Map([["input", input]]);
            const argv = ["input", ...(dither ? ["-dither", "FloydSteinberg"] : ["+dither"]), "-remap", palette, "out.png"];
            expect((await runConvertCli(argv, files)).exitCode).toBe(0);
            const pixels = await sharp(files.get("out.png")!).ensureAlpha().raw().toBuffer();
            expect(Array.from(pixels)).toEqual(palette.startsWith("gradient:") ? [255, 0, 0, expectedAlpha] : [0, 0, 255, expectedAlpha]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input", input);
            expect((await runConvertCli(argv, { filesystem, cwd: "/" })).exitCode).toBe(0);
            expect(decodeImage(await filesystem.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
        }
    }
});
it.each([false, true])("distinguishes palette colors differing only in alpha with dithering %s", async (dither) => {
    const pixels = new Uint8Array([0, 0, 255, 64, 0, 0, 255, 192]);
    const palette = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const input = await sharp(new Uint8Array([0, 0, 255, 80, 0, 0, 255, 176]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input", input], ["palette", palette]]);
    const argv = ["input", ...(dither ? ["-dither", "FloydSteinberg"] : ["+dither"]), "-remap", "palette", "out.png"];
    expect((await runConvertCli(argv, files)).exitCode).toBe(0);
    expect(Array.from(await sharp(files.get("out.png")!).ensureAlpha().raw().toBuffer())).toEqual(Array.from(pixels));
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input", input);
    await filesystem.writeFile("/palette", palette);
    expect((await runConvertCli(argv, { filesystem, cwd: "/" })).exitCode).toBe(0);
    expect(decodeImage(await filesystem.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
it("preserves native remap pixel vectors", async () => {
    const bytes = await fixture(), hashes: string[] = [];
    for (const args of operators) {
        const files = new Map([["input", bytes], ["palette", await paletteFixture()]]);
        expect((await runConvertCli(["input", ...args, "out.png"], files)).exitCode).toBe(0);
        hashes.push(createHash("sha256").update(decodeImage(files.get("out.png")!).data).digest("hex"));
    }
    // ImageMagick 7.1.2-35 Q16-HDRI keeps checkerboard in sRGB at gray 102/153.
    expect(hashes).toMatchInlineSnapshot(`
      [
        "f3a788f01bc173e183ab96743bf602253bc0844fcd6812c17eb26acb71e00e81",
        "ab03f6333f370c5dab5267e5c88d5284f476811d9965808347372ccbf89b2061",
        "ab03f6333f370c5dab5267e5c88d5284f476811d9965808347372ccbf89b2061",
        "7670906deccf00f10509bcc2c56054f7bb7a5df8da90cdf01fc020e67838981e",
        "6eac2444bedf289ceee36b9dfc034f5fb8b0e75a294bac17e47ebb2b5ad0aace",
        "75b1984598b8b0d542c1699e078d89b43a0b0cb686bc786f6a592a8d16b1e616",
        "6eac2444bedf289ceee36b9dfc034f5fb8b0e75a294bac17e47ebb2b5ad0aace",
        "07f880da26145a8329f7322487ac84bae6a1622fc29a06b39f9ad15b7cf1d904",
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

for (const execution of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["missing.png", "rgb.png"])(`${execution}: remaps with palette %s without losing existing output on failure`, async palette => {
        const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
        const png = await sharp(pixels, { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
        const sentinel = new TextEncoder().encode("sentinel");
        const files = new Map([["rgb.png", png], ["out.png", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/rgb.png", png);
        await filesystem.writeFile("/out.png", sentinel);
        const argv = ["rgb.png", "+dither", "-remap", palette, "out.png"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = execution === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                fs: filesystem,
            })
            : execution === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files);
        const output = execution === "command" || execution === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        if (palette === "missing.png") {
            expect(output).toEqual(sentinel);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("unable to open image 'missing.png'");
        } else {
            expect(result.exitCode).toBe(0);
            expect(await sharp(output).removeAlpha().raw().toBuffer()).toEqual(pixels);
        }
    });
}
