import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: +endian selects explicit Undefined.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { coder, big, little } of [
        { coder: "rgb", big: "123456789abc", little: "34127856bc9a" },
        { coder: "gray", big: "4ce1", little: "e14c" },
        { coder: "rgba", big: "123456789abcffff", little: "34127856bc9affff" }
    ]) {
        it.each([
            { options: ["+endian"], expected: big },
            { options: ["-endian", "LSB", "+endian"], expected: big },
            { options: ["-endian", "MSB", "+endian"], expected: big },
            { options: ["-endian", "Undefined"], expected: big },
            { options: ["-endian", "MSB"], expected: big },
            { options: ["-endian", "LSB"], expected: little },
            { options: [], expected: little },
            { options: ["+endian", "-endian", "LSB"], expected: little }
        ])(`${mode}: writes ${coder}16 with $options`, async ({ options, expected }) => {
            const argv = ["xc:#123456789abc", "-depth", "16", ...options, "-write", `${coder}:/out`, `${coder}:-`];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? Buffer.concat(chunks)
                : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
            expect(output.toString("hex")).toBe(expected);
            const written = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(written).toString("hex")).toBe(expected);
        });
    }
}
