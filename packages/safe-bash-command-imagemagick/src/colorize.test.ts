import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: magick -size 1x1 xc:COLOR -fill blue -colorize PERCENT -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [color, alpha] of [["#804020", 255], ["#80402080", 128]] as const) {
        it.each([
            ["0%", [128, 64, 32]],
            ["50%", [64, 32, 144]],
            ["100%", [0, 0, 255]],
        ] as const)(`matches native colorize %s for ${color} via ${mode}`, async (percent, rgb) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", `xc:${color}`, "-fill", "blue", "-colorize", percent, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([...rgb, alpha]);
        });
    }
}

// Native grayscale PNGs: magick -size 1x1 xc:white (or 'xc:graya(100%,0.5)') -strip png:-
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const [png, alpha] of [
    ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVQI12NoAAAAggCB3UNq9AAAAABJRU5ErkJggg==", 255],
    ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQI12P43wAAAoEBgMGRgVgAAAAASUVORK5CYII=", 128],
] as const)
it.each([
    ["red", [255, 128, 128]],
    ["black", [128, 128, 128]],
] as const)(`${mode}: colorizes grayscale PNG with %s, alpha=${alpha}`, async (fill, rgb) => {
    const input = Buffer.from(png, "base64");
    expect(decodeImage(input).space).toBe("b-w");
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-fill", fill, "-colorize", "50%", "/out.png"];
    const result = mode === "command"
        ? await createConvertCommand().execute({
            command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual([...rgb, alpha]);
    expect(output.space).toBe(fill === "red" ? "srgb" : "b-w");
});

// Native ImageMagick leaves alpha untouched even when A or RGBA is selected.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["R", [144, 96, 160, 128]],
    ["G", [32, 176, 160, 128]],
    ["B", [32, 96, 208, 128]],
    ["RG", [144, 176, 160, 128]],
    ["A", [32, 96, 160, 128]],
    ["RGBA", [144, 176, 208, 128]],
    [undefined, [144, 176, 208, 128]],
] as const)(`${mode}: colorize honors channel %s`, async (channel, expected) => {
    const input = await sharp(new Uint8Array([32, 96, 160, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", ...(channel ? ["-channel", channel] : []), "-fill", "white", "-colorize", "50%", "+channel", "/out.png"];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
});

for (const mode of ["buffered", "retained", "sync"] as const)
it(`${mode}: preserves grayscale channels and resets the colorize mask`, async () => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const args = ["xc:gray(128)", "-channel", "R", "-fill", "white", "-colorize", "50%", "-write", "/red.png", "+channel", "-colorize", "100%", "/white.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    for (const [path, expected] of [["/red.png", [192, 128, 128, 255]], ["/white.png", [255, 255, 255, 255]]] as const) {
        expect([...decodeImage(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!).data]).toEqual(expected);
    }
});

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(["bogus", "50%junk", "50%"])(`${mode}: validates colorize strength %s before replacing output`, async strength => {
    const input = await sharp(new Uint8Array([25, 100, 220, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const destination = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["/input.png", input], ["/out.png", destination]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    await filesystem.writeFile("/out.png", destination);
    const args = ["/input.png", "-fill", "#aabbcc", "-colorize", strength, "/out.png"];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    const output = mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    if (strength === "50%") {
        expect(result.exitCode).toBe(0);
        expect([...decodeImage(output).data]).toEqual([98, 144, 212, 128]);
    } else {
        expect(result.exitCode).toBe(1);
        expect([...output]).toEqual([...destination]);
    }
});
