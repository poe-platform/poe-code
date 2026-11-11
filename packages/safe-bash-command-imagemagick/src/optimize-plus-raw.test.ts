import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI, without a GIF encoder.
for (const mode of ["buffered", "sync", "retained", "command"] as const)
it.each([
    { inputs: ["xc:red", "xc:red"], layers: ["-layers", "OptimizePlus"], output: ["-depth", "8", "rgba:-"], expected: "ff0000ffffffff00" },
    { inputs: ["xc:red", "xc:red", "xc:red"], layers: ["-layers", "OptimizePlus"], output: ["-depth", "8", "rgba:-"], expected: "ff0000ffffffff00" },
    { inputs: ["xc:red", "xc:lime"], layers: ["-layers", "OptimizePlus"], output: ["-depth", "8", "rgba:-"], expected: "ff0000ff00ff00ff" },
    { inputs: ["xc:red", "xc:red"], layers: [], output: ["-depth", "8", "rgba:-"], expected: "ff0000ffff0000ff" },
    { inputs: ["xc:red", "xc:red", "xc:blue"], layers: ["-layers", "OptimizePlus"], output: ["-format", "%[pixel:p{0,0}];", "info:"], expected: "srgb(255,0,0);srgba(0,0,0,0);srgb(0,0,255);" },
])(`${mode} emits OptimizePlus pause before encoding: %j`, async ({ inputs, layers, output, expected }) => {
    const args = [...inputs, ...layers, ...output];
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes); } }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const info = output.at(-1) === "info:";
    const actual = info && "stdout" in result ? result.stdout
        : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks)).toString(info ? "utf8" : "hex");
    if (info) {
        const pixels = String(actual).split(";");
        expect(pixels[0]).toBe("srgb(255,0,0)");
        expect(pixels[1]?.startsWith("srgba(")).toBe(true);
        expect(pixels[1]?.endsWith(",0)")).toBe(true);
        expect(pixels.slice(2)).toEqual(["srgb(0,0,255)", ""]);
    } else expect(actual).toBe(expected);
});
