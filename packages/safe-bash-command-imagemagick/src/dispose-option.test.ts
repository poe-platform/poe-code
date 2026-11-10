import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        { inputs: ["-dispose", "pReViOuS", "xc:red", "xc:blue"], expected: "Previous|pReViOuS|pReViOuS;Previous|pReViOuS|pReViOuS;" },
        { inputs: ["-dispose", "2", "xc:red", "xc:blue"], expected: "Background|2|2;Background|2|2;" },
        { inputs: ["-dispose", "Previous", "xc:red", "-dispose", "None", "xc:blue"], expected: "Previous|None|None;None|None|None;" },
        { inputs: ["-dispose", "Previous", "xc:red", "+dispose", "xc:blue"], expected: "Previous|undefined|undefined;Undefined|undefined|undefined;" },
        { inputs: ["xc:red", "xc:blue", "-dispose", "Previous"], expected: "Undefined|Previous|Previous;Undefined|Previous|Previous;" },
        { inputs: ["xc:red", "xc:blue", "-set", "dispose", "Previous"], expected: "Previous||;Previous||;" },
        { inputs: ["xc:red", "xc:blue"], expected: "Undefined||;Undefined||;" }
    ])(`${mode}: active disposal option for $inputs`, async ({ inputs, expected }) => {
        const args = [...inputs, "-format", "%D|%[dispose]|%[option:dispose];", "info:-"];
        let stdout = "";
        const result = mode === "sync" ? runMagickCliSync(args, new Map())
            : mode === "buffered" ? await runMagickCli(args, new Map())
            : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });

    it(`${mode}: preserves per-frame GIF disposal`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-dispose", "Previous", "xc:red", "-dispose", "None", "xc:blue", "/out.gif"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
            : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
        expect([0, 1].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual([3, 1]);
    });
}
