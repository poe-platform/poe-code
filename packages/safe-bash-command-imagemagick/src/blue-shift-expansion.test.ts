import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the expanded factor preserves the numeric RGBA output.
describe.each(["command", "retained", "buffered", "sync"] as const)("blue-shift factor expansion (%s)", mode => {
    it.each([
        { input: ["xc:#4080a080"], factor: "%[fx:3/2]" },
        { input: ["-set", "option:shift", "1.5", "xc:#4080a080"], factor: "%[option:shift]" },
        { input: ["-set", "option:shift", "1.5", "xc:#4080a080"], factor: "1.5" },
        { input: ["xc:#4080a080", "-set", "shift", "1.5"], factor: "%[shift]" },
        { input: ["xc:#4080a080", "xc:#4080a080"], factor: "%[fx:1+t/2]", expected: "70808880a0b0b880" },
        { input: ["-set", "option:shift", "bogus", "xc:#4080a080"], factor: "%[option:shift]", expected: "", exitCode: 1 }
    ])("expands $factor with $input", async ({ input, factor, expected = "a0b0b880", exitCode = 0 }) => {
        const argv = [...input, "-blue-shift", factor, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect(result.exitCode, error).toBe(exitCode);
        if (exitCode === 0) expect(error).toBe("");
        else expect(error).toContain("invalid argument '-blue-shift'");
        const bytes = mode === "command" ? Buffer.concat(chunks)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
        expect(bytes.toString("hex")).toBe(expected);
    });
});
