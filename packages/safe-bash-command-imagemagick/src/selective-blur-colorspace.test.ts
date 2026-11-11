import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const [space, blurred] of [
    ["Lab", "536d75ff6f827cff"],
    ["HSL", "4f7b7aff6c8a77ff"],
    ["sRGB", "526d74ff6e837cff"]
] as const)
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    ["100%", blurred],
    ["0", "406070ff809080ff"],
    [undefined, "406070ff809080ff"]
])(`preserves ${space} selective blur on conversion to sRGB (${mode}, threshold=%s)`, async (threshold, expected) => {
    const args = ["xc:#406070", "xc:#809080", "+append", "-colorspace", space,
        ...(threshold === undefined ? [] : ["-selective-blur", `1x1+${threshold}`]),
        "-colorspace", "sRGB", "-depth", "8", "rgba:-"];
    let output: Uint8Array;
    if (mode === "command") {
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {},
            fs: new MemoryFileSystem(), signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(typeof bytes === "string" ? Buffer.from(bytes) : bytes); } },
            stderr: { async write(bytes) { stderr.push(typeof bytes === "string" ? Buffer.from(bytes) : bytes); } }
        });
        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(stderr).toString()).toBe("");
        output = Buffer.concat(stdout);
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, new Map()) : await runMagickCli(args, new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        output = result.stdoutBytes ?? new Uint8Array();
    }
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
