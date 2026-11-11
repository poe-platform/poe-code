import { crc32 } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 preserves these cHRM integers on a plain PNG rewrite.
const coordinates = [31400, 35100, 68000, 32000, 26500, 69000, 15000, 6000];
const nativePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAgMAAABmjvwnAAAAIGNIUk0AAHqoAACJHAABCaAAAH0AAABnhAABDYgAADqYAAAXcEglrIMAAAAJUExURf8AACCAQAAA/8pw558AAAAKSURBVAjXY5AAAAAaABmHBux0AAAAAElFTkSuQmCC", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([true, false])("retains custom PNG chromaticity (%s) via " + mode, async tagged => {
        const input = tagged ? nativePng : Uint8Array.from([...nativePng.subarray(0, 33), ...nativePng.subarray(77)]);
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "/output.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect([...decodeImage(output).data]).toEqual([255, 0, 0, 255, 32, 128, 64, 255, 0, 0, 255, 255]);
        const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
        const chunks: string[] = [];
        const actual: number[][] = [];
        for (let pos = 8; pos + 12 <= output.length; pos += outputView.getUint32(pos) + 12) {
            const name = String.fromCharCode(...output.subarray(pos + 4, pos + 8));
            chunks.push(name);
            if (name !== "cHRM") continue;
            expect(outputView.getUint32(pos)).toBe(32);
            expect(outputView.getUint32(pos + 40)).toBe(crc32(output.subarray(pos + 4, pos + 40)));
            actual.push(coordinates.map((_, index) => outputView.getUint32(pos + 8 + index * 4)));
        }
        expect(actual).toEqual(tagged ? [coordinates] : []);
        if (tagged) {
            expect(chunks.indexOf("cHRM")).toBeLessThan(chunks.indexOf("IDAT"));
            if (chunks.includes("PLTE")) expect(chunks.indexOf("cHRM")).toBeLessThan(chunks.indexOf("PLTE"));
        }
    });
}
