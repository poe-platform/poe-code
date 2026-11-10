import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "selected Meta0", clamp: ["-clamp"], expected: "404040" },
        { name: "reset channels", clamp: ["+channel", "-clamp"], expected: "404040" },
        { name: "explicit Default", clamp: ["-channel", "Default", "-clamp"], expected: "404040" },
        { name: "unclamped control", clamp: [], expected: "4080c0" },
        { name: "red selection preserves Meta0", clamp: ["-channel", "R", "-clamp"], expected: "4080c0" },
        { name: "Meta1 selection preserves Meta0", clamp: ["-channel", "Meta1", "-clamp"], expected: "4080c0" },
        { name: "negative samples", clamp: ["-clamp"], before: ["subtract", "65535"], after: ["add", "16384"], expected: "404040" },
        { name: "16-bit samples", clamp: ["-clamp"], depth: "16", expected: "400040004000" },
        { name: "selected Meta1", clamp: ["-clamp"], channel: "Meta1", expected: "404040" },
    ])(`${mode}: clamps stored extra channels before arithmetic ($name)`, async ({ clamp, expected, before = ["multiply", "4"], after = ["divide", "4"], depth = "8", channel = "Meta0" }) => {
        const argv = ["-size", "3x1", "xc:white", "-duplicate", "3",
            "(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")",
            ...(channel === "Meta1" || clamp.includes("Meta1") ? ["-size", "3x1", "xc:#808080"] : []), "-combine",
            "-channel", channel, "-evaluate", ...before, ...clamp,
            "-channel", channel, "-evaluate", ...after, "+channel",
            "-channel", channel, "-separate", "+channel", "-depth", depth, "-endian", "MSB",
            mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
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
