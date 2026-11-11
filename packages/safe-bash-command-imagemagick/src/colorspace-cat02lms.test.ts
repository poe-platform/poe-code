import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input: Uint8Array = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI reference bytes: red, muted green, blue.
const channelCases = [
    { name: "L channel", options: ["-colorspace", "CAT02LMS", "-channel", "R", "-separate"], hex: "6969691818182e2e2e" },
    { name: "M channel", options: ["-colorspace", "CAT02LMS", "-channel", "G", "-separate"], hex: "363636292929121212" },
    { name: "S channel", options: ["-colorspace", "CAT02LMS", "-channel", "B", "-separate"], hex: "050505131313f2f2f2" },
    { name: "sRGB round trip", options: ["-colorspace", "CAT02LMS", "-colorspace", "sRGB"], hex: "ff00002080400000ff" },
    { name: "repeated case-insensitive conversion", options: ["-colorspace", "cat02lms", "-colorspace", "CaT02LmS", "-channel", "R", "-separate"], hex: "6969691818182e2e2e" },
    { name: "sRGB control", options: ["-colorspace", "sRGB", "-channel", "R", "-separate"], hex: "ffffff202020000000" },
];

const cases = [
    ...channelCases.map(test => ({ name: test.name, args: ["/in.ppm", ...test.options, "-depth", "8", "rgb:/out"], hex: test.hex })),
    { name: "alpha round trip", args: ["xc:#20804080", "-colorspace", "CAT02LMS", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "20804080" },
    { name: "metadata", args: ["xc:red", "-colorspace", "CAT02LMS", "-format", "%[colorspace]|%[channels]", "info:/out"], text: "CAT02LMS|cat02lms  3.0" },
    { name: "pixel formatting", args: ["xc:red", "-colorspace", "CAT02LMS", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "cat02lms(105.161,54.2095,4.92079)" },
    { name: "pixel enumeration", args: ["xc:red", "-colorspace", "CAT02LMS", "txt:/out"], contains: "cat02lms(105.161,54.2095,4.92079)" },
    { name: "histogram", args: ["xc:red", "-colorspace", "CAT02LMS", "-format", "%c", "histogram:info:/out"], contains: "cat02lms(105.161,54.2095,4.92079)" },
    { name: "PNG output", args: ["/in.ppm", "-colorspace", "CAT02LMS", "PNG32:/out"], hex: "ff0000ff208040ff0000ffff", png: true },
    { name: "declared colorspace", args: ["/in.ppm", "-colorspace", "CAT02LMS", "-set", "colorspace", "sRGB", "-set", "colorspace", "CAT02LMS", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
    it.each(cases)(`matches native CAT02LMS $name (${mode})`, async test => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = test.args;
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (test.hex !== undefined) expect(Buffer.from("png" in test && test.png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(test.hex);
        else if (test.text !== undefined) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else expect(new TextDecoder().decode(bytes)).toContain(test.contains);
    });
}
