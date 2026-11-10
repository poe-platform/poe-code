import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        // ImageMagick 7.1.2-35 Q16-HDRI: two selectors preserve blue and alpha.
        { color: "#204080c0", depth: 8, expression: "g,r", expected: "402080c0" },
        { color: "#204080c0", depth: 8, expression: "r,g", expected: "204080c0" },
        { color: "#204080c0", depth: 8, expression: "r", expected: "202020c0" },
        { color: "#204080c0", depth: 8, expression: "g,r,b", expected: "402080c0" },
        { color: "#123456789abcdef0", depth: 16, expression: "g,r", expected: "567812349abcdef0" },
        { color: "#123456789abcdef0", depth: 16, expression: "r,g", expected: "123456789abcdef0" },
        { color: "#123456789abcdef0", depth: 16, expression: "r", expected: "123412341234def0" },
        { color: "#123456789abcdef0", depth: 16, expression: "g,r,b", expected: "567812349abcdef0" },
    ])(`${mode}: selects $expression at depth $depth`, async ({ color, depth, expression, expected }) => {
        const argv = [`xc:${color}`, "-channel-fx", expression, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
