import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCliSync, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it(`converts real PNG pixels to HSB and back, retained=${retained}`, async () => {
        const pixels = [32, 64, 96, 128, 255, 0, 0, 255, 128, 128, 128, 255, 0, 255, 0, 255, 0, 0, 255, 255];
        const { data } = encodeImage({ width: 5, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const format = "%[colorspace] %[fx:p{0,0}.r] %[fx:p{0,0}.g] %[fx:p{0,0}.b] %[pixel:p{1,0}]";
        const args = ["in.png", "-colorspace", "HSB", "-format", format, "info:"];
        const result = await runConvertCli(args, input);
        expect(result.exitCode, result.stderr).toBe(0);
        const fields = result.stdout.trim().split(" ");
        expect(fields[0]).toBe("HSB");
        expect(Number(fields[1])).toBeCloseTo(210 / 360, 4);
        expect(Number(fields[2])).toBeCloseTo(2 / 3, 4);
        expect(Number(fields[3])).toBeCloseTo(96 / 255, 4);
        expect(fields[4]).toBe("hsba(0,100%,100%,1)");
        const native = spawnSync("magick", ["png:-", ...args.slice(1)], { input: data, encoding: "utf8" });
        if (!native.error) {
            expect(native.status, native.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(native.stdout.trim());
            const values = native.stdout.split(" ");
            for (let i = 1; i <= 3; i++) expect(Number(fields[i])).toBeCloseTo(Number(values[i]), 4);
        }
        for (const format of ["png", "tiff"]) {
            const output = await runConvertCli(["in.png", "-colorspace", "HSB", `out.${format}`], input);
            expect(output.exitCode, output.stderr).toBe(0);
            const encoded = retained ? await fs.readFile(`/out.${format}`) : files.get(`out.${format}`)!;
            const decoded = decodeImage(encoded);
            expect([...decoded.data.slice(0, 4)]).toEqual(format === "png" ? pixels.slice(0, 4) : [149, 170, 96, 128]);
        }
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["in.png", "-colorspace", "HSB", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("hsba(210.001,66.6667%,37.6471%,0.501961)");
            expect(text.stdout).not.toContain("srgb");
        }
        const written = await runConvertCli(["in.png", "-colorspace", "HSB", "-write", "written.png", "-format", "%[colorspace]", "info:"], input);
        expect(written.stdout.trim()).toBe("HSB");
        expect([...decodeImage(retained ? await fs.readFile("/written.png") : files.get("written.png")!).data]).toEqual(pixels);
        const reported = await runConvertCli(["in.png", "-colorspace", "HSB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(reported.stdout.trim()).toBe("hsba(210,66.6667%,37.6471%,0.501961) HSB");
        const repeated = await runConvertCli(["in.png", "-colorspace", "HSB", "-colorspace", "HSB", "-format", format, "info:"], input);
        expect(repeated.stdout).toBe(result.stdout);
        const roundtrip = await runConvertCli(["in.png", "-colorspace", "HSB", "-colorspace", "sRGB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(roundtrip.stdout.trim()).toBe("srgba(32,64,96,0.501961) sRGB");
    });
}

for (const retained of [false, true]) {
    it(`reports opaque and achromatic HSB, retained=${retained}`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        for (const [color, expected] of [["red", "hsb(0,100%,100%)"], ["black", "hsb(0,0%,0%)"], ["white", "hsb(0,0%,100%)"], ["blue", "hsb(240,100%,100%)"], ["lime", "hsb(120,100%,100%)"]]) {
            const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "HSB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(`${expected} HSB`);
        }
    });
}

for (const mode of ["buffered", "sync", "command"] as const) {
    it(`converts opaque PNG through the public ${mode} API`, async () => {
        const { data } = encodeImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        for (const [spaces, expected] of [
            [["HSB"], "HSB hsb(0,100%,100%)"],
            [["HSL", "HSB"], "HSB hsb(0,100%,100%)"],
            [["HSB", "HSL"], "HSL hsl(0,100%,50%)"],
            [["HSB", "RGB", "sRGB"], "sRGB srgb(255,0,0)"],
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
