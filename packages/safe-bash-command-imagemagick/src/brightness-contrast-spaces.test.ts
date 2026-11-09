import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: spaces within geometry fields are ignored.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["20", [29492, 37108, 54068, 45876]],
        ["2 0", [29492, 37108, 54068, 45876]],
        ["20x60", [24579, 43619, 65535, 65535]],
        ["20 x 60", [24579, 43619, 65535, 65535]],
        ["2 0x6 0", [24579, 43619, 65535, 65535]],
        [" 2 0 , 6 0 ", [24579, 43619, 65535, 65535]],
        [" 2 0 / 6 0 ", [24579, 43619, 65535, 65535]],
    ] as const)(`${mode}: matches native 16-bit brightness-contrast for %s`, async (geometry, expected) => {
        const samples = [16385, 24001, 40961, 32769];
        const input = encodeImage({ width: 1, height: 1,
            data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples), format: "png", space: "srgb",
            channels: 4, depth: "ushort", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-brightness-contrast", geometry, "PNG64:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data16!]).toEqual(expected);
    });
}
