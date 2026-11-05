import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31: magick -size 1x1 xc:'#808080' -gamma VALUE -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([[1.5, 161], [0.5, 64], [1, 128]])("matches native gamma %s midtones via " + mode, async (gamma, value) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#808080", "-gamma", String(gamma), "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([value, value, value, 255]);
    });
}

// Native ImageMagick 7.1.2-31: magick -size 1x1 xc:'#80402080' ... -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-channel", "R", "-gamma", "1.5", "+channel"], expected: [161, 64, 32, 128] },
        { options: ["-channel", "G", "-gamma", "1.5", "+channel"], expected: [128, 101, 32, 128] },
        { options: ["-channel", "B", "-gamma", "1.5", "+channel"], expected: [128, 64, 64, 128] },
        { options: ["-channel", "A", "-gamma", "1.5", "+channel"], expected: [128, 64, 32, 161] },
        { options: ["-channel", "RGB", "-gamma", "1.5"], expected: [161, 101, 64, 128] },
        { options: ["-channel", "RGBA", "-gamma", "1.5", "+channel"], expected: [161, 101, 64, 161] },
        { options: ["-gamma", "1.5"], expected: [161, 101, 64, 161] },
        { options: ["-channel", "R", "+channel", "-gamma", "1.5"], expected: [161, 101, 64, 161] },
        { options: ["-channel", "R", "-gamma", "1.5", "-channel", "A", "-gamma", "0.5", "+channel"], expected: [161, 64, 32, 64] }
    ])("matches native channel-scoped gamma $options via " + mode, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#80402080", ...options, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
