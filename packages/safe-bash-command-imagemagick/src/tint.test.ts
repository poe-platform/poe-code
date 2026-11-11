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
        ["%[fx:w+49]", [0, 13, 181, 128]],
        ["%[fx:w-1],%[fx:h+49],%[fx:100]", [0, 13, 229, 128]],
        ["5 0", [0, 13, 181, 128]],
        [" 5 0 % ", [0, 13, 181, 128]],
        [" 0 % , 5 0 % , 1 0 0 % ", [0, 13, 229, 128]],
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
it.each(["bogus", "30+10+15", "50%junk", "5 0 % junk", "50%"])(`${mode}: validates tint strength %s before replacing output`, async strength => {
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

// Native Q16-HDRI: RGB16 4321 8765 abcd, PNG48 input, -fill FILL -tint STRENGTH.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["black", "100%", [0x4321, 0x8765, 0xabcd, 65535]],
        ["#aabbcc", "50%", [0, 0x2c3b, 0x6294, 65535]],
    ] as const)(`${mode}: preserves 16-bit samples with %s tint`, async (fill, strength, expected) => {
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAAD0lEQVQI12NwVmxPXX0WAAesAsn2ck3qAAAAAElFTkSuQmCC", "base64");
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-fill", fill, "-tint", strength, "/out.png"];
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
        expect(output[24]).toBe(16);
        expect(Array.from(decodeImage(output).data16 ?? [])).toEqual(expected);
    });
}

// Width-dependent strength on the reported gray strip, including transparent pixels.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`${mode}: expands tint strength before applying the curve to a gray strip`, async () => {
        const pixels = [0, 0, 0, 255, 48, 48, 48, 0, 128, 128, 128, 128, 192, 192, 192, 255, 255, 255, 255, 255];
        const input = await sharp(new Uint8Array(pixels), { raw: { width: 5, height: 1, channels: 4 } }).png().toBuffer();
        const outputs: number[][] = [];
        for (const strength of ["50", "%[fx:w+45]"]) {
            const files = new Map([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-fill", "#dc501e", "-tint", strength, "PNG32:/out.png"];
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
            outputs.push([...decodeImage(output).data]);
        }
        expect(outputs[1]).toEqual(outputs[0]);
        expect(outputs[1]!.slice(8, 12)).toEqual([132, 62, 37, 128]);
        expect(outputs[1]!.slice(16)).toEqual([255, 255, 255, 255]);
        expect(outputs[1]!.filter((_, index) => index % 4 === 3)).toEqual([255, 0, 128, 255, 255]);
    });
}
