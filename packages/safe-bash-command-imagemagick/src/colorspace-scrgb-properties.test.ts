import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves scRGB as a distinct linear colorspace.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { options: ["-colorspace", "scRGB"], expected: "scRGB|DirectClass scRGB " },
    { options: ["-quantize", "scRGB", "-colors", "4"], expected: "scRGB|PseudoClass scRGB " },
    { options: ["-colorspace", "ScRgB", "-colorspace", "scRGB"], expected: "scRGB|DirectClass scRGB " },
    { options: ["-colorspace", "RGB", "-colorspace", "scRGB"], expected: "scRGB|DirectClass scRGB " },
    { options: ["-colorspace", "scRGB", "-colorspace", "RGB"], expected: "RGB|DirectClass RGB " },
    { options: ["-colorspace", "scRGB", "-colorspace", "sRGB"], expected: "sRGB|DirectClass sRGB " },
    { options: ["-set", "colorspace", "scRGB"], expected: "scRGB|DirectClass scRGB " },
    { options: ["-colorspace", "RGB"], expected: "RGB|DirectClass RGB " },
    { options: ["-quantize", "RGB", "-colors", "4"], expected: "RGB|PseudoClass RGB " },
    { options: ["-colorspace", "LinearGray", "-colorspace", "scRGB"], expected: "scRGB|DirectClass scRGB " },
])(`${mode}: reports colorspace after $options`, async ({ options, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#123456", ...options, "-format", "%[colorspace]|%r", "info:"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
});

for (const mode of ["buffered", "retained"] as const)
it.each([
    ["-resize", "7x3!"],
    ["-posterize", "4"],
    ["-white-threshold", "40%"],
    ["-threshold", "40%"],
    ["-bilateral-blur", "1x1"],
    ["-selective-blur", "1x1+10%"],
    ["-shade", "30x30"],
    ["-charcoal", "1x1"],
    ["-sort-pixels"],
    ["-evaluate-sequence", "mean"],
    ["-poly", "1,1"],
    ["-combine"],
    ["-colors", "4"],
])(`${mode}: preserves linear samples through %j`, async (...operation) => {
    const outputs: Uint8Array[] = [];
    for (const space of ["RGB", "scRGB"]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["-size", "3x3", "gradient:#123456-#abcdef", "-colorspace", space,
            ...operation, "-colorspace", "sRGB", "-depth", "16", "rgb:/out"],
        mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        outputs.push(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
    }
    expect(outputs[1]).toEqual(outputs[0]);
});

for (const mode of ["buffered", "retained"] as const)
it.each([
    { output: "info:", options: ["-format", "%[pixel:p{0,0}]"], expected: "scrgb(0.604883%,3.43398%,9.3059%)" },
    { output: "txt:", options: [], expected: "scrgb(0.604883%,3.43398%,9.3059%)" },
    { output: "histogram:info:", options: ["-format", "%c"], expected: "scrgb(0.604883%,3.43398%,9.3059%)" },
])(`${mode}: names linear pixels in $output`, async ({ output, options, expected }) => {
    const result = await runConvertCli(["xc:#123456", "-colorspace", "scRGB", ...options, output],
        mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(expected);
});
