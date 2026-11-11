import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: magick -list virtual-pixel.
const expected = `Background
Black
CheckerTile
Dither
Edge
Gray
HorizontalTile
HorizontalTileEdge
Mirror
None
Random
Tile
Transparent
VerticalTile
VerticalTileEdge
White
`;

for (const command of ["convert", "magick"] as const) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it(`${command} lists canonical virtual-pixel methods without input in ${mode}`, async () => {
            const args = ["-list", "virtual-pixel"];
            const files = new Map<string, Uint8Array>();
            const input = mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files;
            const result = mode === "sync"
                ? (command === "convert" ? runConvertCliSync : runMagickCliSync)(args, files)
                : await (command === "convert" ? runConvertCli : runMagickCli)(args, input);
            expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
            expect(files.size).toBe(0);
        });
    }
}
