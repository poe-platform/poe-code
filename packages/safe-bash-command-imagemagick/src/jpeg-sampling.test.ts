import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const [width, height] of [[8, 8], [19, 17]] as const)
for (const quality of [75, 89, 90])
it(`writes native JPEG sampling at quality ${quality} for ${width}x${height}`, async () => {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = await sharp(pixels, { raw: { width: width, height: height, channels: 4 } }).png().toBuffer();
    const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = ["in.png", "-quality", String(quality), "-write", "copy.jpg", "out.jpg"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem, cwd: "/" })).exitCode).toBe(0);
    for (const name of ["copy.jpg", "out.jpg"]) {
        const bytes = files.get(name)!;
        expect(await fs.readFile(`/${name}`)).toEqual(bytes);
        let offset = 2;
        while (offset < bytes.length && bytes[offset + 1] !== 0xc0) offset += 2 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
        expect([bytes[offset + 11], bytes[offset + 14], bytes[offset + 17]]).toEqual([quality < 90 ? 0x22 : 0x11, 0x11, 0x11]);
        const decoded = decodeImage(bytes);
        expect([decoded.width, decoded.height]).toEqual([width, height]);
    }
});
