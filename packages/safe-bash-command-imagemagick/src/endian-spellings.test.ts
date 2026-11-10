import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const placement of ["before", "after"] as const) {
        it.each([
            { endian: "M-S-B", expected: "123456789abc" },
            { endian: "M_S_B", expected: "123456789abc" },
            { endian: " MSB ", expected: "123456789abc" },
            { endian: "mSb", expected: "123456789abc" },
            { endian: "L-S-B", expected: "34127856bc9a" },
            { endian: "L_S_B", expected: "34127856bc9a" },
            { endian: "\tLSB\n", expected: "34127856bc9a" },
            { endian: "U_n-deFiNed", expected: "123456789abc" },
            { endian: " Undefined ", expected: "123456789abc" },
            { endian: "what", expected: "", exitCode: 1 },
            { endian: "", expected: "", exitCode: 1 },
            { endian: "M SB", expected: "", exitCode: 1 }
        ])(`${mode}: endian $endian ${placement} input`, async ({ endian, expected, exitCode = 0 }) => {
            const options = ["-set", "option:bo", "MSB", "-endian", endian];
            const input = ["xc:#123456789abc"];
            const argv = [...(placement === "before" ? [...options, ...input] : [...input, ...options]), "-depth", "16", "rgb:-"];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? {
                ...await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdoutBytes: Buffer.concat(chunks), stderr
            } : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(exitCode);
            expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(expected);
            if (exitCode === 0) expect(result.stderr).toBe("");
            else expect(result.stderr).toContain("unrecognized endian type");
        });
    }
}
