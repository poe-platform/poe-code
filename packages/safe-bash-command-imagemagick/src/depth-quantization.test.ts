import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAANdEVYdGNvbW1lbnQAaGVsbG9VgeXRAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA4OjQ4OjAwKzAwOjAwyByfAgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwODo0ODowMCswMDowMLlBJ74AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDg6NDg6MDArMDA6MDDuVAZhAAAADXRFWHRub3RlAG9yaWdpbmFspRFDOAAAABVJREFUCNdjPBEpx8DAwMDAwMQAAwAXVAFDa/2bLwAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        [["-depth", "4"], [204, 85, 34, 255]],
        [["-set", "depth", "4"], [200, 89, 30, 255]],
        [["-depth", "4", "+depth"], [204, 85, 34, 255]],
        [["-channel", "R", "-depth", "4"], [204, 89, 30, 255]],
    ] as [string[], number[]][])(`quantizes samples only for the depth operator via ${mode}: %j`, async (options, pixel) => {
        const files = new Map([["/in.png", new Uint8Array(input)], ["/out.png", new TextEncoder().encode("keep")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.png", ...options, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([3, 2]);
        expect([...decoded.data]).toEqual(Array.from({ length: 6 }, () => pixel).flat());
        const textKeys: string[] = [];
        for (let offset = 8; offset + 12 <= output.length;) {
            const length = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0);
            const type = new TextDecoder().decode(output.subarray(offset + 4, offset + 8));
            const payload = output.subarray(offset + 8, offset + 8 + length);
            if (["tEXt", "zTXt", "iTXt"].includes(type)) textKeys.push(new TextDecoder().decode(payload.subarray(0, payload.indexOf(0))));
            offset += length + 12;
        }
        expect(textKeys).not.toContain("depth");
        expect(decoded.properties).toMatchObject({ note: "original", comment: "hello" });
    });
}
