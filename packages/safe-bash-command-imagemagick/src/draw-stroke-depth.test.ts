import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-draw", "line 0,0 1,0"], expected: "aaab567889ab".repeat(2) + "2345567889ab".repeat(4) },
        { options: [], expected: "2345567889ab".repeat(6) },
        { options: ["-fill", "#aaab567889ab", "+stroke", "-draw", "point 0,0"], expected: "aaab567889ab" + "2345567889ab".repeat(5) },
        { options: ["+stroke", "-draw", "stroke '#aaab567889ab' line 0,0 1,0"], expected: "aaab567889ab".repeat(2) + "2345567889ab".repeat(4) },
        { options: ["-draw", "push graphic-context stroke red pop graphic-context line 0,0 1,0"], expected: "aaab567889ab".repeat(2) + "2345567889ab".repeat(4) },
    ])(`${mode}: preserves 16-bit stroke samples with $options`, async ({ options, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "3x2", "xc:#2345567889ab", "-fill", "none", "-stroke", "#aaab567889ab", "+antialias",
            ...options, "-depth", "16", "-endian", "MSB", mode === "command" ? "rgb:-" : "rgb:out.rgb"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("out.rgb")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
