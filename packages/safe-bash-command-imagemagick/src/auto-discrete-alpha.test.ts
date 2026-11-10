import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete big-endian 16-bit output.
const cases = [
    { operation: "-auto-gamma", alpha: "Discrete", extract: false, expected: "50625c8f79c5ffff70e882019108ffff" },
    { operation: "-auto-gamma", alpha: "Discrete", extract: true, expected: "8201b69b" },
    { operation: "-auto-level", alpha: "Discrete", extract: false, expected: "000013b14ec5ffff3b13627689d8ffff" },
    { operation: "-auto-level", alpha: "Discrete", extract: true, expected: "6276ffff" },
    { operation: "-auto-gamma", alpha: "", extract: false, expected: "50625c8f79c5820170e882019108b69b" },
    { operation: "-auto-level", alpha: "", extract: false, expected: "000013b14ec562763b13627689d8ffff" },
    { operation: "-auto-gamma", alpha: "Deactivate", extract: false, expected: "5ce66919859dffff7d108d7d9bb3ffff" },
    { operation: "-auto-level", alpha: "Deactivate", extract: false, expected: "000024929249ffff6db6b6dbffffffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $operation with alpha '$alpha', extract=$extract`, async ({ operation, alpha, extract, expected }) => {
        const argv = ["xc:#18203840", "xc:#30405080", "+append", ...(alpha ? ["-alpha", alpha] : []), operation,
            ...(extract ? ["-alpha", "activate", "-alpha", "extract"] : []), "-depth", "16", "-endian", "MSB",
            `${extract ? "gray" : "rgba"}:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
