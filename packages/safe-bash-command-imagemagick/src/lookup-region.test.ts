import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Inputs and RGB results from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAABCAIAAACZnPOkAAAAGElEQVR4nGNgcPjv0HCgVuTVgjtR/2sZADlZB40a4DkbAAAAAElFTkSuQmCC", "base64");
const lookups = [
    { operation: "-clut", png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAFUlEQVR4nGNgENGJ+mB0T+jX/xM2ABzoBaqNPZlHAAAAAElFTkSuQmCC", pixels: ["00ba3c", "4480c9", "98486b", "ce7d3e", "ff882c"] },
    { operation: "-hald-clut", png: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAXElEQVR4nB2NsQEAIAzC+iRP8iQmdlApAe9217ucs1xzydfrtZfqb9ddYP/JEkhsSeOgsqZ1QcuWYtL4ozS5pmsyUiS6OtHtEDTw7fzP2zBvi+0iASQWKzcVLvADM0lfoV1S878AAAAASUVORK5CYII=", pixels: ["ffff40", "c0bf80", "ea8214", "5a5fdc", "00007d"] },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const { operation, png, pixels } of lookups)
it.each([
    { geometry: "2x1+1+0", selected: [1, 2], negate: false },
    { geometry: "2x1-1+0", selected: [0], negate: false },
    { geometry: "2x1+4+0", selected: [4], negate: false },
    { geometry: "2x1+1+0", selected: [1, 2], negate: true },
])(`${mode}: confines ${operation} to $geometry, clear then negate=$negate`, async ({ geometry, selected, negate }) => {
    const files = new Map([["/in.png", input], ["/lut.png", Buffer.from(png, "base64")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/in.png", "-region", geometry, "/lut.png", operation, "+region", ...(negate ? ["-negate"] : []), "PNG24:/out.png"];
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
    const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    // Preserve the original pixels exactly outside the region.
    const original = decodeImage(input).data;
    expect(output.data).toEqual(Uint8Array.from(original, (value, index) => {
        const pixel = Math.floor(index / 4), channel = index % 4;
        if (channel === 3) return value;
        const mapped = selected.includes(pixel) ? Buffer.from(pixels[pixel]!, "hex")[channel]! : value;
        return negate ? 255 - mapped : mapped;
    }));
});

for (const mode of ["buffered", "retained", "sync"] as const)
for (const operation of ["-clut", "-hald-clut"])
it(`${mode}: preserves 16-bit samples and channel selection around ${operation} region`, async () => {
    const metadata = { format: "png" as const, space: "srgb" as const, depth: "ushort" as const, channels: 4 as const, hasAlpha: true, density: 72 };
    const samples = Uint16Array.of(0x1234, 0x2345, 0x3456, 0x4567, 0x5678, 0x6789, 0x789a, 0x89ab, 0x9abc, 0xabcd, 0xbcde, 0xcdef);
    const base = encodeImage({ ...metadata, width: 3, height: 1, data16: samples, data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
    const lut = encodeImage({ ...metadata, width: 1, height: 1, data16: Uint16Array.of(0x1111, 0x2222, 0x3333, 65535), data: Uint8Array.of(17, 34, 51, 255) }, { format: "png" }).data;
    const files = new Map([["/in.png", base], ["/lut.png", lut]]), filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/in.png", "-region", "1x1+1+0", "/lut.png", "-channel", "R", operation, "+region", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    // Native cache compositing blends the selected red channel outside the region.
    const expected = Uint16Array.of(2127, 9029, 13398, 17767, 4369, 26505, 30874, 35243, 32553, 43981, 48350, 52719);
    expect(decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data16).toEqual(expected);
});

for (const retained of [false, true])
for (const operation of ["-clut", "-hald-clut"])
it(`keeps ${operation} region across rows and chunk boundaries, retained=${retained}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "4098x2", "xc:red", "-region", "1x1+4096+1", "-size", "1x1", "xc:blue", operation, "+region", "-depth", "8", "rgba:/out.rgba"];
    expect(await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const expected = Uint8Array.from({ length: 4098 * 2 * 4 }, (_, offset) => offset % 4 === 0 || offset % 4 === 3 ? 255 : 0);
    expected.set([0, 0, 255, 255], (4098 + 4096) * 4);
    expect(retained ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")).toEqual(expected);
});
