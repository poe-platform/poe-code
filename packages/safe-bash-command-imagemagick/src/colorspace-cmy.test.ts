import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results.
const cases = [
    { name: "CMY palette order", args: ["xc:red", "xc:blue", "xc:red", "+append", "-colorspace", "CMY", "-unique-colors", "-colorspace", "sRGB", "-depth", "8", "rgb:out"], hex: "0000ffff0000" },
    { name: "CMYK control", args: ["xc:red", "xc:blue", "xc:red", "+append", "-colorspace", "CMYK", "-unique-colors", "-colorspace", "sRGB", "-depth", "8", "rgb:out"], hex: "0000ffff0000" },
    { name: "alpha round trip", args: ["xc:#ff000080", "-colorspace", "cMy", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "ff000080" },
    { name: "three channels and alpha", args: ["xc:#ff000080", "-colorspace", "CMY", "-format", "%[colorspace]|%[channels]", "info:out"], text: "CMY|cmya 4.0" },
    { name: "working pixel values", args: ["xc:#ff000080", "-colorspace", "CMY", "-format", "%[pixel:p{0,0}]", "info:out"], text: "cmya(0,255,255,0.501961)" },
    { name: "repeated conversion", args: ["xc:#20406080", "-colorspace", "CMY", "-colorspace", "CMY", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "20406080" },
    ...["R", "G", "B"].map((channel, index) => ({ name: `${channel} separation`, args: ["xc:#ff000080", "-colorspace", "CMY", "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:out"], hex: index === 0 ? "00" : "ff" })),
];
for (const mode of ["command", "sync"]) it.each(cases)(`${mode}: $name`, async ({ args, hex, text }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    let stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = Buffer.from(mode === "sync" ? files.get("out")! : await fs.readFile("/out"));
    expect(output.toString(text === undefined ? "hex" : "utf8")).toBe(text ?? hex);
});
