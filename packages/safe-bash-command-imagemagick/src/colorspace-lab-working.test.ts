import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.of(0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255);
const input = encodeImage({ width: 3, height: 2, data: pixels, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
for (const mode of ["buffered", "sync", "command"] as const) {
    it(`inspects working Lab pixels and component means (${mode})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        async function run(args: string[]) {
            if (mode === "sync") return runConvertCliSync(args, files);
            if (mode === "buffered") return runConvertCli(args, files);
            let stdout = "", stderr = "";
            const result = await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
            return { ...result, stdout, stderr };
        }
        for (const space of ["Lab", "lab", "LAB", "CIELab"]) {
            const result = await run(["/in.png", "-colorspace", space, "-colorspace", "Lab", "-format", "%[colorspace] %[pixel:p{0,0}] %[pixel:p{1,0}]", "info:"]);
            expect({ ...result, stdout: result.stdout.trim() }).toMatchObject({ exitCode: 0, stderr: "", stdout: "CIELab cielab(32.3027,79.1923,-107.863) cielab(53.2314,80.1144,67.22)" });
        }
        const report = await run(["/in.png", "-colorspace", "Lab", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"]);
        expect(report).toMatchObject({ exitCode: 0, stderr: "", stdout: "Objects (id: bounding-box centroid area mean-color):\n  1: 3x2+0+0 1.2,0.6 5 cielab(53.2314,80.1144,67.22)\n  0: 1x1+0+0 0.0,0.0 1 cielab(32.3027,79.1923,-107.863)\n" });
        const roundtrip = await run(["/in.png", "-colorspace", "Lab", "/out.png"]);
        expect(roundtrip.exitCode).toBe(0);
        expect(decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toEqual(pixels);
        for (const output of ["txt:-", "histogram:info:-"]) {
            const result = await run(["/in.png", "-colorspace", "Lab", ...(output === "histogram:info:-" ? ["-format", "%c"] : []), output]);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain("cielab(32.3027,79.1923,-107.863)");
        }
    });
}

for (const retained of [false, true]) it(`preserves alpha and dark Lab samples (${retained})`, async () => {
    const rgba = Uint8Array.of(2, 3, 4, 128, 32, 64, 96, 255, 255, 255, 255, 255);
    const bytes = encodeImage({ width: 3, height: 1, data: rgba, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const fs = new MemoryFileSystem(), files = new Map([["/in.png", bytes]]);
    await fs.writeFile("/in.png", bytes);
    const context = retained ? { filesystem: fs, cwd: "/" } : files;
    const result = await runConvertCli(["/in.png", "-colorspace", "Lab", "-format", "%[pixel:p{0,0}] %[pixel:p{2,0}]", "info:"], context);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(",0.501961)");
    const white = result.stdout.trim().split(" ")[1]!.slice(8, -1).split(",").map(Number);
    [99.9983, 0.00744771, -0.0119391, 1].forEach((value, index) => expect(white[index]).toBeCloseTo(value, 4));
    const output = await runConvertCli(["/in.png", "-colorspace", "Lab", "-colorspace", "sRGB", "/out.png"], context);
    expect(output.exitCode, output.stderr).toBe(0);
    expect(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toEqual(rgba);
});
