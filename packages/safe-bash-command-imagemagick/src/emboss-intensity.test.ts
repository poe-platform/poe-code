import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI, raw RGBA8.
const cases = [
    { space: "sRGB", method: "Rec709Luma", channel: undefined, hex: "ff0000000000ff0000ff00ff" },
    { space: "sRGB", method: "Average", channel: undefined, hex: "ff0000800080ff80008000ff" },
    { space: "sRGB", method: "Brightness", channel: undefined, hex: "ff0000000000ff00005500ff" },
    { space: "sRGB", method: "RMS", channel: undefined, hex: "ff0000000055ff00005500ff" },
    { space: "sRGB", method: "Lightness", channel: undefined, hex: "ff0000000080ff00008000ff" },
    { space: "sRGB", method: "Rec709Luminance", channel: undefined, hex: "ff0000000055ff00005500ff" },
    { space: "LinearGray", method: "Rec709Luma", channel: undefined, hex: "0000000000000000bcbcbcff" },
    { space: "LinearGray", method: "Average", channel: undefined, hex: "00000080bcbcbc80ffffffff" },
    { space: "LinearGray", method: "Brightness", channel: undefined, hex: "00000080bcbcbc80ffffffff" },
    { space: "LinearGray", method: "RMS", channel: undefined, hex: "000000559c9c9c55d5d5d5ff" },
    { space: "LinearGray", method: "Lightness", channel: undefined, hex: "00000080bcbcbc80ffffffff" },
    { space: "LinearGray", method: "Rec709Luminance", channel: undefined, hex: "00000080bcbcbc80ffffffff" },
    { space: "RGB", method: "Rec709Luma", channel: undefined, hex: "ff0000ff0000ffff00ff00ff" },
    { space: "RGB", method: "Average", channel: undefined, hex: "ff0000800000ff8000bc00ff" },
    { space: "RGB", method: "Brightness", channel: undefined, hex: "ff0000000000ff00009c00ff" },
    { space: "RGB", method: "RMS", channel: undefined, hex: "ff0000000000ff00009c00ff" },
    { space: "RGB", method: "Lightness", channel: undefined, hex: "ff0000800000ff8000bc00ff" },
    { space: "RGB", method: "Rec709Luminance", channel: undefined, hex: "ff0000800000ff8000ff00ff" },
    { space: "sRGB", method: "Average", channel: "R", hex: "ff4039808094dfa000c037f0" },
    { space: "sRGB", method: "Rec709Luma", channel: "R", hex: "ff4039808094dfa000c037f0" },
];

for (const mode of ["magick", "convert", "buffered", "retained", "sync"] as const)
it.each(cases)(`${mode}: equalizes emboss using $method in $space with channel=$channel`, async ({ space, method, channel, hex }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:#a2403980", "xc:#4094dfa0", "xc:#15c037f0", "+append", "-colorspace", space, "-intensity", method,
        ...(channel ? ["-channel", channel] : []), "-emboss", "2x1",
        "+channel", "-colorspace", "sRGB", "-depth", "8", mode === "magick" || mode === "convert" ? "rgba:-" : "rgba:/out.raw"];
    let stdout = "", stderr = "";
    const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }), stderr } : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = mode === "magick" || mode === "convert" ? stdout
        : Buffer.from(mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw")).toString("hex");
    expect(output).toBe(hex);
});
