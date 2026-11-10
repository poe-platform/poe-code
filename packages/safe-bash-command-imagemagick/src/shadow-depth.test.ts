import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([100, 50, 0])(`preserves 16-bit shadow color and alpha at %s percent opacity (${mode})`, async opacity => {
        const data16 = Uint16Array.of(0x1234, 0x5678, 0x9abc, 0x5023);
        const input = encodeImage({ width: 1, height: 1, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        expect(decodeImage(input).data16).toEqual(data16);
        const files = new Map([["/deep.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/deep.png", input);
        const args = ["/deep.png", "-background", "#c02314015291", "-shadow", `${opacity}x0+0+0`, "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(output.virtualCanvas).toBeUndefined();
        expect(Array.from(output.data16 ?? [])).toEqual([0xc023, 0x1401, 0x5291, Math.round(0x5023 * opacity / 100)]);
    });
}
