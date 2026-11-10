import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, with little-endian raw samples.
const cases = [
    { options: ["-colorspace", "Oklch", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "oklcha(0.488939,0.0864923,68.3162,0.376471)" },
    { options: ["-colorspace", "oKlCh", "-colorspace", "OKLCH", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "8b516e60" },
    { options: ["-colorspace", "Oklch", "PNG32:/out"], hex: "80562360", png: true },
    { options: ["-colorspace", "Oklch", "-format", "%[colorspace]", "info:/out"], text: "Oklch" },
    { options: ["-colorspace", "Oklch", "-channel", "R", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "2b7d" },
    { options: ["-colorspace", "Oklch", "-channel", "G", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "2416" },
    { options: ["-colorspace", "Oklch", "-channel", "B", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "ffff" },
    { options: ["-colorspace", "Oklch", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "80562360" },
    { options: ["-colorspace", "Oklch", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "8b516e60" },
    { options: ["-colorspace", "Lab", "-channel", "R", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "e266" },
    { options: ["-colorspace", "Lab", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "2c99ce60" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native Oklch working pixels and Lab controls (${mode}): $options`, async ({ options, text, hex, png }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["xc:#80562360", ...options];
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
        else expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(hex);
    });
}
