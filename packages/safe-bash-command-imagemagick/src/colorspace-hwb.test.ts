import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCliSync, runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it(`converts real PNG pixels to HWB and back, retained=${retained}`, async () => {
        const pixels = [32, 64, 96, 128, 255, 0, 0, 255, 128, 128, 128, 255, 0, 255, 0, 255, 0, 0, 255, 255];
        const { data } = encodeImage({ width: 5, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const format = "%[colorspace] %[fx:p{0,0}.r] %[fx:p{0,0}.g] %[fx:p{0,0}.b] %[pixel:p{1,0}]";
        const args = ["in.png", "-colorspace", "HWB", "-format", format, "info:"];
        const result = await runConvertCli(args, input);
        expect(result.exitCode, result.stderr).toBe(0);
        const fields = result.stdout.trim().split(" ");
        expect(fields[0]).toBe("HWB");
        expect(Number(fields[1])).toBeCloseTo(210 / 360, 4);
        expect(Number(fields[2])).toBeCloseTo(32 / 255, 4);
        expect(Number(fields[3])).toBeCloseTo(159 / 255, 4);
        expect(fields[4]).toBe("hwba(255,0,1.38236e-17,1)");
        const native = spawnSync("magick", ["png:-", ...args.slice(1)], { input: data, encoding: "utf8" });
        if (!native.error) {
            expect(native.status, native.stderr).toBe(0);
            const nativeFields = native.stdout.trim().split(" ");
            expect(fields.slice(0, 4)).toEqual(nativeFields.slice(0, 4));
            // Native builds differ by an HDRI epsilon at zero blackness.
            expect(fields[4]!.slice(5, -1).split(",").map(Number)).toEqual(
                nativeFields[4]!.slice(5, -1).split(",").map(value => expect.closeTo(Number(value), 12)));
        }
        for (const format of ["png", "tiff"]) {
            const output = await runConvertCli(["in.png", "-colorspace", "HWB", `out.${format}`], input);
            expect(output.exitCode, output.stderr).toBe(0);
            const encoded = retained ? await fs.readFile(`/out.${format}`) : files.get(`out.${format}`)!;
            const decoded = decodeImage(encoded);
            expect([...decoded.data.slice(0, 4)]).toEqual(format === "png" ? pixels.slice(0, 4) : [149, 32, 159, 128]);
        }
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["in.png", "-colorspace", "HWB", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("hwba(148.75,32,159,0.501961)");
            expect(text.stdout).toContain("hwba(-255,128,127,1)");
            expect(text.stdout).toContain("hwba(255,0,1.38236e-17,1)");
            expect(text.stdout).not.toContain("srgb");
        }
        const written = await runConvertCli(["in.png", "-colorspace", "HWB", "-write", "written.png", "-format", "%[colorspace]", "info:"], input);
        expect(written.stdout.trim()).toBe("HWB");
        expect([...decodeImage(retained ? await fs.readFile("/written.png") : files.get("written.png")!).data]).toEqual(pixels);
        const reported = await runConvertCli(["in.png", "-colorspace", "HWB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(reported.stdout.trim()).toBe("hwba(148.75,32,159,0.501961) HWB");
        const repeated = await runConvertCli(["in.png", "-colorspace", "HWB", "-colorspace", "HWB", "-format", format, "info:"], input);
        expect(repeated.stdout).toBe(result.stdout);
        const roundtrip = await runConvertCli(["in.png", "-colorspace", "HWB", "-colorspace", "sRGB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
        expect(roundtrip.stdout.trim()).toBe("srgba(32,64,96,0.501961) sRGB");
    });
}

for (const retained of [false, true]) {
    it(`reports opaque and achromatic HWB, retained=${retained}`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        for (const [color, expected] of [["red", "hwb(255,0,1.38236e-17)"], ["black", "hwb(-255,0,255)"], ["white", "hwb(-255,255,1.38236e-17)"], ["blue", "hwb(170,0,1.38236e-17)"], ["lime", "hwb(85,0,1.38236e-17)"]]) {
            const result = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "HWB", "-format", "%[pixel:p{0,0}] %[colorspace]", "info:"], input);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stdout.trim()).toBe(`${expected} HWB`);
            for (const output of ["txt:-", "histogram:-"]) {
                const text = await runConvertCli(["-size", "1x1", `xc:${color}`, "-colorspace", "HWB", output], input);
                expect(text.exitCode, text.stderr).toBe(0);
                expect(text.stdout).toContain(expected);
            }
        }
    });
}

for (const mode of ["buffered", "sync", "command"] as const) {
    it(`converts opaque PNG through the public ${mode} API`, async () => {
        const { data } = encodeImage({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        for (const [spaces, expected] of [
            [["HWB"], "HWB hwb(255,0,1.38236e-17)"],
            [["HSL", "HWB"], "HWB hwb(255,0,1.38236e-17)"],
            [["HWB", "HSL"], "HSL hsl(0,100%,50%)"],
            [["HWB", "RGB", "sRGB"], "sRGB srgb(255,0,0)"],
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
