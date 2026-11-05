import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16: magick -size 1x1 xc:'#804020' -solarize THRESHOLD -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["128", [127, 191, 223, 255]],
        ["32768", [127, 64, 32, 255]],
        ["32896", [128, 64, 32, 255]],
        ["65535", [128, 64, 32, 255]],
        ["50%", [127, 64, 32, 255]],
        ["100%", [128, 64, 32, 255]],
    ] as const)(`matches native solarize threshold %s via ${mode}`, async (threshold, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#804020", "-solarize", threshold, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
