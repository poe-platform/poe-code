import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for the fifth channel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "unmodified Meta0", operations: [], expected: "2080c0" },
        { name: "default selection", operations: ["-emboss", "1x1"], expected: "00ffff" },
        { name: "explicit Default", operations: ["-channel", "Default", "-emboss", "1x1"], expected: "00ffff" },
        { name: "explicit Meta0", operations: ["-channel", "Meta0", "-emboss", "1x1"], expected: "0080ff" },
        { name: "red preserves Meta0", operations: ["-channel", "R", "-emboss", "1x1"], expected: "2080c0" },
        { name: "reset selection", operations: ["-channel", "R", "+channel", "-emboss", "1x1"], expected: "00ffff" },
    ])(`${mode}: emboss $name`, async ({ operations, expected }) => {
        const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3", "(", "+size",
            "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
            ...operations, "+channel", "-channel", "Meta0", "-separate", "+channel", "-depth", "8",
            mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
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
