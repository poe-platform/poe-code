import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMogrifyCli } from "./index.js";

const pixels = [240, 0, 0, 255, 200, 0, 0, 255, 0, 0, 200, 255, 0, 0, 240, 255];
// ImageMagick 7.1.2-35: decoded samples, independent of PNG encoding.
const clustered = [220, 0, 0, 255, 220, 0, 0, 255, 0, 0, 220, 255, 0, 0, 220, 255];

for (const publicCommand of [false, true])
it.each([
    ["#ff0000", "1", "16", "rgb", "800000000000800000000000"],
    ["#010203", "1", "16", "rgb", "008101010182008101010182"],
    ["#ff0000", "1", "8", "rgba", "800000ff800000ff"],
    ["#ff0000", "2", "16", "rgb", "000000000000ffff00000000"],
])(`exports native kmeans centroids for %s with %s colors at depth %s (public=${publicCommand})`, async (color, colors, depth, format, expected) => {
    const fs = new MemoryFileSystem(), files = new Map([["out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("out")!);
    const argv = ["-seed", "7", "xc:black", `xc:${color}`, "+append", "-kmeans", colors, "-depth", depth, "-endian", "MSB", `${format}:out`];
    const args = createCommandArguments(argv);
    const result = publicCommand ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(publicCommand ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
for (const mogrify of [false, true])
it.each([
    [[], pixels],
    [["-kmeans", "1x0"], pixels],
    [["-kmeans", "2x0+0.001"], pixels],
    [["-kmeans", "2x50+0.001"], clustered],
    [["-kmeans", "2"], clustered],
    [["-kmeans", "1x50+0.001"], [110, 0, 110, 255, 110, 0, 110, 255, 110, 0, 110, 255, 110, 0, 110, 255]],
    [["-kmeans", "4x50+0.001"], pixels],
])(`clusters native strip %j (retained=${retained}, mogrify=${mogrify})`, async (options, expected) => {
    const input = await sharp(Uint8Array.from(pixels), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file kmeans I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = mogrify ? [...options, "input.png"] : ["input.png", ...options, "out.png"];
    const result = await (mogrify ? runMogrifyCli : runMagickCli)(args, retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const output = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect([output.width, output.height]).toEqual([4, 1]);
    expect(Array.from(output.data)).toEqual(expected);
});

it("supports kmeans through the public magick command", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", await sharp(Uint8Array.from(pixels), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer());
    const args = createCommandArguments(["input.png", "-kmeans", "2x50+0.001", "out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data)).toEqual(clustered);
});

for (const mode of ["public", "map"])
it.each([
    { options: [], output: ["-depth", "8", "rgba:out"], expected: Buffer.from("202040ff405080ff808060ffb0a040ff", "hex") },
    { options: ["-kmeans", "1x0"], output: ["-depth", "8", "rgba:out"], expected: Buffer.from("202040ff405080ff808060ffb0a040ff", "hex") },
    { options: [], output: ["-format", "%k|%r", "info:out"], expected: Buffer.from("4|DirectClass sRGB ") },
    { options: ["-kmeans", "1x0"], output: ["-format", "%k|%r", "info:out"], expected: Buffer.from("4|DirectClass sRGB ") },
    { options: ["-kmeans", "1x1"], output: ["-depth", "8", "rgba:out"], expected: Buffer.from("646458ff646458ff646458ff646458ff", "hex") },
])(`matches native zero-iteration kmeans and controls (%j, mode=${mode})`, async ({ options, output, expected }) => {
    const argv = ["-seed", "7", "xc:#202040", "xc:#405080", "xc:#808060", "xc:#b0a040", "+append", ...options, ...output];
    const files = new Map<string, Uint8Array>([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const args = createCommandArguments(argv);
    const result = mode === "map" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "map" ? files.get("out")! : await fs.readFile("/out"))).toEqual(expected);
});

it.each(["", "bogus", "0", "-1", "2x-1", "2x50+Infinity", "2x50+-1", "65537", "2x1001"])("rejects invalid or excessive kmeans geometry %j without replacing output", async geometry => {
    const files = new Map([["out.png", new Uint8Array([42])]]);
    const result = await runMagickCli(["xc:red", "-kmeans", geometry, "out.png"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("kmeans");
    expect(files.get("out.png")).toEqual(new Uint8Array([42]));
});

for (const retained of [false, true])
it(`preserves 16-bit cluster means across raster chunks (retained=${retained})`, async () => {
    const samples = [[30001, 0, 0, 65535], [30003, 0, 0, 65535], [0, 0, 20001, 65535], [0, 0, 20003, 65535]];
    const data16 = Uint16Array.from(Array.from({ length: 1028 }, (_, i) => samples[i % 4]!).flat());
    const input = encodeImage({ width: 1028, height: 1, density: 72, data16,
        data: Uint8Array.from(data16, value => Math.round(value / 257)),
        hasAlpha: false, channels: 3, space: "srgb", depth: "ushort", format: "png",
    }, { format: "png" }).data;
    const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const result = await runMagickCli(["in.png", "-kmeans", "2x50+0.001", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(output.data16).toEqual(Uint16Array.from(Array.from({ length: 1028 }, (_, i) => i % 4 < 2 ? [30002, 0, 0, 65535] : [0, 0, 20002, 65535]).flat()));
});
