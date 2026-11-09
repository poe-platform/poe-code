import { createHash } from "node:crypto";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";
import fixtures from "./enhance-fixtures.json" with { type: "json" };

// Decoded PNG32 reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
for (const retained of [false, true]) for (const mogrify of [false, true])
it.each(fixtures)(`enhances $name like native ImageMagick (retained=${retained}, mogrify=${mogrify})`, async fixture => {
    const input = await sharp(Buffer.from(fixture.input, "hex"), { raw: { width: fixture.width, height: fixture.height, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = mogrify ? ["-enhance", "input.png"] : ["input.png", "-enhance", "PNG32:out.png"];
    const result = await (mogrify ? runMogrifyCli : runConvertCli)(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const output = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height]);
    expect(Buffer.from(output.data).toString("hex")).toBe(fixture.expected);
});

it.each([
    { width: 1031, height: 3, method: "edge", hash: "a71d63ccfbdecbd21e97512fbc761fda6b1efd532393d8e9a0ca2a7c0443e230" },
    { width: 7, height: 5, method: "tile", hash: "1b08ac2e2d0f2b8b58f95df49c6e32d3442e686b9e0886a47b5584db71d048fa" },
    { width: 7, height: 5, method: "mirror", hash: "12882180e3326fbe76a29495433a9033d1856ea4228ed3d61ecc0d4d7924d4d4" },
    { width: 7, height: 5, method: "background", hash: "170e82df42fb848f0fff4599f894767034c8a7da9b14cd20c77caac89759ab07" }
])("enhances $width x $height with $method virtual pixels through the public command", async ({ width, height, method, hash }) => {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 240 : 80 + i % 4 * 20 + Math.floor(i / 4) * 7 % 23);
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole-file enhancement I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = createCommandArguments(["input.png", "-background", "black", "-virtual-pixel", method, "-enhance", "PNG32:out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([width, height]);
    expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
});

for (const retained of [false, true])
it(`enhances 16-bit color and alpha with native precision (retained=${retained})`, async () => {
    const samples = Uint16Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 0x9876 : 0x4321) + i * 71);
    const input = encodeImage({ width: 3, height: 2,
        data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples,
        format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runConvertCli(["input.png", "-enhance", "PNG64:out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data16!)).toEqual([
        17546, 17617, 17688, 39752, 17723, 17794, 17865, 39928, 17899, 17970, 18041, 40105,
        17892, 17963, 18034, 40097, 18068, 18139, 18210, 40274, 18245, 18316, 18387, 40450
    ]);
});
