import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  decodePng,
  encodeJpeg,
  encodePng,
  dictGet,
  dictSet,
} from "@poe-code/pdf-ast";
import {
  createPdfimagesCommand,
  pdfimagesPlugin,
  runPdfimagesCli,
} from "./index.js";

function createMultiImagePdf(): Uint8Array {
  const doc = PdfDocument.create();

  // Page 1: 80x40 RGB image drawn at 40x20 pt (144x144 PPI)
  const p1 = doc.addPage([612, 792]);
  const rgb = new Uint8Array(80 * 40 * 3);
  for (let i = 0; i < 80 * 40; i++) {
    rgb[i * 3] = 10;
    rgb[i * 3 + 1] = 120;
    rgb[i * 3 + 2] = 240;
  }
  const h1 = doc.embedRgbImage(80, 40, rgb);
  p1.drawImage(h1, { x: 50, y: 500, width: 40, height: 20 });

  // Page 2: JPEG image XObject (32x16)
  const p2 = doc.addPage([612, 792]);
  const fakeJpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00,
    0x00, 0xff, 0xd9,
  ]);
  const jpgStream = cosStream(fakeJpeg, {
    dict: cosDict({
      Type: cosName("XObject"),
      Subtype: cosName("Image"),
      Width: cosNumber(32),
      Height: cosNumber(16),
      ColorSpace: cosName("DeviceRGB"),
      BitsPerComponent: cosNumber(8),
      Filter: cosName("DCTDecode"),
    }),
    compress: false,
  });
  const jpgRef = doc.cos.allocateObject(jpgStream);
  const p2Res = p2.getResourcesDict();
  dictSet(p2Res, "XObject", cosDict({ ImJpg: jpgRef }));
  dictSet(
    p2.pageDict,
    "Contents",
    doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 32 0 0 16 10 10 cm /ImJpg Do Q"), { compress: false }))
  );

  return doc.save();
}

describe("safe-bash-command-pdfimages", () => {
  it("outputs the exact Poppler table header and rows for -list", async () => {
    const pdfBytes = createMultiImagePdf();
    const files = new Map<string, Uint8Array>([["paper.pdf", pdfBytes]]);

    const res = await runPdfimagesCli(["-list", "paper.pdf"], files);
    expect(res.exitCode).toBe(0);
    const lines = res.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio"
    );
    expect(lines[1]).toBe(
      "--------------------------------------------------------------------------------------------"
    );
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("80");
    expect(lines[2]).toContain("40");
    expect(lines[2]).toContain("rgb");
    expect(lines[2]).toContain("144");
    expect(lines[3]).toContain("32");
    expect(lines[3]).toContain("16");
    expect(lines[3]).toContain("jpeg");
  });

  it("extracts embedded images to img-000.png, img-001.png matching original pixel dimensions", async () => {
    const pdfBytes = createMultiImagePdf();
    const files = new Map<string, Uint8Array>([["paper.pdf", pdfBytes]]);

    const res = await runPdfimagesCli(["-png", "paper.pdf", "img"], files);
    expect(res.exitCode).toBe(0);
    expect(files.has("img-000.png")).toBe(true);
    expect(files.has("img-001.png")).toBe(true);

    const bmp0 = decodePng(files.get("img-000.png")!);
    expect(bmp0.width).toBe(80);
    expect(bmp0.height).toBe(40);
    expect(bmp0.data[0]).toBe(10);
    expect(bmp0.data[1]).toBe(120);
    expect(bmp0.data[2]).toBe(240);
  });

  it("supports -j for raw JPEG extraction, -p page numbering, and -f/-l page ranges", async () => {
    const pdfBytes = createMultiImagePdf();
    const files = new Map<string, Uint8Array>([["paper.pdf", pdfBytes]]);

    const res = await runPdfimagesCli(["-j", "-png", "-p", "-f", "2", "-l", "2", "paper.pdf", "fig"], files);
    expect(res.exitCode).toBe(0);
    expect(files.has("fig-002-000.jpg")).toBe(true);
    const jpg = files.get("fig-002-000.jpg")!;
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
  });

  it("protects against infinite recursion on circular Form XObjects", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    const formRes = cosDict({ XObject: cosDict({}) });
    const formStream = cosStream(new TextEncoder().encode("/Loop Do"), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        Resources: formRes,
      }),
      compress: false,
    });
    const formRef = doc.cos.allocateObject(formStream);
    const xobjDict = dictGet(formRes, "XObject");
    if (xobjDict?.kind === "dict") dictSet(xobjDict, "Loop", formRef);
    dictSet(page.getResourcesDict(), "XObject", cosDict({ Loop: formRef }));
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode("/Loop Do"), { compress: false }))
    );

    const files = new Map<string, Uint8Array>([["cycle.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-list", "cycle.pdf"], files);
    expect(res.exitCode).toBe(0);
  });

  it("exposes createPdfimagesCommand and pdfimagesPlugin", () => {
    expect(createPdfimagesCommand().name).toBe("pdfimages");
    expect(pdfimagesPlugin().name).toBe("pdfimages");
  });

  it("extracts 1-bit monochrome images as .pbm, Indexed palette images, and inline images", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([300, 300]);

    // 1-bit monochrome 8x2 image
    const monoStream = cosStream(Uint8Array.from([0b10101010, 0b01010101]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(8),
        Height: cosNumber(2),
        ColorSpace: cosName("DeviceGray"),
        BitsPerComponent: cosNumber(1),
      }),
      compress: false,
    });
    const monoRef = doc.cos.allocateObject(monoStream);
    dictSet(page.getResourcesDict(), "XObject", cosDict({ ImMono: monoRef }));
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(
        cosStream(
          new TextEncoder().encode("q 8 0 0 2 10 10 cm /ImMono Do Q BI /W 2 /H 1 /CS /G /BPC 8 ID \x20\xe0\nEI"),
          { compress: false }
        )
      )
    );

    const files = new Map<string, Uint8Array>([["mono.pdf", doc.save()]]);
    const listRes = await runPdfimagesCli(["-list", "mono.pdf"], files);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout).toContain("[inline]");

    const extRes = await runPdfimagesCli(["mono.pdf", "out"], files);
    expect(extRes.exitCode).toBe(0);
    expect(files.has("out-000.pbm")).toBe(true);
    expect(files.has("out-001.ppm")).toBe(true);
  });

  it("preserves RGBA alpha channel transparency via /SMask when extracting embedded PNGs with -png", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const rgbaData = Uint8Array.from([
      255, 10, 20, 128, // semi-transparent red
      10, 250, 30, 64,  // quarter-opaque green
      20, 30, 240, 255, // opaque blue
      255, 255, 0, 0,   // fully transparent yellow
    ]);
    const pngBytes = encodePng({ width: 2, height: 2, data: rgbaData });
    const emb = doc.embedPng(pngBytes);
    page.drawImage(emb, { x: 10, y: 10, width: 50, height: 50 });

    const files = new Map<string, Uint8Array>([["alpha.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-png", "alpha.pdf", "rgba-out"], files);
    expect(res.exitCode).toBe(0);
    const extractedPng = decodePng(files.get("rgba-out-000.png")!);
    expect(extractedPng.width).toBe(2);
    expect(extractedPng.height).toBe(2);
    expect(Array.from(extractedPng.data)).toEqual(Array.from(rgbaData));
  });

  it("supports -all mixed JPEG + PNG extraction, stdin (-) input, and -upw encrypted PDFs", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    const jpgBytes = encodeJpeg({
      width: 8,
      height: 8,
      data: new Uint8Array(8 * 8 * 4).fill(180),
    });
    const pngBytes = encodePng({
      width: 4,
      height: 4,
      data: new Uint8Array(4 * 4 * 4).fill(120),
    });
    page.drawImage(doc.embedJpg(jpgBytes), { x: 10, y: 10, width: 40, height: 40 });
    page.drawImage(doc.embedPng(pngBytes), { x: 60, y: 10, width: 40, height: 40 });
    const encBytes = doc.save({
      encrypt: { userPassword: "u1", ownerPassword: "o1", revision: 6 },
    });

    const files = new Map<string, Uint8Array>([["-", encBytes]]);
    const res = await runPdfimagesCli(["-all", "-upw", "u1", "-", "mixed"], files);
    expect(res.exitCode).toBe(0);
    expect(files.has("mixed-000.jpg")).toBe(true);
    expect(files.has("mixed-001.png")).toBe(true);

    const errRes = await runPdfimagesCli([], new Map());
    expect(errRes.exitCode).toBe(99);
  });

  it("supports -tiff extraction writing valid Baseline TIFF 6.0 (.tif) files", async () => {
    const pdfBytes = createMultiImagePdf();
    const files = new Map<string, Uint8Array>([["paper.pdf", pdfBytes]]);
    const res = await runPdfimagesCli(["-tiff", "-f", "1", "-l", "1", "paper.pdf", "tif-out"], files);
    expect(res.exitCode).toBe(0);
    const tif = files.get("tif-out-000.tif");
    expect(tif).toBeDefined();
    expect(Array.from(tif!.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);
  });

  it("applies explicit /Mask 1-bit stencil stream XObjects to extracted PNG alpha and supports -print-filenames", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    // 2x1 1-bit explicit mask stream: bit 0 (left) = 0 (opaque), bit 1 (right) = 1 (masked/transparent)
    const maskStream = cosStream(Uint8Array.from([0b01000000]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        ImageMask: { kind: "boolean", value: true },
        BitsPerComponent: cosNumber(1),
      }),
      compress: false,
    });
    const maskRef = doc.cos.allocateObject(maskStream);

    // 2x1 RGB image XObject with /Mask pointing to maskRef
    const imgStream = cosStream(
      Uint8Array.from([
        200, 50, 25, // left pixel
        200, 50, 25, // right pixel (should be masked to alpha=0)
      ]),
      {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(1),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
          Mask: maskRef,
        }),
        compress: false,
      }
    );
    const imgRef = doc.cos.allocateObject(imgStream);

    dictSet(page.getResourcesDict(), "XObject", cosDict({ ImMasked: imgRef }));
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 40 0 0 20 10 10 cm /ImMasked Do Q"), { compress: false }))
    );

    const files = new Map<string, Uint8Array>([["explicit-mask.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-png", "-print-filenames", "explicit-mask.pdf", "masked"], files);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("masked-000.png");

    const png = decodePng(files.get("masked-000.png")!);
    expect(png.width).toBe(2);
    expect(png.height).toBe(1);
    // Left pixel: opaque (255), Right pixel: transparent (0)
    expect(Array.from(png.data)).toEqual([200, 50, 25, 255, 200, 50, 25, 0]);
  });

  it("supports -u to deduplicate shared XObject images referenced across multiple pages", async () => {
    const doc = PdfDocument.create();
    const pngBytes = encodePng({
      width: 2,
      height: 2,
      data: Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]),
    });
    const imgHandle = doc.embedPng(pngBytes);
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage({ width: 100, height: 100 });
      p.drawImage(imgHandle, { x: 10, y: 10, width: 40, height: 40 });
    }
    const files = new Map<string, Uint8Array>([["shared.pdf", doc.save()]]);

    // Without -u: 3 occurrences across 3 pages
    const allRes = await runPdfimagesCli(["-png", "shared.pdf", "all_img"], files);
    expect(allRes.exitCode).toBe(0);
    expect(files.has("all_img-000.png")).toBe(true);
    expect(files.has("all_img-001.png")).toBe(true);
    expect(files.has("all_img-002.png")).toBe(true);

    // With -u: deduplicated to 1 unique XObject image
    const uniqRes = await runPdfimagesCli(["-u", "-png", "shared.pdf", "uniq_img"], files);
    expect(uniqRes.exitCode).toBe(0);
    expect(files.has("uniq_img-000.png")).toBe(true);
    expect(files.has("uniq_img-001.png")).toBe(false);
  });

  it("supports native -jp2 (.jp2), -jbig2 (.jb2e), -ccitt (.ccitt + .params), and -all extraction", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const jp2Payload = Uint8Array.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]);
    const jbig2Payload = Uint8Array.from([0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ccittPayload = Uint8Array.from([0x00, 0x10, 0x01, 0x00]);

    const jp2Ref = doc.cos.allocateObject(
      cosStream(jp2Payload, {
        compress: false,
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(16),
          Height: cosNumber(16),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
          Filter: cosName("JPXDecode"),
        }),
      })
    );
    const jbig2Ref = doc.cos.allocateObject(
      cosStream(jbig2Payload, {
        compress: false,
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(32),
          Height: cosNumber(24),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(1),
          Filter: cosName("JBIG2Decode"),
        }),
      })
    );
    const ccittRef = doc.cos.allocateObject(
      cosStream(ccittPayload, {
        compress: false,
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(64),
          Height: cosNumber(48),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(1),
          Filter: cosName("CCITTFaxDecode"),
          DecodeParms: cosDict({
            K: cosNumber(-1),
            Columns: cosNumber(64),
            Rows: cosNumber(48),
            BlackIs1: { kind: "boolean", value: true },
          }),
        }),
      })
    );

    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({
          ImJp2: jp2Ref,
          ImJb2: jbig2Ref,
          ImFax: ccittRef,
        }),
      })
    );
    page.setRawContentStream("q 16 0 0 16 0 0 cm /ImJp2 Do Q q 32 0 0 24 20 0 cm /ImJb2 Do Q q 64 0 0 48 0 30 cm /ImFax Do Q");

    const files = new Map<string, Uint8Array>([["streams.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-all", "-print-filenames", "streams.pdf", "raw"], files);
    expect(res.exitCode).toBe(0);
    expect(Array.from(files.get("raw-000.jp2") ?? [])).toEqual(Array.from(jp2Payload));
    expect(Array.from(files.get("raw-001.jb2e") ?? [])).toEqual(Array.from(jbig2Payload));
    expect(Array.from(files.get("raw-002.ccitt") ?? [])).toEqual(Array.from(ccittPayload));
    const paramsText = new TextDecoder().decode(files.get("raw-002.params")!);
    expect(paramsText).toContain("-4");
    expect(paramsText).toContain("-x 64");
    expect(paramsText).toContain("-y 48");
    expect(res.stdout).toContain("raw-002.params");
  });

  it("extracts images embedded inside annotation /AP /N appearance streams, /PatternType 1 tiling patterns, and Type 3 /CharProcs", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const makeImgRef = (r: number, g: number, b: number) =>
      doc.cos.allocateObject(
        cosStream(new Uint8Array([r, g, b]), {
          compress: true,
          dict: cosDict({
            Type: cosName("XObject"),
            Subtype: cosName("Image"),
            Width: cosNumber(1),
            Height: cosNumber(1),
            ColorSpace: cosName("DeviceRGB"),
            BitsPerComponent: cosNumber(8),
          }),
        })
      );

    const patImgRef = makeImgRef(255, 0, 0);
    const t3ImgRef = makeImgRef(0, 255, 0);
    const annotImgRef = makeImgRef(0, 0, 255);

    const tilePatRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("q 10 0 0 10 0 0 cm /ImPat Do Q"), {
        dict: cosDict({
          Type: cosName("Pattern"),
          PatternType: cosNumber(1),
          PaintType: cosNumber(1),
          TilingType: cosNumber(1),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(10), cosNumber(10)]),
          XStep: cosNumber(10),
          YStep: cosNumber(10),
          Resources: cosDict({ XObject: cosDict({ ImPat: patImgRef }) }),
        }),
      })
    );

    const gAStreamRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("10 0 d0 q 10 0 0 10 0 0 cm /ImT3 Do Q"))
    );
    const type3FontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type3"),
        FontBBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(10), cosNumber(10)]),
        FontMatrix: cosArray([cosNumber(0.1), cosNumber(0), cosNumber(0), cosNumber(0.1), cosNumber(0), cosNumber(0)]),
        CharProcs: cosDict({ gA: gAStreamRef }),
        Encoding: cosDict({
          Type: cosName("Encoding"),
          Differences: cosArray([cosNumber(65), cosName("gA")]),
        }),
        Resources: cosDict({ XObject: cosDict({ ImT3: t3ImgRef }) }),
      })
    );

    const apStreamRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("q 10 0 0 10 0 0 cm /ImAnnot Do Q"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(10), cosNumber(10)]),
          Resources: cosDict({ XObject: cosDict({ ImAnnot: annotImgRef }) }),
        }),
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

    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        Pattern: cosDict({ PTile: tilePatRef }),
        Font: cosDict({ F3: type3FontRef }),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([stampAnnotRef]));
    page.setRawContentStream("/Pattern cs /PTile scn 0 0 10 10 re f BT /F3 10 Tf (A) Tj ET");

    const files = new Map<string, Uint8Array>([["nested.pdf", doc.save()]]);
    const listRes = await runPdfimagesCli(["-list", "nested.pdf"], files);
    expect(listRes.exitCode).toBe(0);
    // All 3 embedded images (pattern, Type 3 glyph, annotation appearance) should be listed
    const dataLines = listRes.stdout.trim().split("\n").slice(2);
    expect(dataLines.length).toBe(3);
  });

  it("rejects invalid page ranges with exitCode 99 and suppresses stderr with -q", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 100, height: 100 });
    const files = new Map<string, Uint8Array>([["one.pdf", doc.save()]]);
    const badRange = await runPdfimagesCli(["-list", "-f", "3", "-l", "1", "one.pdf"], files);
    expect(badRange.exitCode).toBe(99);
    expect(badRange.stderr).toContain("Wrong page range given");

    const quietBadRange = await runPdfimagesCli(["-list", "-q", "-f", "3", "-l", "1", "one.pdf"], files);
    expect(quietBadRange.exitCode).toBe(99);
    expect(quietBadRange.stderr).toBe("");
  });

  it("reports Poppler color space labels (devn, sep, lab, icc, -) in pdfimages -list", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });

    const sepImgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([200]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosArray([
            cosName("Separation"),
            cosName("SpotRed"),
            cosName("DeviceRGB"),
            cosDict({
              FunctionType: cosNumber(2),
              C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
              C1: cosArray([cosNumber(0.9), cosNumber(0.1), cosNumber(0.1)]),
              N: cosNumber(1),
            }),
          ]),
        }),
      })
    );

    const stencilRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x80]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(1),
          ImageMask: { kind: "boolean", value: true },
        }),
      })
    );

    const kSep = page.ensureXObjectResource(sepImgRef);
    const kMask = page.ensureXObjectResource(stencilRef);
    page.setRawContentStream(`q 10 0 0 10 10 10 cm /${kSep} Do Q q 10 0 0 10 30 10 cm /${kMask} Do Q`);

    const files = new Map<string, Uint8Array>([["cs-labels.pdf", doc.save()]]);
    const listRes = await runPdfimagesCli(["-list", "cs-labels.pdf"], files);
    expect(listRes.exitCode).toBe(0);
    const rows = listRes.stdout.trim().split("\n").slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("sep  ");
    expect(rows[1]).toContain("stencil");
    expect(rows[1]).toContain(" -    ");
  });

  it("unwraps outer ASCIIHexDecode filter chains before terminal CCITTFaxDecode and JPXDecode codecs", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const hexCcitt = new TextEncoder().encode("1F3E>");
    const ccittRef = doc.cos.allocateObject(
      cosStream(hexCcitt, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(8),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          Filter: cosArray([cosName("ASCIIHexDecode"), cosName("CCITTFaxDecode")]),
          DecodeParms: cosArray([cosDict({}), cosDict({ K: cosNumber(-1) })]),
        }),
      })
    );

    const hexJp2 = new TextEncoder().encode("0000000C6A502020>");
    const jp2Ref = doc.cos.allocateObject(
      cosStream(hexJp2, {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(4),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosName("DeviceRGB"),
          Filter: cosArray([cosName("ASCIIHexDecode"), cosName("JPXDecode")]),
        }),
      })
    );

    const k1 = page.ensureXObjectResource(ccittRef);
    const k2 = page.ensureXObjectResource(jp2Ref);
    page.setRawContentStream(`q 10 0 0 10 10 10 cm /${k1} Do Q q 10 0 0 10 30 10 cm /${k2} Do Q`);

    const files = new Map<string, Uint8Array>([["chained.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-ccitt", "-jp2", "chained.pdf", "ch"], files);
    expect(res.exitCode).toBe(0);
    expect(files.get("ch-000.ccitt")).toEqual(Uint8Array.from([0x1f, 0x3e]));
    expect(files.get("ch-001.jp2")).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]));
  });

  it("extracts .jb2e + .jb2g for JBIG2Decode with JBIG2Globals and includes .jb2g in -print-filenames", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const grayRef = doc.cos.allocateObject(
      cosStream(new Uint8Array([40, 120, 200, 250]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(2),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosName("DeviceGray"),
        }),
      })
    );

    const jb2GlobalsRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]), {
        dict: cosDict({}),
      })
    );
    const jb2Ref = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x00, 0x00, 0x00, 0x02, 0x30]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(4),
          BitsPerComponent: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          Filter: cosName("JBIG2Decode"),
          DecodeParms: cosDict({
            JBIG2Globals: jb2GlobalsRef,
          }),
        }),
      })
    );

    const kGray = page.ensureXObjectResource(grayRef);
    const kJb2 = page.ensureXObjectResource(jb2Ref);
    page.setRawContentStream(`q 20 0 0 20 10 10 cm /${kGray} Do Q q 20 0 0 20 50 10 cm /${kJb2} Do Q`);

    const files = new Map<string, Uint8Array>([["gray-jb2.pdf", doc.save()]]);
    const defRes = await runPdfimagesCli(["-jbig2", "-print-filenames", "gray-jb2.pdf", "out"], files);
    expect(defRes.exitCode).toBe(0);
    const ppmBytes = files.get("out-000.ppm");
    expect(ppmBytes).toBeDefined();
    expect(new TextDecoder().decode(ppmBytes!.subarray(0, 3))).toBe("P6\n");
    expect(files.get("out-001.jb2e")).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x02, 0x30]));
    expect(files.get("out-001.jb2g")).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]));
    expect(defRes.stdout).toContain("out-001.jb2e");
    expect(defRes.stdout).toContain("out-001.jb2g");
  });

  it("extracts .jb2e and .jb2g when JBIG2 image uses multi-filter [/ASCIIHexDecode /JBIG2Decode] and /DecodeParms [null << /JBIG2Globals ... >>]", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const jb2GlobalsRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]), {
        dict: cosDict({}),
      })
    );
    const jb2Ref = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("0000000230>"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(4),
          BitsPerComponent: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          Filter: cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]),
          DecodeParms: cosArray([
            { kind: "null" },
            cosDict({
              JBIG2Globals: jb2GlobalsRef,
            }),
          ]),
        }),
      })
    );

    const kJb2 = page.ensureXObjectResource(jb2Ref);
    page.setRawContentStream(`q 20 0 0 20 10 10 cm /${kJb2} Do Q`);

    const files = new Map<string, Uint8Array>([["multi-jb2.pdf", doc.save()]]);
    const res = await runPdfimagesCli(["-all", "-print-filenames", "multi-jb2.pdf", "out"], files);
    expect(res.exitCode).toBe(0);
    expect(files.get("out-000.jb2e")).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x02, 0x30]));
    expect(files.get("out-000.jb2g")).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]));
  });
});
