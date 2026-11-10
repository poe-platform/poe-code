import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels and channel metadata.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "Disassociate", geometry: "2x1", white: true, activate: true, hex: "ffdfbf00ffffff00" },
        { alpha: "Disassociate", geometry: "3x2", activate: true, hex: "ffdfbf00" + "ffffff00".repeat(5) },
        { alpha: "Disassociate", geometry: "2x1", white: true, hex: "ffdfbfffffffffff" },
        { alpha: "Disassociate", geometry: "3x2", text: "srgb  3.0" },
        { alpha: "On", geometry: "2x1", white: true, activate: true, hex: "cfb7abffffffffff" },
    ])(`${mode}: extent $geometry after $alpha, activate=$activate, channels=$text`, async testCase => {
        const argv = ["xc:#80402060", "-alpha", testCase.alpha,
            ...(testCase.white ? ["-background", "white", "-bordercolor", "white"] : []),
            "-extent", testCase.geometry, ...(testCase.activate ? ["-alpha", "Activate"] : []),
            ...(testCase.text ? ["-format", "%[channels]", "info:out"] : ["-depth", "8", "rgba:out"])];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        if ("text" in testCase) expect(new TextDecoder().decode(output)).toBe(testCase.text);
        else expect(Buffer.from(output).toString("hex")).toBe(testCase.hex);
    });
}
