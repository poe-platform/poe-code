import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = Uint8Array.from(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"));
// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for red, muted green and blue.
const cases = [
    { name: "L channel", options: ["-colorspace", "LMS", "-channel", "R", "-separate"], hex: "646464202020020202" },
    { name: "M channel", options: ["-colorspace", "LMS", "-channel", "G", "-separate"], hex: "121212353535000000" },
    { name: "S channel", options: ["-colorspace", "LMS", "-channel", "B", "-separate"], hex: "060606131313efefef" },
    { name: "sRGB round trip", options: ["-colorspace", "LMS", "-colorspace", "sRGB"], hex: "ff00002080400000ff" },
    { name: "case-insensitive repeated conversion", options: ["-colorspace", "lMs", "-colorspace", "LMS", "-channel", "R", "-separate"], hex: "646464202020020202" },
    { name: "sRGB channel control", options: ["-colorspace", "sRGB", "-channel", "R", "-separate"], hex: "ffffff202020000000" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`extracts $name through ${mode}`, async ({ options, hex }) => {
        const files = new Map([["/in.ppm", ppm]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        const args = ["/in.ppm", ...options, "-depth", "8", "rgb:/out.raw"];
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
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

for (const retained of [false, true]) {
    it(`converts LMS to RGB for PNG output, retained=${retained}`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["xc:#20804080", "-colorspace", "LMS", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([32, 128, 64, 128]);
    });

    it.each([
        { name: "working channels and alpha", args: ["-colorspace", "LMS", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:/out"], text: "LMS lmsa(31.8245,53.2938,19.3712,0.501961)" },
        { name: "16-bit round trip and alpha", args: ["-colorspace", "LMS", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "20218080403f8080" },
        { name: "declared LMS inverse", args: ["-set", "colorspace", "LMS", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/out"], hex: "0000ffffd6528080" },
    ])(`preserves $name, retained=${retained}`, async ({ args, text, hex }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["xc:#20804080", ...args], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const output = retained ? await fs.readFile("/out") : files.get("/out")!;
        expect(hex ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output)).toBe(hex ?? text);
    });

    it.each(["txt:/out", "histogram:info:/out"])(`reports LMS pixel colors in %s, retained=${retained}`, async output => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["xc:red", "-colorspace", "LMS", "-format", "%c", output], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const data = retained ? await fs.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(data)).toContain("lms(99.5511,18.0594,5.89184)");
    });
}
