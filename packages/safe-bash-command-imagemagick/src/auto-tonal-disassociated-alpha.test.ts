import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian 16-bit RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "disassociated auto-gamma", operations: ["-alpha", "Disassociate", "-auto-gamma"], expected: "5fe67fe7dff7ffff5fe67fe79febffff" },
        { name: "disassociated auto-level", operations: ["-alpha", "Disassociate", "-auto-level"], expected: "32e16628ffffffff32e166289970ffff" },
        { name: "disassociated input", operations: ["-alpha", "Disassociate"], expected: "60008000dfffffff600080009fffffff" },
        { name: "active alpha auto-gamma", operations: ["-auto-gamma"], expected: "50625c8f79c5820170e882019108b69b" },
        { name: "active alpha auto-level", operations: ["-auto-level"], expected: "000013b14ec562763b13627689d8ffff" },
    ])(`${mode}: $name`, async ({ operations, expected }) => {
        const argv = ["xc:#18203840", "xc:#30405080", "+append", ...operations,
            "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
