import { expect, it } from "vitest";
import { decodeImage, encodeImage, readImageMetadata } from "./index.js";
import type { RgbaImage } from "../ast.js";

const image: RgbaImage = {width:1,height:1,data:Uint8Array.of(255,0,0,255),format:"png",space:"srgb",channels:3,depth:"uchar",density:144,hasAlpha:false,orientation:6,resolution:{x:144,y:72,unit:"inch"}};
for (const format of ["png", "jpeg", "tiff"] as const) {
  it(`honors an explicit scalar density override in ${format}`, () => {
    const bytes = encodeImage(image, {format,density:300}).data;
    const decoded = decodeImage(bytes);
    expect(decoded.density).toBe(300);
    expect(decoded.resolution?.x).toBe(decoded.resolution?.y);
  });
  it(`retains independent centimeter axes in ${format}`, () => {
    const bytes = encodeImage({...image,resolution:{x:60,y:30,unit:"cm"}}, {format}).data;
    const metadata = readImageMetadata(bytes), decoded = decodeImage(bytes);
    expect(decoded.resolution).toEqual(metadata.resolution);
    expect(decoded.resolution).toEqual(format === "png" ? {x:6000,y:3000,unit:"meter"} : {x:60,y:30,unit:"cm"});
  });
}

for (const tiffBig of [false, true]) {
  it(`omits TIFF resolution when only the default density is present (BigTIFF=${tiffBig})`, () => {
    const { resolution: ignoredResolution, ...untagged } = image;
    const bytes = encodeImage({ ...untagged, density: 72 }, { format: "tiff", tiffBig }).data;
    expect(readImageMetadata(bytes).resolution).toBeUndefined();
    expect(decodeImage(bytes).data).toEqual(image.data);
  });
}
