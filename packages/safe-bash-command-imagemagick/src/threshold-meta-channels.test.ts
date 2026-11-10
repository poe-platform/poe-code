import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, big-endian gray samples.
const samples = ["(", "-size", "1x1", "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "Meta0 threshold equality", selection: ["-channel", "Meta0"], threshold: "32896", extra: false, output: "Meta0", expected: "00000000ffff" },
        { name: "Meta0 percentage", selection: ["-channel", "Meta0"], threshold: "50%", extra: false, output: "Meta0", expected: "0000ffffffff" },
        { name: "default channels", selection: [], threshold: "50%", extra: false, output: "Meta0", expected: "000000000000" },
        { name: "reset channels", selection: ["-channel", "R", "+channel"], threshold: "50%", extra: false, output: "Meta0", expected: "000000000000" },
        { name: "explicit Default", selection: ["-channel", "Default"], threshold: "50%", extra: false, output: "Meta0", expected: "000000000000" },
        { name: "bright default intensity", selection: [], threshold: "50%", extra: false, output: "Meta0", visible: "#a0a0a0", expected: "ffffffffffff" },
        { name: "numeric meta selection", selection: ["-channel", "10"], threshold: "50%", extra: false, output: "Meta0", expected: "0000ffffffff" },
        { name: "expanded threshold", selection: ["-channel", "Meta0"], threshold: "%[fx:25*2]%", extra: false, output: "Meta0", expected: "0000ffffffff" },
        { name: "Meta0 selection preserves visible red", selection: ["-channel", "Meta0"], threshold: "50%", extra: false, output: "R", expected: "505050505050" },
        { name: "Meta1", selection: ["-channel", "Meta1"], threshold: "50%", extra: true, output: "Meta1", expected: "ffffffffffff" },
        { name: "red selection preserves Meta0", selection: ["-channel", "R"], threshold: "50%", extra: false, output: "Meta0", expected: "40408080c0c0" },
        { name: "Meta1 selection preserves Meta0", selection: ["-channel", "Meta1"], threshold: "50%", extra: true, output: "Meta0", expected: "40408080c0c0" },
        { name: "RGB control", selection: [], threshold: "50%", extra: false, output: "", expected: "0000ffffffff" },
    ])(`${mode}: thresholds $name`, async ({ selection, threshold, extra, output, expected, ...test }) => {
        const argv = [...(output ? ["-size", "3x1", `xc:${"visible" in test ? test.visible : "#505050"}`, "-duplicate", "3"] : []), ...samples,
            ...(extra ? ["-size", "3x1", "xc:#a0a0a0"] : []), ...(output ? ["-combine"] : []),
            ...selection, "-threshold", threshold, "+channel",
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
