import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick: the fifth bare selection supplies alpha; the fourth is skipped.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { expression: "r,g,b,a,r", expected: "9120ac91" },
        { expression: "r,g,b,a,g", expected: "9120ac20" },
        { expression: "r,g,b,a,b", expected: "9120acac" },
        { expression: "r,g,b,a,r,g", expected: "9120ac91" },
        { expression: "r,g,b,a", expected: "9120ac60" },
        { expression: "r,g,b,a,a", expected: "9120ac60" },
        { expression: "r,g,b,r", expected: "9120ac60" },
        { expression: "b,g,r,a,r", expected: "ac209191" },
        { expression: "r,g,b,a,r", after: ["-channel", "A", "-separate", "+channel"], output: "gray", expected: "91" },
        { expression: "r,g,b,a,r", output: "info", expected: "srgba 4.0" },
        { expression: "r,g,b,a,r", mean: true, expected: "59389659" },
        { expression: "r,g,b,a,r", color: "#123456789abcdef0", depth: 16, expected: "123456789abc1234" },
    ])(`${mode}: $expression produces $expected`, async ({ expression, expected, after = [], output = "rgba", mean = false, color = "#9120ac60", depth = 8 }) => {
        const argv = [...(mean ? ["xc:#20508020", "("] : []), `xc:${color}`, "-channel-fx", expression,
            ...(mean ? [")", "-evaluate-sequence", "Mean"] : []), ...after,
            ...(output === "info" ? ["-format", "%[channels]"] : ["-depth", String(depth), "-endian", "MSB"]), `${output}:-`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
