import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["-set", "-repage"])(`writes the PNG canvas without changing pixels via ${mode}: %s`, async option => {
        const pixels = Uint8Array.from(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
        const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/input.png", option, ...(option === "-set" ? ["page"] : []), "15x12+2+1", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const canvases: number[][] = [];
        const textKeys: string[] = [];
        for (let offset = 8; offset + 12 <= output.length;) {
            const length = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0);
            const type = new TextDecoder().decode(output.subarray(offset + 4, offset + 8));
            const payload = output.subarray(offset + 8, offset + 8 + length);
            if (type === "caNv") canvases.push([...payload]);
            if (["tEXt", "zTXt", "iTXt"].includes(type)) textKeys.push(new TextDecoder().decode(payload.subarray(0, payload.indexOf(0))));
            offset += length + 12;
        }
        expect(canvases).toEqual([[0, 0, 0, 15, 0, 0, 0, 12, 0, 0, 0, 2, 0, 0, 0, 1]]);
        expect(textKeys).not.toContain("page");
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([3, 2]);
        expect([...decoded.data]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30, 255]).flat());
        expect(decoded.virtualCanvas).toEqual({ width: 15, height: 12, x: 2, y: 1 });
    });
}
