import { describe, expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { decodeXObjectImageToRgba } from "../extract/images.js";

const numbers = (values: readonly number[]) => cosArray(values.map(value => cosNumber(value)));
// Ported from Mozilla PDF.js colorspace_spec.js, DeviceCmykCS.
const samples = [27, 125, 250, 128, 131, 139, 140, 45, 111, 25, 198, 78, 21, 147, 255, 69];
const expected = [135, 81, 18, 114, 102, 97, 112, 144, 75, 188, 98, 27];

describe("PDF.js DeviceCMYK conversion", () => {
  it.each(["k", "K", "scn", "SCN"])("uses the upstream reference colors for %s painting", operator => {
    const doc = PdfDocument.create(), page = doc.addPage([40, 10]);
    const content: string[] = [];
    if (operator === "scn") content.push("/DeviceCMYK cs");
    if (operator === "SCN") content.push("/DeviceCMYK CS");
    for (let i = 0; i < 4; i++) content.push(`${samples.slice(i * 4, i * 4 + 4).map(value => value / 255).join(" ")} ${operator} ${i * 10} 0 10 10 re ${operator === "K" || operator === "SCN" ? "S" : "f"}`);
    page.setRawContentStream(content.join("\n"));
    const colors = page.evaluateDisplayList().paths.flatMap(path => {
      const color = path.fillColor ?? path.strokeColor!;
      return [color.r, color.g, color.b].map(value => Math.round(value * 255));
    });
    expect(colors).toEqual(expected);
  });

  it("ports the upstream floating-point and process-black vectors", () => {
    const doc = PdfDocument.create(), page = doc.addPage([20, 10]);
    page.setRawContentStream("0.1 0.2 0.3 1 k 0 0 10 10 re f 0 0 0 1 k 10 0 10 10 re f");
    const bitmap = page.renderToBitmap({ scale: 1 });
    expect(Array.from(bitmap.data.slice(0, 4))).toEqual([32, 28, 21, 255]);
    expect(Array.from(bitmap.data.slice(40, 44))).toEqual([44, 46, 53, 255]);
  });

  it.each(["direct", "indirect", "indexed"])("uses the same conversion for %s image colors", mode => {
    const doc = PdfDocument.create();
    const colorSpace = mode === "indirect" ? doc.cos.allocateObject(cosName("DeviceCMYK"))
      : mode === "indexed" ? cosArray([cosName("Indexed"), cosName("DeviceCMYK"), cosNumber(3), cosString(new Uint8Array(samples))])
        : cosName("DeviceCMYK");
    const stream = cosStream(new Uint8Array(mode === "indexed" ? [0, 1, 2, 3] : samples), { dict: cosDict({
      Width: cosNumber(4), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: colorSpace,
    }) });
    const image = decodeXObjectImageToRgba(doc.cos, stream, undefined);
    expect(Array.from(image.rgba.filter((_, index) => index % 4 < 3))).toEqual(expected);
  });

  it("applies image Decode before the CMYK conversion", () => {
    const stream = cosStream(new Uint8Array(samples.map(value => 255 - value)), { dict: cosDict({
      Width: cosNumber(4), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceCMYK"),
      Decode: numbers([1, 0, 1, 0, 1, 0, 1, 0]),
    }) });
    const image = decodeXObjectImageToRgba(PdfDocument.create().cos, stream, undefined);
    expect(Array.from(image.rgba.filter((_, index) => index % 4 < 3))).toEqual(expected);
  });

  it("uses the same CMYK conversion for shading functions", () => {
    const doc = PdfDocument.create(), page = doc.addPage([10, 10]);
    dictSet(page.pageDict, "Resources", cosDict({ Shading: cosDict({ Sh: cosDict({
      ShadingType: cosNumber(2), ColorSpace: cosName("DeviceCMYK"), Coords: numbers([0, 0, 10, 0]),
      Function: cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), C0: numbers([0.1, 0.2, 0.3, 1]), C1: numbers([0.1, 0.2, 0.3, 1]), N: cosNumber(1) }),
    }) }) }));
    page.setRawContentStream("/Sh sh");
    expect(Array.from(page.renderToBitmap({ scale: 1 }).data.slice(0, 4))).toEqual([32, 28, 21, 255]);
  });

  it.each(["Separation", "DeviceN"])("converts %s tint outputs consistently in paths and images", family => {
    const doc = PdfDocument.create(), page = doc.addPage([10, 10]);
    const tint = cosDict({ FunctionType: cosNumber(2), Domain: numbers([0, 1]), C0: numbers([0.1, 0.2, 0.3, 1]), C1: numbers([0.1, 0.2, 0.3, 1]), N: cosNumber(1) });
    const colorSpace = cosArray([cosName(family), family === "DeviceN" ? cosArray([cosName("Spot")]) : cosName("Spot"), cosName("DeviceCMYK"), tint]);
    dictSet(page.pageDict, "Resources", cosDict({ ColorSpace: cosDict({ Spot: colorSpace }) }));
    page.setRawContentStream("/Spot cs 1 scn 0 0 10 10 re f");
    expect(Array.from(page.renderToBitmap({ scale: 1 }).data.slice(0, 4))).toEqual([32, 28, 21, 255]);
    const stream = cosStream(new Uint8Array([255]), { dict: cosDict({ Width: cosNumber(1), Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: colorSpace }) });
    expect(Array.from(decodeXObjectImageToRgba(doc.cos, stream, undefined).rgba)).toEqual([32, 28, 21, 255]);
  });
});
