import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference text and decoded RGBA16 pixels.
const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 2\n255\n"), ...[1, 2, 3, 0, 3, 1, 0, 2].flatMap(index => colors[index]!)]);
const cases = [
    { name: "OHTA components", args: ["xc:#4080c0", "-colorspace", "OHTA", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.501961 0.249027 0.500008" },
    { name: "OHTA label", args: ["xc:#4080c0", "-colorspace", "OHTA", "-format", "%[colorspace]", "info:/out"], text: "OHTA" },
    { name: "OHTA round trip", args: ["xc:#4080c0", "-colorspace", "OHTA", "-colorspace", "sRGB", "PNG64:/out"], width: 1, pixels: "40408081c0bfffff" },
    { name: "OHTA unique palette", args: ["/in.ppm", "-colorspace", "OHTA", "-unique-colors", "-colorspace", "sRGB", "PNG64:/out"], width: 4, pixels: "0b0c4b4cfefdffff8c8d26275d5cfffff8f81d1da2a1ffff5c5cf0f27e7dffff" },
    { name: "OHTA implicit PNG conversion", args: ["xc:#4080c0", "-colorspace", "OHTA", "PNG64:/out"], width: 1, pixels: "40408081c0bfffff" },
    { name: "OHTA mixed-case repeated conversion and pixel reporting", args: ["xc:#4080c080", "-colorspace", "oHtA", "-colorspace", "OHTA", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:/out"], text: "OHTA ohtaa(128,63.5019,127.502,0.501961)" },
    { name: "OHTA alpha round trip", args: ["xc:#4080c080", "-colorspace", "OHTA", "-colorspace", "sRGB", "PNG64:/out"], width: 1, pixels: "40408081c0bf8080" },
    { name: "OHTA pixel enumeration", args: ["xc:#4080c0", "-colorspace", "OHTA", "txt:/out"], contains: "ohta(128,63.5019,127.502)" },
    { name: "OHTA histogram", args: ["xc:#4080c0", "-colorspace", "OHTA", "-format", "%c", "histogram:info:/out"], contains: "ohta(128,63.5019,127.502)" },
    { name: "XYZ components control", args: ["xc:#4080c0", "-colorspace", "XYZ", "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"], text: "0.193472 0.203334 0.527738" },
    { name: "XYZ label control", args: ["xc:#4080c0", "-colorspace", "XYZ", "-format", "%[colorspace]", "info:/out"], text: "XYZ" },
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const test of cases) it(`matches native ${test.name} (${mode})`, async () => {
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(test.args, files) : mode === "buffered" ? await runConvertCli(test.args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const bytes = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        if (test.text !== undefined) expect(new TextDecoder().decode(bytes)).toBe(test.text);
        else if (test.contains !== undefined) expect(new TextDecoder().decode(bytes)).toContain(test.contains);
        else {
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([test.width, 1]);
            expect(output.data16).toBeDefined();
            expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(test.pixels);
        }
    });
}
