import { expect, it } from "vitest";
import fixtures from "./mean-shift-fixtures.json" with { type: "json" };
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMogrifyCli } from "./index.js";

for (const retained of [false, true])
for (const mogrify of [false, true])
for (const control of ["edges", "identity", "constant"])
it(`matches the full native mean-shift raster (${retained}, ${mogrify}, ${control})`, async () => {
    const pixels = Uint8Array.from(Array.from({ length: 64 }, (_, i) => {
        if (control === "constant") return [64, 96, 128, 255];
        if (i === 18) return [64, 80, 96, 255];
        if (i === 30) return [255, 255, 255, 255];
        return i % 8 < 4 ? [32, 48, 64, 255] : [176, 192, 208, 255];
    }).flat());
    const expected = pixels.slice();
    // ImageMagick 7.1.2 Q16-HDRI: only these five pixels change.
    if (control === "edges") for (const i of [10, 17, 18, 19, 26]) expected.set(i === 19 ? [40, 56, 72] : [38, 54, 70], i * 4);
    const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const geometry = control === "identity" ? "1x1+0%" : "3x3+25%";
    const args = mogrify ? ["-mean-shift", geometry, "input.png"] : ["input.png", "-mean-shift", geometry, "out.png"];
    const result = await (mogrify ? runMogrifyCli : runMagickCli)(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const output = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect([output.width, output.height]).toEqual([8, 8]);
    expect(output.data).toEqual(expected);
});

// Full RGBA references generated with native ImageMagick Q16-HDRI.
for (const retained of [false, true])
it.each(fixtures.cases)(`matches native geometry $geometry and virtual pixels $virtual (retained=${retained})`, async ({ geometry, virtual, expected }) => {
    const input = await sharp(Buffer.from(fixtures.input, "hex"), { raw: { width: 5, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file mean-shift I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await runMagickCli(["input.png", "-virtual-pixel", virtual, "-mean-shift", geometry, "out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Buffer.from(output.data).toString("hex")).toBe(expected);
});

it.each(["", "bogus", "3x3+", "-1x3+25%", "3x3+Infinity", "1001x3+25%"])("rejects invalid or excessive mean-shift geometry %s", async geometry => {
    const result = await runMagickCli(["xc:red", "-mean-shift", geometry, "out.png"], new Map());
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("mean-shift");
});

for (const retained of [false, true])
it(`preserves native 16-bit mean-shift samples (retained=${retained})`, async () => {
    const input = Buffer.from(fixtures.depth16.input, "base64");
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runMagickCli(["input.png", "-mean-shift", "3x3+25%", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data16!)).toEqual(fixtures.depth16.expected);
});

it("supports mean shift through the public magick command", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", Buffer.from(fixtures.depth16.input, "base64"));
    const args = createCommandArguments(["input.png", "-mean-shift", "3x3+25%", "out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(0);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data16!)).toEqual(fixtures.depth16.expected);
});

for (const execution of ["memory", "retained", "public"] as const)
it.each([
    ["#808080", "black", "16", "19b319b319b3"],
    ["#9a405c", "black", "16", "1eec0cda1279"],
    ["#808080", "edge", "16", "808080808080"],
    ["#808080", "black", "8", "1a1a1a"],
])(`retains fractional mean-shift samples for %s with %s padding at depth %s (${execution})`, async (color, padding, depth, expected) => {
    const fs = new MemoryFileSystem(), files = new Map([["out", Buffer.from("KEEP")]]);
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const argv = [`xc:${color}`, "-virtual-pixel", padding, "-mean-shift", "3x3+150%", "-depth", depth, "-endian", "MSB", "rgb:out"];
    const args = createCommandArguments(argv);
    const result = execution === "public" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(execution === "memory" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
});
