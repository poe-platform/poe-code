import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: red, muted green and blue PPM pixels.
const input = Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex");
const cases = [
    ...[["R", "eaeaea3f3f3f000000"], ["G", "3333337e7e7e000000"], ["B", "232323474747f5f5f5"]].map(([channel, hex]) => ({
        name: `DisplayP3 ${channel} channel`, args: ["/in.ppm", "-colorspace", "DisplayP3", "-channel", channel!, "-separate", "-depth", "8", "rgb:/out"], hex,
    })),
    { name: "DisplayP3 round trip", args: ["/in.ppm", "-colorspace", "DisplayP3", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { name: "sRGB channel control", args: ["/in.ppm", "-colorspace", "sRGB", "-channel", "R", "-separate", "-depth", "8", "rgb:/out"], hex: "ffffff202020000000" },
    { name: "red pixel metadata", args: ["xc:red", "-colorspace", "DisplayP3", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "DisplayP3|displayp3  3.0|displayp3(91.7524%,19.9973%,13.8429%)" },
    { name: "alpha pixel metadata", args: ["xc:#458abc80", "-colorspace", "DisplayP3", "-format", "%[colorspace]|%[channels]|%[pixel:p{0,0}]", "info:/out"], text: "DisplayP3|displayp3a 4.0|displayp3a(33.906%,53.4811%,72.0192%,0.501961)" },
    { name: "black pixel enumeration", args: ["xc:black", "-colorspace", "DisplayP3", "txt:/out"], text: "# ImageMagick pixel enumeration: 1,1,0,65535,displayp3\n0,0: (0,0,0)  #000000000000  displayp3(0,0,0)\n" },
    { name: "black histogram", args: ["xc:black", "-colorspace", "DisplayP3", "-format", "%c", "histogram:info:/out"], contains: "displayp3(0,0,0)" },
    { name: "raw P3 precision", args: ["xc:#458abc80", "-colorspace", "DisplayP3", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "56cc88e9b85e8080" },
    { name: "repeated mixed-case round trip", args: ["xc:#458abc80", "-colorspace", "dIsPlAyP3", "-colorspace", "DISPLAYP3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "45498a8abcbb8080" },
    { name: "assigned P3 inverse", args: ["xc:#458abc80", "-set", "colorspace", "DisplayP3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "21cc8c92c1698080" },
    { name: "alpha channel", args: ["xc:#458abc80", "-colorspace", "DisplayP3", "-channel", "A", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "8080" },
    { name: "black round trip", args: ["xc:black", "-colorspace", "DisplayP3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
    { name: "white round trip", args: ["xc:white", "-colorspace", "DisplayP3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "fffffffcfffdffff" },
    { name: "fractional input channel", args: ["xc:#458abc80", "-evaluate", "Multiply", "0.75", "-colorspace", "DisplayP3", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "40eb" },
    { name: "linear RGB input channel", args: ["xc:#458abc80", "-colorspace", "RGB", "-colorspace", "DisplayP3", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"], hex: "56cc" },
    { name: "XYZ conversion chain", args: ["xc:#458abc80", "-colorspace", "DisplayP3", "-colorspace", "XYZ", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"], hex: "458abc80" },
    { name: "PNG P3 precision", args: ["xc:#458abc80", "-colorspace", "DisplayP3", "PNG64:/out"], pixels: "56cc88e9b85e8080" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = test.args;
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "buffered" ? await runConvertCli(args, files)
                : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
                    : await createMagickCommand().execute({
                        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { write: async () => {} },
                        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                    });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if ("text" in test) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else if ("contains" in test) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else if ("pixels" in test) expect(Array.from(decodeImage(bytes).data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        else expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
    });
}
