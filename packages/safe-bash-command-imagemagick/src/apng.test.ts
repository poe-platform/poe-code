import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { crc32 } from "node:zlib";
import { runConvertCli, runConvertCliSync } from "./index.js";

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function makeChunk(type: string, data: Uint8Array): Uint8Array {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length); bytes.write(type, 4); bytes.set(data, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
}

it.each(["sync", "buffered", "retained"] as const)("writes one APNG with ordered frames (%s)", async mode => {
    for (const destination of ["out.apng", "APNG:out.png", "APNG:-"]) {
        for (const intermediate of [false, true]) {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const source = runConvertCliSync(["-size", "2x2", "-delay", "20", "xc:red", "-delay", "40", "xc:lime", "-delay", "20", "xc:blue", "-loop", "3", "input.gif"], files);
            expect(source.exitCode).toBe(0);
            await fs.writeFile("/input.gif", files.get("input.gif")!);
            const args = ["input.gif", ...(intermediate ? ["-write", destination, "null:"] : [destination])];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const path = destination === "out.apng" ? "out.apng" : "out.png";
            const bytes = destination.endsWith(":-") ? result.stdoutBytes : mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path);
            expect(bytes).toBeDefined();
            const chunks: { type: string; data: Uint8Array }[] = [];
            for (let offset = 8; offset < bytes!.length;) {
                const length = new DataView(bytes!.buffer, bytes!.byteOffset + offset, 4).getUint32(0);
                expect(new DataView(bytes!.buffer, bytes!.byteOffset + offset + 8 + length, 4).getUint32(0)).toBe(crc32(bytes!.subarray(offset + 4, offset + 8 + length)));
                chunks.push({ type: new TextDecoder().decode(bytes!.subarray(offset + 4, offset + 8)), data: bytes!.slice(offset + 8, offset + 8 + length) });
                offset += length + 12;
            }
            const animation = chunks.find(chunk => chunk.type === "acTL")!;
            expect(animation).toBeDefined();
            expect(new DataView(animation.data.buffer).getUint32(0)).toBe(3);
            expect(new DataView(animation.data.buffer).getUint32(4)).toBe(3);
            expect(chunks.filter(chunk => chunk.type === "fcTL")).toHaveLength(3);
            const header = chunks[0]!.data;
            const frames: Uint8Array[][] = [];
            let sequence = 0;
            for (const chunk of chunks) {
                if (chunk.type === "fcTL") {
                    const view = new DataView(chunk.data.buffer);
                    expect(view.getUint32(0)).toBe(sequence++);
                    expect(view.getUint16(20) / (view.getUint16(22) || 100)).toBe([0.2, 0.4, 0.2][frames.length]);
                    frames.push([PNG_SIGNATURE, makeChunk("IHDR", header)]);
                } else if (chunk.type === "IDAT" || chunk.type === "fdAT") {
                    if (chunk.type === "fdAT") expect(new DataView(chunk.data.buffer).getUint32(0)).toBe(sequence++);
                    frames.at(-1)!.push(makeChunk("IDAT", chunk.type === "fdAT" ? chunk.data.slice(4) : chunk.data));
                }
            }
            expect(frames.map(parts => {
                parts.push(makeChunk("IEND", new Uint8Array()));
                return [...decodeImage(Uint8Array.from(parts.flatMap(part => [...part]))).data.slice(0, 4)];
            })).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
            expect([...files.keys()].some(name => name.includes("out-"))).toBe(false);
            expect((await fs.readdir("/")).some(entry => entry.name.includes("out-"))).toBe(false);
        }
    }
});

it.each(["sync", "retained"] as const)("keeps explicit scene splitting for APNG (%s)", async mode => {
    for (const output of [["+adjoin", "out.apng"], ["out-%d.apng"]]) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:blue", ...output];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        for (let frame = 0; frame < 2; frame++) {
            const bytes = mode === "sync" ? files.get(`out-${frame}.apng`)! : await fs.readFile(`/out-${frame}.apng`);
            expect([...decodeImage(bytes).data]).toEqual(frame === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
            expect(new DataView(bytes.buffer, bytes.byteOffset + 41, 4).getUint32(0)).toBe(1);
        }
    }
});
