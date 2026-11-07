import { expect, it } from "vitest";
import { deflateSync, crc32 } from "node:zlib";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

function chunk(type: string, data: Uint8Array) {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length); out.write(type, 4); out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
}
function icon(kind: number, dib: boolean) {
    const payloads = [16, 32, 64].map((n, index) => {
        if (dib) {
            const stride = Math.ceil(n / 32) * 4, out = Buffer.alloc(40 + n * n * 4 + stride * n);
            out.writeUInt32LE(40); out.writeInt32LE(n, 4); out.writeInt32LE(n * 2, 8);
            out.writeUInt16LE(1, 12); out.writeUInt16LE(32, 14);
            for (let p = 0; p < n * n; p++) { out[40 + p * 4 + 2 - index] = 255; out[43 + p * 4] = 255; }
            out[40 + (n - 1) * n * 4 + 3] = 0;
            out[40 + n * n * 4 + (n - 1) * stride] = 128;
            return out;
        }
        const header = Buffer.alloc(13); header.writeUInt32BE(n); header.writeUInt32BE(n, 4); header[8] = 8; header[9] = 6;
        const raw = Buffer.alloc(n * (n * 4 + 1));
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const p = y * (n * 4 + 1) + 1 + x * 4; raw[p + index] = 255; raw[p + 3] = x || y ? 255 : 0; }
        return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
    });
    const header = Buffer.alloc(54); header.writeUInt16LE(kind, 2); header.writeUInt16LE(3, 4);
    let offset = header.length;
    payloads.forEach((bytes, i) => { const p = 6 + i * 16; header[p] = header[p + 1] = [16,32,64][i]!; header.writeUInt16LE(kind === 1 ? 1 : 3, p + 4); header.writeUInt16LE(kind === 1 ? 32 : 7, p + 6); header.writeUInt32LE(bytes.length, p + 8); header.writeUInt32LE(offset, p + 12); offset += bytes.length; });
    return Buffer.concat([header, ...payloads]);
}

it.each(["sync", "buffered", "retained"] as const)("extracts ICO/CUR directories, scenes and append (%s)", async mode => {
    for (const kind of [1, 2]) for (const dib of [false, true]) {
        const bytes = icon(kind, dib), files = new Map<string, Uint8Array>([["input.ico", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.ico", bytes);
        const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const read = async (path: string) => decodeImage(mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path)!);
        for (const args of [["input.ico", "out-%d.png"], ["input.ico[1]", "selected.png"], ["input.ico", "-append", "append.png"]]) {
            expect(await run(args)).toMatchObject({ exitCode: 0, stderr: "" });
        }
        for (let i = 0; i < 3; i++) {
            const frame = await read(`out-${i}.png`), color = [0, 0, 0, 255]; color[i] = 255;
            expect([frame.width, frame.height]).toEqual([[16,16],[32,32],[64,64]][i]);
            expect(frame.data[3]).toBe(0); expect([...frame.data.slice(4, 8)]).toEqual(color);
        }
        expect(await read("selected.png")).toMatchObject({ width: 32, height: 32 });
        expect(await read("append.png")).toMatchObject({ width: 64, height: 112 });
    }
});
