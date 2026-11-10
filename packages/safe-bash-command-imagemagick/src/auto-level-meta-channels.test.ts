import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian gray output.
const input = ["-size", "3x1", "xc:#404040", "-duplicate", "3", "(",
    "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#a0a0a0", "+append", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "shared range stretches red", operations: ["-auto-level"], channel: "R", expected: "000000000000" },
        { name: "shared range stretches Meta0", operations: ["-auto-level"], channel: "Meta0", expected: "0000aaaaffff" },
        { name: "explicit Meta0 remains unchanged", operations: ["-channel", "Meta0", "-auto-level"], channel: "Meta0", expected: "40408080a0a0" },
        { name: "reset channels share the range", operations: ["-channel", "R", "+channel", "-auto-level"], channel: "Meta0", expected: "0000aaaaffff" },
        { name: "explicit red ignores Meta0 range", operations: ["-channel", "R", "-auto-level"], channel: "R", expected: "404040404040" },
        { name: "explicit red preserves Meta0", operations: ["-channel", "R", "-auto-level"], channel: "Meta0", expected: "40408080a0a0" },
        { name: "extra plane spans retained chunks", operations: ["-auto-level"], channel: "Meta0", expected: "ffff".repeat(513),
            sources: ["-size", "513x1", "xc:#404040", "-duplicate", "3", "xc:#808080"] },
        { name: "red without levels", operations: [], channel: "R", expected: "404040404040" },
        { name: "Meta0 without levels", operations: [], channel: "Meta0", expected: "40408080a0a0" },
        { name: "constant shared range", operations: ["-auto-level"], channel: "R", expected: "404040404040",
            sources: ["-size", "3x1", "xc:#404040", "-duplicate", "3", "xc:#404040"] },
    ])(`${mode}: $name`, async ({ operations, channel, expected, sources = input }) => {
        const argv = [...sources, "-combine", ...operations, "+channel", "-channel", channel,
            "-separate", "+channel", "-depth", "16", "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
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
