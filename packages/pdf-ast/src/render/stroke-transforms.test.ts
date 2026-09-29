import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { PdfDocument } from "../document.js";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { STANDARD_FONT_CFF_BASE64 } from "../fonts/standard-font-data.js";
import { renderDisplayListToBitmap, renderDisplayListToSvg, type RgbaBitmap } from "./raster.js";

function pageWith(content: string) {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  page.setRawContentStream(`0 0 1 RG 10 w ${content}`);
  return page;
}

function pixel(bitmap: RgbaBitmap, x: number, y: number) {
  const offset = ((bitmap.height - 1 - Math.floor(y * 4)) * bitmap.width + Math.floor(x * 4)) * 4;
  return Array.from(bitmap.data.subarray(offset, offset + 4));
}

describe("stroke transforms", () => {
  // Expectations are interior pixels of the independently rendered PDF.js cases.
  it.each(["2 0 0 1 0 0", "-2 0 0 1 100 0"])("preserves both axis widths under %s", matrix => {
    const bitmap = pageWith(`${matrix} cm 10 20 30 60 re S`).renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 50, 12)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 50, 17)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 12, 50)).toEqual([0, 0, 255, 255]);
  });

  it("shears the stroke envelope", () => {
    const bitmap = pageWith("1 0 1 1 0 0 cm 10 20 m 10 70 l S").renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 66, 50)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 64, 50)).toEqual([0, 0, 255, 255]);
  });

  it.each([
    "[10 10] 0 d 2 0 0 2 0 0 cm",
    "2 0 0 2 0 0 cm [10 10] 0 d",
    "4 0 0 4 0 0 cm [10 10] 0 d .5 0 0 .5 0 0 cm",
  ])("uses the paint-time transform for dashes: %s", setup => {
    const bitmap = pageWith(`${setup} 2 w 10 25 m 40 25 l S`).renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 35, 50)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 45, 50)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 65, 50)).toEqual([0, 0, 255, 255]);
  });

  it("scales dash lengths independently along each direction", () => {
    const bitmap = pageWith("2 0 0 1 0 0 cm [10 10] 0 d 2 w 10 20 m 40 20 l 10 40 m 10 90 l S")
      .renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 35, 20)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 20, 55)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 20, 65)).toEqual([0, 0, 255, 255]);
  });

  it("restores the stroke transform after Q", () => {
    const bitmap = pageWith("q 2 0 0 1 0 0 cm 10 20 30 20 re S Q 20 60 60 20 re S")
      .renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 50, 12)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 12, 70)).toEqual([255, 255, 255, 255]);
  });

  it("preserves transformed stroke geometry after save/reopen", () => {
    const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
    page.setRawContentStream("0 0 1 RG 10 w 2 0 0 1 0 0 cm 10 20 30 60 re S");
    const reopened = PdfDocument.load(doc.save()).getPage(0).renderToBitmap({ scale: 4 });
    expect(pixel(reopened, 50, 12)).toEqual([255, 255, 255, 255]);
  });

  it("emits an SVG transform with the original line width", () => {
    const page = pageWith("2 0 0 1 0 0 cm 10 20 30 60 re S");
    const paths: Record<string, string>[] = [];
    const parser = new SaxesParser();
    parser.on("opentag", node => { if (node.name === "path") paths.push(node.attributes as Record<string, string>); });
    parser.write(renderDisplayListToSvg(page.evaluateDisplayList())).close();
    expect(paths).toHaveLength(1);
    expect(paths[0]!["stroke-width"]).toBe("10");
    expect(paths[0]!.transform).toBe("matrix(2 0 0 1 0 100)");
  });

  it("keeps legacy display-list paths in page coordinates", () => {
    const bitmap = renderDisplayListToBitmap({ pageIndex: 0, rotation: 0, annotations: [], width: 100, height: 100, glyphs: [], images: [], paths: [{
      segments: [{ kind: "move", x: 20, y: 50 }, { kind: "line", x: 80, y: 50 }],
      strokeWidth: 10, strokeColor: { r: 0, g: 0, b: 1 },
    }] }, { scale: 4 });
    expect(pixel(bitmap, 50, 54)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 50, 56)).toEqual([255, 255, 255, 255]);
  });

  it("keeps subpixel transformed lines at the PDF.js minimum device thickness", () => {
    const thin = pageWith("2 0 0 1 0 0 cm .05 w 10 20 30 60 re S").renderToBitmap({ scale: 4 });
    const hairline = pageWith("2 0 0 1 0 0 cm 0 w 10 20 30 60 re S").renderToBitmap({ scale: 4 });
    expect(Array.from(pixel(thin, 50, 20))).toEqual(pixel(hairline, 50, 20));
    expect(Array.from(pixel(thin, 20, 50))).toEqual(pixel(hairline, 20, 50));
  });

  it("does not paint an SVG stroke under a singular transform", () => {
    const svg = renderDisplayListToSvg(pageWith("0 0 0 1 50 0 cm 10 20 30 60 re S").evaluateDisplayList());
    expect(svg).not.toContain('stroke="rgb(0,0,255)"');
  });

  it("bases thin-line opacity on the transformed device width", () => {
    const bitmap = pageWith("10 0 0 10 0 0 cm .2 w 1 5 m 9 5 l S")
      .renderToBitmap({ scale: 4, thinLineMode: "shape" });
    expect(pixel(bitmap, 50, 50)).toEqual([0, 0, 255, 255]);
  });

  it("transforms a Form's stroke before applying its page-space clip", () => {
    const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
    const form = cosStream(new TextEncoder().encode("0 0 1 RG 10 w 10 20 30 60 re S"));
    dictSet(form.dict, "Subtype", cosName("Form"));
    dictSet(form.dict, "BBox", cosArray([0, 0, 100, 100].map(value => cosNumber(value))));
    dictSet(form.dict, "Matrix", cosArray([2, 0, 0, 1, 0, 0].map(value => cosNumber(value))));
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ F: doc.cos.allocateObject(form) }) }));
    page.setRawContentStream("0 0 50 100 re W n /F Do");
    const bitmap = page.renderToBitmap({ scale: 4 });
    expect(pixel(bitmap, 40, 12)).toEqual([255, 255, 255, 255]);
    expect(pixel(bitmap, 40, 17)).toEqual([0, 0, 255, 255]);
    expect(pixel(bitmap, 60, 17)).toEqual([255, 255, 255, 255]);
  });

  it("uses the graphics transform for embedded glyph stroke thickness", () => {
    const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
    const program = cosStream(Uint8Array.from(atob(STANDARD_FONT_CFF_BASE64.Helvetica), char => char.charCodeAt(0)));
    dictSet(program.dict, "Subtype", cosName("Type1C"));
    const font = cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("ChromSansOTF"),
      Encoding: cosName("WinAnsiEncoding"), FontDescriptor: cosDict({ Type: cosName("FontDescriptor"),
        FontName: cosName("ChromSansOTF"), Flags: cosNumber(32), FontFile3: doc.cos.allocateObject(program) }) });
    dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ F1: font }) }));
    page.setRawContentStream("0 0 1 RG 2 0 0 1 0 0 cm 1 w BT /F1 30 Tf 1 Tr 1 0 0 1 5 40 Tm (O) Tj ET");
    const bitmap = page.renderToBitmap({ scale: 6 });
    // PDF.js renders this exact embedded CFF program; no substitute font.
    for (const [y, red] of [[222, 255], [227, 0], [232, 255]] as const) {
      expect(Array.from(bitmap.data.subarray((y * 600 + 200) * 4, (y * 600 + 200) * 4 + 4)))
        .toEqual([red, red, 255, 255]);
    }
  });
});
