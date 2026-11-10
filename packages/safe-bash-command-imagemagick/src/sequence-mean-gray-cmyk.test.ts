import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 reference pixels from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const reverse of [false, true])
it.each([
    { colorspace: "Gray", expected: "63a28a23" },
    { colorspace: "sRGB", expected: "63a26e23" },
])(`${mode}: Mean combines $colorspace alpha with CMYK (reverse=${reverse})`, async ({ colorspace, expected }) => {
    const inputs = [
        ["(", "xc:#4a4a4a82", "-colorspace", colorspace, ")"],
        ["(", "xc:#297d3846", "-colorspace", "CMYK", ")"],
    ];
    if (reverse) inputs.reverse();
    const argv = [...inputs.flat(), "-evaluate-sequence", "Mean", "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(mode === "command" ? Buffer.concat(stderr).toString() : result.stderr).toBe("");
    expect(output.toString("hex")).toBe(expected);
});
