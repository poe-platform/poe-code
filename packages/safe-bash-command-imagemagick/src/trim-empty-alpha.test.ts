import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alpha of ["Off", "On", undefined])
for (const format of ["rgba", "PNG32", "MIFF", "PAM", "info"])
it(`${mode}: empty trim exports ${format} with alpha ${alpha ?? "default"}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-size", "3x2", "xc:red", ...(alpha ? ["-alpha", alpha] : []),
        "-trim", "-depth", "8", "-format", "%wx%h %g %[fx:a]", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("magick: geometry does not contain image 'red'\n");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // Native ImageMagick 7: one transparent white pixel with the original page.
    if (format === "info") expect(new TextDecoder().decode(output)).toBe("1x1 3x2-1-1 0");
    else {
        const pixels = format === "rgba" ? output : decodeImage(output).data;
        expect([...pixels]).toEqual([255, 255, 255, 0]);
    }
});

// ImageMagick 7.1.2-35 Q16-HDRI recomputes type from the replacement pixel.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [background, type, rgba] of [
    ["white", "Bilevel", "ffffff00"],
    ["#808080", "GrayscaleAlpha", "80808000"],
] as const)
for (const format of ["info", "rgba"])
it(`${mode}: empty Gray trim with ${background} reports native ${format}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-size", "3x2", "xc:#123456", "-colorspace", "Gray",
        "-background", background, "-trim", "-depth", "8",
        "-format", "%wx%h|%g|%[colorspace]|%[channels]|%[type]", `${format}:/out`];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("magick: geometry does not contain image '#123456'\n");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString(format === "info" ? "utf8" : "hex")).toBe(format === "info"
        ? `1x1|3x2-1-1|Gray|graya 2.0|${type}` : rgba);
});
