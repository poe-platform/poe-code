import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Read tag 297 itself; a decoder's inferred page index is not PageNumber.
function inspect(bytes: Uint8Array, firstScene: number, pageCount: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = bytes[0] === 73, big = view.getUint16(2, little) === 43;
    const countBytes = big ? 8 : 2, entryBytes = big ? 20 : 12;
    const offsetAt = (at: number) => big ? Number(view.getBigUint64(at, little)) : view.getUint32(at, little);
    let offset = offsetAt(big ? 8 : 4);
    for (let page = 0; page < pageCount; page++) {
        expect(offset).toBeGreaterThan(0);
        const count = big ? Number(view.getBigUint64(offset, little)) : view.getUint16(offset, little);
        let pageNumber: number[] | undefined;
        for (let index = 0; index < count; index++) {
            const at = offset + countBytes + index * entryBytes;
            if (view.getUint16(at, little) !== 297) continue;
            expect(view.getUint16(at + 2, little)).toBe(3); // SHORT
            expect(big ? Number(view.getBigUint64(at + 4, little)) : view.getUint32(at + 4, little)).toBe(2);
            const valueAt = at + (big ? 12 : 8);
            pageNumber = [view.getUint16(valueAt, little), view.getUint16(valueAt + 2, little)];
        }
        expect(pageNumber).toEqual([(firstScene + page) & 65535, pageCount]);
        const selected = bytes.slice(), header = new DataView(selected.buffer);
        if (big) header.setBigUint64(8, BigInt(offset), little);
        else header.setUint32(4, offset, little);
        expect([...decodeImage(selected).data]).toEqual(page === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
        offset = offsetAt(offset + countBytes + count * entryBytes);
    }
    expect(offset).toBe(0);
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { pages: 1, scene: undefined, coder: "TIFF", endian: "lsb" },
        { pages: 2, scene: undefined, coder: "TIFF", endian: "lsb" },
        { pages: 2, scene: 4, coder: "TIFF", endian: "lsb" },
        { pages: 2, scene: 4, coder: "TIFF", endian: "msb" },
        { pages: 2, scene: 4, coder: "TIFF64", endian: "lsb" },
        { pages: 2, scene: 4, coder: "TIFF64", endian: "msb" },
        { pages: 2, scene: 65535, coder: "TIFF", endian: "msb" }
    ])(`writes PageNumber for each directory in ${mode}: %j`, async ({ pages, scene, coder, endian }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["xc:red", ...(pages === 2 ? ["xc:blue"] : []), "-depth", "8", "-define", `tiff:endian=${endian}`,
            ...(scene === undefined ? [] : ["-scene", String(scene)]), "-write", `${coder}:copy.tif`, "-scene", "9", `${coder}:out.tif`];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [name, start] of [["copy.tif", scene ?? 0], ["out.tif", 9]] as const) {
            inspect(mode === "retained" || mode === "command" ? await fs.readFile(`/${name}`) : files.get(name)!, start, pages);
        }
    });
}

it("writes the reported two-page TIFF to command stdout", async () => {
    const chunks: Uint8Array[] = [];
    const result = await createMagickCommand().execute({
        command: "magick", args: ["xc:red", "xc:blue", "-scene", "4", "-depth", "8", "tiff:-"],
        cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    inspect(Buffer.concat(chunks), 4, 2);
});
