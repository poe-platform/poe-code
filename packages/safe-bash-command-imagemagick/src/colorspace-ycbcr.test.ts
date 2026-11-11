import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCliSync, runConvertCli } from "./index.js";

for (const mode of ["buffered", "sync", "command"] as const) {
    it(`converts opaque PNG through the public ${mode} API`, async () => {
        const { data } = encodeImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        for (const [spaces, expected] of [
            [["YCbCr"], "YCbCr ycbcr(76.2039,84.4721,255)"],
            [["YCbCr", "YCbCr"], "YCbCr ycbcr(76.2039,84.4721,255)"],
            [["YCbCr", "sRGB"], "sRGB srgb(99.9839%,-0.0160994%,-0.0161011%)"],
            [["YCbCr", "RGB", "sRGB"], "sRGB srgb(99.9839%,-0.0160994%,-0.0161011%)"],
        ] as const) {
            const args = ["/in.png", ...spaces.flatMap(space => ["-colorspace", space]), "-format", "%[colorspace] %[pixel:p{0,0}]", "info:"];
            let stdout = "";
            const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createConvertCommand().execute({
                command: "convert", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async () => {} },
            });
            expect(result.exitCode).toBe(0);
            expect(("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim()).toBe(expected);
        }
    });
}

for (const retained of [false, true]) {
    it(`preserves YCbCr precision, alpha and encoded RGB output, retained=${retained}`, async () => {
        const pixels = Uint8Array.of(32, 64, 96, 128, 255, 255, 255, 255);
        const { data } = encodeImage({ width: 2, height: 1, data: pixels, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const result = await runConvertCli(["/in.png", "-colorspace", "YCbCr", "-write", "/out.png", "-format", "%[colorspace] %[pixel:p{1,0}] %[fx:p{1,0}.b] %[pixel:p{0,0}]", "info:"], input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain("YCbCr ycbcra(255,127.5,127.5,1) 0.5");
        expect(result.stdout).toContain(",0.501961)");
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual([...pixels]);
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["/in.png", "-colorspace", "YCbCr", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("ycbcra(255,127.5,127.5,1)");
            expect(text.stdout).not.toContain("srgb");
        }
    });
}

for (const retained of [false, true]) {
    it(`reports native primary and neutral YCbCr samples, retained=${retained}`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        // ImageMagick 7.1.2 HDRI reference values, without rounding to 8-bit RGB.
        for (const [color, expected] of [
            ["red", "76.2039,84.4721,255"],
            ["lime", "149.637,43.0277,20.7346"],
            ["blue", "29.1592,255,106.765"],
            ["black", "0,127.5,127.5"],
            ["white", "255,127.5,127.5"],
        ]) {
            for (const output of ["info:", "txt:-", "histogram:-"]) {
                const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "yCbCr", "-format", "%[pixel:p{0,0}]", output!], input);
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stdout).toContain(`ycbcr(${expected})`);
            }
        }
    });
}
