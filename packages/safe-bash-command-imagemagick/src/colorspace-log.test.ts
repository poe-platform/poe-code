import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const cases = [
    { name: "Log metadata", args: ["-colorspace", "Log", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "Log|log  3.0" },
    ...[["R", "547a"], ["G", "7fa5"], ["B", "9534"]].map(([channel, hex]) => ({ name: `Log ${channel} component`, args: ["-colorspace", "Log", "-channel", channel!, "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:/out"], hex })),
    { name: "Log round trip", args: ["-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45458a89bcbcffff" },
    { name: "mixed-case repeated Log conversion", args: ["-colorspace", "lOg", "-colorspace", "LOG", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45458a89bcbcffff" },
    { name: "Log alpha round trip", color: "#458abc80", args: ["-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45458a89bcbc8080" },
    { name: "Log implicit PNG conversion", color: "#458abc80", args: ["-colorspace", "Log", "PNG64:/out"], pixels: "45458a89bcbc8080" },
    { name: "Log black endpoint", color: "black", args: ["-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { name: "Log white endpoint", color: "white", args: ["-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "ffffffffffffffff" },
    { name: "declared Log inverse clamps endpoints", color: "#00ff0080", args: ["-set", "colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "0000ffff00008080" },
    { name: "Log samples survive metadata reassignment", args: ["-colorspace", "Log", "-set", "colorspace", "sRGB", "-set", "colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45458a89bcbcffff" },
    { name: "Log clips above-white input", color: "white", args: ["-evaluate", "Multiply", "2", "-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "ffffffffffffffff" },
    { name: "Log clips negative input", color: "black", args: ["-evaluate", "Subtract", "50%", "-colorspace", "Log", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { name: "Log black pixel format", color: "black", args: ["-colorspace", "Log", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "log(23.6572,23.6572,23.6572)" },
    { name: "Log white text output", color: "white", args: ["-colorspace", "Log", "txt:/out"], contains: "log(170.581,170.581,170.581)" },
    { name: "Log white histogram", color: "white", args: ["-colorspace", "Log", "-format", "%c", "histogram:info:/out"], contains: "log(170.581,170.581,170.581)" },
    { name: "RGB metadata control", args: ["-colorspace", "RGB", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "RGB|rgb  3.0" },
    { name: "RGB round trip control", args: ["-colorspace", "RGB", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45458a8abcbcffff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const args = [`xc:${"color" in test ? test.color : "#458abc"}`, ...test.args];
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" }) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const bytes = (mode === "command" || mode === "retained") ? await fs.readFile("/out") : files.get("/out")!;
        if ("text" in test) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else if ("contains" in test) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else if ("pixels" in test) expect(Array.from(decodeImage(bytes).data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        else expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
    });
}
