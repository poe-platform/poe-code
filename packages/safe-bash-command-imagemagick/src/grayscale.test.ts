import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const execution of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["Average", [85, 85, 85, 107, 0]],
        ["Mean", [85, 85, 85, 107, 0]],
        ["Brightness", [255, 255, 255, 180, 1]],
        ["Lightness", [128, 128, 128, 110, 1]],
        ["MS", [255, 255, 255, 255, 86]],
        ["RMS", [147, 147, 147, 121, 1]],
        ["Rec601Luma", [76, 150, 29, 91, 0]],
        ["Rec601Luminance", [76, 150, 29, 34, 0]],
        ["Rec709Luma", [54, 182, 18, 93, 0]],
        ["Rec709Luminance", [54, 182, 18, 33, 0]]
    ] as const)(`matches native grayscale %s via ${execution}`, async (method, gray) => {
        // ImageMagick 7.1.2: RGBA red, green, blue, (40,100,180,128), (1,0,0,255).
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAABBAMAAADk0HnAAAAAD1BMVEUoZLT/AAAA/wAAAP8BAAA1DKxNAAAAAXRSTlOArV5bRgAAAAxJREFUCNdjEDJwAAAA2gCDI+t2nAAAAABJRU5ErkJggg==", "base64");
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-grayscale", method, "out.png"];
        const result = execution === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = execution === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(gray.flatMap((value, i) => [value, value, value, i === 3 ? 128 : 255]));
    });

    it.each(["invalid", "sRGB", "gray"])(`rejects unsupported grayscale %s via ${execution}`, async method => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "-grayscale", method, "out.png"];
        const result = execution === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, execution === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unsupported grayscale");
        expect(files.has("out.png")).toBe(false);
        await expect(filesystem.stat("/out.png")).rejects.toThrow();
    });
}
