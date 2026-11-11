import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: copying into Meta0 creates a new plane.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { input: ["xc:#234567"], expression: "red=>meta", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "23" },
        { input: ["xc:#234567"], expression: "red=>MeTa", output: ["-format", "%[channels]", "info:"], text: "srgb  4.1" },
        { input: ["xc:#23456780"], expression: "red=>meta", output: ["-depth", "8", "rgba:-"], expected: "23456780" },
        { input: ["xc:#123456789abc"], expression: "red=>meta", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:-"], expected: "1234" },
        { input: ["xc:#234567", "-channel-fx", "red=>meta0"], expression: "green=>meta", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "45" },
        { input: ["-size", "513x1", "xc:#234567"], expression: "red=>meta", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "23".repeat(513) },
        { input: ["xc:#336699"], expression: "red=>meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "33" },
        { input: ["xc:#336699"], expression: "red=>10", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "33" },
        { input: ["xc:#336699"], expression: "red=>Meta0", output: ["-format", "%[channels]", "info:"], text: "srgb  4.1" },
        { input: ["xc:#336699"], expression: "red=>10", output: ["-format", "%[channels]", "info:"], text: "srgb  4.1" },
        { input: ["xc:#336699"], expression: "red=>green", output: ["-format", "%[channels]", "info:"], text: "srgb  3.0" },
        { input: ["xc:#33669980"], expression: "red=>meta0", output: ["-depth", "8", "rgba:-"], expected: "33669980" },
        { input: ["xc:#123456789abc"], expression: "red=>meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:-"], expected: "1234" },
        { input: ["xc:#336699"], expression: "red=>green,green=>meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "66" },
        { input: ["xc:#336699", "xc:#abcdef"], expression: "|red=>meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "ab" },
        { input: ["xc:#336699", "-channel-fx", "red=>meta0"], expression: "green=>meta1", output: ["-channel", "Meta0,Meta1", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "3366" },
        { input: ["-size", "513x1", "xc:#336699"], expression: "red=>meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "33".repeat(513) },
        { input: ["xc:#234567"], expression: "red=>meta1", output: ["-format", "%[channels]", "info:"], error: "missing image channel 'meta1'" },
        { input: ["xc:#234567"], expression: "red=>11", output: ["info:"], error: "missing image channel 'meta1'" },
        { input: ["xc:#234567"], expression: "red=>meta1,green=>meta0", output: ["info:"], error: "missing image channel 'meta1'" },
        { input: ["xc:#234567"], expression: "red=>meta0,green=>meta2", output: ["info:"], error: "missing image channel 'meta2'" },
        { input: ["xc:#234567", "-channel-fx", "red=>meta0"], expression: "green=>meta2", output: ["info:"], error: "missing image channel 'meta2'" },
        { input: ["xc:#234567"], expression: "red=>meta0,green=>meta1", output: ["-format", "%[channels]", "info:"], text: "srgb  5.2" },
        { input: ["xc:#234567"], expression: "red=>meta0,green=>meta0,blue=>meta1", output: ["-channel", "Meta0,Meta1", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "4567" },
        { input: ["xc:#336699"], expression: "red=>Bogus", output: ["gray:-"], error: "unsupported channel-fx assignment" },
    ])(`${mode}: $expression $output`, async ({ input, expression, output, expected, text, error }) => {
        const fs = new MemoryFileSystem();
        const argv = [...input, "-channel-fx", expression, ...output];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        let result;
        if (mode === "command") {
            const execution = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            result = { ...execution, stderr, stdout: "", stdoutBytes: Buffer.concat(chunks) };
        } else result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        stderr = result.stderr;
        const bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        expect(result.exitCode, stderr).toBe(error ? 1 : 0);
        if (error) {
            expect(stderr).toContain(error);
            expect(bytes.length).toBe(0);
        } else {
            expect(stderr).toBe("");
            expect(text === undefined ? bytes.toString("hex") : bytes.toString()).toBe(text ?? expected);
        }
    });
}
