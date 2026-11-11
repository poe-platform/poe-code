import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete 243-byte RGB output.
for (const mode of ["public", "sync"] as const)
it.each([
    [[], [], "f9e927986199c64f0d2ec9974a48dcf21ec0972f8b8a36ef2b222a73a6eb0f42"],
    [[], ["-virtual-pixel", "mirror"], "bdca40ff07b35ef0258f99a4e55e44c5bb53e40d8897522d75de36323c3c41b6"],
    [["-virtual-pixel", "mirror"], [], "bdca40ff07b35ef0258f99a4e55e44c5bb53e40d8897522d75de36323c3c41b6"]
] as const)(`matches native unsharp virtual pixels %j %j (${mode})`, async (before, after, expected) => {
    const input = Buffer.concat([Buffer.from("P6\n9 9\n255\n"), Buffer.from(Array.from({ length: 243 }, (_, i) => (i * 71 + 13) % 256))]);
    const files = new Map<string, Uint8Array>([["/image.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/image.ppm", input);
    const args = [...before, "/image.ppm", ...after, "-unsharp", "2x1+1+0.05", "-depth", "8", "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext);
    expect(result.exitCode).toBe(0);
    const output = mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(output).toHaveLength(243);
    expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
});

// ImageMagick 7.1.2-35 Q16-HDRI, complete two-pixel RGBA output.
for (const mode of ["public", "sync"] as const)
it.each([
    ["edge", "372c51ffb9949fff"],
    ["mirror", "33284effbd98a2ff"],
    ["tile", "282048ffc8a0a8ff"],
    ["transparent", "31274dffbf99a3ff"],
    ["black", "856ba4ffffe7ffff"],
    ["white", "000000ff5f2640ff"],
    ["gray", "250a44ffc080a1ff"],
    ["horizontal-tile", "000000ff753e55ff"],
    ["vertical-tile", "000019ff906072ff"]
])(`matches native unsharp border %s (${mode})`, async (method, expected) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const args = ["xc:#504060", "xc:#a08090", "+append", "-virtual-pixel", method, "-unsharp", "0x1", "-depth", "8", "rgba:/out.rgba"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext);
    expect(result.exitCode).toBe(0);
    const output = mode === "sync" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

// Native complete RGB hashes cover wraparound beyond the 1024-pixel read chunk.
for (const mode of ["public", "sync"] as const)
it.each([
    [1031, 3, "tile", "a3360e5429680d01d5652bfcfb53457462ea86579e89a3dc39d08f0ca39ba9cd"],
    [1031, 3, "horizontal-tile", "3bbd8764195026d97f7732a378244ee248050d9f8124355b9714a3309da727b7"],
    [1031, 3, "vertical-tile", "f86a50c64ca1d7a5fcec6a2feab64d91443aba5a1fafd34625afc8b29bff3509"],
    [1031, 3, "background", "2e8979d07fa612c7748170918df5095dbaf18995b44ef39bfd3a71abdd06219c"],
    [3, 1031, "tile", "85d3ba9f2616d2afdb0e937dfd4cd398dd7ab2bcbe839a2350aebb875e94f1a4"],
    [3, 1031, "horizontal-tile", "26cd27bc5ba56905ab6caa61196842419c419c9f47945c4896d2c185a5e0c756"],
    [3, 1031, "vertical-tile", "d068bf2bd58f3b7774f74b2506dc9fb7f98a7590be3bf94b43470e773166d458"],
    [3, 1031, "background", "efccc3a740f025e59e4b17c83e79ca46ca18e0eae808264904e8bbfc547240e1"]
] as const)(`matches native %sx%s unsharp %s (${mode})`, async (width, height, method, expected) => {
    const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => (i * 71 + 13) % 256))]);
    const files = new Map<string, Uint8Array>([["/image.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/image.ppm", input);
    const args = ["/image.ppm", "-background", "#204080", "-virtual-pixel", method, "-unsharp", "0x1", "-depth", "8", "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext);
    expect(result.exitCode).toBe(0);
    const output = mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
    expect(output).toHaveLength(width * height * 3);
    expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
});
