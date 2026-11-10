import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI outputs, with explicit little-endian 16-bit encoding.
const cases = [
    { name: "metadata", args: ["-colorspace", "LinearGray", "-format", "%[colorspace]", "info:out"], hex: "4c696e65617247726179" },
    { name: "16-bit channel", args: ["-colorspace", "LinearGray", "-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "LSB", "gray:out"], hex: "191d" },
    { name: "sRGB conversion", args: ["-colorspace", "LinearGray", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5f5f5f60" },
    { name: "solarize", args: ["-colorspace", "LinearGray", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "1d1d1d60" },
    { name: "linear RGB input", args: ["-colorspace", "RGB", "-colorspace", "LinearGray", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5f5f5f60" },
    { name: "repeated conversion", args: ["-colorspace", "LinearGray", "-colorspace", "lineargray", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5f5f5f60" },
    { name: "nonlinear Gray input", args: ["-colorspace", "Gray", "-colorspace", "LinearGray", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5b5b5b60" },
    { name: "luminance control", args: ["-grayscale", "Rec709Luminance", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5f5f5f60" },
    { name: "Gray control", args: ["-colorspace", "Gray", "-channel", "RGB", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "5b5b5b60" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: LinearGray $name matches native output`, async ({ args, hex }) => {
        const argv = ["xc:#80562360", ...args];
        const files = new Map<string, Uint8Array>([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        let stderr = "";
        const parsed = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: parsed.args, argumentValues: parsed, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
