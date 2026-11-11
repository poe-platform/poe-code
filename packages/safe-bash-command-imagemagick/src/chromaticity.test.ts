import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: these settings change headers, not RGB samples.
const input = new Uint8Array(Buffer.from("50360a3320310a3235350aff00002080400000ff", "hex"));
const defaults = { "red-primary": [0.64, 0.33], "green-primary": [0.3, 0.6], "blue-primary": [0.15, 0.06], "white-point": [0.3127, 0.329] };
const settings = [
    ["red-primary", "-red-primary", "0.68,0.32", [0.68, 0.32]],
    ["green-primary", "-green-primary", "0.265,0.69", [0.265, 0.69]],
    ["blue-primary", "-blue-primary", "0.15,0.06", [0.15, 0.06]],
    ["white-point", "-white-point", "0.314,0.351", [0.314, 0.351]],
] as const;

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const selected of [[], ...settings.map(setting => [setting]), settings]) {
        for (const format of ["miff", "png"]) {
            it(`sets chromaticities without changing pixels (${mode}, ${format}, ${selected.map(s => s[0]).join() || "defaults"})`, async () => {
                const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const path = `/out.${format}`;
                const args = ["/in.ppm", ...selected.flatMap(([, flag, value]) => [flag, value]), "-depth", "8", path];
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0 });
                const output = mode === "retained" ? await fs.readFile(path) : files.get(path)!;
                expect(decodeImage(output).data).toEqual(decodeImage(input).data);
                const expected = { ...defaults, ...Object.fromEntries(selected.map(([key, , , pair]) => [key, pair])) };
                if (format === "miff") {
                    const header = new TextDecoder().decode(output.subarray(0, output.indexOf(0x1a)));
                    for (const [key, pair] of Object.entries(expected)) {
                        expect(header).toContain(`${key}=${pair.join(",")}`);
                    }
                }
                if (selected.length || format === "miff") expect(readImageMetadata(output)).toMatchObject({ chromaticity: expected });
            });
        }
    }

    it(`applies settings before input and resets individual primaries (${mode})`, async () => {
        const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["-red-primary", "0.68x0.32", "-white-point", "0.314,0.351", "/in.ppm", "+red-primary", "-green-primary", "0.4", "/out.miff"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await fs.readFile("/out.miff") : files.get("/out.miff")!;
        expect(readImageMetadata(output)).toMatchObject({ chromaticity: { ...defaults, "red-primary": [0, 0], "green-primary": [0.4, 0.4], "white-point": [0.314, 0.351] } });
    });
}

for (const [, flag] of settings) {
    it(`rejects invalid ${flag} without replacing output`, async () => {
        const files = new Map([["/in.ppm", input], ["/out.miff", input]]);
        const result = await runConvertCli(["/in.ppm", flag, "invalid", "/out.miff"], files);
        expect(result.exitCode).not.toBe(0);
        expect(files.get("/out.miff")).toBe(input);
    });
}
