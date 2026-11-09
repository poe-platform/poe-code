import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./ordered-dither-depth-fixtures.json" with { type: "json" };

// Original RGBA16 reproduction; expected samples decoded from native
// ImageMagick 7.1.2-31 Q16-HDRI PNG64 output as big-endian RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: preserves 16-bit ordered dither samples for $args`, async ({ args, expected }) => {
        const input = Buffer.from(fixtures.input, "base64");
        const files = new Map<string, Uint8Array>([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", ...args, "PNG64:out.png"];
        const commandArgs = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data16!]).toEqual(expected);
    });
}
