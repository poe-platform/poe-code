import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["black", "rgba"] as const) {
        it.each([
            { name: "unmodified control", matrix: undefined, black: "9f", rgba: "204060ff" },
            { name: "implicit black identity", matrix: "3x4: 1 0 0 0 1 0 0 0 1 0 0 0", black: "9f", rgba: "204060ff" },
            { name: "explicit black identity", matrix: "4x4: 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1", black: "9f", rgba: "204060ff" },
            { name: "explicit black zero", matrix: "4x4: 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0", black: "00", rgba: "55aaffff" },
        ])(`${mode}, ${output}: $name`, async ({ matrix, black, rgba }) => {
            const argv = ["xc:#204060", "-colorspace", "CMYK",
                ...(matrix ? ["-color-matrix", matrix] : []),
                ...(output === "black" ? ["-channel", "K", "-separate", "+channel"] : ["-colorspace", "sRGB"]),
                "-depth", "8", output === "black" ? "gray:-" : "rgba:-"];
            const fs = new MemoryFileSystem();
            const args = createCommandArguments(argv);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr } : mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            expect(Buffer.from(result.stdoutBytes ?? result.stdout).toString("hex")).toBe(output === "black" ? black : rgba);
        });
    }
}
