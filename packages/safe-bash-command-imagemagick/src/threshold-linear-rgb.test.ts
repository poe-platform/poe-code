import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: threshold relabels linear samples as sRGB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { space: "RGB", operation: ["-threshold", "20%"], pixels: "000000ff", metadata: "sRGB" },
        { space: "scRGB", operation: ["-threshold", "20%"], pixels: "000000ff", metadata: "sRGB" },
        { space: "sRGB", operation: ["-threshold", "20%"], pixels: "ffffffff", metadata: "sRGB" },
        { space: "RGB", operation: ["-intensity", "Rec709Luminance", "-threshold", "2%"], pixels: "000000ff", metadata: "sRGB" },
        { space: "RGB", operation: ["-intensity", "Average", "-threshold", "2%"], pixels: "ffffffff", metadata: "sRGB" },
        { space: "RGB", operation: ["-channel", "R", "-threshold", "2%"], pixels: "ff1019ff", metadata: "sRGB" },
        { space: "RGB", operation: ["-auto-threshold", "Otsu"], pixels: "000000ff000000ff000000ff", metadata: "sRGB 26.2745%" },
        { space: "sRGB", operation: ["-auto-threshold", "Otsu"], pixels: "ffffffffffffffffffffffff", metadata: "sRGB 26.2745%" },
        { space: "RGB", operation: ["-auto-threshold", "Triangle"], pixels: "ffffffffffffffffffffffff", metadata: "sRGB 0%" },
    ])(`${mode}: $space $operation uses native samples`, async ({ space, operation, pixels, metadata }) => {
        const automatic = operation[0] === "-auto-threshold";
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#344658", ...(automatic ? ["xc:#344859", "xc:#34475a", "+append"] : []),
            "-colorspace", space, ...operation,
            "-format", `%[colorspace]${automatic ? " %[auto-threshold:threshold]" : ""}`, "-write", "info:/metadata",
            "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const info = mode === "command" || mode === "retained" ? await fs.readFile("/metadata") : files.get("/metadata")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixels);
        expect(new TextDecoder().decode(info)).toBe(metadata);
    });
}
