import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: magick -size 1x1 xc:COLOR -fill blue -tint PERCENT -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const [color, alpha] of [["#804020", 255], ["#80402080", 128]] as const) {
        it.each([
            ["0%", [110, 50, 24]],
            ["50%", [110, 50, 80]],
            ["100%", [110, 50, 136]],
        ] as const)(`matches native tint %s for ${color} via ${mode}`, async (percent, rgb) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", `xc:${color}`, "-fill", "blue", "-tint", percent, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([...rgb, alpha]);
        });
    }
}
