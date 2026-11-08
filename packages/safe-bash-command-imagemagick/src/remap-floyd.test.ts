import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [["-dither", "FloydSteinberg"], "010010010100100100010101010010010010001001001"],
        [["+dither"], "0".repeat(45)],
    ] as const)(`${mode}: remaps with %j`, async (options, expected) => {
        // Native ImageMagick: -size 9x5 xc:'#606060', black/white palette.
        const input = encodeImage({ width: 9, height: 5,
            data: Uint8Array.from({ length: 45 * 4 }, (_, i) => i % 4 === 3 ? 255 : 96),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
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
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data).filter((_, i) => i % 4 === 0).map(value => value / 255).join("")).toBe(expected);
    });
}
