import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including retained-alpha controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colors: ["80402060"], alpha: "Disassociate", operations: ["-sort-pixels", "-channel", "A", "-separate", "+channel"], coder: "gray", hex: "00" },
        { alpha: "Disassociate", operations: ["-sort-pixels"], format: "%r|%[channels]|%wx%h", text: "DirectClass sRGB |srgb  3.0|3x1" },
        { alpha: "Disassociate", operations: ["-sort-pixels", "-alpha", "Activate"], coder: "rgba", hex: "03080d0010204000ffffff00" },
        ...["Disassociate", "Discrete", "On"].map(alpha => ({
            colors: ["80402060"], alpha, operations: [...alpha === "Disassociate" ? [] : ["-sort-pixels"], "-channel", "A", "-separate", "+channel"], coder: "gray", hex: "60"
        })),
    ])(`${mode}: sort pixels after $alpha with $operations and $format $coder`, async testCase => {
        const colors = "colors" in testCase ? testCase.colors : ["ffeedd80", "01030560", "102040ff"];
        const argv = [...colors.map(color => `xc:#${color}`), "+append", "-alpha", testCase.alpha,
            ...testCase.operations, ...("text" in testCase ? ["-format", testCase.format!, "info:out"]
                : ["-depth", "8", "-endian", "MSB", `${testCase.coder}:out`])];
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
