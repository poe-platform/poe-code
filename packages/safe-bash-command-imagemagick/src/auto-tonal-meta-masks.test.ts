import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for the complete Meta0 plane.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "regional levels", operations: ["-region", "1x1+0+1", "-auto-level", "+region"], expected: "0baa12" },
        { name: "masked levels", operations: ["-write-mask", "xc:white", "-auto-level", "+write-mask"], expected: "0b0e12" },
        { name: "masked gamma", operations: ["-write-mask", "xc:white", "-auto-gamma", "+write-mask"], expected: "20272e" },
        { name: "regional gamma", operations: ["-region", "1x1+0+1", "-auto-gamma", "+region"], expected: "20ab2e" },
        { name: "partial mask levels", operations: ["-write-mask", "xc:gray50", "-auto-level", "+write-mask"], expected: "040607" },
        { name: "partial mask gamma", operations: ["-write-mask", "xc:gray50", "-auto-gamma", "+write-mask"], expected: "181d21" },
        { name: "levels across chunks", operations: ["-region", "1x1+0+512", "-auto-level", "+region"], height: 513, source: "xc:#a0a0a0", expected: "12".repeat(512) + "ff" },
        { name: "gamma across chunks", operations: ["-region", "1x1+0+512", "-auto-gamma", "+region"], height: 513, source: "xc:#a0a0a0", expected: "2c".repeat(512) + "bf" },
        { name: "16-bit masked levels", operations: ["-write-mask", "xc:white", "-auto-level", "+write-mask"], depth: "16", expected: "0a9e0e2811b2" },
        { name: "16-bit masked gamma", operations: ["-write-mask", "xc:white", "-auto-gamma", "+write-mask"], depth: "16", expected: "202a27992ea3" },
        { name: "unmasked levels", operations: ["-auto-level"], expected: "55aaff" },
        { name: "unmasked gamma", operations: ["-auto-gamma"], expected: "91abc3" },
    ])(`${mode}: $name`, async ({ operations, expected, height = 3, depth = "8", source = "gradient:#606060-#a0a0a0" }) => {
        const argv = ["-size", `1x${height}`, "xc:#404040", "-duplicate", "3", source, "-combine",
            ...operations, "-channel", "Meta0", "-separate", "+channel", "-depth", depth, "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
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
