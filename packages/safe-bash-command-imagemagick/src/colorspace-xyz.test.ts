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
            [["XYZ"], "XYZ xyz(41.2396,21.2586,1.92972)"],
            [["XYZ", "XYZ"], "XYZ xyz(41.2396,21.2586,1.92972)"],
            [["XYZ", "sRGB"], "sRGB 255 0 0"],
            [["XYZ", "RGB", "sRGB"], "sRGB 255 0 0"],
        ] as const) {
            // Compare round trips at the input's 8-bit precision; native HDRI
            // preserves small matrix errors instead of spelling the pixel as red.
            const format = spaces.at(-1) === "sRGB"
                ? "%[colorspace] %[fx:round(255*u.r)] %[fx:round(255*u.g)] %[fx:round(255*u.b)]"
                : "%[colorspace] %[pixel:p{0,0}]";
            const args = ["/in.png", ...spaces.flatMap(space => ["-colorspace", space]), "-format", format, "info:"];
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
    it(`preserves XYZ precision, alpha and encoded RGB output, retained=${retained}`, async () => {
        const pixels = Uint8Array.of(32, 64, 96, 128, 255, 255, 255, 255);
        const { data } = encodeImage({ width: 2, height: 1, data: pixels, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const result = await runConvertCli(["/in.png", "-colorspace", "XYZ", "-write", "/out.png", "-format", "%[colorspace] %[pixel:p{1,0}] %[fx:p{1,0}.b] %[pixel:p{0,0}]", "info:"], input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain("XYZ xyza(95.0472,99.9957,108.898,1) 1.08898");
        expect(result.stdout).toContain(",0.501961)");
        expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual([...pixels]);
        for (const output of ["txt:-", "histogram:-"]) {
            const text = await runConvertCli(["/in.png", "-colorspace", "XYZ", output], input);
            expect(text.exitCode, text.stderr).toBe(0);
            expect(text.stdout).toContain("xyza(95.0472,99.9957,108.898,1)");
            expect(text.stdout).not.toContain("srgb");
        }
    });
}
