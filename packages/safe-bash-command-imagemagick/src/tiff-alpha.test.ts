import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// tifffile.imwrite(..., uint8([[[30,20,10,128],[42,63,99,255]]]),
// photometric="rgb", extrasamples=[1], metadata=None). Only tag 338 varies.
const fixture = "SUkqAAgAAAAPAAABBAABAAAAAgAAAAEBBAABAAAAAQAAAAIBAwAEAAAAwgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAABAAAA8AAAABUBAwABAAAABAAAABYBBAABAAAAAQAAABcBBAABAAAACAAAABoBBQABAAAAygAAABsBBQABAAAA0gAAABwBAwABAAAAAQAAACgBAwABAAAAAQAAADEBAgAMAAAA2gAAAFIBAwABAAAAAQAAAAAAAAAIAAgACAAIAAEAAAABAAAAAQAAAAEAAAB0aWZmZmlsZS5weQAAAAAAAAAAAAAAHhQKgCo/Y/8=";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { extra: 0, source: [30, 20, 10, 128], pixel: [30, 20, 10, 255], hasAlpha: false },
        { extra: 1, source: [30, 20, 10, 128], pixel: [60, 40, 20, 128], hasAlpha: true },
        { extra: 2, source: [30, 20, 10, 128], pixel: [30, 20, 10, 128], hasAlpha: true },
        { extra: 1, source: [0, 20, 10, 0], pixel: [0, 255, 255, 0], hasAlpha: true },
        { extra: 1, source: [200, 20, 10, 128], pixel: [255, 40, 20, 128], hasAlpha: true },
    ])(`decodes TIFF ExtraSamples=$extra in ${mode} conversion`, async ({ extra, source, pixel, hasAlpha }) => {
        const input = new Uint8Array(Buffer.from(fixture, "base64"));
        const view = new DataView(input.buffer);
        expect(view.getUint16(178, true)).toBe(338);
        view.setUint16(186, extra, true);
        input.set(source, 240);
        const expected = [...pixel, 42, 63, 99, 255];
        const decoded = decodeImage(input);
        expect([...decoded.data]).toEqual(expected);
        expect(decoded.hasAlpha).toBe(hasAlpha);
        expect(decoded.channels).toBe(hasAlpha ? 4 : 3);
        const files = new Map([["/in.tif", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", input);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([...output.data]).toEqual(expected);
        expect(output.hasAlpha).toBe(hasAlpha);
    });
}
