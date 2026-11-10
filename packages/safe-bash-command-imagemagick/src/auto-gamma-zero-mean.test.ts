import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete big-endian 16-bit RGBA output.
const cases = [
    { name: "zero green mean", input: "red", channels: ["-channel", "G"], expected: "ffffffff0000ffff" },
    { name: "black", input: "black", channels: [], expected: "ffffffffffffffff" },
    { name: "transparent black", input: "#00000000", channels: [], expected: "ffffffffffffffff" },
    { name: "full red mean", input: "red", channels: ["-channel", "R"], expected: "ffff00000000ffff" },
    { name: "one quantum mean", input: "#000100010001", channels: [], expected: "800080008000ffff" },
    { name: "white", input: "white", channels: [], expected: "ffffffffffffffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: auto-gamma matches native $name`, async ({ input, channels, expected }) => {
        const argv = [`xc:${input}`, ...channels, "-auto-gamma", ...(channels.length ? ["+channel"] : []),
            "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
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
