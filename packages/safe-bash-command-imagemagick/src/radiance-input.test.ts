import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick-generated RGBE: 8x2, RGB pixel i = [(i*17)%256,(10+i*31)%256,(40+i*47)%256].
const fixture = "Iz9SQURJQU5DRQpHQU1NQT0xClBSSU1BUklFUz0wIDAgMCAwIDAgMCAwIDAKRk9STUFUPTMyLWJpdF9ybGVfcmdiZQoKLVkgMiArWCA4CgICAAgIAAsQEA4uIi8IGC1CRT3AjcQIrcP07MYDDSoIe31+f4B/gIACAgAICH5RZv6audqACAADDTo1VoBaCLOf/Q0bQn1oCH+AgH+AgICB";
for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`decodes native Radiance RGBE colors (${mode})`, async () => {
        const bytes = new Uint8Array(Buffer.from(fixture, "base64"));
        const files = new Map([["/in.hdr", bytes]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.hdr", bytes);
        const args = ["/in.hdr", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([8, 2]);
        const expected = Buffer.from("000000c00568016005a01860040010803d000800228076000e003d00c5ff17006000018022008cff0d002f00c3ff2a003f0000005980510003009eff66000d00fcff7f001d00068099ff35001b00b8ff56004200d9ff80007d00ffffb3ffcfff", "hex");
        const rgb = Array.from(image.data16!).filter((_, i) => i % 4 !== 3);
        expect(rgb).toEqual(Array.from({ length: 48 }, (_, i) => expected.readUInt16BE(i * 2)));
        // Pillow's RGB8 preview takes the high byte of native ImageMagick's 16-bit PNG.
        expect(Array.from(image.data16!.slice(0, 12), value => value >>> 8)).toEqual([0, 0, 5, 255, 1, 5, 24, 255, 4, 16, 61, 255]);
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`preserves HDR values and rejects malformed RLE (${mode})`, async () => {
        const header = new TextEncoder().encode("#?RGBE\nFORMAT=32-bit_rle_rgbe\n\n+Y 1 -X 2\n");
        const bytes = new Uint8Array([...header, 0, 0, 128, 130, 128, 0, 0, 129]);
        const files = new Map([["/in.hdr", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.hdr", bytes);
        const run = () => mode === "sync" ? runConvertCliSync(["/in.hdr", "/out.pfm"], files) : runConvertCli(["/in.hdr", "/out.pfm"], mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(await run()).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.pfm") : files.get("/out.pfm")!);
        expect(Array.from(image.dataFloat!)).toEqual([1, 0, 0, 1, 0, 0, 2, 1]);
        const invalid = new Uint8Array([...header, 1, 1, 1, 2]);
        files.set("/in.hdr", invalid); await filesystem.writeFile("/in.hdr", invalid);
        expect(await run()).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Invalid Radiance repeat run") });
    });
}
