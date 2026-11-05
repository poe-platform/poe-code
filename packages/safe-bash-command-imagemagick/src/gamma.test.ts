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
