import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output; raw samples use explicit MSB order.
const cases = [
    { args: ["xc:#458abc", "-colorspace", "LCH", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCH|lch  3.0|lch(55.1466,33.1886,259.173)" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "8d2c" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-channel", "G", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "a151" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-channel", "B", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "b84c" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc80", "-colorspace", "lch", "-colorspace", "LCH", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCH|lcha 4.0|lcha(55.1466,33.1886,259.173,0.501961)" },
    { args: ["xc:#458abc80", "-colorspace", "LCH", "-channel", "G", "-evaluate", "multiply", "0.75", "+channel", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "8bf0835778bd8080" },
    { args: ["xc:blue", "-colorspace", "LCH", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "00250002fffeffff" },
    { args: ["xc:black", "-colorspace", "LCH", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-format", "%[pixel:p{0,0}]", "txt:/out"], text: "# ImageMagick pixel enumeration: 1,1,0,65535,lch\n0,0: (36140,41297,47180)  #8D2CA151B84C  lch(55.1466,33.1886,259.173)\n" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-format", "%c", "histogram:info:/out"], contains: "lch(55.1466,33.1886,259.173)" },
    { args: ["xc:#458abc", "-colorspace", "LCH", "PNG32:/out"], hex: "458abcff", png: true },
    { args: ["xc:#458abc", "-colorspace", "LCH", "-set", "colorspace", "sRGB", "-set", "colorspace", "LCH", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCHab|lchab  3.0|lchab(55.1466,33.1886,259.173)" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "8d2c" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-channel", "G", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "a151" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-channel", "B", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "b84c" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc80", "-colorspace", "lchab", "-colorspace", "LCHAB", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCHab|lchaba 4.0|lchaba(55.1466,33.1886,259.173,0.501961)" },
    { args: ["xc:#458abc80", "-colorspace", "LCHab", "-channel", "G", "-evaluate", "multiply", "0.75", "+channel", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "8bf0835778bd8080" },
    { args: ["xc:blue", "-colorspace", "LCHab", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "00250002fffeffff" },
    { args: ["xc:black", "-colorspace", "LCHab", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-format", "%[pixel:p{0,0}]", "txt:/out"], text: "# ImageMagick pixel enumeration: 1,1,0,65535,lchab\n0,0: (36140,41297,47180)  #8D2CA151B84C  lchab(55.1466,33.1886,259.173)\n" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-format", "%c", "histogram:info:/out"], contains: "lchab(55.1466,33.1886,259.173)" },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "PNG32:/out"], hex: "458abcff", png: true },
    { args: ["xc:#458abc", "-colorspace", "LCHab", "-set", "colorspace", "sRGB", "-set", "colorspace", "LCHab", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCHuv|lchuv  3.0|lchuv(55.1466,56.6343,240.343)" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "8d2c" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-channel", "G", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "b8db" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-channel", "B", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "aae8" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc80", "-colorspace", "lchuv", "-colorspace", "LCHUV", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "LCHuv|lchuva 4.0|lchuva(55.1466,56.6343,240.343,0.501961)" },
    { args: ["xc:#458abc80", "-colorspace", "LCHuv", "-channel", "G", "-evaluate", "multiply", "0.75", "+channel", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "7ccb85868fba8080" },
    { args: ["xc:blue", "-colorspace", "LCHuv", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "00250002fffeffff" },
    { args: ["xc:black", "-colorspace", "LCHuv", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-format", "%[pixel:p{0,0}]", "txt:/out"], text: "# ImageMagick pixel enumeration: 1,1,0,65535,lchuv\n0,0: (36140,47323,43752)  #8D2CB8DBAAE8  lchuv(55.1466,56.6343,240.343)\n" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-format", "%c", "histogram:info:/out"], contains: "lchuv(55.1466,56.6343,240.343)" },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "PNG32:/out"], hex: "458abcff", png: true },
    { args: ["xc:#458abc", "-colorspace", "LCHuv", "-set", "colorspace", "sRGB", "-set", "colorspace", "LCHuv", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { args: ["xc:#458abc", "-colorspace", "Lab", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "CIELab|cielab  3.0" },
    { args: ["xc:#458abc", "-colorspace", "Luv", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "Luv|luv  3.0" },
    { args: ["xc:#458abc", "-colorspace", "Luv", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native LCH working pixels and Lab/Luv controls (${mode}): $args`, async ({ args, text, hex, png, contains }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (text !== undefined) expect(new TextDecoder().decode(output)).toBe(text);
        else if (contains !== undefined) expect(new TextDecoder().decode(output)).toContain(contains);
        else expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(hex);
    });
}
