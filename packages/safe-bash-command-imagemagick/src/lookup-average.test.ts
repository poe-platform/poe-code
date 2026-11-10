import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const highDepth of [false, true])
it.each([
    ["average9", "-clut", "517f6428715f287f64"],
    ["average9", "-hald-clut", "9b7b81828a6a7b926f"],
    ["average16", "-clut", "3c805a2e945a1f805a"],
    ["average16", "-hald-clut", "94727c83837576937f"],
    ["bilinear", "-clut", "45ae8814437805eb98"],
    ["bilinear", "-hald-clut", "c56a4093b84042678c"],
] as const)(`${mode}, highDepth=${highDepth}: %s %s matches native colors`, async (method, operation, expected) => {
    const files = new Map<string, Uint8Array>([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", operation === "-clut"
            ? Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")
            : Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Uint8Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256)])],
    ]);
    if (highDepth) for (const [path, bytes] of files) {
        const image = decodeImage(bytes);
        files.set(path, encodeImage({ ...image, depth: "ushort", data16: Uint16Array.from(image.data, value => value * 257) }, { format: "png" }).data);
    }
    files.set("/out", Buffer.from("KEEP"));
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/a.ppm", "/lut.ppm", "-interpolate", method, operation, "-endian", "MSB", "-depth", "8", "rgb:/out"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? {
        ...await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr,
    } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
for (const method of ["average9", "average16"])
for (const operation of ["-clut", "-hald-clut"])
for (const alpha of [0, 0x4567])
it(`preserves 16-bit lookup colors and alpha: ${method} ${operation}, alpha=${alpha}, retained=${retained}`, async () => {
    const samples = Uint16Array.of(0x1234, 0x5678, 0x9abc, alpha);
    const lookup = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", channels: 4,
        depth: "ushort", density: 72, hasAlpha: true, data16: samples,
        data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
    const files = new Map([["/lut.png", lookup]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/lut.png", lookup);
    const args = ["xc:#4080c0ff", "/lut.png", "-channel", "RGBA", "-interpolate", method, operation, "PNG64:/out.png"];
    expect(retained ? await runMagickCli(args, { filesystem, cwd: "/" }) : runMagickCliSync(args, files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect(output.data16).toEqual(alpha ? samples : new Uint16Array(4));
});
