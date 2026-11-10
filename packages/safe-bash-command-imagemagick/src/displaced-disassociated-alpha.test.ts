import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian 16-bit output.
const row = ["xc:#11223340", "xc:#a0b0c080", "+append"];
const rectangle = ["xc:#11223340", "xc:#a0b0c080", "xc:#405060c0", "+append",
    "(", "xc:#d070a060", "xc:#3090a090", "xc:#e0a0f0b0", "+append", ")", "-append"];
const extract = ["-alpha", "activate", "-alpha", "extract"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: row, alpha: "Disassociate", operation: ["-roll", "+1+0"], finish: extract, expected: "00000000" },
        { input: row, alpha: "Disassociate", operation: ["-roll", "+1+0"], finish: [], format: true, expected: "srgb  3.0" },
        { input: row, alpha: "Disassociate", operation: ["-roll", "+0+0"], finish: extract, expected: "00000000" },
        { input: rectangle, alpha: "Disassociate", operation: ["-chop", "1x1+1+0"], finish: extract, expected: "00000000" },
        { input: rectangle, alpha: "Disassociate", operation: ["-splice", "1x1+1+0"], finish: extract, expected: "000000000000000000000000000000000000000000000000" },
        { input: row, alpha: "Disassociate", operation: ["-roll", "+1+0"], finish: ["-channel", "A", "-separate", "+channel"], expected: "00000000" },
        { input: row, alpha: "Disassociate", operation: [], finish: extract, expected: "40408080" },
        { input: row, alpha: "Disassociate", operation: ["-flip"], finish: extract, expected: "00000000" },
        { input: row, alpha: "Deactivate", operation: ["-roll", "+1+0"], finish: extract, expected: "80804040" },
        { input: row, alpha: "Discrete", operation: ["-roll", "+1+0"], finish: extract, expected: "80804040" },
    ])(`${mode}: $alpha $operation $finish format=$format`, async ({ input, alpha, operation, finish, format, expected }) => {
        const destination = mode === "command" ? "-" : "out";
        const argv = [...input, "-alpha", alpha, ...operation, ...finish,
            ...(format ? ["-format", "%[channels]", `info:${destination}`] : ["-depth", "16", "-endian", "MSB", `gray:${destination}`])];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(format ? "utf8" : "hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("out")!).toString(format ? "utf8" : "hex");
        expect(output).toBe(expected);
    });
}
