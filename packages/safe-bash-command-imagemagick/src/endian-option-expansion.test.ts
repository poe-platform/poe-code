import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const beforeInput of [true, false]) {
        it.each([
            { value: "MSB", operand: "%[option:bo]", expected: "123456789abc" },
            { value: "LSB", operand: "%[option:bo]", expected: "34127856bc9a" },
            { value: "mSb", operand: "%[option:bo]", expected: "123456789abc" },
            { value: "MSB", operand: "%[bo]", expected: "123456789abc" },
            { value: "M", operand: "%[option:bo]SB", expected: "123456789abc" },
            { value: "MSB", operand: "MSB", expected: "123456789abc" },
            { value: "invalid", operand: "%[option:bo]", expected: undefined }
        ])(`${mode}: expands $operand=$value (before input: ${beforeInput})`, async ({ value, operand, expected }) => {
            const settings = ["-set", "option:bo", value, "-endian", operand];
            const input = ["xc:#123456789abc"];
            const argv = [...(beforeInput ? [...settings, ...input] : [...input, ...settings]),
                "-set", "option:bo", "invalid", "-depth", "16", "-write", "rgb:/out", "rgb:-"];
            const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", keep]]);
            await fs.writeFile("/out", keep);
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
            const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
            const output = mode === "command" ? Buffer.concat(chunks)
                : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
            const written = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(result.exitCode, error).toBe(expected === undefined ? 1 : 0);
            if (expected === undefined) {
                expect(error).toContain("unrecognized endian type 'invalid'");
                expect(output).toHaveLength(0);
                expect(written).toEqual(keep);
            } else {
                expect(error).toBe("");
                expect(output.toString("hex")).toBe(expected);
                expect(Buffer.from(written).toString("hex")).toBe(expected);
            }
        });
    }
}
