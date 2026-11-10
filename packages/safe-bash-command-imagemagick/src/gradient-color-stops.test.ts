import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ["2x1", "gradient:#123456789abc-#abcdef012345", "123456789abcabcdef012345"],
        ["2x1", "gradient:#121256569a9a-#ababeeee2323", "121256569a9aababeeee2323"],
        ["1x5", "gradient:black-white", "000000000000400040004000800080008000bfffbfffbfffffffffffffff"],
        ["3x1", "radial-gradient:#123456789abc-#abcdef012345", "abcdef012345123456789abcabcdef012345"]
    ])(`${mode}: preserves color stops in %s %s`, async (size, input, expected) => {
        const args = ["-size", size, input, "-depth", "16", "-endian", "MSB", "rgb:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const files = new Map<string, Uint8Array>();
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
