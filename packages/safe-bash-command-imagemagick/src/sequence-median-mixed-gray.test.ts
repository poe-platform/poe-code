import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const)
for (const depth of [8, 16])
it.each([
    { name: "GrayAlpha before sRGB", inputs: ["(", "xc:#4a4a4a82", "-colorspace", "Gray", ")", "xc:#297d3846"] },
    { name: "GrayAlpha after sRGB", inputs: ["xc:#297d3846", "(", "xc:#4a4a4a82", "-colorspace", "Gray", ")"] },
    { name: "sRGB control", inputs: ["xc:#4a4a4a82", "xc:#297d3846"] },
])(`${mode}, ${depth}-bit: ranks Median using output channels ($name)`, async ({ inputs }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI counts gray in each output RGB channel.
    const argv = [...inputs, "-evaluate-sequence", "Median", "-depth", String(depth), "-endian", "MSB", "rgba:-"];
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const args = createCommandArguments(argv);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout.push(chunk); } },
            stderr: { async write(chunk) { stderr.push(chunk); } },
        })
        : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    expect(output.toString("hex")).toBe(depth === 8 ? "4a4a4a82" : "4a4a4a4a4a4a8282");
});
