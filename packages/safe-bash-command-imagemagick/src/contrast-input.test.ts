import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: contrast needs an image at the operator's position.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const option of ["-contrast", "+contrast"]) {
        it.each([
            ["before input", [option, "xc:#345caa"], false],
            ["deleted input", ["xc:blue", "-delete", "0", option, "xc:#345caa"], false],
            ["empty group", ["xc:blue", "(", option, "xc:#345caa", ")"], false],
            ["after input", ["xc:#345caa", option], true],
        ] as const)(`${mode}: ${option} %s preserves native status, pixels and warnings`, async (_placement, operation, valid) => {
            const fs = new MemoryFileSystem();
            const args = [...operation, "-depth", "8", "rgb:-"];
            const stdout: number[] = [];
            let stderr = "";
            const result = mode === "magick" || mode === "convert" ? {
                ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout.push(...bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }), stdout: "", stdoutBytes: Uint8Array.from(stdout), stderr,
            } : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
            expect.soft(result.exitCode).toBe(valid ? 0 : 1);
            expect.soft(result.stdout).toBe("");
            expect.soft([...(result.stdoutBytes ?? [])]).toEqual(valid
                ? option === "-contrast" ? [0x37, 0x62, 0xb5] : [0x31, 0x56, 0x9f]
                : []);
            expect.soft(result.stderr).toBe(valid
                ? `magick: option has been replaced '${option}', use "${option[0]}level" at CLI arg ${args.indexOf(option) + 1}\n`
                : `magick: no images found for operation '${option}'\n`);
        });
    }
}
