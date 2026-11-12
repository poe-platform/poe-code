import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 output.
const red = ["(", "xc:#203040", "-channel", "R", ")"];
const blue = ["(", "xc:#203040", "-channel", "B", ")"];
describe.each(["command", "buffered", "retained", "sync"] as const)("shade image channels (%s)", mode => {
    it.each([
        { name: "per-image selections", inputs: [...red, ...blue], expected: "b430402030b4" },
        { name: "red selection", inputs: red, expected: "b43040" },
        { name: "blue selection", inputs: blue, expected: "2030b4" },
        { name: "reset selections", inputs: [...red, ...blue, "+channel"], expected: "b4b4b4b4b4b4" },
    ])("honors $name", async ({ inputs, expected }) => {
        const args = [...inputs, "-shade", "0x45", "-depth", "8", "rgb:-"];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(0);
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
        expect(error).toBe("");
    });
});
