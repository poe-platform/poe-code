import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA samples, independent of RGB rounding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colors: "none-white", depth: 8, alpha: [0, 43, 85, 128, 170, 213, 255] },
        { colors: "white-none", depth: 8, alpha: [255, 213, 170, 128, 85, 43, 0] },
        { colors: "none-white", depth: 16, alpha: [0, 10923, 21845, 32768, 43690, 54613, 65535] },
        { colors: "white-none", depth: 16, alpha: [65535, 54613, 43690, 32768, 21845, 10923, 0] }
    ])(`${mode}: rounds gradient:$colors alpha at depth $depth`, async ({ colors, depth, alpha }) => {
        const args = ["-size", "1x7", `gradient:${colors}`, "-endian", "MSB", "-depth", String(depth), "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
        expect(output.length).toBe(7 * 4 * depth / 8);
        const samples = depth === 8 ? [...output] : Array.from({ length: 28 }, (_, index) => output.readUInt16BE(index * 2));
        expect(samples.filter((_, index) => index % 4 === 3)).toEqual(alpha);
        expect(samples.filter((_, index) => index % 4 !== 3)).toEqual(alpha.flatMap(value => Array(3).fill(value === 0 ? 0 : 2 ** depth - 1)));
    });
}
