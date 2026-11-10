import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB bytes from ImageMagick 7.1.2-35 Q16-HDRI for the same PPM inputs.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of ["-clut", "-hald-clut"])
it.each([
    { background: undefined, reset: false, expected: "ffffffffffffffffff" },
    { background: "#218aed", reset: false, expected: "218aed218aed218aed" },
    { background: "#218aed", reset: true, expected: undefined },
])(`${mode}: ${operation} background=$background, reset=$reset`, async ({ background, reset, expected }) => {
    const files = new Map<string, Uint8Array>([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Uint8Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256)])],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = [...(background ? ["-background", background] : []), "/a.ppm", operation === "-clut" ? "/lut.ppm" : "/h.ppm",
        "-interpolate", "background", ...(reset ? ["+interpolate"] : []), operation, "-endian", "MSB", "-depth", "8", "rgb:/out"];
    let stderr = "";
    const commandArgs = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: commandArgs.args, argumentValues: commandArgs, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected ?? (operation === "-clut" ? "45ae8814437805eb98" : "c56a4093b84042678c"));
});

for (const retained of [false, true])
for (const operation of ["-clut", "-hald-clut"])
it(`preserves 16-bit background and unselected channels: ${operation}, retained=${retained}`, async () => {
    const samples = Uint16Array.of(0x4023, 0x8034, 0xc045, 0x9876);
    const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples,
        format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    expect(await runMagickCli(["-background", "#123456789abc", "/in.png", "/in.png", "-channel", "R", "-interpolate", "background", operation, "/out.png"],
        retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data16)
        .toEqual(Uint16Array.of(0x1234, 0x8034, 0xc045, 0x9876));
});
