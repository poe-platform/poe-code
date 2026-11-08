import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([8, 16])(`${mode}: saves remapped pixels for a %s-bit source`, async depth => {
        const samples = [30000, 30020, 30080, 60000].flatMap(value => [value, value, value, 65535]);
        const input = encodeImage({ width: 4, height: 1,
            data: Uint8Array.from(samples, value => Math.round(value / 257)),
            ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}),
            format: "png", space: "srgb", channels: 3,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const palette = encodeImage({ width: 2, height: 1,
            data: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255),
            format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const files = new Map([["in.png", input], ["palette.png", palette]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/palette.png", palette);
        const argv = ["in.png", "+dither", "-remap", "palette.png", "out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const decoded = decodeImage(output);
        expect(Array.from(decoded.data)).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
        if (depth === 16) {
            expect(output[24]).toBe(16);
            expect(Array.from(decoded.data16!)).toEqual([0, 0, 0, 65535, 0, 0, 0, 65535, 0, 0, 0, 65535, 65535, 65535, 65535, 65535]);
        }
    });
}
