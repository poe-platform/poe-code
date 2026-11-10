import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Reference output: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "retained", "sync", "magick"] as const) {
    it.each([
        { options: ["-deskew", "40%"], pixels: false, expected: "srgb  3.0" },
        { options: ["-deskew", "40%", "-negate"], pixels: true, expected: "14220cff13210bff11200aff1d2913ff2d351eff41452cff" },
        { options: ["-alpha", "on", "-deskew", "40%", "-negate"], pixels: true, expected: "14220c0013210b0011200a001d2913002d351e0041452c00" },
        { options: [], pixels: false, expected: "srgb  3.0" },
        { options: ["-negate"], pixels: true, expected: "e9c5a5ffe9c5a5ffe9c5a5ffe9c5a5ffe9c5a5ffe9c5a5ff" },
        { options: ["-background", "none", "-deskew", "40%"], pixels: false, expected: "srgba 4.0" }
    ])(`preserves deskew channels with $options, pixels=$pixels (${mode})`, async ({ options, pixels, expected }) => {
        const data = new Uint8Array(32 * 12 * 3);
        for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) {
            const stripe = x > 2 && x < 29 && Math.abs(y - 3 - Math.floor(x / 8)) <= 1;
            data.set(stripe ? [22, 58, 90] : [235, 221, 243], (y * 32 + x) * 3);
        }
        const input = Buffer.concat([Buffer.from("P6\n32 12\n255\n"), data]);
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...options, ...(pixels
            ? ["+repage", "-crop", "3x2+12+4", "-depth", "8", "rgba:/out"]
            : ["-format", "%[channels]", "info:/out"])];
        let stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "magick" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(pixels ? "hex" : "utf8")).toBe(expected);
    });
}
