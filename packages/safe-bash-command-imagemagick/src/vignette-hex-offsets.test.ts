import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "retained", "sync"] as const)("reads hexadecimal vignette offsets (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const outputs = [];
    for (const geometry of ["0x0+0x2+0x2", "0x0+2+2"]) {
        const args = ["-size", "9x9", "xc:#b4326480", "-background", "#20304080", "-compose", "Over", "-vignette", geometry, "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([9, 9]);
        // Native ImageMagick 7.1.2 Q16-HDRI, pixels (0,0) and (4,2).
        expect(Array.from(output.data.slice(0, 4))).toEqual([32, 48, 64, 128]);
        expect(Array.from(output.data.slice(88, 92))).toEqual([180, 50, 100, 255]);
        outputs.push(output.data);
    }
    expect(outputs[0]).toEqual(outputs[1]);
});
