import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const palette = [[240,20,30,255], [40,210,60,255], [70,80,230,255], [200,170,90,255]];
const fixtures = [
    { name: "literal RLE4", base64: "Qk1SAAAAAAAAAEYAAAAoAAAAAwAAAAIAAAABAAQAAgAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAHhTwADzSKADmUEYAWqrIAAADMhAAAAADASAAAQ==", indices: [0,1,2,3,2,1] },
    { name: "literal RLE8", base64: "Qk1WAAAAAAAAAEYAAAAoAAAAAwAAAAIAAAABAAgAAQAAABAAAAAAAAAAAAAAAAQAAAAAAAAAHhTwADzSKADmUEYAWqrIAAADAwIBAAAAAAMAAQIAAAE=", indices: [0,1,2,3,2,1] },
    { name: "encoded RLE4", base64: "Qk1OAAAAAAAAAEYAAAAoAAAAAwAAAAIAAAABAAQAAgAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAHhTwADzSKADmUEYAWqrIAAMyAAADAQAB", indices: [0,1,0,3,2,3] },
    { name: "encoded RLE8", base64: "Qk1QAAAAAAAAAEYAAAAoAAAAAwAAAAIAAAABAAgAAQAAAAoAAAAAAAAAAAAAAAQAAAAAAAAAHhTwADzSKADmUEYAWqrIAAMDAAACAQECAAE=", indices: [1,1,2,3,3,3] },
    { name: "uncompressed control", base64: "Qk1OAAAAAAAAAEYAAAAoAAAAAwAAAAIAAAABAAQAAAAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAHhTwADzSKADmUEYAWqrIADIQAAABIAAA", indices: [0,1,2,3,2,1] }
];
function rleFixture(bpp: number, width: number, height: number, packets: number[]): Buffer {
    const header = Buffer.from(fixtures[0]!.base64, "base64").subarray(0, 70);
    header.writeInt32LE(width, 18);
    header.writeInt32LE(height, 22);
    header.writeUInt16LE(bpp, 28);
    header.writeUInt32LE(bpp === 4 ? 2 : 1, 30);
    header.writeUInt32LE(70 + packets.length, 2);
    header.writeUInt32LE(packets.length, 34);
    return Buffer.concat([header, Buffer.from(packets)]);
}
for (const bpp of [4, 8]) {
    fixtures.push({ name: `delta and early end RLE${bpp}`, base64: rleFixture(bpp, 4, 3, [1,bpp === 4 ? 0x30 : 3,0,2,1,1,1,bpp === 4 ? 0x20 : 2,0,1,255,255]).toString("base64"), indices: [0,0,0,0,0,0,2,0,3,0,0,0] });
    fixtures.push({ name: `word padding RLE${bpp}`, base64: rleFixture(bpp, 5, 2, bpp === 4 ? [0,5,0x01,0x23,0x10,0xff,0,0,5,0x12,0,0,0,1] : [0,5,0,1,2,3,1,0xff,0,0,5,2,0,0,0,1]).toString("base64"), indices: bpp === 4 ? [1,2,1,2,1,0,1,2,3,1] : [2,2,2,2,2,0,1,2,3,1] });
}
for (const fixture of fixtures) for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`decodes ${fixture.name} (${mode})`, async () => {
        const bytes = Buffer.from(fixture.base64, "base64");
        const files = new Map<string, Uint8Array>([["/in.bmp", bytes]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", bytes);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(fixture.indices.flatMap(index => palette[index]!));
    });
}

for (const packets of [[0], [0,3,1], [0,2,1], [4,1,0,1], [0,2,0,3,0,1], [3,1]]) {
    it(`rejects truncated or out-of-bounds RLE packets ${packets}`, async () => {
        const bytes = rleFixture(8, 3, 2, packets);
        expect(() => decodeImage(bytes)).toThrow(/BMP RLE/);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", bytes);
        expect(await runConvertCli(["/in.bmp", "/out.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 1 });
    });
}
