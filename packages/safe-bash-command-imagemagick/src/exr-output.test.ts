import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const sync of [false, true]) for (const destination of ["out.exr", "EXR:out.bin", "exr:-"]) for (const write of [false, true]) {
    it(`writes OpenEXR samples to ${destination}, sync=${sync}, write=${write}`, async () => {
        const pixels = Uint8Array.from({ length: 48 }, (_, i) => {
            const pixel = Math.floor(i / 3);
            return i % 3 === 0 ? pixel * 17 % 256 : i % 3 === 1 ? (10 + pixel * 31) % 256 : (40 + pixel * 47) % 256;
        });
        // Native ImageMagick PNG24 fixture for the RGB grid above.
        const input = Buffer.from("89504e470d0a1a0a0000000d4948445200000008000000020802000000eaf60aba0000001b4944415408d76364e0d21094d7c7442c1d3f2a047fe82321281700f30f0d9a8f67c0c40000000049454e44ae426082", "hex");
        const files = new Map<string, Uint8Array>([["input", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input", input);
        const args = ["input", ...(write ? ["-write", destination, "null:"] : [destination])];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const path = destination === "out.exr" ? "out.exr" : "out.bin";
        const output = Buffer.from((destination === "exr:-" ? result.stdoutBytes : sync ? files.get(path) : await filesystem.readFile("/" + path))!);
        expect(output.readUInt32LE(0)).toBe(20000630);
        expect(output.readUInt32LE(4)).toBe(2);
        let offset = 8;
        const string = () => { const end = output.indexOf(0, offset); const value = output.toString("ascii", offset, end); offset = end + 1; return value; };
        const attributes = new Map<string, Buffer>();
        while (output[offset]) { const name = string(); string(); const size = output.readUInt32LE(offset); offset += 4; attributes.set(name, output.subarray(offset, offset + size)); offset += size; }
        offset++;
        expect([...attributes.get("dataWindow")!]).toEqual([0,0,0,0,0,0,0,0,7,0,0,0,1,0,0,0]);
        expect(attributes.get("compression")![0]).toBe(0);
        expect(attributes.get("channels")!.toString("ascii")).toContain("B");
        for (let y = 0; y < 2; y++) {
            const row = Number(output.readBigUInt64LE(offset + y * 8));
            expect(output.readInt32LE(row)).toBe(y);
            expect(output.readUInt32LE(row + 4)).toBe(8 * 3 * 4);
            for (let channel = 0; channel < 3; channel++) for (let x = 0; x < 8; x++) {
                expect(output.readFloatLE(row + 8 + (channel * 8 + x) * 4)).toBeCloseTo(pixels[(y * 8 + x) * 3 + 2 - channel]! / 255, 6);
            }
        }
    });
}
