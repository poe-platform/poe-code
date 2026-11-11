import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: painting changes CMYK inks and alpha together.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const depth of [8, 16])
for (const format of ["cmyka", "rgba"])
it.each([
    { name: "matching opaque", paint: ["-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [255, 255, 0, 0, 128], rgba: [0, 0, 255, 128] },
    { name: "inverted nonmatching opaque", paint: ["+opaque", "green"], cmyka: [255, 255, 0, 0, 128], rgba: [0, 0, 255, 128] },
    { name: "inverted matching opaque", paint: ["+opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [0, 255, 255, 0, 255], rgba: [255, 0, 0, 255] },
    { name: "nonmatching opaque", paint: ["-opaque", "green"], cmyka: [0, 255, 255, 0, 255], rgba: [255, 0, 0, 255] },
    { name: "unpainted control", paint: [], cmyka: [0, 255, 255, 0, 255], rgba: [255, 0, 0, 255] },
    { name: "alpha-only paint preserves inks", paint: ["-channel", "A", "-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [0, 255, 255, 0, 128], rgba: [255, 0, 0, 128] },
    { name: "cyan-only paint preserves other inks", paint: ["-channel", "C", "-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [255, 255, 255, 0, 255], rgba: [0, 0, 0, 255] },
    { name: "black-only paint updates RGB backing", paint: ["-fill", "#00000080", "-channel", "K", "-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [0, 255, 255, 255, 255], rgba: [0, 0, 0, 255] },
    { name: "black fill updates all four inks", paint: ["-fill", "#00000080", "-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [0, 0, 0, 255, 128], rgba: [0, 0, 0, 128] },
    { name: "explicit CMYK fill preserves ink separation", paint: ["-fill", "cmyk(100%,100%,100%,0%)", "-opaque", "cmyk(0%,100%,100%,0%)"], cmyka: [255, 255, 255, 0, 255], rgba: [0, 0, 0, 255] },
])(`${mode}: ${depth}-bit ${format} $name`, async ({ paint, cmyka, rgba }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argv = ["xc:red", "-colorspace", "CMYK", "-fill", "#0000ff80", ...paint,
        ...(format === "rgba" ? ["-colorspace", "sRGB"] : []),
        "-depth", String(depth), "-endian", "MSB", `${format}:-`];
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    const expected = format === "cmyka" ? cmyka : rgba;
    expect([...bytes]).toEqual(depth === 16 ? expected.flatMap(value => [value, value]) : expected);
});
