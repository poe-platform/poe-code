import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([undefined, 0.75, 1.2])(`writes gamma metadata without changing pixels via ${mode}: %s`, async gamma => {
        const pixels = Uint8Array.from(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
        const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/input.png", ...(gamma === undefined ? [] : ["-set", "gamma", String(gamma)]), "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const chunks: number[][] = [];
        for (let offset = 8; offset + 12 <= output.length;) {
            const length = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0);
            const type = new TextDecoder().decode(output.subarray(offset + 4, offset + 8));
            if (type === "gAMA") chunks.push([...output.subarray(offset + 8, offset + 8 + length)]);
            offset += length + 12;
        }
        expect(chunks).toEqual(gamma === undefined ? [] : gamma === 0.75 ? [[0, 1, 36, 248]] : [[0, 1, 212, 192]]);
        const decoded = decodeImage(output);
        expect([...decoded.data]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30, 255]).flat());
        expect(decoded.gamma).toBe(gamma);
        expect(decoded.properties?.gamma).toBeUndefined();
    });
}
