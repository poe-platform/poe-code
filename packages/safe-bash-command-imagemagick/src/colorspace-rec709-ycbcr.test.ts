import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference values and big-endian raw samples.
const format = "%[colorspace] %[fx:u.r] %[fx:u.g] %[fx:u.b]";
const cases = [
    { name: "red components", args: ["xc:red", "-colorspace", "Rec709YCbCr", "-format", format, "info:/out"], text: "Rec709YCbCr 0.212656 0.385436 1" },
    { name: "blue components", args: ["xc:#0080ff", "-colorspace", "Rec709YCbCr", "-format", format, "info:/out"], text: "Rec709YCbCr 0.431167 0.806538 0.226194" },
    { name: "neutral chroma offset", args: ["xc:white", "-colorspace", "Rec709YCbCr", "-format", format, "info:/out"], text: "Rec709YCbCr 1 0.500008 0.500008" },
    { name: "16-bit round trip", args: ["xc:#0080ff", "-colorspace", "Rec709YCbCr", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgb:/out"], hex: "0000807efffd" },
    { name: "alpha round trip", args: ["xc:#0080ff80", "-colorspace", "Rec709YCbCr", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "0000807efffd8080" },
    { name: "case-insensitive repeated conversion", args: ["xc:#0080ff80", "-colorspace", "rEc709yCbCr", "-colorspace", "Rec709YCbCr", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "rec709ycbcra(109.948,205.667,57.6794,0.501961)" },
    { name: "pixel enumeration", args: ["xc:red", "-colorspace", "Rec709YCbCr", "txt:/out"], contains: "rec709ycbcr(54.2273,98.2861,255)" },
    { name: "histogram", args: ["xc:red", "-colorspace", "Rec709YCbCr", "-format", "%c", "histogram:info:/out"], contains: "rec709ycbcr(54.2273,98.2861,255)" },
    { name: "YCbCr components control", args: ["xc:red", "-colorspace", "YCbCr", "-format", format, "info:/out"], text: "YCbCr 0.298839 0.331263 1" },
    { name: "YCbCr round-trip control", args: ["xc:#0080ff", "-colorspace", "YCbCr", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgb:/out"], hex: "00118091ffff" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`matches native $name (${mode})`, async test => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(test.args, files)
            : await runConvertCli(test.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (test.hex !== undefined) expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
        else if (test.text !== undefined) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else expect(new TextDecoder().decode(bytes)).toContain(test.contains);
    });
}
