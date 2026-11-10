import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { expression: "r=>g;b=>g", expected: "202080c0208080c0" },
        { expression: "r=>g", expected: "202080c0" },
        { expression: "b=>g", expected: "208080c0" },
        { expression: "r;g", expected: "202020c0404040c0" },
    ])(`emits independent channel-fx frames in ${mode}: $expression`, async ({ expression, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI, including the single-frame controls.
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#204080c0", "-channel-fx", expression, "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await Promise.resolve(createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        })).then(result => ({ ...result, stdout: "", stderr, stdoutBytes: Buffer.concat(chunks) })) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = result.stdoutBytes!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
