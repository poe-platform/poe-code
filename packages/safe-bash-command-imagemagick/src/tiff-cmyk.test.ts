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

it("decodes CMYK TIFF ink as opaque RGB", () => {
    const image = decodeImage(input);
    expect(Array.from(image.data)).toEqual(expected);
    expect(image).toMatchObject({ hasAlpha: false, channels: 3, space: "srgb" });
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
