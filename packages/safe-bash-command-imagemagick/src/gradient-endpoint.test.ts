import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps a distinct blue endpoint at (3,3).
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const define of [undefined, "direction=south", "vector=0,0 0,3"]) {
        it.each([
            { size: "4x4", output: ["-precision", "20", "-format", "%[fx:p{0,3}.r],%[fx:p{3,3}.r],%k", "info:"], samples: [0, 2.2204460492503130808e-16, 5] },
            { size: "4x4", output: ["-unique-colors", "-format", "%wx%h", "info:"], expected: "5x1" },
            { size: "4x4", output: ["-unique-colors", "-depth", "8", "rgb:-"], hex: "ff0000aa00555500aa0000ff0000ff" },
            { size: "3x4", output: ["-format", "%k", "info:"], expected: "4" },
            { size: "3x4", output: ["-unique-colors", "-format", "%wx%h", "info:"], expected: "4x1" },
            { size: "3x4", output: ["-unique-colors", "-depth", "8", "rgb:-"], hex: "ff0000aa00555500aa0000ff" },
        ])(`${mode}, ${define ?? "default"}: $size $output`, async ({ size, output, expected, hex, samples }) => {
            const argv = ["-size", size, ...(define ? ["-define", `gradient:${define}`] : []), "gradient:red-blue", ...output];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let bytes: Uint8Array;
            if (mode === "command") {
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                });
                expect(result.exitCode).toBe(0);
                expect(stderr).toBe("");
                bytes = Buffer.concat(chunks);
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                bytes = hex ? result.stdoutBytes! : new TextEncoder().encode(result.stdout);
            }
            if (samples) expect(new TextDecoder().decode(bytes).split(",").map(Number)).toEqual(samples);
            else expect(hex ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes)).toBe(hex ?? expected);
        });
    }
}
