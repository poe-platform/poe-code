import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31: magick -size 1x1 xc:COLOR
// -modulate VALUE -depth 8 rgba:-. Alpha must remain unchanged.
const values = ["50", "150", "100,50", "100,150", "100,100,50", "100,100,150", "100,100,300"];
const samples = [
    { color: "#ff0000", alpha: 255, rgb: [[128,0,0], [255,128,128], [191,64,64], [255,0,0], [128,0,255], [128,255,0], [255,0,0]] },
    { color: "#0000ff", alpha: 255, rgb: [[0,0,128], [128,128,255], [64,64,191], [0,0,255], [0,255,128], [255,0,128], [0,0,255]] },
    { color: "#80402080", alpha: 128, rgb: [[64,32,16], [192,96,48], [104,72,56], [152,56,8], [112,32,128], [48,128,32], [128,64,32]] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const { color, alpha, rgb } of samples) {
        it.each(values)(`matches native modulation of ${color} by %s via ${mode}`, async value => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", `xc:${color}`, "-modulate", value, "out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual([...rgb[values.indexOf(value)]!, alpha]);
        });
    }
}
