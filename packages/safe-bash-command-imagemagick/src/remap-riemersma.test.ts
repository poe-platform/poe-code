import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const [width, height, native, floyd] of [
    [9, 5, "000011000000011000000000000000000001111100001", "010010010100100100010101010010010010001001001"],
    [1, 17, "00000000000000001", "00100100100100100"],
    [17, 1, "00000000000000001", "01001001001001001"],
    [3, 7, "000000000000000001111", "010100010010001010010"],
    [7, 3, "000011100001000000000", "010010010010010101010"],
] as const) for (const depth of [8, 16]) for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [[], native],
        [["-dither", "Riemersma"], native],
        [["+dither", "-dither", "Riemersma"], native],
        [["-dither", "FloydSteinberg"], floyd],
        [["+dither"], "0".repeat(width * height)],
        [["-dither", "None"], "0".repeat(width * height)],
    ] as const)(`${mode}: ${width}x${height} depth=${depth} remaps with %j`, async (options, expected) => {
        // Native ImageMagick: -size WxH xc:'#606060', black/white palette.
        const input = encodeImage({ width, height,
            data: Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : 96),
            ...(depth === 16 ? { data16: Uint16Array.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? 255 : 96) * 257) } : {}),
            format: "png", space: "srgb", channels: 3, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const palette = encodeImage({ width: 2, height: 1,
            data: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/palette.png", palette);
        const argv = ["in.png", ...options, "-remap", "palette.png", "out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result)).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        if (depth === 16) expect(Array.from(decodeImage(output).data16!).filter((_, i) => i % 4 === 0).map(value => value / 65535).join("")).toBe(expected);
        expect(Array.from(decodeImage(output).data).filter((_, i) => i % 4 === 0).map(value => value / 255).join("")).toBe(expected);
    });
}
