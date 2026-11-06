import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["-write", "+write", "final"])(`preserves the image list after %s TIFF in ${mode}`, async option => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = [255, 0, 0, 255, 0, 0, 255, 255];
        for (const [index, name] of ["r.png", "b.png"].entries()) {
            const { data } = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: new Uint8Array(pixels.slice(index * 4, index * 4 + 4)) }, { format: "png" });
            files.set(name, data);
            await filesystem.writeFile(`/${name}`, data);
        }
        const args = option === "final" ? ["r.png", "b.png", "mid.tiff"] : ["r.png", "b.png", option, "mid.tiff", "+append", "out.png"];
        const retained = mode === "retained" || mode === "command";
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = retained ? await filesystem.readFile("/mid.tiff") : files.get("mid.tiff")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const pages = [];
        for (let offset = view.getUint32(4, true); offset !== 0;) {
            const page = bytes.slice();
            new DataView(page.buffer).setUint32(4, offset, true);
            pages.push(decodeImage(page));
            offset = view.getUint32(offset + 2 + view.getUint16(offset, true) * 12, true);
            expect(pages.length).toBeLessThanOrEqual(2);
        }
        expect(pages).toHaveLength(2);
        expect(pages.map(page => [...page.data]).flat()).toEqual(pixels);
        if (option === "final") return;
        const final = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([final.width, final.height]).toEqual([2, 1]);
        expect([...final.data]).toEqual(pixels);
    });
}

it.each([false, true])("preserves three differently sized TIFF pages, retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "1x1", "xc:red", "-size", "2x1", "xc:blue", "-size", "1x3", "xc:lime", "out.tiff"];
    expect(await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const bytes = retained ? await filesystem.readFile("/out.tiff") : files.get("out.tiff")!;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = view.getUint32(4, true);
    for (const [width, height, pixel] of [[1, 1, [255, 0, 0, 255]], [2, 1, [0, 0, 255, 255]], [1, 3, [0, 255, 0, 255]]] as const) {
        expect(offset).toBeGreaterThan(0);
        const page = bytes.slice();
        new DataView(page.buffer).setUint32(4, offset, true);
        const decoded = decodeImage(page);
        expect([decoded.width, decoded.height]).toEqual([width, height]);
        expect([...decoded.data]).toEqual(Array.from({ length: width * height }, () => pixel).flat());
        offset = view.getUint32(offset + 2 + view.getUint16(offset, true) * 12, true);
    }
    expect(offset).toBe(0);
});

it.each([false, true])("keeps +adjoin TIFF pages in separate files, retained=%s", async retained => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    expect(await runMagickCli(["-size", "1x1", "xc:red", "xc:blue", "+adjoin", "out.tiff"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    for (const [index, pixel] of [[255, 0, 0, 255], [0, 0, 255, 255]].entries()) {
        const bytes = retained ? await filesystem.readFile(`/out-${index}.tiff`) : files.get(`out-${index}.tiff`)!;
        expect([...decodeImage(bytes).data]).toEqual(pixel);
    }
});
