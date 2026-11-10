import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete big-endian 16-bit gray output.
for (const height of [1, 257]) for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "shared red correction", options: ["-auto-gamma", "+channel"], output: "R", constant: false, expected: "755575557555" },
        { name: "shared Meta0 correction", options: ["-auto-gamma", "+channel"], output: "Meta0", constant: false, expected: "7555ad81c4ca" },
        { name: "explicit default channels", options: ["-channel", "Default", "-auto-gamma", "+channel"], output: "Meta0", constant: false, expected: "7555ad81c4ca" },
        { name: "reset default channels", options: ["-channel", "Meta0", "+channel", "-auto-gamma"], output: "R", constant: false, expected: "755575557555" },
        { name: "explicit Meta0 preserves red", options: ["-channel", "Meta0", "-auto-gamma", "+channel"], output: "R", constant: false, expected: "404040404040" },
        { name: "explicit Meta0 preserves Meta0", options: ["-channel", "Meta0", "-auto-gamma", "+channel"], output: "Meta0", constant: false, expected: "40408080a0a0" },
        { name: "channel reset preserves Meta0", options: ["-channel", "Meta0", "+channel"], output: "Meta0", constant: false, expected: "40408080a0a0" },
        { name: "constant fifth plane", options: ["-auto-gamma"], output: "R", constant: true, expected: "800080008000" },
    ])(`${mode}: auto-gamma: $name (height=${height})`, async ({ options, output, constant, expected }) => {
        const argv = ["-size", `3x${height}`, "xc:#404040", "-duplicate", "3",
            ...(constant ? ["xc:#404040"] : ["(", "-size", `1x${height}`, "xc:#404040", "xc:#808080", "xc:#a0a0a0", "+append", ")"]),
            "-combine", ...options, "-channel", output, "-separate", "+channel", "-depth", "16", "-endian", "MSB",
            mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected.repeat(height));
    });
}
