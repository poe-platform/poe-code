import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosBool,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  decodePng,
  encodeFlate,
  dictGet,
  dictSet,
  encodePbm,
  encodePgm,
  encodePpm,
  encodeTiff,
  renderDisplayListToSvg,
  renderPdfPageToPng,
  renderPdfPageToBitmap,
  rotateRgbaBitmapQuarterTurns,
  type RgbaBitmap,
} from "../index.js";

describe("Netpbm encoders & PDF rasterization options", () => {
  it("encodes RgbaBitmap into valid PPM (P6), PGM (P5), and PBM (P4)", () => {
    const bmp: RgbaBitmap = {
      width: 2,
      height: 1,
      data: Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]),
    };

    const ppm = encodePpm(bmp);
    const ppmHeader = new TextDecoder().decode(ppm.subarray(0, 11));
    expect(ppmHeader).toBe("P6\n2 1\n255\n");
    expect(Array.from(ppm.subarray(11))).toEqual([255, 255, 255, 0, 0, 0]);

    const pgm = encodePgm(bmp);
    const pgmHeader = new TextDecoder().decode(pgm.subarray(0, 11));
    expect(pgmHeader).toBe("P5\n2 1\n255\n");
    expect(Array.from(pgm.subarray(11))).toEqual([255, 0]);

    const pbm = encodePbm(bmp);
    const pbmHeader = new TextDecoder().decode(pbm.subarray(0, 7));
    expect(pbmHeader).toBe("P4\n2 1\n");
    expect(pbm[7]).toBe(0b01000000);
  });

  it("scales dimensions accurately with dpi / dpiX / dpiY and crops sub-rectangles", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([144, 72]);
    page.drawRect({ x: 0, y: 0, width: 144, height: 72, fill: { r: 1, g: 0, b: 0 } });
    const pdfBytes = doc.save();

    const png72 = decodePng(renderPdfPageToPng(pdfBytes, 1, { dpi: 72 }));
    expect(png72.width).toBe(144);
    expect(png72.height).toBe(72);

    const png144 = decodePng(renderPdfPageToPng(pdfBytes, 1, { dpi: 144 }));
    expect(png144.width).toBe(288);
    expect(png144.height).toBe(144);

    const pngAsym = decodePng(renderPdfPageToPng(pdfBytes, 1, { dpiX: 144, dpiY: 72 }));
    expect(pngAsym.width).toBe(288);
    expect(pngAsym.height).toBe(72);

    const pngCrop = decodePng(
      renderPdfPageToPng(pdfBytes, 1, {
        dpi: 72,
        cropRect: { x: 10, y: 5, width: 50, height: 30 },
      })
    );
    expect(pngCrop.width).toBe(50);
    expect(pngCrop.height).toBe(30);
  });

  it("respects useCropBox when rendering pages with a CropBox", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(72), cosNumber(72), cosNumber(216), cosNumber(288)])
    );
    const pdfBytes = doc.save();
    const cropped = decodePng(renderPdfPageToPng(pdfBytes, 1, { dpi: 72, useCropBox: true }));
    expect(cropped.width).toBe(144);
    expect(cropped.height).toBe(216);
  });

  it("rotates page bitmaps accurately when page /Rotate is 90, 180, or 270 degrees", () => {
    const doc = PdfDocument.create();
    const p90 = doc.addPage([200, 100]);
    p90.setRotation(90);
    const p180 = doc.addPage([200, 100]);
    p180.setRotation(180);
    const p270 = doc.addPage([200, 100]);
    p270.setRotation(270);

    const pdfBytes = doc.save();
    const bmp90 = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72 });
    expect(bmp90.width).toBe(100);
    expect(bmp90.height).toBe(200);

    const bmp180 = renderPdfPageToBitmap(pdfBytes, 1, { dpi: 72 });
    expect(bmp180.width).toBe(200);
    expect(bmp180.height).toBe(100);

    const bmp270 = renderPdfPageToBitmap(pdfBytes, 2, { dpi: 72 });
    expect(bmp270.width).toBe(100);
    expect(bmp270.height).toBe(200);

    // Verify exact pixel placement on a 2x1 bitmap rotated 90 degrees clockwise -> 1x2
    const src2x1 = {
      width: 2,
      height: 1,
      data: Uint8Array.from([
        255, 0, 0, 255, // (0,0) red
        0, 0, 255, 255, // (1,0) blue
      ]),
    };
    const rot90 = rotateRgbaBitmapQuarterTurns(src2x1, 90);
    expect(rot90.width).toBe(1);
    expect(rot90.height).toBe(2);
    expect(Array.from(rot90.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(rot90.data.subarray(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it("resolves inherited /CropBox from parent /Pages node and renders SVG <text> glyphs", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("A&B<C>", { x: 72, y: 700, fontSize: 14 });
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    const pagesDict = doc.cos.resolveDict(dictGet(catalog, "Pages"))!;
    dictSet(
      pagesDict,
      "CropBox",
      cosArray([cosNumber(50), cosNumber(50), cosNumber(250), cosNumber(150)])
    );

    const pdfBytes = doc.save();
    const bmp = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72, useCropBox: true });
    expect(bmp.width).toBe(200);
    expect(bmp.height).toBe(100);

    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain("<text");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");
  });

  it("renders /ImageMask stencil masks in current fill color, Flate inline images, rotated XObjects, and SVG <image> tags", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    // Create a 2x1 1-bit stencil mask XObject: left bit=0 (paint in fill color), right bit=1 (transparent)
    const maskDict = cosDict({});
    dictSet(maskDict, "Type", cosName("XObject"));
    dictSet(maskDict, "Subtype", cosName("Image"));
    dictSet(maskDict, "Width", cosNumber(2));
    dictSet(maskDict, "Height", cosNumber(1));
    dictSet(maskDict, "ImageMask", cosBool(true));
    dictSet(maskDict, "BitsPerComponent", cosNumber(1));
    const maskStream = cosStream(Uint8Array.from([0b01000000]), { dict: maskDict, compress: false });
    const maskRef = doc.cos.allocateObject(maskStream);

    // Create a 1x2 RGB XObject (top pixel green, bottom pixel yellow) that we will rotate 90 deg CCW
    const rotDict = cosDict({});
    dictSet(rotDict, "Type", cosName("XObject"));
    dictSet(rotDict, "Subtype", cosName("Image"));
    dictSet(rotDict, "Width", cosNumber(1));
    dictSet(rotDict, "Height", cosNumber(2));
    dictSet(rotDict, "ColorSpace", cosName("DeviceRGB"));
    dictSet(rotDict, "BitsPerComponent", cosNumber(8));
    const rotStream = cosStream(
      Uint8Array.from([
        0, 255, 0, // top pixel: green
        255, 255, 0, // bottom pixel: yellow
      ]),
      { dict: rotDict, compress: false }
    );
    const rotRef = doc.cos.allocateObject(rotStream);

    const resDict = doc.cos.resolveDict(dictGet(page.pageDict, "Resources")) ?? cosDict({});
    const xobjMap = cosDict({});
    dictSet(xobjMap, "ImMask", maskRef);
    dictSet(xobjMap, "ImRot", rotRef);
    dictSet(resDict, "XObject", xobjMap);
    dictSet(page.pageDict, "Resources", resDict);

    // Also include a Flate-compressed 1x1 cyan inline image at (70, 70, 20, 20)
    const flateCyan = cosStream(Uint8Array.from([0, 255, 255]), { compress: true }).rawBytes;
    const prefix = new TextEncoder().encode(
      [
        // Blue background across (0,0)-(40,40)
        "0 0 1 rg 0 0 40 40 re f",
        // Draw 2x1 stencil mask in red (1 0 0 rg) across (0,0)-(40,40): x in [0,20) -> red, x in [20,40) -> blue!
        "q 1 0 0 rg 40 0 0 40 0 0 cm /ImMask Do Q",
        // Draw 90-deg rotated image at (40,0)-(60,20) via matrix [0 20 -20 0 60 0]
        "q 0 20 -20 0 60 0 cm /ImRot Do Q",
        // Draw Flate inline image at (70,70)-(90,90)
        `q 20 0 0 20 70 70 cm BI /W 1 /H 1 /BPC 8 /CS /RGB /F /Fl ID `,
      ].join("\n")
    );
    const suffix = new TextEncoder().encode(" EI Q\n");
    const contentBytes = new Uint8Array(prefix.length + flateCyan.length + suffix.length);
    contentBytes.set(prefix, 0);
    contentBytes.set(flateCyan, prefix.length);
    contentBytes.set(suffix, prefix.length + flateCyan.length);
    const contentRef = doc.cos.allocateObject(cosStream(contentBytes, { compress: false }));
    dictSet(page.pageDict, "Contents", contentRef);

    const pdfBytes = doc.save();
    const bmp = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72 });

    // Left half of (0,0)-(40,40) at x=10, y=80 (PDF y=20) should be painted in red by the stencil mask
    const leftMaskIdx = (80 * bmp.width + 10) * 4;
    expect(Array.from(bmp.data.subarray(leftMaskIdx, leftMaskIdx + 4))).toEqual([255, 0, 0, 255]);
    // Right half of (0,0)-(40,40) at x=30, y=80 (PDF y=20) should remain blue background!
    const rightMaskIdx = (80 * bmp.width + 30) * 4;
    expect(Array.from(bmp.data.subarray(rightMaskIdx, rightMaskIdx + 4))).toEqual([0, 0, 255, 255]);

    // Flate inline image at x=80, y=20 (PDF x=80, y=80) should be cyan [0, 255, 255, 255]
    const inlineIdx = (20 * bmp.width + 80) * 4;
    expect(Array.from(bmp.data.subarray(inlineIdx, inlineIdx + 4))).toEqual([0, 255, 255, 255]);

    // Rotated image at (40..60, PDF y=0..20 -> raster y=80..99) should have non-white pixels rendered
    const rotIdx = (90 * bmp.width + 45) * 4;
    expect(bmp.data[rotIdx + 1]).toBe(255);

    // SVG output should include embedded <image href="data:image/png;base64,...">
    const parsedDoc = PdfDocument.load(pdfBytes);
    const svg = renderDisplayListToSvg(parsedDoc.getPage(0).evaluateDisplayList());
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,");
  });

  it("applies /ExtGState (/ca and /CA) opacity to vector paths and placed images in bitmap and SVG", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    const gsHalf = cosDict({
      Type: cosName("ExtGState"),
      ca: cosNumber(0.5),
      CA: cosNumber(0.5),
    });
    const gsRef = doc.cos.allocateObject(gsHalf);

    const imgDict = cosDict({
      Type: cosName("XObject"),
      Subtype: cosName("Image"),
      Width: cosNumber(1),
      Height: cosNumber(1),
      ColorSpace: cosName("DeviceRGB"),
      BitsPerComponent: cosNumber(8),
    });
    const imgStream = cosStream(Uint8Array.from([255, 0, 0]), { dict: imgDict, compress: false });
    const imgRef = doc.cos.allocateObject(imgStream);

    const resDict = doc.cos.resolveDict(dictGet(page.pageDict, "Resources")) ?? cosDict({});
    dictSet(resDict, "ExtGState", cosDict({ GS50: gsRef }));
    dictSet(resDict, "XObject", cosDict({ ImRed: imgRef }));
    dictSet(page.pageDict, "Resources", resDict);

    // Draw opaque blue background (0,0)-(100,100), then /GS50 gs with red rect at (0,0)-(50,50) and red image at (50,0)-(100,50)
    const streamBytes = new TextEncoder().encode(
      [
        "0 0 1 rg 0 0 100 100 re f",
        "q /GS50 gs 1 0 0 rg 0 0 50 50 re f 50 0 0 50 50 0 cm /ImRed Do Q",
      ].join("\n")
    );
    const contentRef = doc.cos.allocateObject(cosStream(streamBytes, { compress: false }));
    dictSet(page.pageDict, "Contents", contentRef);

    const pdfBytes = doc.save();
    const bmp = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72 });

    // Semi-transparent red (0.5) over blue (1.0) at x=25, y=75 (PDF y=25) -> R~128, G=0, B~128
    const rectIdx = (75 * bmp.width + 25) * 4;
    expect(bmp.data[rectIdx]).toBeGreaterThanOrEqual(126);
    expect(bmp.data[rectIdx]).toBeLessThanOrEqual(129);
    expect(bmp.data[rectIdx + 2]).toBeGreaterThanOrEqual(126);
    expect(bmp.data[rectIdx + 2]).toBeLessThanOrEqual(129);

    // Semi-transparent red image (0.5) over blue (1.0) at x=75, y=75 (PDF y=25) -> R~128, G=0, B~128
    const imgIdx = (75 * bmp.width + 75) * 4;
    expect(bmp.data[imgIdx]).toBeGreaterThanOrEqual(126);
    expect(bmp.data[imgIdx]).toBeLessThanOrEqual(129);
    expect(bmp.data[imgIdx + 2]).toBeGreaterThanOrEqual(126);
    expect(bmp.data[imgIdx + 2]).toBeLessThanOrEqual(129);

    const svg = renderDisplayListToSvg(PdfDocument.load(pdfBytes).getPage(0).evaluateDisplayList());
    expect(svg).toContain('fill-opacity="0.5"');
  });

  it("encodes valid Baseline TIFF 6.0 images via encodeTiff and supports hideAnnotations in renderPdfPageToBitmap", () => {
    const bmp: RgbaBitmap = {
      width: 2,
      height: 1,
      data: Uint8Array.from([
        200, 100, 50, 255,
        10, 20, 30, 255,
      ]),
    };
    const tiff = encodeTiff(bmp, 150);
    // Little-endian TIFF magic 'II*\0'
    expect(Array.from(tiff.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);
    // Trailing 6 bytes are the 2 RGB pixels
    expect(Array.from(tiff.subarray(tiff.length - 6))).toEqual([200, 100, 50, 10, 20, 30]);

    // Verify hideAnnotations suppresses interactive widget rendering
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const widgetDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosName("secret"),
      V: cosName("VISIBLE_WIDGET"),
      Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(180), cosNumber(50)]),
    });
    const widgetRef = doc.cos.allocateObject(widgetDict);
    dictSet(page.pageDict, "Annots", cosArray([widgetRef]));
    const pdfBytes = doc.save();

    const withAnnots = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72, hideAnnotations: false });
    const withoutAnnots = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72, hideAnnotations: true });

    const countNonWhite = (b: RgbaBitmap) => {
      let n = 0;
      for (let i = 0; i < b.data.length; i += 4) {
        if (b.data[i]! < 250 || b.data[i + 1]! < 250 || b.data[i + 2]! < 250) n++;
      }
      return n;
    };
    expect(countNonWhite(withAnnots)).toBeGreaterThan(0);
    expect(countNonWhite(withoutAnnots)).toBe(0);
  });

  it("distinguishes nonzero (f) vs evenodd (f*) winding rules in bitmap scanline fill and emits cubic (C) & fill-rule in SVG", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    // Left side (0..80): two concentric CW rects filled with f* (evenodd) -> center (40,40) is a hole (white)
    // Right side (100..180): two concentric CW rects filled with f (nonzero) -> center (140,40) is filled (red)
    // Plus a cubic Bezier curve (`10 80 m 20 95 40 95 50 80 c S`)
    const streamBytes = new TextEncoder().encode(
      [
        "1 0 0 rg",
        "0 0 80 80 re 20 20 40 40 re f*",
        "100 0 80 80 re 120 20 40 40 re f",
        "0 0 1 RG 2 w 10 80 m 20 95 40 95 50 80 c S",
      ].join("\n")
    );
    dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(streamBytes, { compress: false })));
    const pdfBytes = doc.save();

    const bmp = renderPdfPageToBitmap(pdfBytes, 0, { dpi: 72 });
    // Outer ring of left shape at x=10, y=60 (PDF y=40) -> red [255, 0, 0, 255]
    const leftRingIdx = (60 * bmp.width + 10) * 4;
    expect(Array.from(bmp.data.subarray(leftRingIdx, leftRingIdx + 4))).toEqual([255, 0, 0, 255]);
    // Inner hole of left shape (f* evenodd) at x=40, y=60 (PDF y=40) -> white [255, 255, 255, 255]
    const leftHoleIdx = (60 * bmp.width + 40) * 4;
    expect(Array.from(bmp.data.subarray(leftHoleIdx, leftHoleIdx + 4))).toEqual([255, 255, 255, 255]);
    // Inner center of right shape (f nonzero) at x=140, y=60 (PDF y=40) -> red [255, 0, 0, 255]
    const rightCenterIdx = (60 * bmp.width + 140) * 4;
    expect(Array.from(bmp.data.subarray(rightCenterIdx, rightCenterIdx + 4))).toEqual([255, 0, 0, 255]);

    const svg = renderDisplayListToSvg(PdfDocument.load(pdfBytes).getPage(0).evaluateDisplayList());
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain(" C ");
  });

  it("preserves in-order color changes and text render modes (1 Tr stroke, 3 Tr invisible OCR) inside BT..ET", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([160, 80]);
    const cosDoc = doc.cos;
    const f1Dict = cosDict({});
    dictSet(f1Dict, "Type", cosName("Font"));
    dictSet(f1Dict, "Subtype", cosName("Type1"));
    dictSet(f1Dict, "BaseFont", cosName("Helvetica"));
    const f1Ref = cosDoc.allocateObject(f1Dict);
    const content = [
      "BT",
      "/F1 18 Tf",
      "10 40 Td",
      "1 0 0 rg (R) Tj",
      "30 0 Td",
      "0 0 1 rg (B) Tj",
      "30 0 Td",
      "0 1 0 RG 1 Tr (S) Tj",
      "30 0 Td",
      "0 Tr 3 Tr (HIDDEN) Tj",
      "ET",
    ].join("\n");
    const contentRef = cosDoc.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }));
    const resDict = cosDict({});
    const fontMap = cosDict({});
    dictSet(fontMap, "F1", f1Ref);
    dictSet(resDict, "Font", fontMap);
    dictSet(page.pageDict, "Resources", resDict);
    dictSet(page.pageDict, "Contents", contentRef);
    const dl = page.evaluateDisplayList();
    const glyphByChar = new Map(dl.glyphs.map(g => [g.unicode, g]));

    // (R) should be red, (B) should be blue, (S) should use stroke color green
    expect(glyphByChar.get("R")?.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(glyphByChar.get("B")?.color).toEqual({ r: 0, g: 0, b: 1 });
    expect(glyphByChar.get("S")?.color).toEqual({ r: 0, g: 1, b: 0 });
    // Invisible 3 Tr text is still in displayList.glyphs for text extraction
    expect(dl.glyphs.map(g => g.unicode).join("")).toBe("RBSHIDDEN");
    expect(glyphByChar.get("H")?.renderMode).toBe(3);

    // SVG and bitmap must not render visible glyphs for 3 Tr (HIDDEN)
    const svg = renderDisplayListToSvg(dl);
    expect(svg).toContain(">R</text>");
    expect(svg).toContain(">B</text>");
    expect(svg).toContain(">S</text>");
    expect(svg).not.toContain(">H</text>");
  });

  it("renders split parent/kid AcroForm widget values and custom /AP /N Form XObject appearance streams (unless hideAnnotations is set)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([120, 80]);

    // 1. Split parent/kid AcroForm field where /V is on /Parent and /Rect is on the kid widget
    const parentRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosName("dept"),
        V: cosName("RESEARCH"),
      })
    );
    const kidRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        Parent: parentRef,
        Rect: cosArray([cosNumber(10), cosNumber(50), cosNumber(100), cosNumber(70)]),
      })
    );
    const parentDict = doc.cos.resolveDict(parentRef)!;
    dictSet(parentDict, "Kids", cosArray([kidRef]));

    // 2. Annotation with a custom /AP << /N <FormXObject> >> painting a pure green 20x20 box at Rect [10, 10, 30, 30]
    const apStreamRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0 1 0 rg 0 0 20 20 re f"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(20), cosNumber(20)]),
        }),
        compress: false,
      })
    );
    const stampAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(30), cosNumber(30)]),
        AP: cosDict({ N: apStreamRef }),
      })
    );

    dictSet(page.pageDict, "Annots", cosArray([kidRef, stampAnnotRef]));

    const dl = page.evaluateDisplayList();
    expect(dl.glyphs.map(g => g.unicode).join("")).toContain("RESEARCH");

    // Check bitmap at (20, 60) in screen coords (which is PDF x=20, y=20 inside [10, 10, 30, 30]) is green
    const bmpVisible = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    const pxIdx = (60 * bmpVisible.width + 20) * 4;
    expect(bmpVisible.data[pxIdx]).toBe(0);
    expect(bmpVisible.data[pxIdx + 1]).toBe(255);
    expect(bmpVisible.data[pxIdx + 2]).toBe(0);

    // With hideAnnotations: true, neither the RESEARCH widget nor the green Stamp /AP is rendered
    const bmpHidden = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72, hideAnnotations: true });
    expect(bmpHidden.data[pxIdx]).toBe(255);
    expect(bmpHidden.data[pxIdx + 1]).toBe(255);
    expect(bmpHidden.data[pxIdx + 2]).toBe(255);
  });

  it("evaluates cs/CS and sc/scn/SC/SCN with /Separation spot color spaces and 4-component CMYK operands", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 50]);

    const spotGreenCs = cosArray([
      cosName("Separation"),
      cosName("PantoneGreen"),
      cosName("DeviceRGB"),
      cosDict({
        FunctionType: cosNumber(2),
        Domain: cosArray([cosNumber(0), cosNumber(1)]),
        C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
        C1: cosArray([cosNumber(0), cosNumber(0.8), cosNumber(0.2)]),
        N: cosNumber(1),
      }),
    ]);
    const resDict = page.getResourcesDict();
    dictSet(resDict, "ColorSpace", cosDict({ SpotGreen: spotGreenCs }));

    const content = [
      "/SpotGreen cs 1 scn 0 0 50 50 re f",
      "/DeviceCMYK cs 1 0 1 0 scn 50 0 50 50 re f",
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Left half (x=25, y=25): SpotGreen at 100% tint -> (0, 204, 51)
    const leftIdx = (25 * bmp.width + 25) * 4;
    expect(bmp.data[leftIdx]).toBe(0);
    expect(bmp.data[leftIdx + 1]).toBe(204);
    expect(bmp.data[leftIdx + 2]).toBe(51);

    // Right half (x=75, y=25): 4-operand CMYK scn (1, 0, 1, 0) -> pure green (0, 255, 0)
    const rightIdx = (25 * bmp.width + 75) * 4;
    expect(bmp.data[rightIdx]).toBe(0);
    expect(bmp.data[rightIdx + 1]).toBe(255);
    expect(bmp.data[rightIdx + 2]).toBe(0);
  });

  it("enforces W / W* clipping paths across q..Q, renders 45-deg rotated re rectangles, and closes s/b/b* stroked paths", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    const content = [
      // 1. Clip to [10, 10, 40, 40] (x in 10..40, y in 10..40) and fill 0..100 with red
      "q 10 10 30 30 re W n 1 0 0 rg 0 0 100 100 re f Q",
      // 2. Outside q..Q clip is restored: draw a 45-deg rotated 20x20 green square at (70, 50)
      "q 0.707106 0.707106 -0.707106 0.707106 70 50 cm 0 1 0 rg 0 0 20 20 re f Q",
      // 3. Close-and-stroke triangle with operator s
      "0 0 1 RG 2 w 10 80 m 40 80 l 40 95 l s",
    ].join("\n");

    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Inside clip [10, 10, 40, 40]: PDF (25, 25) -> screen (25, 75) is red
    const inClipIdx = (75 * bmp.width + 25) * 4;
    expect(bmp.data[inClipIdx]).toBe(255);
    expect(bmp.data[inClipIdx + 1]).toBe(0);
    expect(bmp.data[inClipIdx + 2]).toBe(0);

    // Outside clip at PDF (25, 60) -> screen (25, 40) must remain white!
    const outClipIdx = (40 * bmp.width + 25) * 4;
    expect(bmp.data[outClipIdx]).toBe(255);
    expect(bmp.data[outClipIdx + 1]).toBe(255);
    expect(bmp.data[outClipIdx + 2]).toBe(255);

    // Inside 45-deg rotated green square: local (10, 10) -> PDF (70, 50 + 14.14) = (70, 64) -> screen (70, 36) is green
    const rotIdx = (36 * bmp.width + 70) * 4;
    expect(bmp.data[rotIdx]).toBe(0);
    expect(bmp.data[rotIdx + 1]).toBe(255);
    expect(bmp.data[rotIdx + 2]).toBe(0);

    // SVG should include closing Z for the s operator path
    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain("M 10 20 L 40 20 L 40 5 Z");
  });

  it("clips placed XObject images to the active W n clipping rectangle", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const rawRgb = new Uint8Array([
      255, 0, 255,  255, 0, 255,
      255, 0, 255,  255, 0, 255,
    ]);
    const imRef = doc.cos.allocateObject(
      cosStream(rawRgb, {
        dict: cosDict([
          ["Type", cosName("XObject")],
          ["Subtype", cosName("Image")],
          ["Width", cosNumber(2)],
          ["Height", cosNumber(2)],
          ["ColorSpace", cosName("DeviceRGB")],
          ["BitsPerComponent", cosNumber(8)],
        ]),
        compress: false,
      })
    );
    const resources = cosDict([["XObject", cosDict([["Im1", imRef]])]]);
    dictSet(page.pageDict, "Resources", resources);

    // Clip to [10, 10, 40, 40], then draw Im1 across [0, 0, 80, 80]
    const content = "q 10 10 30 30 re W n 80 0 0 80 0 0 cm /Im1 Do Q";
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Inside clip [10, 10, 40, 40]: PDF (25, 25) -> screen (25, 75) is magenta
    const inIdx = (75 * bmp.width + 25) * 4;
    expect(bmp.data[inIdx]).toBe(255);
    expect(bmp.data[inIdx + 1]).toBe(0);
    expect(bmp.data[inIdx + 2]).toBe(255);

    // Outside clip at PDF (60, 60) -> screen (60, 40) must remain white
    const outIdx = (40 * bmp.width + 60) * 4;
    expect(bmp.data[outIdx]).toBe(255);
    expect(bmp.data[outIdx + 1]).toBe(255);
    expect(bmp.data[outIdx + 2]).toBe(255);
  });

  it("renders /ShadingType 2 axial and /ShadingType 3 radial gradients via /ShName sh and dashed strokes via d", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const axialFn = cosDict([
      ["FunctionType", cosNumber(2)],
      ["Domain", cosArray([cosNumber(0), cosNumber(1)])],
      ["C0", cosArray([cosNumber(1), cosNumber(0), cosNumber(0)])],
      ["C1", cosArray([cosNumber(0), cosNumber(0), cosNumber(1)])],
      ["N", cosNumber(1)],
    ]);
    const shRef = doc.cos.allocateObject(
      cosDict([
        ["ShadingType", cosNumber(2)],
        ["ColorSpace", cosName("DeviceRGB")],
        ["Coords", cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(0)])],
        ["Function", axialFn],
        ["Extend", cosArray([{ kind: "boolean", value: true }, { kind: "boolean", value: true }])],
      ])
    );
    dictSet(page.pageDict, "Resources", cosDict([["Shading", cosDict([["Grad1", shRef]])]]));

    // Clip [0, 50, 100, 100] and paint /Grad1 sh; then draw a dashed green line at y=20 (screen y=80)
    const content = [
      "q 0 50 100 50 re W n /Grad1 sh Q",
      "q 0 1 0 RG 4 w [20 20] 0 d 10 20 m 90 20 l S Q",
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Near left of gradient at PDF (10, 75) -> screen (10, 25): dominant red
    const leftIdx = (25 * bmp.width + 10) * 4;
    expect(bmp.data[leftIdx]!).toBeGreaterThan(200);
    expect(bmp.data[leftIdx + 2]!).toBeLessThan(55);

    // Near right of gradient at PDF (90, 75) -> screen (90, 25): dominant blue
    const rightIdx = (25 * bmp.width + 90) * 4;
    expect(bmp.data[rightIdx + 2]!).toBeGreaterThan(200);
    expect(bmp.data[rightIdx]!).toBeLessThan(55);

    // Dashed stroke at PDF y=20 -> screen y=80: x=20 is inside first [20] "on" dash (green), x=40 is inside [20] "off" gap (white)
    const dashOnIdx = (80 * bmp.width + 20) * 4;
    expect(bmp.data[dashOnIdx + 1]).toBe(255);
    expect(bmp.data[dashOnIdx]).toBe(0);

    const dashOffIdx = (80 * bmp.width + 40) * 4;
    expect(bmp.data[dashOffIdx]).toBe(255);
    expect(bmp.data[dashOffIdx + 1]).toBe(255);
    expect(bmp.data[dashOffIdx + 2]).toBe(255);

    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain('stroke-dasharray="20 20"');
  });

  it("decodes and embeds 4-bit indexed-color PNGs (colorType=3) with PLTE palette and tRNS transparency into PDF /SMask", () => {
    const makeChunk = (typeStr: string, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(12 + payload.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, payload.length, false);
      for (let i = 0; i < 4; i++) out[4 + i] = typeStr.charCodeAt(i);
      out.set(payload, 8);
      return out;
    };
    // 2x1 4-bit indexed PNG (colorType=3, bitDepth=4)
    const ihdr = new Uint8Array(13);
    const idv = new DataView(ihdr.buffer);
    idv.setUint32(0, 2, false);
    idv.setUint32(4, 1, false);
    ihdr[8] = 4; // bitDepth = 4
    ihdr[9] = 3; // colorType = 3 (Indexed)
    // Palette: index 0 = Red (255,0,0), index 1 = Green (0,200,50)
    const plte = Uint8Array.from([255, 0, 0, 0, 200, 50]);
    // tRNS: index 0 has alpha = 64, index 1 has implicit alpha = 255
    const trns = Uint8Array.from([64]);
    // Scanline: filter byte 0, packed indices (0 << 4) | 1 = 0x01
    const idat = encodeFlate(Uint8Array.from([0, 0x01]));
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = [
      sig,
      makeChunk("IHDR", ihdr),
      makeChunk("PLTE", plte),
      makeChunk("tRNS", trns),
      makeChunk("IDAT", idat),
      makeChunk("IEND", new Uint8Array(0)),
    ];
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const pngBytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      pngBytes.set(c, off);
      off += c.length;
    }

    const decoded = decodePng(pngBytes);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 64, 0, 200, 50, 255]);

    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const handle = doc.embedPng(pngBytes);
    page.drawImage(handle, { x: 10, y: 10, width: 40, height: 20 });
    const dl = page.evaluateDisplayList();
    expect(dl.images).toHaveLength(1);
    expect(Array.from(dl.images[0]!.decodedRgba)).toEqual([255, 0, 0, 64, 0, 200, 50, 255]);
  });

  it("evaluates /ExtGState (/LW line width, /D dash pattern, and /Font [fontRef size]) via gs operator without Tf", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    const fontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Helvetica"),
        Encoding: cosDict({
          Type: cosName("Encoding"),
          BaseEncoding: cosName("WinAnsiEncoding"),
          Differences: cosArray([cosNumber(65), cosName("Omega")]),
        }),
      })
    );
    const gsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("ExtGState"),
        LW: cosNumber(4.5),
        D: cosArray([cosArray([cosNumber(6), cosNumber(3)]), cosNumber(1)]),
        Font: cosArray([fontRef, cosNumber(18)]),
      })
    );
    dictSet(page.getResourcesDict(), "ExtGState", cosDict({ GS1: gsRef }));
    page.setRawContentStream("q /GS1 gs 10 20 m 150 20 l S BT 20 50 Td (A) Tj ET Q");

    const dl = page.evaluateDisplayList();
    expect(dl.paths).toHaveLength(1);
    expect(dl.paths[0]!.strokeWidth).toBe(4.5);
    expect(dl.paths[0]!.dashArray).toEqual([6, 3]);
    expect(dl.paths[0]!.dashPhase).toBe(1);
    expect(dl.glyphs).toHaveLength(1);
    expect(dl.glyphs[0]!.unicode).toBe("\u2126");
    expect(dl.glyphs[0]!.fontSize).toBe(18);
  });

  it("clips Form XObject paths and glyphs to the Form XObject /BBox (ISO 32000-1 §8.10.2)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const helvRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    // Form XObject has BBox [0, 0, 50, 50] and Matrix [1 0 0 1 10 10] -> user space [10, 10, 60, 60]
    // Draws a 0..150 red rectangle and text at x=5 ("Inside") and x=100 ("Outside")
    const formStream = cosStream(
      new TextEncoder().encode("1 0 0 rg 0 0 150 80 re f 0 0 0 rg BT /F1 10 Tf 5 20 Td (Inside) Tj 95 0 Td (Outside) Tj ET"),
      {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(50)]),
          Matrix: cosArray([cosNumber(1), cosNumber(0), cosNumber(0), cosNumber(1), cosNumber(10), cosNumber(10)]),
          Resources: cosDict({ Font: cosDict({ F1: helvRef }) }),
        }),
      }
    );
    const fmKey = page.ensureXObjectResource(doc.cos.allocateObject(formStream));
    page.setRawContentStream(`/${fmKey} Do`);

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Inside [10, 10, 60, 60] at PDF (30, 30) -> screen (30, 70): red pixel
    const inIdx = (80 * bmp.width + 30) * 4;
    expect(bmp.data[inIdx]).toBe(255);
    expect(bmp.data[inIdx + 1]).toBe(0);
    // Outside [10, 10, 60, 60] at PDF (100, 30) -> screen (100, 70): clipped to white background
    const outIdx = (70 * bmp.width + 100) * 4;
    expect(bmp.data[outIdx]).toBe(255);
    expect(bmp.data[outIdx + 1]).toBe(255);
    expect(bmp.data[outIdx + 2]).toBe(255);

    // Text extraction with clipText: true keeps "Inside" and filters "Outside"
    const clippedPage = page.extractPage({ clipText: true });
    const words = clippedPage.blocks.flatMap(b => b.lines.flatMap(l => l.words.map(w => w.text)));
    expect(words).toContain("Inside");
    expect(words).not.toContain("Outside");
  });

  it("evaluates Type 3 font /CharProcs streams with /FontMatrix and extracts text (ISO 32000-1 §9.6.5)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    const gAStream = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("100 0 0 0 100 100 d1 0 0 100 100 re f"))
    );
    const gBStream = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("100 0 d0 0 1 0 rg 0 0 100 100 re f"))
    );
    const type3FontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type3"),
        FontBBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        FontMatrix: cosArray([cosNumber(0.01), cosNumber(0), cosNumber(0), cosNumber(0.01), cosNumber(0), cosNumber(0)]),
        FirstChar: cosNumber(65),
        LastChar: cosNumber(66),
        Widths: cosArray([cosNumber(100), cosNumber(100)]),
        Encoding: cosDict({
          Type: cosName("Encoding"),
          Differences: cosArray([cosNumber(65), cosName("gA"), cosName("gB")]),
        }),
        CharProcs: cosDict({
          gA: gAStream,
          gB: gBStream,
        }),
        ToUnicode: doc.cos.allocateObject(
          cosStream(
            new TextEncoder().encode(
              "beginbfchar\n<41> <0041>\n<42> <0042>\nendbfchar"
            )
          )
        ),
      })
    );
    dictSet(page.dict, "Resources", cosDict({ Font: cosDict({ T3: type3FontRef }) }));
    page.setRawContentStream("0 0 1 rg BT /T3 20 Tf 10 30 Td (AB) Tj ET");

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    const idxA = (60 * bmp.width + 20) * 4;
    expect(bmp.data[idxA]).toBe(0);
    expect(bmp.data[idxA + 1]).toBe(0);
    expect(bmp.data[idxA + 2]).toBe(255);

    const idxB = (60 * bmp.width + 40) * 4;
    expect(bmp.data[idxB]).toBe(0);
    expect(bmp.data[idxB + 1]).toBe(255);
    expect(bmp.data[idxB + 2]).toBe(0);

    expect(doc.extractText()).toContain("AB");
  });

  it("evaluates /PatternType 1 Colored (/PaintType 1) and Uncolored (/PaintType 2) tiling patterns via /Pattern cs and scn (ISO 32000-1 §8.7.3)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const helvRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );

    // Uncolored tiling pattern (/PaintType 2, 20x20 step): fills the 20x20 cell using the active scn base color
    const uncoloredPatRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0 0 20 20 re f"), {
        dict: cosDict({
          Type: cosName("Pattern"),
          PatternType: cosNumber(1),
          PaintType: cosNumber(2),
          TilingType: cosNumber(1),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(20), cosNumber(20)]),
          XStep: cosNumber(20),
          YStep: cosNumber(20),
        }),
      })
    );

    // Colored tiling pattern (/PaintType 1, 40x40 step): paints green cell + text "(Tile)"
    const coloredPatRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0 1 0 rg 0 0 40 40 re f 0 0 0 rg BT /F1 8 Tf 2 10 Td (Tile) Tj ET"), {
        dict: cosDict({
          Type: cosName("Pattern"),
          PatternType: cosNumber(1),
          PaintType: cosNumber(1),
          TilingType: cosNumber(1),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(40), cosNumber(40)]),
          XStep: cosNumber(40),
          YStep: cosNumber(40),
          Resources: cosDict({ Font: cosDict({ F1: helvRef }) }),
        }),
      })
    );

    dictSet(
      page.dict,
      "Resources",
      cosDict({
        ColorSpace: cosDict({
          CsPatRgb: cosArray([cosName("Pattern"), cosName("DeviceRGB")]),
        }),
        Pattern: cosDict({
          PUncol: uncoloredPatRef,
          PCol: coloredPatRef,
        }),
      })
    );

    // Paint [10, 20, 40, 40] (x: 10..50, y: 20..60) with uncolored pattern PUncol tinted blue (0 0 1)
    // Paint [80, 20, 40, 40] (x: 80..120, y: 20..60) with colored pattern PCol (green + text "Tile")
    page.setRawContentStream(
      "/CsPatRgb cs 0 0 1 /PUncol scn 10 20 40 40 re f /Pattern cs /PCol scn 80 20 40 40 re f"
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Inside PUncol rect at PDF (25, 35) -> screen (25, 65): blue (0, 0, 255)
    const idxUncol = (65 * bmp.width + 25) * 4;
    expect(bmp.data[idxUncol]).toBe(0);
    expect(bmp.data[idxUncol + 1]).toBe(0);
    expect(bmp.data[idxUncol + 2]).toBe(255);

    // Inside PCol rect at PDF (110, 30) -> screen (110, 70): green (0, 255, 0)
    const idxCol = (70 * bmp.width + 110) * 4;
    expect(bmp.data[idxCol]).toBe(0);
    expect(bmp.data[idxCol + 1]).toBe(255);
    expect(bmp.data[idxCol + 2]).toBe(0);

    // Outside rects at PDF (65, 35) -> screen (65, 65): clipped to white (255, 255, 255)
    const idxOut = (65 * bmp.width + 65) * 4;
    expect(bmp.data[idxOut]).toBe(255);
    expect(bmp.data[idxOut + 1]).toBe(255);
    expect(bmp.data[idxOut + 2]).toBe(255);

    expect(doc.extractText()).toContain("Tile");
  });

  it("renders /PatternType 2 shading patterns and /ShadingType 1 function-based shadings with FunctionType 4 PostScript calculators", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 140, height: 100 });

    // 1. /PatternType 2 Shading Pattern with /ShadingType 2 (axial red -> blue along x in [10, 50])
    const shadPatRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Pattern"),
        PatternType: cosNumber(2),
        Shading: cosDict({
          ShadingType: cosNumber(2),
          ColorSpace: cosName("DeviceRGB"),
          Coords: cosArray([cosNumber(10), cosNumber(0), cosNumber(50), cosNumber(0)]),
          Extend: cosArray([cosBool(true), cosBool(true)]),
          Function: cosDict({
            FunctionType: cosNumber(2),
            Domain: cosArray([cosNumber(0), cosNumber(1)]),
            C0: cosArray([cosNumber(1), cosNumber(0), cosNumber(0)]),
            C1: cosArray([cosNumber(0), cosNumber(0), cosNumber(1)]),
            N: cosNumber(1),
          }),
        }),
      })
    );

    // 2. /ShadingType 1 Function-based shading using a FunctionType 4 PostScript calculator stream
    // Takes (x, y) in [0, 1] x [0, 1] and outputs (0, x, 1 - x) in DeviceRGB, mapped via /Matrix [40 0 0 40 80 20]
    const psFnRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("{ pop 0 exch dup 1 exch sub }"), {
        dict: cosDict({
          FunctionType: cosNumber(4),
          Domain: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
          Range: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
        }),
      })
    );

    const shType1Ref = doc.cos.allocateObject(
      cosDict({
        ShadingType: cosNumber(1),
        ColorSpace: cosName("DeviceRGB"),
        Domain: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
        Matrix: cosArray([cosNumber(40), cosNumber(0), cosNumber(0), cosNumber(40), cosNumber(80), cosNumber(20)]),
        Function: psFnRef,
      })
    );

    dictSet(
      page.dict,
      "Resources",
      cosDict({
        Pattern: cosDict({ PShad: shadPatRef }),
        Shading: cosDict({ ShFn1: shType1Ref }),
      })
    );

    page.setRawContentStream(
      "/Pattern cs /PShad scn 10 20 40 40 re f q 80 20 40 40 re W n /ShFn1 sh Q"
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Left side of PShad rect at PDF (12, 40) -> screen (12, 60): predominantly red
    const idxLeft = (60 * bmp.width + 12) * 4;
    expect(bmp.data[idxLeft]!).toBeGreaterThan(200);
    expect(bmp.data[idxLeft + 2]!).toBeLessThan(60);

    // Right side of PShad rect at PDF (48, 40) -> screen (48, 60): predominantly blue
    const idxRight = (60 * bmp.width + 48) * 4;
    expect(bmp.data[idxRight]!).toBeLessThan(60);
    expect(bmp.data[idxRight + 2]!).toBeGreaterThan(200);

    // Inside ShFn1 rect near x=118 (xs ≈ 0.95): (0, 0.95, 0.05) -> predominantly green
    const idxFnRight = (60 * bmp.width + 118) * 4;
    expect(bmp.data[idxFnRight]!).toBe(0);
    expect(bmp.data[idxFnRight + 1]!).toBeGreaterThan(200);
    expect(bmp.data[idxFnRight + 2]!).toBeLessThan(60);
  });

  it("respects Hidden (/F 2) and NoView (/F 32) annotation flags and evaluates /AP /N /Matrix + /Resources (ISO 32000-1 §12.5.3 / §12.5.5)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 120, height: 100 });

    const apFontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Helvetica"),
        Encoding: cosDict({
          Type: cosName("Encoding"),
          Differences: cosArray([cosNumber(65), cosName("Delta")]),
        }),
      })
    );

    // Visible annotation (/F 4) with BBox [100 200 140 240] shifted by Matrix [1 0 0 1 -100 -200] -> [0 0 40 40]
    // Placed at Rect [10 20 50 60], paints green and shows "A" (which decodes to U+0394 Delta via apFontRef)
    const visApRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0 1 0 rg 100 200 40 40 re f 0 0 0 rg BT /FAp 12 Tf 105 210 Td (A) Tj ET"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(100), cosNumber(200), cosNumber(140), cosNumber(240)]),
          Matrix: cosArray([cosNumber(1), cosNumber(0), cosNumber(0), cosNumber(1), cosNumber(-100), cosNumber(-200)]),
          Resources: cosDict({ Font: cosDict({ FAp: apFontRef }) }),
        }),
      })
    );
    const visAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        F: cosNumber(4),
        Rect: cosArray([cosNumber(10), cosNumber(20), cosNumber(50), cosNumber(60)]),
        AP: cosDict({ N: visApRef }),
      })
    );

    // Hidden annotation (/F 2) at Rect [70 20 110 60] painting bright red
    const hidApRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("1 0 0 rg 0 0 40 40 re f BT /FAp 12 Tf 5 10 Td (HiddenText) Tj ET"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(40), cosNumber(40)]),
          Resources: cosDict({ Font: cosDict({ FAp: apFontRef }) }),
        }),
      })
    );
    const hidAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        F: cosNumber(2), // Hidden flag
        Rect: cosArray([cosNumber(70), cosNumber(20), cosNumber(110), cosNumber(60)]),
        AP: cosDict({ N: hidApRef }),
      })
    );

    dictSet(page.dict, "Annots", cosArray([visAnnotRef, hidAnnotRef]));

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Inside visible annotation at PDF (30, 40) -> screen (30, 60): green (0, 255, 0)
    const idxVis = (60 * bmp.width + 30) * 4;
    expect(bmp.data[idxVis]).toBe(0);
    expect(bmp.data[idxVis + 1]).toBe(255);
    expect(bmp.data[idxVis + 2]).toBe(0);

    // Inside hidden annotation at PDF (90, 40) -> screen (90, 60): white background (255, 255, 255)
    const idxHid = (60 * bmp.width + 90) * 4;
    expect(bmp.data[idxHid]).toBe(255);
    expect(bmp.data[idxHid + 1]).toBe(255);
    expect(bmp.data[idxHid + 2]).toBe(255);

    // Extracted text includes U+2206 / U+0394 from apFontRef and excludes HiddenText
    const text = doc.extractText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("HiddenText");
  });

  it("evaluates /Indexed, /Lab, /CalRGB, /CalGray, and /DeviceN color spaces in vector and shading operations", () => {
    const doc = PdfDocument.create();
    // 1. /Indexed palette over /DeviceRGB: index 0 = red (255,0,0), index 1 = blue (0,0,255)
    const idxLookupRef = doc.cos.allocateObject(
      cosStream(new Uint8Array([255, 0, 0, 0, 0, 255]))
    );
    const csIndexedRef = doc.cos.allocateObject(
      cosArray([cosName("Indexed"), cosName("DeviceRGB"), cosNumber(1), idxLookupRef])
    );
    // 2. /Lab color space (D65 whitepoint): L*=53.24, a*=80.09, b*=67.20 -> bright sRGB red
    const csLabRef = doc.cos.allocateObject(
      cosArray([
        cosName("Lab"),
        cosDict({
          WhitePoint: cosArray([cosNumber(0.95047), cosNumber(1.0), cosNumber(1.08883)]),
          Range: cosArray([cosNumber(-100), cosNumber(100), cosNumber(-100), cosNumber(100)]),
        }),
      ])
    );
    // 3. /DeviceN with 2 spot colorants and a Type 4 PostScript tint transform function to /DeviceRGB
    const devNFnCode = new TextEncoder().encode("{ exch 0.0 }",);
    const devNFnRef = doc.cos.allocateObject(
      cosStream(
        cosDict({
          FunctionType: cosNumber(4),
          Domain: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
          Range: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
        }),
        devNFnCode
      )
    );
    const csDeviceNRef = doc.cos.allocateObject(
      cosArray([
        cosName("DeviceN"),
        cosArray([cosName("CyanSpot"), cosName("YellowSpot")]),
        cosName("DeviceRGB"),
        devNFnRef,
      ])
    );

    const page = doc.addPage({
      width: 120,
      height: 80,
    });
    const streamBytes = new TextEncoder().encode(
      [
        // Left rect [10..35]: /Indexed index 1 -> blue (0, 0, 255)
        "q /CSIdx cs 1 scn 10 20 25 40 re f Q",
        // Middle rect [45..70]: /Lab bright red (L*=53, a*=80, b*=67)
        "q /CSLab cs 53.24 80.09 67.20 scn 45 20 25 40 re f Q",
        // Right rect [80..105]: /DeviceN (0.2, 0.9) -> PS `{ exch 0.0 }` -> (0.9, 0.2, 0.0)
        "q /CSDevN cs 0.2 0.9 scn 80 20 25 40 re f Q",
      ].join("\n")
    );
    dictSet(page.dict, "Contents", doc.cos.allocateObject(cosStream(streamBytes)));
    const resDict = doc.cos.resolveDict(dictGet(page.dict, "Resources"))!;
    dictSet(
      resDict,
      "ColorSpace",
      cosDict({
        CSIdx: csIndexedRef,
        CSLab: csLabRef,
        CSDevN: csDeviceNRef,
      })
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Left rect at (20, 40): blue
    const idxLeft = (40 * bmp.width + 20) * 4;
    expect(bmp.data[idxLeft]).toBe(0);
    expect(bmp.data[idxLeft + 1]).toBe(0);
    expect(bmp.data[idxLeft + 2]).toBe(255);

    // Middle rect at (55, 40): Lab bright red (R > 220, G < 40, B < 40)
    const idxMid = (40 * bmp.width + 55) * 4;
    expect(bmp.data[idxMid]).toBeGreaterThan(220);
    expect(bmp.data[idxMid + 1]).toBeLessThan(40);
    expect(bmp.data[idxMid + 2]).toBeLessThan(40);

    // Right rect at (90, 40): DeviceN -> R ~ 230, G ~ 51, B = 0
    const idxRight = (40 * bmp.width + 90) * 4;
    expect(bmp.data[idxRight]).toBeGreaterThan(210);
    expect(bmp.data[idxRight + 1]).toBeGreaterThan(40);
    expect(bmp.data[idxRight + 1]).toBeLessThan(70);
    expect(bmp.data[idxRight + 2]).toBe(0);
  });

  it("evaluates ISO 32000-1 §8.11 Optional Content Groups (/OCProperties, /OCG, /OCMD) and §14.6.2 /Resources /Properties /ActualText", () => {
    const doc = PdfDocument.create();
    const ocgOnRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("OCG"), Name: cosString("VisibleLayer") })
    );
    const ocgOffRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("OCG"), Name: cosString("HiddenLayer") })
    );
    const ocmdAllOnRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("OCMD"),
        OCGs: cosArray([ocgOnRef, ocgOffRef]),
        P: cosName("AllOn"),
      })
    );
    const propActualRef = doc.cos.allocateObject(
      cosDict({
        MCID: cosNumber(1),
        ActualText: cosString("ExpandedFromPropertiesDict"),
      })
    );
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "OCProperties",
      doc.cos.allocateObject(
        cosDict({
          OCGs: cosArray([ocgOnRef, ocgOffRef]),
          D: cosDict({
            BaseState: cosName("ON"),
            ON: cosArray([ocgOnRef]),
            OFF: cosArray([ocgOffRef]),
          }),
        })
      )
    );

    const page = doc.addPage({ width: 120, height: 80 });
    const f1Ref = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    const contentBytes = new TextEncoder().encode(
      [
        // 1. Visible OCG rect [10..40]: green
        "/OC /MCOn BDC 0 1 0 rg 10 20 30 40 re f BT /F1 12 Tf 10 60 Td (LayerOnText) Tj ET EMC",
        // 2. Hidden OCG rect [50..80]: red (should be skipped!)
        "/OC /MCOff BDC 1 0 0 rg 50 20 30 40 re f BT /F1 12 Tf 50 60 Td (LayerOffText) Tj ET EMC",
        // 3. OCMD AllOn with one OFF member [85..110]: blue (should be skipped!)
        "/OC /MCOcmd BDC 0 0 1 rg 85 20 25 40 re f BT /F1 12 Tf 85 60 Td (OcmdOffText) Tj ET EMC",
        // 4. Property list in /Resources /Properties with /ActualText
        "/Span /MCActual BDC BT /F1 12 Tf 10 10 Td (RawGlyphs) Tj ET EMC",
      ].join("\n")
    );
    dictSet(page.dict, "Contents", doc.cos.allocateObject(cosStream(contentBytes)));
    dictSet(
      page.dict,
      "Resources",
      cosDict({
        Font: cosDict({ F1: f1Ref }),
        Properties: cosDict({
          MCOn: ocgOnRef,
          MCOff: ocgOffRef,
          MCOcmd: ocmdAllOnRef,
          MCActual: propActualRef,
        }),
      })
    );

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // (20, 40) is inside visible OCG -> green (0, 255, 0)
    const idxOn = (40 * bmp.width + 20) * 4;
    expect(bmp.data[idxOn]).toBe(0);
    expect(bmp.data[idxOn + 1]).toBe(255);
    expect(bmp.data[idxOn + 2]).toBe(0);

    // (60, 40) is inside hidden OCG -> white background (255, 255, 255)
    const idxOff = (40 * bmp.width + 60) * 4;
    expect(bmp.data[idxOff]).toBe(255);
    expect(bmp.data[idxOff + 1]).toBe(255);
    expect(bmp.data[idxOff + 2]).toBe(255);

    // (95, 40) is inside OCMD (/AllOn with one OFF) -> white background (255, 255, 255)
    const idxOcmd = (40 * bmp.width + 95) * 4;
    expect(bmp.data[idxOcmd]).toBe(255);
    expect(bmp.data[idxOcmd + 1]).toBe(255);
    expect(bmp.data[idxOcmd + 2]).toBe(255);

    // Extracted text includes LayerOnText and ExpandedFromPropertiesDict, and excludes LayerOffText / OcmdOffText
    const extractedText = doc.extractText();
    expect(extractedText).toContain("LayerOnText");
    expect(extractedText).toContain("ExpandedFromPropertiesDict");
    expect(extractedText).not.toContain("LayerOffText");
    expect(extractedText).not.toContain("OcmdOffText");
  });

  it("evaluates 0 w hairlines, CTM stroke-width scaling, and J/j/M (/LC, /LJ, /ML) line cap, join, and miter limit in bitmap and SVG", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 120, height: 80 });
    const gsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("ExtGState"),
        LC: cosNumber(2), // square cap
        LJ: cosNumber(1), // round join
        ML: cosNumber(4), // miter limit 4
      })
    );
    const contentBytes = new TextEncoder().encode(
      [
        // 1. Hairline (0 w) red horizontal line at y=60
        "q 1 0 0 rg 1 0 0 RG 0 w 10 60 m 110 60 l S Q",
        // 2. Square cap (2 J via /GS1 gs) thick blue line from x=40 to x=60 at y=30 (width=10 -> projects 5pt to x=35..65)
        "q /GS1 gs 0 0 1 RG 10 w 40 30 m 60 30 l S Q",
        // 3. Butt cap (0 J) thick green line from x=40 to x=60 at y=15 (width=10 -> stops at x=40..60)
        "q 0 J 2 j 6 M 0 1 0 RG 10 w 40 15 m 60 15 l S Q",
      ].join("\n")
    );
    dictSet(page.dict, "Contents", doc.cos.allocateObject(cosStream(contentBytes)));
    dictSet(
      page.dict,
      "Resources",
      cosDict({
        ExtGState: cosDict({ GS1: gsRef }),
      })
    );

    const dl = page.evaluateDisplayList();
    expect(dl.paths[0]?.strokeWidth).toBe(0);
    expect(dl.paths[1]?.lineCap).toBe(2);
    expect(dl.paths[1]?.lineJoin).toBe(1);
    expect(dl.paths[1]?.miterLimit).toBe(4);
    expect(dl.paths[2]?.lineJoin).toBe(2);
    expect(dl.paths[2]?.miterLimit).toBe(6);

    const svg = renderDisplayListToSvg(dl);
    expect(svg).toContain('stroke-width="1" vector-effect="non-scaling-stroke"');
    expect(svg).toContain('stroke-linecap="square"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('stroke-miterlimit="4"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-miterlimit="6"');

    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72 });
    // Square cap at y=30 (screen y = 80 - 30 = 50), x=37 (3pt past endpoint x=40): painted blue
    const idxSquareCap = (50 * bmp.width + 37) * 4;
    expect(bmp.data[idxSquareCap]).toBe(0);
    expect(bmp.data[idxSquareCap + 2]).toBe(255);

    // Butt cap at y=15 (screen y = 80 - 15 = 65), x=37 (3pt past endpoint x=40): remains white
    const idxButtCap = (65 * bmp.width + 37) * 4;
    expect(bmp.data[idxButtCap]).toBe(255);
    expect(bmp.data[idxButtCap + 1]).toBe(255);
    expect(bmp.data[idxButtCap + 2]).toBe(255);
  });

  it("emits font-weight, font-style, and rotation transforms on SVG <text> elements in renderDisplayListToSvg", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText("B", { x: 20, y: 150, size: 16, font: "Helvetica-Bold" });
    page.drawText("I", { x: 40, y: 150, size: 14, font: "Times-Italic" });
    page.drawText("R", { x: 60, y: 100, size: 12, font: "Courier-BoldOblique", rotateRadians: Math.PI / 4 });

    const svg = renderDisplayListToSvg(page.evaluateDisplayList());
    expect(svg).toContain(`font-weight="bold"`);
    expect(svg).toContain(`font-style="italic"`);
    expect(svg).toContain(`transform="rotate(-45 `);
  });
});
