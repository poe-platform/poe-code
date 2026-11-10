import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // Native ImageMagick 7 Q16-HDRI RGBA8 results; alpha remains 0xc0.
    it.each([
        { channel: "Gray", clamp: true, expected: "404040c0" },
        { channel: "R", clamp: true, expected: "404040c0" },
        { channel: "G", clamp: true, expected: "454545c0" },
        { channel: "B", clamp: true, expected: "454545c0" },
        { channel: "R", clamp: false, expected: "454545c0" },
        { channel: "RGB", clamp: true, expected: "404040c0" },
    ])(`${mode}: grayscale -channel $channel, clamp=$clamp`, async ({ channel, clamp, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#464263c0", "-colorspace", "Gray", "-channel", channel,
            "-evaluate", "multiply", "4", ...(clamp ? ["-clamp"] : []),
            "-evaluate", "divide", "4", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
