import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 output.
for (const mode of ["map", "command"] as const)
it.each([
    ["catrom", "-clut", "44b99b10348405eb98"],
    ["catrom", "-hald-clut", "cd6c399cc53642678c"],
    ["spline", "-clut", "4c927b1f5b7216b17e"],
    ["spline", "-hald-clut", "a4706a81985e7b926f"],
    ["bilinear", "-clut", "45ae8814437805eb98"],
    ["bilinear", "-hald-clut", "c56a4093b84042678c"],
] as const)(`matches native lookup colors, ${mode}: %s %s`, async (method, operation, expected) => {
    const files = new Map<string, Uint8Array>([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Uint8Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256)])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/a.ppm", operation === "-clut" ? "/lut.ppm" : "/h.ppm", "-interpolate", method, operation, "-endian", "MSB", "-depth", "8", "rgb:/out"];
    let stderr = "";
    const result = mode === "map" ? await runMagickCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(Buffer.from(mode === "map" ? files.get("/out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
for (const highDepth of [false, true])
for (const operation of ["-clut", "-hald-clut"])
it.each(["catrom", "spline"])(`preserves premultiplied lookup colors and channel selection, ${operation}, retained=${retained}, highDepth=${highDepth}: %s`, async method => {
    const samples = highDepth ? Uint16Array.of(32768, 16384, 8192, 32768) : undefined;
    const lut = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", channels: 4,
        density: 72, hasAlpha: true, depth: highDepth ? "ushort" : "uchar",
        data: Uint8Array.of(128, 64, 32, 128), ...(samples ? { data16: samples } : {}),
    }, { format: "png" }).data;
    const files = new Map([["/lut.png", lut]]), fs = new MemoryFileSystem();
    await fs.writeFile("/lut.png", lut);
    const result = await runMagickCli(["xc:#20406080", "/lut.png", "-interpolate", method, "-channel", "RGB", operation,
        "-endian", "MSB", "-depth", highDepth ? "16" : "8", "rgba:/out"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    // A constant table keeps its RGB multiplied by opacity; selecting RGB preserves source alpha.
    expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("/out")!).toString("hex"))
        .toBe(highDepth ? "4000200010008080" : "40201080");
});

for (const retained of [false, true])
for (const highDepth of [false, true])
it.each([false, true])(`clips Catmull–Rom overshoot at output, retained=${retained}, highDepth=${highDepth}, inverted=%s`, async inverted => {
    const maximum = highDepth ? 65535 : 255;
    const entries = [0, 0, maximum].flatMap(value => Array(3).fill(inverted ? maximum - value : value));
    const files = new Map([["/lut.ppm", Buffer.from(`P3\n3 1\n${maximum}\n${entries.join(" ")}\n`)]]), fs = new MemoryFileSystem();
    await fs.writeFile("/lut.ppm", files.get("/lut.ppm")!);
    expect(await runMagickCli(["xc:#2a2a2a", "/lut.ppm", "-interpolate", "catrom", "-clut", "-endian", "MSB", "-depth", highDepth ? "16" : "8", "rgb:/out"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(retained ? await fs.readFile("/out") : files.get("/out"))
        .toEqual(new Uint8Array(highDepth ? 6 : 3).fill(inverted ? 255 : 0));
});
