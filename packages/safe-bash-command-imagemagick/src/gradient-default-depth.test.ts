import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { input: "gradient:#123456789abc-#abcdef012345", depth: undefined, hex: "123456789abcabcdef012345" },
        { input: "gradient:#123456789abc-#abcdef012345", depth: "8", hex: "12569aabee23" },
        { input: "xc:#123456789abc", depth: undefined, hex: "123456789abc123456789abc" }
    ])(`${mode}: uses native PAM sample depth for $input at depth $depth`, async ({ input, depth, hex }) => {
        const argv = ["-size", "2x1", ...(depth ? ["-depth", depth] : []), input, "out.pam"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? await fs.readFile("/out.pam") : files.get("out.pam")!;
        const header = new TextEncoder().encode(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH 3\nMAXVAL ${depth === "8" ? 255 : 65535}\nTUPLTYPE RGB\nENDHDR\n`);
        expect(bytes.slice(0, header.length)).toEqual(header);
        expect(Buffer.from(bytes.slice(header.length)).toString("hex")).toBe(hex);
    });
    it.each([undefined, "16"])(`${mode}: reports native gradient depth with -depth %s`, async depth => {
        const argv = ["-size", depth ? "2x1" : "3x1", ...(depth ? ["-depth", depth] : []),
            depth ? "gradient:#123456789abc-#abcdef012345" : "gradient:black-white", "-format", "%z", "info:-"];
        const args = createCommandArguments(argv);
        let stdout = "";
        const result = mode === "sync" ? runMagickCliSync(argv, new Map())
            : mode === "buffered" ? await runMagickCli(argv, new Map())
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        expect(mode === "command" ? stdout : "stdout" in result ? result.stdout : undefined).toBe("16");
    });
}
