import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(["2x3", "%[fx:w-5]x%[fx:h-3]", "%[option:frame-size]"])(`expands frame geometry %s and matches PNG48 pixels (${mode})`, async geometry => {
        const data16 = Uint16Array.from(Array.from({ length: 42 }, (_, i) => [(i * 5 + 1) * 257, 0, 0, 65535]).flat());
        const input = encodeImage({ width: 7, height: 6, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
            format: "png", depth: "ushort", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png", pngBitDepth: 16, pngColorType: 2 }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const argv = ["/in.png", "-mattecolor", "#4275ac", "-set", "option:frame-size", "2x3", "-frame", geometry,
            "-set", "option:frame-size", "1x1", "PNG48:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([11, 12]);
        const expected: number[] = [];
        for (let y = 0; y < 12; y++) for (let x = 0; x < 11; x++) {
            const source = ((y - 3) * 7 + x - 2) * 4;
            expected.push(...(x >= 2 && x < 9 && y >= 3 && y < 9 ? data16.slice(source, source + 4) : [0x4242, 0x7575, 0xacac, 65535]));
        }
        expect(Array.from(output.data16!)).toEqual(expected);
    });

    it(`expands frame dimensions against each current image (${mode})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["-size", "7x6", "xc:red", "-size", "8x7", "xc:blue",
            "-frame", "%[fx:w-5]x%[fx:h-3]", "-frame", "%[fx:w-5]x%[fx:h-3]", "/out-%d.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [index, dimensions] of [[23, 30], [32, 39]].entries()) {
            const path = `/out-${index}.png`;
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
            expect([output.width, output.height]).toEqual(dimensions);
        }
    });
}
