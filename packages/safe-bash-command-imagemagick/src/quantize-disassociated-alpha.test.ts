import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: quantize disassociated RGB without alpha weighting.
for (const mode of ["sync", "public"] as const) {
    it.each([
        { name: "transparent RGB", input: ["xc:#12345600"], colors: ["-colors", "3"], output: ["-depth", "8", "rgb:-"], hex: "ffffff" },
        { name: "collapsed palette bytes", input: ["xc:#12345600", "xc:#8ab9cd80", "+append"], colors: ["-colors", "3"], output: ["-depth", "8", "rgb:-"], hex: "ffffffffffff" },
        { name: "collapsed palette width", input: ["xc:#12345600", "xc:#8ab9cd80", "+append"], colors: ["-colors", "3"], output: ["-unique-colors", "-format", "%w", "info:"], hex: "31" },
        { name: "unquantized control", input: ["xc:#12345600"], colors: [], output: ["-depth", "8", "rgb:-"], hex: "ffffff" },
        { name: "translucent control", input: ["xc:#12345680"], colors: ["-colors", "3"], output: ["-depth", "8", "rgb:-"], hex: "2468ab" },
    ])(`${mode}: $name`, async ({ input, colors, output, hex }) => {
        const args = [...input, "-alpha", "disassociate", ...colors, ...output];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, new Map()) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs: new MemoryFileSystem(), cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
