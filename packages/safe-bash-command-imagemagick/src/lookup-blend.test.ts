import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 outputs.
for (const mode of ["public", "sync"])
for (const [operation, method, expected] of [
    ["-clut", "blend", "3feb6b05258b05eb98"],
    ["-hald-clut", "blend", "da682fa1c61e42678c"],
    ["-clut", "bilinear", "45ae8814437805eb98"],
    ["-hald-clut", "bilinear", "c56a4093b84042678c"],
] as const) it(`${mode}: ${operation} ${method} matches native lookup colors`, async () => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Buffer.from(Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256))])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/a.ppm", operation === "-clut" ? "/lut.ppm" : "/h.ppm", "-interpolate", method, operation, "-endian", "MSB", "-depth", "8", "rgb:/out"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(mode === "public" ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
});

for (const retained of [false, true])
for (const highDepth of [false, true])
it(`blend weights translucent lookup colors at quarter boundaries, retained=${retained}, highDepth=${highDepth}`, async () => {
    const data = Uint8Array.of(255, 0, 0, 64, 0, 0, 255, 192);
    const lut = encodeImage({ width: 2, height: 1, data,
        ...(highDepth ? { data16: Uint16Array.from(data, value => value * 257) } : {}),
        format: "png", space: "srgb", channels: 4, depth: highDepth ? "ushort" : "uchar", density: 72, hasAlpha: true,
    }, { format: "png" }).data;
    const files = new Map([["/lut.png", lut]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/lut.png", lut);
    // Native Q16-HDRI: middle-half colors are alpha-weighted; source alpha stays opaque.
    for (const [color, expected] of [
        ["#3f3f3f", "ffff00000000ffff"],
        ["#404040", "40000000bfffffff"],
        ["#808080", "40000000bfffffff"],
        ["#bfbfbf", "40000000bfffffff"],
        ["#c0c0c0", "00000000ffffffff"],
    ]) {
        const args = [`xc:${color}`, "/lut.png", "-interpolate", "blend", "-clut", "-endian", "MSB", "-depth", highDepth ? "16" : "8", "rgba:/out"];
        expect((await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files)).exitCode).toBe(0);
        const output = retained ? await filesystem.readFile("/out") : files.get("/out")!;
        const native = Buffer.from(expected!, "hex");
        expect(Buffer.from(output)).toEqual(highDepth ? native : Buffer.from([native[0]!, native[2]!, native[4]!, native[6]!]));
    }
});
