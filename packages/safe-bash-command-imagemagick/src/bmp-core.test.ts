import { expect, it } from "vitest";
import { decodeImage, readImageMetadata, readImageMetadataFromSource } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const core = Buffer.from("Qk0yAAAAAAAAABoAAAAMAAAAAwACAAEAGABaqsjmUEY80igAAAAeFPA80ijmUEYAAAA=", "base64");
const rgb = Buffer.from("Qk1OAAAAAAAAADYAAAAoAAAAAwAAAAIAAAABABgAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAWqrI5lBGPNIoAAAAHhTwPNIo5lBGAAAA", "base64");

it("reads CORE dimensions and depth before decoding or allocating pixels", () => {
    expect(readImageMetadata(core)).toMatchObject({ width: 3, height: 2, channels: 3, hasAlpha: false, density: 72 });
    expect(readImageMetadata(core.subarray(0, 26))).toMatchObject({ width: 3, height: 2 });
});

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`converts a CORE BMP to PNG (${mode})`, async () => {
        // Guard decoding against the original enormous dimensions.
        expect(readImageMetadata(core)).toMatchObject({ width: 3, height: 2 });
        const files = new Map<string, Uint8Array>([["/in.bmp", core]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", core);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(decodeImage(output).data).toEqual(decodeImage(rgb).data);
        expect(Array.from(decodeImage(output).data)).toEqual([
            240, 20, 30, 255, 40, 210, 60, 255, 70, 80, 230, 255,
            200, 170, 90, 255, 70, 80, 230, 255, 40, 210, 60, 255
        ]);
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`applies 32-bit BMP channel masks with opaque default alpha (${mode})`, async () => {
        const input = Buffer.from("Qk1aAAAAAAAAAEIAAAAoAAAAAwAAAAIAAAABACAAAwAAABgAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAAD/AAAAAP8A////AAAAAACAgIAA/wAAAAD/AAAAAP8A", "base64");
        const files = new Map<string, Uint8Array>([["/in.bmp", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", input);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
            255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255
        ]);
        expect(readImageMetadata(input)).toMatchObject({ channels: 3, hasAlpha: false });
    });
}

for (const dibSize of [40, 52, 56, 108, 124]) {
    it(`decodes packed 10-bit channels in a ${dibSize}-byte BMP header`, async () => {
        const offset = 14 + Math.max(52, dibSize);
        const input = new Uint8Array(offset + 4);
        const view = new DataView(input.buffer);
        input.set([66, 77]);
        view.setUint32(2, input.length, true);
        view.setUint32(10, offset, true);
        view.setUint32(14, dibSize, true);
        view.setInt32(18, 1, true);
        view.setInt32(22, -1, true);
        view.setUint16(26, 1, true);
        view.setUint16(28, 32, true);
        view.setUint32(30, 3, true);
        view.setUint32(54, 0x3ff00000, true);
        view.setUint32(58, 0x000ffc00, true);
        view.setUint32(62, 0x000003ff, true);
        if (dibSize >= 56) view.setUint32(66, 0xc0000000, true);
        view.setUint32(offset, (2 << 30 | 1023 << 20 | 512 << 10) >>> 0, true);
        const expected = [255, 128, 0, dibSize >= 56 ? 170 : 255];
        expect(Array.from(decodeImage(input).data)).toEqual(expected);
        expect(readImageMetadata(input).hasAlpha).toBe(dibSize >= 56);
        const metadata = await readImageMetadataFromSource({ size: input.length, read: async (position, length) => input.slice(position, position + length) }, new AbortController().signal);
        expect(metadata.hasAlpha).toBe(dibSize >= 56);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.bmp", input);
        expect(await runConvertCli(["/in.bmp", "/out.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Array.from(decodeImage(await filesystem.readFile("/out.png")).data)).toEqual(expected);
    });
}
