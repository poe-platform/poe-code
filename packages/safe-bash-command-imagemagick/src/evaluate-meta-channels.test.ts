import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes, big-endian gray samples.
const samples = ["(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "selected Meta0", selection: ["-channel", "Meta0"], operation: "multiply", value: "0.5", extra: false, output: "Meta0", expected: "202040406060" },
        { name: "nonlinear Meta0", selection: ["-channel", "Meta0"], operation: "pow", value: "2", extra: false, output: "Meta0", expected: "102040819121" },
        { name: "default channels", selection: [], operation: "multiply", value: "0.5", extra: false, output: "Meta0", expected: "202040406060" },
        { name: "reset channels", selection: ["-channel", "R", "+channel"], operation: "multiply", value: "0.5", extra: false, output: "Meta0", expected: "202040406060" },
        { name: "selected Meta1", selection: ["-channel", "Meta1"], operation: "multiply", value: "0.5", extra: true, output: "Meta1", expected: "505050505050" },
        { name: "red preserves Meta0", selection: ["-channel", "R"], operation: "multiply", value: "0.5", extra: false, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta1 preserves Meta0", selection: ["-channel", "Meta1"], operation: "multiply", value: "0.5", extra: true, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta0 preserves red", selection: ["-channel", "Meta0"], operation: "multiply", value: "0.5", extra: false, output: "R", expected: "505050505050" },
        { name: "RGB control", selection: [], operation: "multiply", value: "0.5", extra: false, output: "", expected: "202040406060" },
    ])(`${mode}: evaluates $name`, async ({ selection, operation, value, extra, output, expected }) => {
        const argv = [...(output ? ["-size", "3x1", "xc:#505050", "-duplicate", "3"] : []), ...samples,
            ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), ...(output ? ["-combine"] : []),
            ...selection, "-evaluate", operation, value, "+channel",
            ...(output ? ["-channel", output, "-separate", "+channel"] : []),
            "-depth", "16", "-endian", "MSB", "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
