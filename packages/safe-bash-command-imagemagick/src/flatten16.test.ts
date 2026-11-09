import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI PNG64 inputs, with ancillary metadata stripped.
const inputs = {
    base: "89504e470d0a1a0a0000000d4948445200000002000000011006000000a4b2a3c9000000194944415408d76364b9c4a9c9dbf0ff7fe55cdfa572cf191800389306a2040943be0000000049454e44ae426082",
    top: "89504e470d0a1a0a0000000d4948445200000002000000011006000000a4b2a3c90000001a4944415408d76398e378dcf293e1ffffca9af28ed291ffff03004471081d89af2cf20000000049454e44ae426082",
    clear: "89504e470d0a1a0a0000000d4948445200000002000000011006000000a4b2a3c90000000b4944415408d7636040030000110001765ea8eb0000000049454e44ae426082",
    semi: "89504e470d0a1a0a0000000d4948445200000002000000011006000000a4b2a3c9000000194944415408d76398e378dcf293610383b2a6bca374a4de030034c305afa3169f870000000049454e44ae426082",
};

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "mosaic"]])
it.each([
    { foreground: "top", expected: [40001, 51001, 62001, 65535, 9001, 8001, 7001, 65535] },
    { foreground: "clear", expected: [1234, 2345, 3456, 65535, 32111, 22222, 11111, 65535] },
    { foreground: "semi", expected: [20618, 26673, 32729, 65535, 27879, 19618, 10358, 65535] }
] as const)(`${mode} ${operation.join(" ")} preserves native RGBA16 samples with $foreground`, async ({ foreground, expected }) => {
    const files = new Map<string, Uint8Array>([["base.png", Buffer.from(inputs.base, "hex")], ["top.png", Buffer.from(inputs[foreground], "hex")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = createCommandArguments(["base.png", "top.png", "-background", "none", ...operation, "PNG64:out.png"]);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
        argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
        : mode === "sync" ? runConvertCliSync(args.args, files)
        : await runConvertCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect([output.width, output.height]).toEqual([2, 1]);
    expect(Array.from(output.data16 ?? [])).toEqual(expected);
});

for (const mode of ["buffered", "retained", "sync"] as const)
it.each([
    { highDepthFirst: true, left: 0, width: 4097 },
    { highDepthFirst: false, left: 0, width: 4097 },
    { highDepthFirst: false, left: -1, width: 2 }
])(`${mode} flatten retains mixed-depth samples across chunks and clipping: %j`, async ({ highDepthFirst, left, width }) => {
    const samples = Uint16Array.from({ length: width * 4 }, (_, i) => i % 4 === 3 ? 65535 : 1234 + i);
    const deep = encodeImage({ width, height: 1, format: "png", data: Uint8Array.from(samples, value => Math.round(value / 257)),
        data16: samples, depth: "ushort", space: "srgb", channels: 4, density: 72, hasAlpha: true }, { format: "png" }).data;
    const clear = encodeImage({ width, height: 1, format: "png", data: new Uint8Array(width * 4),
        depth: "uchar", space: "srgb", channels: 4, density: 72, hasAlpha: true }, { format: "png" }).data;
    expect(decodeImage(clear).data16).toBeUndefined();
    const files = new Map<string, Uint8Array>([["deep.png", deep], ["clear.png", clear]]), fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = [...(highDepthFirst ? ["deep.png", "clear.png"] : ["clear.png", "deep.png"]),
        "-repage", `${width}x1${left < 0 ? left : "+0"}+0`, "-background", "none", "-flatten", "PNG64:out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    const expected = new Uint16Array(samples.length);
    expected.set(samples.subarray(-left * 4));
    expect(output.data16).toEqual(expected);
});

for (const mode of ["buffered", "retained", "sync"] as const)
it(`${mode} flatten preserves partial alpha on a transparent background`, async () => {
    const bytes = Buffer.from(inputs.semi, "hex"), files = new Map<string, Uint8Array>([["semi.png", bytes]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/semi.png", bytes);
    const args = ["semi.png", "-background", "none", "-flatten", "PNG64:out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(output.data16).toEqual(decodeImage(bytes).data16);
});
