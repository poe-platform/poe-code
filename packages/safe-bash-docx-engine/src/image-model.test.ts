import { expect, it } from "vitest";
import { Image } from "./image-model.js";
import { Inches, Emu } from "./formatting-values.js";
import { rasterPng, rasterJpeg, rasterGif, rasterBmp, rasterTiff, pngChunk, joinBytes } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { DocumentBudget } from "./budget.js";
import { ResourceLimitError, InvalidValueError, InputTypeError } from "./archive.js";
import type { DocxLength } from "./operation-types.js";
import { UnsupportedEditError } from "./xml-write.js";

it.each([[rasterPng(), "image/png", "png"], [rasterJpeg(), "image/jpeg", "jpg"], [rasterGif(), "image/gif", "gif"], [rasterBmp(), "image/bmp", "bmp"], [rasterTiff(), "image/tiff", "tiff"]] as const)("admits original bytes with synchronous immutable metadata %s", async (source, mime, extension) => {
  const pending = Image.from_blob(source); expect(pending).toBeInstanceOf(Promise); const image = await pending;
  expect(image.content_type).toBe(mime); expect(image.filename).toBe("image." + extension); expect(image.ext).toBe(extension); expect(image.blob).toEqual(source); expect(image.blob).not.toBe(source); expect(Object.isFrozen(image)).toBe(true);
});
it("provides independent per-axis DPI, native Inches and shared scaled tuples", async () => {
  const image = await Image.from_blob(rasterJpeg(150, 75, [1, 72, 200]), textContext);
  expect([image.px_width, image.px_height, image.horz_dpi, image.vert_dpi]).toEqual([150, 75, 72, 200]); expect(image.width.unit).toBe("in"); expect(image.width.emu).toBe(1905000); expect(image.height.emu).toBe(342900);
  for (const [width, height, expected] of [[undefined, null, [1905000,342900]], [Emu(100), undefined, [100,18]], [null, Emu(500), [2778,500]], [1500, Inches(1), [1500,914400]]] as const) {
    const tuple = image.scaled_dimensions(width, height); expect(tuple.map(length => length.emu)).toEqual(expected); expect(Object.isFrozen(tuple)).toBe(true);
  }
});
it("preserves fractional physical DPI and unrounded native aspect ratio", async () => {
  const image = await Image.from_blob(rasterPng(1, 1, [1654,945,1])); expect(image.horz_dpi).toBe(42.0116); expect(image.vert_dpi).toBe(24.003);
  const unequal = await Image.from_blob(rasterJpeg(1, 1, [1,73,79])); expect(unequal.scaled_dimensions(Inches(1))[1].emu).toBe(844952);
});
it("keeps admitted bytes and SHA-1 independent of caller and getter mutation", async () => {
  const source = rasterPng(), original = new Uint8Array(source), pending = Image.from_blob(source); source.fill(0); const image = await pending; const copy = image.blob; copy.fill(1);
  expect(image.blob).toEqual(original); expect(image.sha1).toMatch(/^[a-f0-9]{40}$/); expect(image.sha1).toBe("4c5fb6b51d61dfb4c66132d05f455ffbebf13028");
});
it("validates actual extents independently of unused tiny native size", async () => {
  const image = await Image.from_blob(rasterPng(1, 1, [4294967295,4294967295,1])); expect(image.scaled_dimensions(Inches(1), Inches(1)).map(value => value.emu)).toEqual([914400,914400]); expect(() => image.width).toThrow();
});
it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe explicit dimensions %s", async value => {
  const image = await Image.from_blob(rasterPng()); expect(() => image.scaled_dimensions(value, 100)).toThrow();
});
it("budgets repeated defensive blob reads before copying", async () => {
  const budget = new DocumentBudget({}, textContext.signal); await Image.from_blob(rasterPng(), { ...textContext, budget }); const used = budget.usage.retainedBytes;
  const limited = await Image.from_blob(rasterPng(), { ...textContext, budget: new DocumentBudget({ retainedBytes: used + rasterPng().length }, textContext.signal) }); expect(limited.blob.length).toBe(rasterPng().length); expect(() => limited.blob).toThrow(ResourceLimitError);
});
it.each([[34,"ccd32de1929fe7c3869f079675c5caa1afd67b99"],[35,"267e453d656c941724a090df550d6645f80514f3"],[42,"75581237ff451e2656b09a4d1653e729fe17ed98"],[43,"a1ee56f46b227e3789b3f5961e56c7b98a852509"],[44,"fde69c693e8e310396fd32c7a37d8c0b782e0801"]] as const)("hashes exact original admitted bytes across padding and block boundaries %s", async (length, expected) => {
  const png = rasterPng(), source = joinBytes(png.subarray(0,33), pngChunk("tEXt", new Uint8Array(length).fill(97)), png.subarray(33)); expect((await Image.from_blob(source)).sha1).toBe(expected);
});
it.each([
  [rasterPng(),"image/png","png",1,1,72,72,12700,12700,100000],
  [rasterPng(2,3,[1654,945,1]),"image/png","png",2,3,42.0116,24.003,43531,114286,262540],
  [rasterJpeg(24,42,[1,333,444]),"image/jpeg","jpg",24,42,333,444,65903,86497,131250],
  [rasterJpeg(2,3,[0,1,1],rasterTiff(true,2,[333,1],[444,1])),"image/jpeg","jpg",2,3,333,444,5492,6178,112500],
  [rasterGif("87a"),"image/gif","gif",1,1,72,72,12700,12700,100000],
  [rasterGif("89a"),"image/gif","gif",1,1,72,72,12700,12700,100000],
  [rasterBmp(26,43,7864,0),"image/bmp","bmp",26,43,199.7456,72,119023,546100,458817],
  [rasterTiff(true),"image/tiff","tiff",1,1,144,72,6350,12700,200000],
  [rasterTiff(false,2,[72,1],[144,1]),"image/tiff","tiff",1,1,72,144,12700,6350,50000],
  [rasterTiff(false,3,[85,2],[337,4]),"image/tiff","tiff",1,1,107.95,213.995,8471,4273,50445]
] as const)("exposes exact pixel, DPI, native and scaled observations for original format variants %s", async (source,mime,extension,width,height,xDpi,yDpi,nativeWidth,nativeHeight,scaledHeight) => {
  const image = await Image.from_blob(source); expect(image.blob).toEqual(source); expect(image.content_type).toBe(mime); expect(image.ext).toBe(extension); expect([image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual([width,height,xDpi,yDpi]);
  expect([image.width.emu,image.height.emu]).toEqual([nativeWidth,nativeHeight]); expect(image.scaled_dimensions().map(value => value.emu)).toEqual([nativeWidth,nativeHeight]); expect(image.scaled_dimensions(100000).map(value => value.emu)).toEqual([100000,scaledHeight]); expect(image.scaled_dimensions(Emu(23),Inches(1)).map(value => value.emu)).toEqual([23,914400]);
});
it("uses typed neutral errors for nonfinite numeric and unsafe native dimensions", async () => {
  const image = await Image.from_blob(rasterPng()); expect(() => image.scaled_dimensions(NaN, 1)).toThrow(InvalidValueError);
  const tiny = await Image.from_blob(rasterPng(1,1,[4294967295,4294967295,1])); expect(() => tiny.width).toThrow(InvalidValueError);
});
it.each([{value:"1",unit:"emu"},{value:true,unit:"emu"},{value:null,unit:"emu"},{unit:"emu"},{value:1}])("refuses dimension type coercion and missing own fields %s", async value => {
  const image = await Image.from_blob(rasterPng()); expect(() => image.scaled_dimensions(value as unknown as DocxLength, 1)).toThrow(InputTypeError);
});
it("refuses dimension accessors without invoking them", async () => {
  const image = await Image.from_blob(rasterPng()); let invoked = false; const value = Object.defineProperty({unit:"emu"}, "value", {get() { invoked = true; return 1; }});
  expect(() => image.scaled_dimensions(value as DocxLength, 1)).toThrow(InputTypeError); expect(invoked).toBe(false);
});
it("refuses JavaScript construction outside the always-async admission factories", () => {
  const RuntimeImage = Image as unknown as new (acquired: {bytes:Uint8Array;filename:null;context:typeof textContext}) => Image;
  expect(() => new RuntimeImage({bytes:rasterPng(),filename:null,context:textContext})).toThrow(InputTypeError);
});
it("refuses unrecognized image signatures and invalid factory argument types asynchronously", async () => {
  const invalid = Image.from_blob(new Uint8Array(73)); expect(invalid).toBeInstanceOf(Promise); await expect(invalid).rejects.toThrow(UnsupportedEditError);
  const wrongType = Image.from_blob("bytes" as unknown as Uint8Array); expect(wrongType).toBeInstanceOf(Promise); await expect(wrongType).rejects.toThrow(InputTypeError);
});
it("substitutes native DPI independently for either missing physical axis", async () => {
  for (const [source,expected] of [[rasterPng(1,1,[0,2835,1]),[72,72.009]],[rasterPng(1,1,[2835,0,1]),[72.009,72]],[rasterTiff(true,2,[72,1],[144,1]),[72,144]]] as const) {
    const image = await Image.from_blob(source); expect([image.horz_dpi,image.vert_dpi]).toEqual(expected);
  }
});
