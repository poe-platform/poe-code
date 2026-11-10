import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, big-endian gray samples.
const samples = ["(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "Meta0 threshold equality", selection: ["-channel", "Meta0"], threshold: "32896", extra: false, output: "Meta0", expected: "404080803f3f" },
        { name: "Meta0 percentage", selection: ["-channel", "Meta0"], threshold: "50%", extra: false, output: "Meta0", expected: "40407f7f3f3f" },
        { name: "default channels", selection: [], threshold: "32896", extra: false, output: "Meta0", expected: "404080803f3f" },
        { name: "reset channels", selection: ["-channel", "R", "+channel"], threshold: "32896", extra: false, output: "Meta0", expected: "404080803f3f" },
        { name: "Meta1", selection: ["-channel", "Meta1"], threshold: "32896", extra: true, output: "Meta1", expected: "5f5f5f5f5f5f" },
        { name: "red selection preserves Meta0", selection: ["-channel", "R"], threshold: "32896", extra: false, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta1 selection preserves Meta0", selection: ["-channel", "Meta1"], threshold: "32896", extra: true, output: "Meta0", expected: "40408080c0c0" },
        { name: "RGB control", selection: [], threshold: "32896", extra: false, output: "", expected: "404080803f3f" },
    ])(`${mode}: solarizes $name`, async ({ selection, threshold, extra, output, expected }) => {
        const argv = [...(output ? ["-size", "3x1", "xc:#505050", "-duplicate", "3"] : []), ...samples,
            ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), ...(output ? ["-combine"] : []),
            ...selection, "-solarize", threshold, "+channel",
            ...(output ? ["-channel", output, "-separate", "+channel"] : []),
            "-depth", "16", "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
