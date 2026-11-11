import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGB8 output, nine bytes per frame.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const)
it.each([
    ["100x30", "49687de5bb92a692bb49687de5bb92a692bb"],
    ["100x60", "5a809affe6b3cdb3e65a809affe6b3cdb3e6"],
    ["100x%[fx:30*n]", "5a809affe6b3cdb3e65a809affe6b3cdb3e6"],
    ["100x%[fx:30*(t+1)]", "49687de5bb92a692bb5a809affe6b3cdb3e6"],
    ["100x%[fx:20*u[1].w]", "5a809affe6b3cdb3e65a809affe6b3cdb3e6"],
    ["100x%[fx:20*w]", "5a809affe6b3cdb3e65a809affe6b3cdb3e6"],
])(`${mode}: expands local-contrast list geometry %s`, async (geometry, expected) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["xc:#385060", "xc:#b09070", "xc:#807090", "+append",
        "-colorspace", "sRGB", "-virtual-pixel", "edge", "-duplicate", "1",
        "-local-contrast", geometry, "-depth", "8", "rgb:-"];
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
