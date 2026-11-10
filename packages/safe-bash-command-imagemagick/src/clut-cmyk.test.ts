import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const output of ["info", "rgb"] as const)
it.each([
    { sourceSpace: "CMYK", tableSpace: "sRGB", expected: "d9bae8c0ad92c01c68" },
    { sourceSpace: "sRGB", tableSpace: "CMYK", expected: "b03f55d4b26af90040" },
    { sourceSpace: "sRGB", tableSpace: "sRGB", expected: "45ae8814437805eb98" },
])(`${mode}: maps $sourceSpace through $tableSpace CLUT to ${output}`, async ({ sourceSpace, tableSpace, expected }) => {
    const files = new Map([
        ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
        ["/lut.ppm", Buffer.from("P3\n3 2\n255\n63 235 23 128 71 255 6 194 25\n59 29 100 99 3 49 5 227 147\n")],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["(", "/a.ppm", "-colorspace", sourceSpace, ")", "(", "/lut.ppm", "-colorspace", tableSpace, ")", "-clut",
        ...(output === "info" ? ["-format", "%[colorspace]/%[channels]", "info:/out"]
            : ["-colorspace", "sRGB", "-endian", "MSB", "-depth", "8", "rgb:/out"])];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"))
        .toBe(output === "info" ? sourceSpace === "CMYK" ? "CMYK/cmyk  4.0" : "sRGB/srgb  3.0" : expected);
});

for (const retained of [false, true])
it.each([
    { channels: [], expected: "20408040" },
    { channels: ["-channel", "K"], expected: "2b558080" },
    { channels: ["-channel", "A"], expected: "4080c040" },
    { channels: ["-channel", "C"], expected: "3080c080" },
])(`retained=${retained}: maps CMYK inks independently of alpha: $channels`, async ({ channels, expected }) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["(", "xc:rgba(64,128,192,0.5)", "-colorspace", "CMYK", ")",
        "(", "xc:rgba(32,64,128,0.25)", "-colorspace", "CMYK", ")", ...channels, "-clut", "+channel",
        "-colorspace", "sRGB", "-endian", "MSB", "-depth", "8", "rgba:/out"];
    expect(await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Buffer.from(retained ? await filesystem.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
});
