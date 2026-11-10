import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { expression: "0", expected: "202020c0" },
        { expression: "cyan", expected: "202020c0" },
        { expression: "gray", expected: "202020c0" },
        { expression: "r", expected: "202020c0" },
        { expression: "1", expected: "404040c0" },
        { expression: "magenta", expected: "404040c0" },
        { expression: "2", expected: "808080c0" },
        { expression: "yellow", expected: "808080c0" },
        { expression: "4", expected: "c0c0c0c0" },
        { expression: "o", expected: "c0c0c0c0" },
        { expression: " C ", expected: "202020c0" },
        { expression: "Y,M,C", expected: "804020c0" },
        { expression: "0;1;2", expected: "202020c0404040c0808080c0" },
    ])(`selects channel aliases in ${mode}: $expression`, async ({ expression, expected }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: bare selections retain source alpha.
        const fs = new MemoryFileSystem();
        const argv = ["xc:#204080c0", "-channel-fx", expression, "-depth", "8", "rgba:-"];
        const args = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString("hex")).toBe(expected);
        } else {
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(expected);
        }
    });
}
