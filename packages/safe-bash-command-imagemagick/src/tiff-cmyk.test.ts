import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independently encoded by ImageMagick from three raw CMYK pixels:
// (0,255,255,0), (255,0,255,0), (0,0,0,128). PhotometricInterpretation=5.
const input = Buffer.from("SUkqABQAAAAA//8A/wD/AAAAAIAQAAABAwABAAAAAwAAAAEBAwABAAAAAQAAAAIBAwAEAAAA2gAAAAMBAwABAAAAAQAAAAYBAwABAAAABQAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAABAAAABYBAwABAAAAAQAAABcBBAABAAAADAAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD4BBQACAAAAEgEAAD8BBQAGAAAA4gAAAEwBAwABAAAAAQAAAAAAAAAIAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=", "base64");
const expected = [255, 0, 0, 255, 0, 255, 0, 255, 127, 127, 127, 255];
// The same native fixture with an explicit, unassociated fifth alpha channel.
const transparentInput = Buffer.from("SUkqABgAAAAA//8AgP8A/wD/AAAAgEAAEQAAAQMAAQAAAAMAAAABAQMAAQAAAAEAAAACAQMABQAAAOoAAAADAQMAAQAAAAEAAAAGAQMAAQAAAAUAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAUAAAAWAQMAAQAAAAEAAAAXAQQAAQAAAA8AAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQA+AQUAAgAAACQBAAA/AQUABgAAAPQAAABMAQMAAQAAAAEAAABSAQMAAQAAAAIAAAAAAAAACAAIAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=", "base64");

it("retains CMYK TIFF inks alongside opaque RGB pixels", () => {
    const image = decodeImage(input);
    expect(Array.from(image.data)).toEqual(expected);
    expect(image).toMatchObject({ hasAlpha: false, channels: 4, space: "cmyk" });
    expect(Array.from(image.hueSamples!)).toEqual([0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 128 / 255]);
});

for (const alpha of [false, true]) {
    it.each(["sync", "buffered", "retained"] as const)(`converts CMYK TIFF to PNG (alpha=${alpha}, %s)`, async mode => {
        const source = alpha ? transparentInput : input;
        const files = new Map<string, Uint8Array>([["/in.tif", source]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", source);
        const args = ["/in.tif", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(alpha ? [255, 0, 0, 128, 0, 255, 0, 255, 127, 127, 127, 64] : expected);
    });
}

for (const mode of ["sync", "retained"] as const) {
    it.each([false, true])(`${mode}: preserves TIFF inks independently of alpha (%s)`, async alpha => {
        const source = alpha ? transparentInput : input;
        const files = new Map([["/in.tif", source]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tif", source);
        const args = ["/in.tif", "-depth", "8", "cmyka:/out"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Array.from(output)).toEqual([0, 255, 255, 0, alpha ? 128 : 255, 255, 0, 255, 0, 255, 0, 0, 0, 128, alpha ? 64 : 255]);
    });
}
