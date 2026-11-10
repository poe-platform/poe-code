import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, LC_ALL=C, MAGICK_THREAD_LIMIT=1. Exact native RGBA bytes.
for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const)
it.each(["1x2", "1,2", "1/2", "(1x2)"])(`${mode}: matches native emboss geometry %s`, async geometry => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["xc:#305060", "xc:#507080", "xc:#908050", "+append",
        "-emboss", geometry, "-depth", "8", "rgba:-"];
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
    expect(Buffer.from(output).toString("hex")).toBe("55ffffffff0000ff00aaffff");
});
