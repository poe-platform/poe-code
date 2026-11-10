import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const depth of ["uchar", "ushort"] as const) {
        it.each([150, 300])(`scales source alpha before clamping shadow opacity at %s percent (${mode}, ${depth})`, async opacity => {
            const data = Uint8Array.of(96, 160, 128, 128, 96, 160, 128, 0, 96, 160, 128, 255);
            const input = encodeImage({ width: 3, height: 1, data,
                ...(depth === "ushort" ? { data16: Uint16Array.from(data, value => value * 257) } : {}),
                format: "png", space: "srgb", channels: 4, depth, density: 72, hasAlpha: true }, { format: "png" }).data;
            expect(decodeImage(input).depth).toBe(depth);
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["/input.png", "-background", "blue", "-shadow", `${opacity}x0+0+0`, "/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([3, 1]);
            expect(output.virtualCanvas).toBeUndefined();
            expect(Array.from(output.data)).toEqual([0, 0, 255, opacity === 150 ? 192 : 255, 0, 0, 255, 0, 0, 0, 255, 255]);
        });
    }
}
