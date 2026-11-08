import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: magick -size 1x1 xc:COLOR -fill blue -tint PERCENT -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [color, alpha] of [["#804020", 255], ["#80402080", 128]] as const) {
        it.each([
            ["0%", [110, 50, 24]],
            ["50%", [110, 50, 80]],
            ["100%", [110, 50, 136]],
        ] as const)(`matches native tint %s for ${color} via ${mode}`, async (percent, rgb) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", `xc:${color}`, "-fill", "blue", "-tint", percent, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([...rgb, alpha]);
        });
    }
}

// Native ImageMagick, raw RGBA 1964dc80 with -fill '#aabbcc' -tint STRENGTH.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["0%,50%,100%", [0, 13, 229, 128]],
        ["100%,50%,0%", [20, 13, 133, 128]],
        ["0,50,100", [0, 13, 229, 128]],
        ["0%,50%", [0, 13, 133, 128]],
        ["50%", [0, 13, 181, 128]],
    ] as const)(`${mode}: applies RGB tint strengths %s and preserves alpha`, async (strength, expected) => {
        const input = await sharp(new Uint8Array([25, 100, 220, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-fill", "#aabbcc", "-tint", strength, "/out.png"];
        const result = mode === "command"
            ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} },
            })
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(["bogus", "50%junk", "50%"])(`${mode}: validates tint strength %s before replacing output`, async strength => {
    const input = await sharp(new Uint8Array([25, 100, 220, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const destination = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
    const files = new Map([["/input.png", input], ["/out.png", destination]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    await filesystem.writeFile("/out.png", destination);
    const args = ["/input.png", "-fill", "#aabbcc", "-tint", strength, "/out.png"];
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
        expect([...decodeImage(output).data]).toEqual([0, 13, 181, 128]);
    } else {
        expect(result.exitCode).toBe(1);
        expect([...output]).toEqual([...destination]);
    }
});
