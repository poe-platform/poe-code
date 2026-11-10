import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete stdout, including 16-bit MSB pixels.
const cases = [
    { operation: "-auto-gamma", output: "info", expected: "srgb  3.0" },
    { operation: "-auto-gamma", output: "gray", expected: "00000000" },
    { operation: "-auto-level", output: "info", expected: "srgb  3.0" },
    { operation: "-auto-level", output: "gray", expected: "00000000" },
    { operation: "-auto-gamma", output: "gray", neutral: true, expected: "0000" },
    { operation: "", output: "info", expected: "srgb  4.0" },
    { operation: "", output: "gray", expected: "40408080" },
    { operation: "-auto-gamma", output: "rgba", neutral: true, expected: "ffffffffffffffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $operation after Disassociate, $output, neutral=$neutral`, async ({ operation, output, neutral, expected }) => {
        const text = output === "info";
        const argv = [...(neutral ? ["xc:#80808080"] : ["xc:#18203840", "xc:#30405080", "+append"]),
            "-alpha", "Disassociate", ...(operation ? [operation] : []),
            ...(output === "gray" ? ["-alpha", "activate", "-alpha", "extract"] : []),
            ...(text ? ["-format", "%[channels]"] : ["-depth", "16", "-endian", "MSB"]),
            `${output}:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(text ? "utf8" : "hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString(text ? "utf8" : "hex");
        expect(actual).toBe(expected);
    });
}
