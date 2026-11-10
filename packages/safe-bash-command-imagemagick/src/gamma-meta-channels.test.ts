import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, big-endian gray samples.
const samples = ["(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "forward Meta0", selection: ["-channel", "Meta0"], operation: "-gamma", extra: false, output: "Meta0", expected: "8040b55fde22" },
        { name: "inverse Meta0", selection: ["-channel", "Meta0"], operation: "+gamma", extra: false, output: "Meta0", expected: "102040819121" },
        { name: "default channels", selection: [], operation: "-gamma", extra: false, output: "Meta0", expected: "8040b55fde22" },
        { name: "reset channels", selection: ["-channel", "R", "+channel"], operation: "-gamma", extra: false, output: "Meta0", expected: "8040b55fde22" },
        { name: "Meta1", selection: ["-channel", "Meta1"], operation: "-gamma", extra: true, output: "Meta1", expected: "cac7cac7cac7" },
        { name: "red selection preserves Meta0", selection: ["-channel", "R"], operation: "-gamma", extra: false, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta1 selection preserves Meta0", selection: ["-channel", "Meta1"], operation: "-gamma", extra: true, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta0 selection preserves red", selection: ["-channel", "Meta0"], operation: "+gamma", extra: false, output: "R", expected: "505050505050" },
        { name: "RGB control", selection: [], operation: "-gamma", extra: false, output: "", expected: "8040b55fde22" },
    ])(`${mode}: gamma: $name`, async ({ selection, operation, extra, output, expected }) => {
        const argv = [...(output ? ["-size", "3x1", "xc:#505050", "-duplicate", "3"] : []), ...samples,
            ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), ...(output ? ["-combine"] : []),
            ...selection, operation, "2", "+channel",
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
