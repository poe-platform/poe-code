import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: an opaque inline Gray operand has one channel.
for (const mode of ["sync", "map", "retained", "command"] as const)
for (const output of ["rgb:-", "PNG24:-"])
it.each([
    { space: "Gray", operation: "Multiply", expected: "6a0000" },
    { space: "Gray", operation: "Mean", expected: "aa4028" },
    { space: "sRGB", operation: "Multiply", expected: "6a4028" },
    { space: "sRGB", operation: "Mean", expected: "aa8068" },
])(`${mode}, ${output}: $operation with an opaque inline $space operand`, async ({ space, operation, expected }) => {
    const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
    let stderr = "";
    const argv = ["xc:#d48050", "(", "xc:#808080", "-colorspace", space, ")",
        "-evaluate-sequence", operation, "-depth", "8", output];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    const pixel = output === "rgb:-" ? bytes : decodeImage(bytes).data.subarray(0, 3);
    expect(Buffer.from(pixel).toString("hex")).toBe(expected);
});
