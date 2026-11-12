import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves unselected working samples.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const input of ["evaluated", "explicit"] as const) {
        it.each([
            { operation: ["-auto-threshold", "OTSU"], expected: "99999999ffff99b999b9ffff" },
            { operation: ["-auto-threshold", "Triangle"], expected: "99999999ffff99b999b9ffff" },
            { operation: ["-auto-threshold", "Kapur"], expected: "99999999ffff99b999b9ffff" },
            { operation: ["-threshold", "39337"], expected: "99999999000099b999b9ffff" },
            { operation: [], expected: "99999999999999b999b999b9" },
        ])(`${mode}: ${input} samples with $operation`, async ({ operation, expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const argv = [
                ...(input === "evaluated" ? ["-size", "1x1", "xc:#999999", "(", "+clone", "-evaluate", "add", "32", ")"]
                    : ["xc:#999999999999", "xc:#99b999b999b9"]),
                "+append", "-channel", "B", ...operation, "-depth", "16", "-endian", "MSB", "rgb:/out",
            ];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
