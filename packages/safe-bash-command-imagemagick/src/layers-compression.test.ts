import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// The reported RLE cases match ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of [[], ["-flatten"], ["-mosaic"], ["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"]]) {
        it.each([
            { name: "explicit RLE", inputs: ["xc:#804020", "-compress", "RLE"], expected: "RLE|RLE", binary: false },
            { name: "default", inputs: ["xc:#804020"], expected: "Undefined|Undefined", binary: false },
            { name: "first frame compression", inputs: ["(", "xc:#804020", "-compress", "RLE", ")", "(", "xc:blue", "-compress", "Zip", ")"], expected: operation.length ? "RLE|RLE" : "RLE|RLEZip|Zip", binary: false },
            { name: "MIFF encoding control", inputs: ["xc:#804020", "-compress", "RLE"], expected: "RLE", binary: true },
        ])(`${mode}: ${operation.join(" ") || "unmerged control"} preserves $name`, async ({ inputs, expected, binary }) => {
            const argv = ["-respect-parentheses", ...inputs, ...operation,
                ...(binary ? ["miff:-"] : ["-format", "%C|%[compression]", "info:"])];
            const fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(argv);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (binary) {
                const bytes = mode === "command" ? Buffer.concat(chunks)
                    : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
                const end = bytes.indexOf(26) + 1;
                expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain("compression=RLE\n");
            } else {
                const stdout = "stdout" in result ? result.stdout : new TextDecoder().decode(Buffer.concat(chunks));
                expect(stdout).toBe(expected);
            }
        });
    }
}
