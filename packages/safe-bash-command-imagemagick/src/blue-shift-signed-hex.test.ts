import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, xc:#345caa80 -blue-shift FACTOR -depth 8 rgba:-.
describe.each(["command", "retained", "buffered", "sync"] as const)("signed hexadecimal blue-shift (%s)", mode => {
    it.each([
        { factor: "+0x2", expected: "d1dbef80" },
        { factor: "-0x2", expected: "00000080" },
        { factor: "0x2", expected: "0d172b80" },
        { factor: "+2", expected: "d1dbef80" },
        { factor: "-2", expected: "00000080" },
        { factor: "0", expected: "0d172b80" },
        { factor: "+0X2", expected: "d1dbef80" },
        { factor: "-0X2", expected: "00000080" },
        { factor: "+0x2%", expected: "d1dbef80" },
        { factor: "+0x2x3", expected: "d1dbef80" },
        { factor: "+0x2.8", expected: "ffffff80" },
        { factor: "%[option:shift]", expected: "d1dbef80" }
    ])("reads $factor", async ({ factor, expected }) => {
        const argv = ["-set", "option:shift", "+0x2", "xc:#345caa80", "-blue-shift", factor, "-depth", "8", "rgba:-"];
        const fs = new MemoryFileSystem();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
});
