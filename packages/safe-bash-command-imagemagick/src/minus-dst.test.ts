import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, compared as separate 16-bit RGBA channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "MinusDst composite", inputs: ["xc:#b02050", "xc:#3090c0"],
            compose: "MinusDst", operation: ["-composite"], expected: [0, 0x7070, 0x7070, 0xffff] },
        { name: "MinusDst flatten", inputs: ["-background", "#b02050", "xc:#3090c0"],
            compose: "MinusDst", operation: ["-layers", "flatten"], expected: [0, 0x7070, 0x7070, 0xffff] },
        { name: "MinusDst translucent merge", inputs: ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482"],
            compose: "MinusDst", operation: ["-layers", "merge"], expected: [0x2ba7, 0x572a, 0x9892, 0xd126] },
        { name: "Minus alias", inputs: ["xc:#b02050", "xc:#3090c0"],
            compose: "Minus", operation: ["-composite"], expected: [0, 0x7070, 0x7070, 0xffff] },
        { name: "Minus alias translucent merge", inputs: ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482"],
            compose: "Minus", operation: ["-layers", "merge"], expected: [0x2ba7, 0x572a, 0x9892, 0xd126] },
        { name: "MinusSrc opposite direction", inputs: ["xc:#b02050", "xc:#3090c0"],
            compose: "MinusSrc", operation: ["-composite"], expected: [0x8080, 0, 0, 0xffff] },
    ])(`${mode}: $name`, async ({ inputs, compose, operation, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = [...inputs, "-compose", compose, ...operation, "-depth", "16", "-endian", "MSB", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
        expect(output).toHaveLength(8);
        expect([0, 2, 4, 6].map(offset => output.readUInt16BE(offset))).toEqual(expected);
    });
}
