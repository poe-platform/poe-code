import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: signs and dots after hexadecimal integers start new terms.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["0x1e+1,0,1", "1e3c5a"],
        ["0x1e,+1,0,1", "1e3c5a"],
        ["0xE+1,0,1", "0e1c2a"],
        ["0xE,+1,0,1", "0e1c2a"],
        ["1,0xE-0.5,1", "000000"],
        ["1,0xE,-0.5,1", "000000"],
        ["0,0xe+0.5,1", "182808"],
        ["0,0xe,+0.5,1", "182808"],
        ["+0X1E+1,0,1", "1e3c5a"],
        ["-0xE+1,0,1", "000000"],
        ["0x1d+1,0,1", "1d3a57"],
        ["1e+1,1,0,1", "0a141e"],
    ])(`${mode}: separates signed terms after hexadecimal integers %s`, async (terms, expected) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        const args = ["xc:#010203", "xc:#305010", "-poly", terms, "-depth", "8", "rgb:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });

    it.each([
        ["0x1.8,1", "30547593"],
        ["1,0.8,1", "30547593"],
        ["0x1.8", "30547593"],
        ["0x0.8,1", "00000000"],
        ["0,0.8,1", "00000000"],
        ["+0X1.8,1", "30547593"],
        ["-0x1.8,1", "00000000"],
        ["0x1p-1,1", ""],
        ["0.5,1", "10203040"],
        ["0x1,1", "20406080"],
        ["oops,1", ""],
    ])(`${mode}: parses hexadecimal and decimal terms %s`, async (terms, expected) => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        const args = ["xc:#20406080", "-poly", terms, "-depth", "8", "rgba:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(expected ? 0 : 1);
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
