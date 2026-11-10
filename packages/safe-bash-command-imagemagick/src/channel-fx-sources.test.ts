import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { expression: "|r", expected: "808080c0" },
        { expression: "|r;g", expected: "808080c050505060" },
        { expression: "r,|g", expected: "202040c0" },
        { expression: "||r=>g", expected: "808080c0" },
        { expression: "|r=>g", expected: "208080c0" },
        { expression: "|r,g", expected: "805080c0" },
        { expression: "|r;g;b", expected: "808080c05050506030303060" },
        { expression: "|||r", expected: "803080c0" },
        { expression: "r;|g", expected: "202020c0204080c0" },
        { expression: undefined, expected: "204080c08050306030a0f080" },
    ])(`reads channel-fx source selectors in ${mode}: $expression`, async ({ expression, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI; source colors and alpha differ.
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#204080c0", "xc:#80503060", "xc:#30a0f080", ...(expression ? ["-channel-fx", expression] : []), "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }), stderr, stdoutBytes: Buffer.concat(chunks) } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = result.stdoutBytes!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
