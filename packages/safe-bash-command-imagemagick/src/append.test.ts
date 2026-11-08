import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const direction of ["-append", "+append"]) {
        for (const background of ["white", "#00ff0040"]) {
            it(`preserves source RGBA and padding: ${mode} ${direction} ${background}`, async () => {
                const args = ["-size", "3x2", "xc:#ff000080", "-size", "2x3", "xc:#0000ff00", "-background", background, "-gravity", "southeast", direction];
                const files = new Map<string, Uint8Array>();
                const filesystem = new MemoryFileSystem();
                const result = mode === "sync"
                    ? runConvertCliSync([...args, "out.png"], files)
                    : await runConvertCli([...args, "out.png"], mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
                const red = [255, 0, 0, 128], blue = [0, 0, 255, 0];
                const padding = background === "white" ? [255, 255, 255, 255] : [0, 255, 0, 64];
                const expected = direction === "-append"
                    ? [...Array.from({ length: 6 }, () => red), ...Array.from({ length: 3 }, () => [padding, blue, blue]).flat()].flat()
                    : [padding, padding, padding, blue, blue, red, red, red, blue, blue, red, red, red, blue, blue].flat();
                expect([output.width, output.height]).toEqual(direction === "-append" ? [3, 5] : [5, 3]);
                expect([...output.data]).toEqual(expected);
                const native = spawnSync("magick", [...args, "-depth", "8", "rgba:-"]);
                if (native.error && "code" in native.error && native.error.code === "ENOENT") return;
                expect(native.status).toBe(0);
                expect([...native.stdout]).toEqual(expected);
            });
        }
    }
}
