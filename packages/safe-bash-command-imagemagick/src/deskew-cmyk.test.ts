import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Reference output: ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "retained", "sync", "magick"] as const) {
    it.each([
        { space: "CMYK", threshold: "40%", pixels: false, expected: "35x16 -2,-1 3.5763343749973515" },
        { space: "sRGB", threshold: "40%", pixels: false, expected: "35x17 -1,-4 -5.3558250428551908" },
        { space: "CMYK", threshold: "0", pixels: false, expected: "34x14 -1,-1 -0" },
        { space: "CMYK", threshold: "40%", pixels: true, expected: "93a3c4ffa5b0cfffb7bcd9ff103250ff103250ff103351ff" }
    ])(`deskews $space at $threshold, pixels=$pixels (${mode})`, async ({ space, threshold, pixels, expected }) => {
        const data = new Uint8Array(32 * 12 * 3);
        for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) {
            const stripe = x > 2 && x < 29 && Math.abs(y - 3 - Math.floor(x / 8)) <= 1;
            data.set(stripe ? [22, 58, 90] : [235, 221, 243], (y * 32 + x) * 3);
        }
        const input = Buffer.concat([Buffer.from("P6\n32 12\n255\n"), data]);
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-colorspace", space, "-deskew", threshold, ...(pixels
            ? ["-colorspace", "sRGB", "+repage", "-crop", "3x2+12+4", "-depth", "8", "rgba:/out"]
            : ["-format", "%wx%h %X,%Y %[deskew:angle]", "info:/out"])];
        let stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "magick" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(pixels ? "hex" : "utf8").trim()).toBe(expected);
    });
}
