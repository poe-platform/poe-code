import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference text and complete raw output bytes.
const cases = [
    { name: "xyY metadata", args: ["xc:#458abc", "-colorspace", "xyY", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "xyY|xyy  3.0" },
    ...[["R", "37c7"], ["G", "3e6a"], ["B", "3b10"]].map(([channel, hex]) => ({
        name: `xyY ${channel} channel`, args: ["xc:#458abc", "-colorspace", "xyY", "-channel", channel!, "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex,
    })),
    { name: "xyY round trip", args: ["xc:#458abc", "-colorspace", "xyY", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { name: "xyY implicit RGBA conversion", args: ["xc:#458abc", "-colorspace", "xyY", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
    { name: "xyY alpha and repeated mixed-case conversion", args: ["xc:#458abc80", "-colorspace", "xYy", "-colorspace", "xyY", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbb8080" },
    { name: "xyY black components", args: ["xc:black", "-colorspace", "xyY", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0 0 0" },
    { name: "xyY black round trip", args: ["xc:black", "-colorspace", "xyY", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { name: "xyY implicit PNG conversion", args: ["xc:#458abc80", "-colorspace", "xyY", "PNG64:/out"], pixels: "45498a8abcbb8080" },
    { name: "xyY black pixel reporting", args: ["xc:black", "-colorspace", "xyY", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "xyy(0,0,0)" },
    { name: "xyY black pixel enumeration", args: ["xc:black", "-colorspace", "xyY", "txt:/out"], contains: "xyy(0,0,0)" },
    { name: "xyY black histogram", args: ["xc:black", "-colorspace", "xyY", "-format", "%c", "histogram:info:/out"], contains: "xyy(0,0,0)" },
    { name: "xyY metadata assignment", args: ["xc:#458abc", "-set", "colorspace", "xyY", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "xyY|xyy  3.0" },
    { name: "XYZ metadata control", args: ["xc:#458abc", "-colorspace", "XYZ", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "XYZ|xyz  3.0" },
    { name: "XYZ round trip control", args: ["xc:#458abc", "-colorspace", "XYZ", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbbffff" },
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(test.args, files) : mode === "buffered" ? await runConvertCli(test.args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const bytes = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        if ("text" in test) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else if ("contains" in test) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else if ("pixels" in test) {
            const output = decodeImage(bytes);
            expect(output.data16).toBeDefined();
            expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        } else expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
    });
}
