import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGB8 output, nine bytes per frame.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const)
it.each([
    ["1x1", "0055ffffffffffff000055ffffffffffff00"],
    ["2x1", "00ffffffffffffff0000ffffffffffffff00"],
    ["%[fx:n]x1", "00ffffffffffffff0000ffffffffffffff00"],
    ["%[fx:t+1]x1", "0055ffffffffffff0000ffffffffffffff00"],
    ["%[fx:u[1].w-1]x1", "00ffffffffffffff0000ffffffffffffff00"],
    ["%[fx:w-1]x1", "00ffffffffffffff0000ffffffffffffff00"],
])(`${mode}: expands emboss list geometry %s`, async (geometry, expected) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["xc:#304050", "xc:#789890", "xc:#987038", "+append",
        "-virtual-pixel", "black", "-duplicate", "1",
        "-emboss", geometry, "-depth", "8", "rgb:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = (mode === "magick" || mode === "convert") ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
