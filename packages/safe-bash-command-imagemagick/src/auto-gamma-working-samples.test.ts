import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGBA output.
const cases = [
    { name: "mean of one", options: ["-evaluate", "Multiply", "1.9921875", "-auto-gamma"], expected: "00ffffff" },
    { name: "independent channel means", options: ["-evaluate", "Multiply", "3", "-channel", "RGB", "-auto-gamma", "+channel", "-evaluate", "Divide", "3"], expected: "2b2b2b80" },
    { name: "above-range mean", options: ["-evaluate", "Multiply", "3", "-auto-gamma", "-evaluate", "Divide", "3"], expected: "552b152b" },
    { name: "negative samples", options: ["-evaluate", "Subtract", "50%", "-auto-gamma", "-evaluate", "Add", "50%"], expected: "80ffffff" },
    { name: "ordinary gamma", options: ["-auto-gamma"], expected: "3f80c080" },
    { name: "multiply/divide control", options: ["-evaluate", "Multiply", "3", "-evaluate", "Divide", "3"], expected: "4080c080" },
    { name: "subtract/add control", options: ["-evaluate", "Subtract", "50%", "-evaluate", "Add", "50%"], expected: "4080c080" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native $name via ${mode}`, async ({ options, expected }) => {
        const fs = new MemoryFileSystem(), sentinel = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", sentinel);
        const files = new Map([["/out", sentinel]]);
        const argv = ["xc:#4080c080", ...options, "-depth", "8", "rgba:/out"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
