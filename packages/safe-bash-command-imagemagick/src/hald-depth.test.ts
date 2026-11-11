import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI output, including image depth independent of pixel precision.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: ["hald:2"], output: [], expected: "000000000000555500000000aaaa00000000ffff00000000" },
        { input: ["hald:4"], output: [], expected: "000000000000111100000000222200000000333300000000" },
        { input: ["hald:3"], output: [], expected: "000000000000200000000000400000000000600000000000" },
        { input: ["hald:2"], output: ["-depth", "16"], expected: "000000000000555500000000aaaa00000000ffff00000000" },
        { input: ["-depth", "8", "hald:3"], output: ["-format", "%z", "info:"], expected: "38" },
        { input: ["hald:2"], output: ["-format", "%z", "info:"], expected: "3136" },
    ])(`${mode}: preserves Hald depth for $input $output`, async ({ input, output, expected }) => {
        const args = [...input, "-crop", "4x1+0+0", "+repage", ...output,
            ...(output.includes("info:") ? [] : ["-endian", "MSB", "rgb:-"])];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
