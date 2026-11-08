import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["+smush", "-smush"])(`${mode}: %s preserves opaque RGB16 samples`, async operation => {
        const samples = [0x1234, 0x5678, 0x9abc, 65535, 0x1235, 0x5679, 0x9abd, 65535];
        const input = encodeImage({ width: 2, height: 1,
            data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples), format: "png", space: "srgb",
            channels: 3, depth: "ushort", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["-background", "none", "in.png", "in.png", operation, "0", "out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const actual = decodeImage(output);
        expect([actual.width, actual.height]).toEqual(operation === "+smush" ? [4, 1] : [2, 2]);
        expect(Array.from(actual.data16 ?? [])).toEqual([...samples, ...samples]);
    });
}
