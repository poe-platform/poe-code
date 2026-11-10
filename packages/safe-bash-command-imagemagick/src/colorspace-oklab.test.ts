import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs, little-endian raw samples.
const cases = [
    { space: "Oklab", args: ["-format", "%[colorspace]", "info:/out"], hex: "4f6b6c6162" },
    { space: "Oklab", args: ["-channel", "R", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "2b7d" },
    { space: "Oklab", args: ["-channel", "G", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "2e88" },
    { space: "Oklab", args: ["-channel", "B", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "9394" },
    { space: "Oklab", args: ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "80562360" },
    { space: "Oklab", args: ["-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "3b6a9660" },
    { space: "Oklab", args: ["PNG32:/out"], hex: "80562360", png: true },
    { space: "Oklab", args: ["-channel", "RGB", "-solarize", "40%", "+channel", "PNG32:/out"], hex: "3b6a9660", png: true },
    { space: "oKlAb", args: ["-colorspace", "OKLAB", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "3b6a9660" },
    { space: "Oklab", args: ["-set", "colorspace", "sRGB", "-set", "colorspace", "Oklab", "-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "3b6a9660" },
    { space: "Lab", args: ["-channel", "R", "-separate", "+channel", "-depth", "16", "gray:/out"], hex: "e266" },
    { space: "Lab", args: ["-channel", "RGB", "-solarize", "40%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "2c99ce60" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native $space working pixels (${mode}): $args`, async ({ space, args: operations, hex, png }) => {
        const args = ["xc:#80562360", "-colorspace", space, ...operations];
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
        expect(Buffer.from(png ? decodeImage(output).data : output).toString("hex")).toBe(hex);
    });
}
