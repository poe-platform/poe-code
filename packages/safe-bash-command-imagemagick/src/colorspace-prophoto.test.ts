import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference values, including distinct working channels.
const ppm = Uint8Array.from(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"));
const cases = [
    ...[["R", "bbbbbb505050747474"], ["G", "5757577a7a7a303030"], ["B", "2a2a2a555555ffffff"]].map(([channel, hex]) => ({
        name: `ProPhoto ${channel} channel`, args: ["/in.ppm", "-colorspace", "ProPhoto", "-channel", channel!, "-separate", "-depth", "8", "rgb:/out"], hex,
    })),
    { name: "sRGB control", args: ["/in.ppm", "-colorspace", "sRGB", "-channel", "R", "-separate", "-depth", "8", "rgb:/out"], hex: "ffffff202020000000" },
    { name: "ProPhoto round trip", args: ["/in.ppm", "-colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "8", "rgb:/out"], hex: "ff00002080400000ff" },
    { name: "RGB output retains working channels", args: ["/in.ppm", "-colorspace", "ProPhoto", "-depth", "8", "rgb:/out"], hex: "bb572a507a557430ff" },
    { name: "mixed-case repeated conversion and alpha", args: ["xc:#4080c080", "-colorspace", "pRoPhOtO", "-colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "40458080c0bf8080" },
    { name: "working samples and metadata", args: ["xc:#4080c080", "-colorspace", "ProPhoto", "-format", "%[colorspace]|%[channels]|%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "ProPhoto|prophotoa 4.0|0.463068 0.497945 0.820752" },
    { name: "above-range working samples", args: ["xc:white", "-colorspace", "ProPhoto", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.985764 1.00564 1.12931" },
    { name: "above-range round trip", args: ["xc:white", "-colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "fffffffcfffdffff" },
    { name: "dark transfer curve", args: ["xc:#010305", "-colorspace", "ProPhoto", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.00884766 0.0113962 0.0243788" },
    { name: "PNG output retains working channels and alpha", args: ["xc:#4080c080", "-colorspace", "ProPhoto", "PNG64:/out"], pixels: "768b7f79d21c8080" },
    { name: "declared ProPhoto inverse", args: ["xc:#4080c080", "-set", "colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "0000b2b9d0038080" },
    { name: "pixel reporting", args: ["xc:#4080c080", "-colorspace", "ProPhoto", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "prophotoa(46.3068%,49.7945%,82.0752%,0.501961)" },
    { name: "black pixel reporting", args: ["xc:black", "-colorspace", "ProPhoto", "-format", "%[pixel:p{0,0}]", "info:/out"], text: "prophoto(0,0,0)" },
    { name: "fractional input precision", args: ["xc:#4080c080", "-evaluate", "Multiply", "0.333", "-colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "15672aca402f2aca" },
    { name: "black round trip", args: ["xc:black", "-colorspace", "ProPhoto", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "000000000000ffff" },
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const files = new Map([["/in.ppm", ppm]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(test.args, files) : mode === "buffered" ? await runConvertCli(test.args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        if ("text" in test) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else if ("pixels" in test) {
            const output = decodeImage(bytes);
            expect(output.data16).toBeDefined();
            expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        } else expect(Buffer.from(bytes).toString("hex")).toBe(test.hex);
    });
}
