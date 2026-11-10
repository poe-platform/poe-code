import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const raster = ["xc:#11223340", "xc:#a0b0c080", "xc:#405060c0", "+append", "(",
    "xc:#d070a060", "xc:#3090a090", "xc:#e0a0f0b0", "+append", ")", "-append"];
const separate = ["-channel", "A", "-separate", "+channel"];
const activate = ["-alpha", "activate", "-alpha", "extract"];

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian 16-bit output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: ["-crop", "1x1+1+0"], finish: separate, expected: "0000" },
        { operation: ["-crop", "1x1+1+0"], finish: activate, expected: "0000" },
        { operation: ["-crop", "1x1+1+0"], text: true, expected: "srgb  3.0" },
        { operation: ["-crop", "3x2+0+0"], finish: separate, expected: "000000000000000000000000" },
        { operation: ["-crop", "3x2+0+0"], finish: activate, expected: "000000000000000000000000" },
        { operation: ["-trim"], finish: separate, expected: "000000000000000000000000" },
        { operation: ["-trim"], finish: activate, expected: "000000000000000000000000" },
        { operation: ["-trim"], text: true, expected: "srgb  3.0" },
        { alpha: "Discrete", operation: ["-crop", "1x1+1+0"], finish: separate, expected: "8080" },
        { alpha: "Discrete", operation: ["-trim"], finish: separate, expected: "40408080c0c060609090b0b0" },
        { small: true, operation: ["-roll", "+1+0"], finish: separate, expected: "00000000" },
        { small: true, operation: [], finish: activate, expected: "40408080" },
    ])(`${mode}: $alpha $operation then $finish (channels=$text)`, async ({ alpha = "Disassociate", operation, finish = [], text, small, expected }) => {
        const argv = [...(small ? ["xc:#11223340", "xc:#a0b0c080", "+append"] : raster),
            "-alpha", alpha, ...operation, ...finish,
            ...(text ? ["-format", "%[channels]"] : ["-depth", "16", "-endian", "MSB"]),
            `${text ? "info" : "gray"}:${mode === "command" ? "-" : "/out"}`];
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
        const output = mode === "command" ? stdout
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString(text ? "utf8" : "hex");
        expect(output).toBe(expected);
    });
}
