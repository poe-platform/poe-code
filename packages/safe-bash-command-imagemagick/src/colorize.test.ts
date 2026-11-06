import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli, runConvertCliSync } from "./index.js";

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
