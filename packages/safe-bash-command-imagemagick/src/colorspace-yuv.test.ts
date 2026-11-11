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
            [["YUV"], "YUV yuv(76.2039,90.015,284.325)"],
            [["YUV", "YUV"], "YUV yuv(76.2039,90.015,284.325)"],
            [["YUV", "sRGB"], "sRGB srgb(99.9839%,-0.0161%,-0.0161%)"],
            [["YUV", "RGB", "sRGB"], "sRGB srgb(99.9839%,-0.0161%,-0.0161%)"],
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
    it(`preserves YUV precision, alpha and encoded RGB output, retained=${retained}`, async () => {
        const pixels = Uint8Array.of(32, 64, 96, 128, 255, 255, 255, 255);
        const { data } = encodeImage({ width: 2, height: 1, data: pixels, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const result = await runConvertCli(["/in.png", "-colorspace", "YUV", "-write", "/out.png", "-format", "%[colorspace] %[pixel:p{1,0}] %[fx:p{1,0}.b] %[pixel:p{0,0}]", "info:"], input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain("YUV yuva(255,127.5,127.5,1) 0.5");
        expect(result.stdout).toContain(",0.501961)");
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual([...pixels]);
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["/in.png", "-colorspace", "YUV", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("yuva(255,127.5,127.5,1)");
            expect(text.stdout).not.toContain("srgb");
        }
    });
}

for (const retained of [false, true]) {
    it(`reports native primary and neutral YUV samples, retained=${retained}`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        // ImageMagick 7.1.2 HDRI reference values, without rounding to 8-bit RGB.
        for (const [color, expected] of [
            ["red", "76.2039,90.015,284.325"],
            ["lime", "149.637,53.805,-3.825"],
            ["blue", "29.1592,238.68,102"],
            ["black", "0,127.5,127.5"],
            ["white", "255,127.5,127.5"],
        ]) {
            for (const output of ["info:", "txt:-", "histogram:-"]) {
                const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "yUv", "-format", "%[pixel:p{0,0}]", output!], input);
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stdout).toContain(`yuv(${expected})`);
            }
        }
    });
}
