import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictGet,
  dictSet,
} from "../index.js";
import { extractDocumentImages, decodeJpegToRgba } from "./images.js";
import { encodeJpeg, decodePng } from "../render/raster.js";

function makeMinimalBaselineJpeg2x2(): Uint8Array {
  return encodeJpeg({
    width: 2,
    height: 2,
    data: new Uint8Array(2 * 2 * 4).fill(180),
  });
}

describe("extractDocumentImages", () => {
  it("extracts direct XObject images with accurate dimensions, object ID, and CTM PPI", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    const rgb = new Uint8Array(100 * 50 * 3);
    for (let i = 0; i < 100 * 50; i++) {
      rgb[i * 3] = 200;
      rgb[i * 3 + 1] = 100;
      rgb[i * 3 + 2] = 50;
    }
    const handle = doc.embedRgbImage(100, 50, rgb);
    page.drawImage(handle, { x: 72, y: 500, width: 50, height: 25 });

    const saved = PdfDocument.load(doc.save());
    const extracted = extractDocumentImages(saved.cos);
    expect(extracted).toHaveLength(1);
    const img = extracted[0]!;
    expect(img.pageNumber).toBe(1);
    expect(img.imageIndex).toBe(0);
    expect(img.inline).toBe(false);
    expect(img.objectId?.objNum).toBeGreaterThan(0);
    expect(img.width).toBe(100);
    expect(img.height).toBe(50);
    expect(img.colorSpace).toBe("rgb");
    expect(img.components).toBe(3);
    expect(img.bitsPerComponent).toBe(8);
    expect(img.encoding).toBe("image");
    expect(img.xPpi).toBe(144);
    expect(img.yPpi).toBe(144);
    expect(img.bitmap.width).toBe(100);
    expect(img.bitmap.height).toBe(50);
    expect(img.bitmap.data[0]).toBe(200);
    expect(img.bitmap.data[1]).toBe(100);
    expect(img.bitmap.data[2]).toBe(50);
    expect(img.bitmap.data[3]).toBe(255);
  });

  it("extracts images inside nested Form XObjects and guards against circular Form references", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([400, 400]);

    const gray = new Uint8Array(20 * 10).fill(128);
    const imgStream = cosStream(gray, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(20),
        Height: cosNumber(10),
        ColorSpace: cosName("DeviceGray"),
        BitsPerComponent: cosNumber(8),
      }),
      compress: true,
    });
    const imgRef = doc.cos.allocateObject(imgStream);

    const formResources = cosDict({
      XObject: cosDict({
        ImNested: imgRef,
      }),
    });
    const formContent = new TextEncoder().encode("q 20 0 0 10 0 0 cm /ImNested Do Q /FmSelf Do");
    const formStream = cosStream(formContent, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        Matrix: cosArray([cosNumber(1), cosNumber(0), cosNumber(0), cosNumber(1), cosNumber(10), cosNumber(20)]),
        Resources: formResources,
      }),
      compress: false,
    });
    const formRef = doc.cos.allocateObject(formStream);
    const xobjMap = dictGet(formResources, "XObject");
    if (xobjMap?.kind === "dict") {
      dictSet(xobjMap, "FmSelf", formRef);
    }

    const pageRes = page.getResourcesDict();
    let pageXObj = doc.cos.resolveDict(dictGet(pageRes, "XObject"));
    if (!pageXObj) {
      pageXObj = cosDict({});
      dictSet(pageRes, "XObject", pageXObj);
    }
    dictSet(pageXObj, "Fm1", formRef);

    page.setContentAst([
      {
        kind: "graphics-group",
        ops: [
          {
            kind: "state-op",
            operator: "cm",
            operands: [cosNumber(0.5), cosNumber(0), cosNumber(0), cosNumber(0.5), cosNumber(0), cosNumber(0)],
          },
          { kind: "xobject", name: "Fm1" },
        ],
      },
    ]);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.colorSpace).toBe("gray");
    expect(extracted[0]!.components).toBe(1);
    expect(extracted[0]!.width).toBe(20);
    expect(extracted[0]!.height).toBe(10);
    expect(extracted[0]!.xPpi).toBe(144);
    expect(extracted[0]!.yPpi).toBe(144);
  });

  it("extracts inline BI/ID/EI images and DCTDecode JPEG streams", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([300, 300]);

    const inlineOps = new TextEncoder().encode(
      "q 72 0 0 72 10 10 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID \xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\x00\nEI Q"
    );
    const contentStream = cosStream(inlineOps, { compress: false });
    const contentRef = doc.cos.allocateObject(contentStream);
    dictSet(page.pageDict, "Contents", contentRef);

    const page2 = doc.addPage([300, 300]);
    const fakeJpeg = makeMinimalBaselineJpeg2x2();
    const jpegStream = cosStream(fakeJpeg, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(2),
        ColorSpace: cosName("DeviceRGB"),
        BitsPerComponent: cosNumber(8),
        Filter: cosName("DCTDecode"),
      }),
      compress: false,
    });
    const jpegRef = doc.cos.allocateObject(jpegStream);
    const page2Res = page2.getResourcesDict();
    const page2XObj = cosDict({ ImJpg: jpegRef });
    dictSet(page2Res, "XObject", page2XObj);
    const p2Content = cosStream(new TextEncoder().encode("q 72 0 0 72 0 0 cm /ImJpg Do Q"), { compress: false });
    dictSet(page2.pageDict, "Contents", doc.cos.allocateObject(p2Content));

    const all = extractDocumentImages(doc.cos);
    expect(all).toHaveLength(2);
    expect(all[0]!.inline).toBe(true);
    expect(all[0]!.pageNumber).toBe(1);
    expect(all[0]!.width).toBe(2);
    expect(all[0]!.height).toBe(2);
    expect(all[0]!.xPpi).toBe(2);

    expect(all[1]!.inline).toBe(false);
    expect(all[1]!.pageNumber).toBe(2);
    expect(all[1]!.encoding).toBe("jpeg");
    expect(all[1]!.rawJpegBytes).toBeDefined();
    expect(all[1]!.rawJpegBytes![0]).toBe(0xff);
    expect(all[1]!.rawJpegBytes![1]).toBe(0xd8);

    const page2Only = extractDocumentImages(doc.cos, { firstPage: 2, lastPage: 2 });
    expect(page2Only).toHaveLength(1);
    expect(page2Only[0]!.pageNumber).toBe(2);
  });

  it("round-trips Baseline DCT JPEG encoding, decoding, PDF embedding, extraction, and page rendering", () => {
    const width = 16;
    const height = 8;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (x < 8) {
          rgba[idx] = 220;
          rgba[idx + 1] = 40;
          rgba[idx + 2] = 30;
          rgba[idx + 3] = 255;
        } else {
          rgba[idx] = 30;
          rgba[idx + 1] = 60;
          rgba[idx + 2] = 220;
          rgba[idx + 3] = 255;
        }
      }
    }

    const jpgBytes = encodeJpeg({ width, height, data: rgba }, 95);
    const decoded = decodeJpegToRgba(jpgBytes);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(8);
    expect(decoded.data[0]).toBeGreaterThan(180);
    expect(decoded.data[2]).toBeLessThan(80);
    const rightPixelIdx = (0 * width + 12) * 4;
    expect(decoded.data[rightPixelIdx + 2]).toBeGreaterThan(180);
    expect(decoded.data[rightPixelIdx]).toBeLessThan(80);

    const doc = PdfDocument.create();
    const embedded = doc.embedJpg(jpgBytes);
    const page = doc.addPage([160, 80]);
    page.drawImage(embedded, { x: 0, y: 0, width: 160, height: 80 });

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.encoding).toBe("jpeg");
    expect(extracted[0]!.bitmap.data[0]).toBeGreaterThan(180);
    expect(extracted[0]!.bitmap.data[rightPixelIdx + 2]).toBeGreaterThan(180);

    const renderedPng = decodePng(page.renderToPng({ dpi: 72 }));
    expect(renderedPng.width).toBe(160);
    expect(renderedPng.height).toBe(80);
    const sampleLeft = (40 * 160 + 20) * 4;
    const sampleRight = (40 * 160 + 120) * 4;
    expect(renderedPng.data[sampleLeft]).toBeGreaterThan(180);
    expect(renderedPng.data[sampleRight + 2]).toBeGreaterThan(180);
  });

  it("handles /ImageMask stencil classification, /Decode [1 0] inversion, and /Mask color-key transparency", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    // 1. 1-bit stencil with /ImageMask true and /Decode [1 0] (0=white 255, 1=black 0)
    const stencilStream = cosStream(Uint8Array.from([0b10000000]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        ImageMask: { kind: "boolean", value: true },
        BitsPerComponent: cosNumber(1),
        Decode: cosArray([cosNumber(1), cosNumber(0)]),
      }),
      compress: false,
    });
    const stencilRef = doc.cos.allocateObject(stencilStream);

    // 2. RGB image with /Mask [255 255 0 0 255 255] (magenta chroma-key transparent)
    const rgbSamples = Uint8Array.from([
      255, 0, 255, // pixel 0: magenta -> should become alpha 0
      10, 200, 30, // pixel 1: green -> should stay alpha 255
    ]);
    const chromaStream = cosStream(rgbSamples, {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        ColorSpace: cosName("DeviceRGB"),
        BitsPerComponent: cosNumber(8),
        Mask: cosArray([
          cosNumber(255), cosNumber(255),
          cosNumber(0), cosNumber(0),
          cosNumber(255), cosNumber(255),
        ]),
      }),
      compress: false,
    });
    const chromaRef = doc.cos.allocateObject(chromaStream);

    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({
          St1: stencilRef,
          Ch1: chromaRef,
        }),
      })
    );

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]!.type).toBe("stencil");
    // Bit 0 was 1, inverted by /Decode [1 0] -> 0; Bit 1 was 0, inverted -> 255
    expect(extracted[0]!.bitmap.data[0]).toBe(0);
    expect(extracted[0]!.bitmap.data[4]).toBe(255);

    expect(extracted[1]!.type).toBe("image");
    // Pixel 0 matched magenta chroma key -> alpha 0; Pixel 1 did not -> alpha 255
    expect(extracted[1]!.bitmap.data[3]).toBe(0);
    expect(extracted[1]!.bitmap.data[7]).toBe(255);
  });

  it("extracts inline /IM true stencil masks with omitted /BPC and /CS and applies /D [1 0] inversion", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const inlineBytes = Uint8Array.from([
      ...new TextEncoder().encode("q 20 0 0 10 5 5 cm BI /W 8 /H 1 /IM true /D [1 0] ID "),
      0b10100000,
      ...new TextEncoder().encode(" EI Q\n"),
    ]);
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(inlineBytes, { compress: false }))
    );

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.inline).toBe(true);
    expect(extracted[0]!.type).toBe("stencil");
    expect(extracted[0]!.colorSpace).toBe("gray");
    expect(extracted[0]!.bitsPerComponent).toBe(1);
    // Bit 0 is 1 -> inverted by /D [1 0] to 0; Bit 1 is 0 -> inverted to 255; Bit 2 is 1 -> 0
    expect(extracted[0]!.bitmap.data[0]).toBe(0);
    expect(extracted[0]!.bitmap.data[4]).toBe(255);
    expect(extracted[0]!.bitmap.data[8]).toBe(0);
  });

  it("applies /SMask alpha channels to /DCTDecode JPEG XObjects without double-extracting the /SMask stream", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    const smaskRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([10, 80, 160, 250]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(2),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(8),
        }),
        compress: false,
      })
    );
    const jpgStreamRef = doc.cos.allocateObject(
      cosStream(makeMinimalBaselineJpeg2x2(), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(2),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
          Filter: cosName("DCTDecode"),
          SMask: smaskRef,
        }),
        compress: false,
      })
    );
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({
          J1: jpgStreamRef,
          SM1: smaskRef,
        }),
      })
    );
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 20 0 0 20 10 10 cm /J1 Do Q\n"), { compress: false }))
    );

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.encoding).toBe("jpeg");
    expect([
      extracted[0]!.bitmap.data[3],
      extracted[0]!.bitmap.data[7],
      extracted[0]!.bitmap.data[11],
      extracted[0]!.bitmap.data[15],
    ]).toEqual([10, 80, 160, 250]);
  });

  it("unpacks sub-byte 4-bit (bpc=4) and 2-bit (bpc=2) Indexed palette images accurately", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);
    const paletteBytes = Uint8Array.from([
      255, 0, 0,    // index 0: Red
      0, 255, 0,    // index 1: Green
      0, 0, 255,    // index 2: Blue
      255, 255, 0,  // index 3: Yellow
    ]);
    const idx4StreamRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x21, 0x30]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(4),
          ColorSpace: cosArray([
            cosName("Indexed"),
            cosName("DeviceRGB"),
            cosNumber(3),
            cosStream(paletteBytes, { compress: false }),
          ]),
        }),
        compress: false,
      })
    );
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({ Pal4: idx4StreamRef }),
      })
    );

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.colorSpace).toBe("index");
    expect(extracted[0]!.bitsPerComponent).toBe(4);
    // Indices in 0x21, 0x30 are [2 (Blue), 1 (Green), 3 (Yellow), 0 (Red)]
    const rgba = extracted[0]!.bitmap.data;
    expect(Array.from(rgba.subarray(0, 4))).toEqual([0, 0, 255, 255]);
    expect(Array.from(rgba.subarray(4, 8))).toEqual([0, 255, 0, 255]);
    expect(Array.from(rgba.subarray(8, 12))).toEqual([255, 255, 0, 255]);
    expect(Array.from(rgba.subarray(12, 16))).toEqual([255, 0, 0, 255]);
  });

  it("decodes 16-bit per component (BPC=16) RGB/Gray images and 2-bit per component (BPC=2) Gray images", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);

    // 1. 2x1 16-bit RGB image: pixel 0 = (0x8000, 0x4000, 0xffff), pixel 1 = (0x1000, 0x2000, 0x3000)
    const rgb16Ref = doc.cos.allocateObject(
      cosStream(
        Uint8Array.from([
          0x80, 0x00, 0x40, 0x00, 0xff, 0xff,
          0x10, 0x00, 0x20, 0x00, 0x30, 0x00,
        ]),
        {
          dict: cosDict({
            Type: cosName("XObject"),
            Subtype: cosName("Image"),
            Width: cosNumber(2),
            Height: cosNumber(1),
            ColorSpace: cosName("DeviceRGB"),
            BitsPerComponent: cosNumber(16),
          }),
          compress: false,
        }
      )
    );

    // 2. 4x1 2-bit Gray image: 1 byte 0b00_01_10_11 -> [0, 85, 170, 255]
    const gray2Ref = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0b00011011]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(4),
          Height: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(2),
        }),
        compress: false,
      })
    );

    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(
        cosStream(
          new TextEncoder().encode("q 20 0 0 10 10 10 cm /ImRgb16 Do Q q 40 0 0 10 50 10 cm /ImGray2 Do Q"),
          { compress: false }
        )
      )
    );
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ ImRgb16: rgb16Ref, ImGray2: gray2Ref }) }));

    const images = extractDocumentImages(doc.cos);
    expect(images).toHaveLength(2);
    expect(images[0]!.bitsPerComponent).toBe(16);
    expect(Array.from(images[0]!.bitmap.data)).toEqual([
      0x80, 0x40, 0xff, 255,
      0x10, 0x20, 0x30, 255,
    ]);

    expect(images[1]!.bitsPerComponent).toBe(2);
    expect(Array.from(images[1]!.bitmap.data)).toEqual([
      0, 0, 0, 255,
      85, 85, 85, 255,
      170, 170, 170, 255,
      255, 255, 255, 255,
    ]);
  });

  it("resolves indirect /Filter and /DecodeParms (cosRef) with TIFF Predictor 2 on XObjects and /DP on inline images", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);

    // 2x1 RGB image encoded with TIFF Predictor 2 (horizontal differencing):
    // Pixel 0 = (100, 50, 20), Pixel 1 = (130, 70, 25) -> differenced bytes: [100, 50, 20, 30, 20, 5]
    const diffBytes = Uint8Array.from([100, 50, 20, 30, 20, 5]);
    const flateDiff = cosStream(diffBytes, { compress: true }).rawBytes;

    const filterRef = doc.cos.allocateObject(cosName("FlateDecode"));
    const parmsRef = doc.cos.allocateObject(
      cosDict({
        Predictor: cosNumber(2),
        Columns: cosNumber(2),
        Colors: cosNumber(3),
        BitsPerComponent: cosNumber(8),
      })
    );

    const xobjDict = cosDict({
      Type: cosName("XObject"),
      Subtype: cosName("Image"),
      Width: cosNumber(2),
      Height: cosNumber(1),
      ColorSpace: cosName("DeviceRGB"),
      BitsPerComponent: cosNumber(8),
      Filter: filterRef,
      DecodeParms: parmsRef,
    });
    const xobjRef = doc.cos.allocateObject(cosStream(flateDiff, { dict: xobjDict, compress: false }));
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ ImPred: xobjRef }) }));

    // Also place an inline image with /F /Fl and /DP << /Predictor 2 /Columns 2 /Colors 3 /BitsPerComponent 8 >>
    const prefix = new TextEncoder().encode(
      "q 20 0 0 10 10 10 cm /ImPred Do Q q 20 0 0 10 50 10 cm BI /W 2 /H 1 /BPC 8 /CS /RGB /F /Fl /DP << /Predictor 2 /Columns 2 /Colors 3 /BitsPerComponent 8 >> ID "
    );
    const suffix = new TextEncoder().encode(" EI Q");
    const contentBytes = new Uint8Array(prefix.length + flateDiff.length + suffix.length);
    contentBytes.set(prefix, 0);
    contentBytes.set(flateDiff, prefix.length);
    contentBytes.set(suffix, prefix.length + flateDiff.length);
    dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(contentBytes, { compress: false })));

    const images = extractDocumentImages(doc.cos);
    expect(images).toHaveLength(2);
    // Both XObject and inline image should reconstruct Pixel 0 = (100, 50, 20) and Pixel 1 = (130, 70, 25)
    expect(Array.from(images[0]!.bitmap.data)).toEqual([
      100, 50, 20, 255,
      130, 70, 25, 255,
    ]);
    expect(Array.from(images[1]!.bitmap.data)).toEqual([
      100, 50, 20, 255,
      130, 70, 25, 255,
    ]);
  });

  it("decodes /Separation spot-color images (FunctionType 2 tint transform) and CIE /Lab images accurately", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    // 1. 2x1 /Separation image: sample 0 = 0 (0% tint -> C0 white [1,1,1]), sample 1 = 255 (100% tint -> C1 blue [0, 0.2, 0.8])
    const sepCs = cosArray([
      cosName("Separation"),
      cosName("SpotBlue"),
      cosName("DeviceRGB"),
      cosDict({
        FunctionType: cosNumber(2),
        Domain: cosArray([cosNumber(0), cosNumber(1)]),
        C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
        C1: cosArray([cosNumber(0), cosNumber(0.2), cosNumber(0.8)]),
        N: cosNumber(1),
      }),
    ]);
    const sepStream = cosStream(Uint8Array.from([0, 255]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        ColorSpace: sepCs,
        BitsPerComponent: cosNumber(8),
      }),
      compress: false,
    });
    const sepRef = doc.cos.allocateObject(sepStream);

    // 2. 2x1 /Lab image: pixel 0 = [255, 128, 128] (L*=100, a*=0, b*=0 -> white), pixel 1 = [0, 128, 128] (L*=0, a*=0, b*=0 -> black)
    const labCs = cosArray([
      cosName("Lab"),
      cosDict({
        WhitePoint: cosArray([cosNumber(0.9505), cosNumber(1), cosNumber(1.089)]),
        Range: cosArray([cosNumber(-100), cosNumber(100), cosNumber(-100), cosNumber(100)]),
      }),
    ]);
    const labStream = cosStream(Uint8Array.from([255, 128, 128, 0, 128, 128]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        ColorSpace: labCs,
        BitsPerComponent: cosNumber(8),
      }),
      compress: false,
    });
    const labRef = doc.cos.allocateObject(labStream);

    dictSet(page.getResourcesDict(), "XObject", cosDict({ ImSep: sepRef, ImLab: labRef }));
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(
        cosStream(new TextEncoder().encode("q 20 0 0 10 10 10 cm /ImSep Do Q q 20 0 0 10 40 10 cm /ImLab Do Q"), {
          compress: false,
        })
      )
    );

    const images = extractDocumentImages(doc.cos);
    expect(images).toHaveLength(2);

    // Separation image: pixel 0 = white (255, 255, 255), pixel 1 = blue (0, 51, 204)
    const sepBmp = images[0]!.bitmap;
    expect(Array.from(sepBmp.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(sepBmp.data.subarray(4, 8))).toEqual([0, 51, 204, 255]);

    // Lab image: pixel 0 = white (~255, 255, 255), pixel 1 = black (0, 0, 0)
    const labBmp = images[1]!.bitmap;
    expect(labBmp.data[0]).toBeGreaterThanOrEqual(250);
    expect(labBmp.data[1]).toBeGreaterThanOrEqual(250);
    expect(labBmp.data[2]).toBeGreaterThanOrEqual(250);
    expect(Array.from(labBmp.data.subarray(4, 8))).toEqual([0, 0, 0, 255]);
  });

  it("un-mattes pre-blended RGB pixels when /SMask specifies a /Matte color array (ISO 32000-1 §11.6.5.3) and resamples mismatched mask dimensions", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);

    // Soft mask: 1x1 pixel with alpha = 128 (~0.502), Matte = [1, 1, 1] (white)
    const smaskRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([128]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(8),
          Matte: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
        }),
      })
    );

    // Base image: 2x1 RGB pixels pre-matted with white [255, 255, 255] at alpha ~0.5:
    // Pixel 0: pure red [255, 0, 0] matted with white -> [255, 127, 127]
    // Pixel 1: pure blue [0, 0, 255] matted with white -> [127, 127, 255]
    const imgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([255, 127, 127, 127, 127, 255]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(1),
          ColorSpace: cosName("DeviceRGB"),
          BitsPerComponent: cosNumber(8),
          SMask: smaskRef,
        }),
      })
    );

    const key = page.ensureXObjectResource(imgRef);
    page.setRawContentStream(`q 100 0 0 50 10 10 cm /${key} Do Q`);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    const rgba = extracted[0]!.bitmap.data;
    // Pixel 0 un-matted should recover red: R ~ 255, G <= 2, B <= 2, A = 128
    expect(rgba[0]).toBe(255);
    expect(rgba[1]).toBeLessThanOrEqual(2);
    expect(rgba[2]).toBeLessThanOrEqual(2);
    expect(rgba[3]).toBe(128);
    // Pixel 1 un-matted should recover blue: R <= 2, G <= 2, B = 255, A = 128
    expect(rgba[4]).toBeLessThanOrEqual(2);
    expect(rgba[5]).toBeLessThanOrEqual(2);
    expect(rgba[6]).toBe(255);
    expect(rgba[7]).toBe(128);
  });

  it("decodes /DeviceN multi-channel images, /CalRGB and /CalGray calibrated images, and per-channel /Decode arrays", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });

    const devNStream = cosStream(Uint8Array.from([0, 0, 128, 127]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(2),
        Height: cosNumber(1),
        BitsPerComponent: cosNumber(8),
        ColorSpace: cosArray([
          cosName("DeviceN"),
          cosArray([cosName("SpotCyan"), cosName("SpotBlue")]),
          cosName("DeviceRGB"),
          cosDict({
            FunctionType: cosNumber(2),
            Domain: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
            C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
            C1: cosArray([cosNumber(0.2), cosNumber(0.4), cosNumber(0.8)]),
            N: cosNumber(1),
          }),
        ]),
      }),
    });
    const devNRef = doc.cos.allocateObject(devNStream);

    const rgbDecStream = cosStream(Uint8Array.from([255, 255, 200]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(1),
        Height: cosNumber(1),
        BitsPerComponent: cosNumber(8),
        ColorSpace: cosName("DeviceRGB"),
        Decode: cosArray([
          cosNumber(1),
          cosNumber(0),
          cosNumber(0),
          cosNumber(1),
          cosNumber(0.5),
          cosNumber(0.5),
        ]),
      }),
    });
    const rgbDecRef = doc.cos.allocateObject(rgbDecStream);

    const calGrayStream = cosStream(Uint8Array.from([128]), {
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Image"),
        Width: cosNumber(1),
        Height: cosNumber(1),
        BitsPerComponent: cosNumber(8),
        ColorSpace: cosArray([
          cosName("CalGray"),
          cosDict({
            WhitePoint: cosArray([cosNumber(0.9505), cosNumber(1), cosNumber(1.089)]),
            Gamma: cosNumber(2.2),
          }),
        ]),
      }),
    });
    const calGrayRef = doc.cos.allocateObject(calGrayStream);

    const k1 = page.ensureXObjectResource(devNRef);
    const k2 = page.ensureXObjectResource(rgbDecRef);
    const k3 = page.ensureXObjectResource(calGrayRef);
    page.setRawContentStream(`q 20 0 0 10 10 10 cm /${k1} Do Q q 10 0 0 10 40 10 cm /${k2} Do Q q 10 0 0 10 70 10 cm /${k3} Do Q`);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(3);
    expect(extracted[0]!.colorSpaceLabel).toBe("devn");
    expect(extracted[0]!.components).toBe(2);
    expect(extracted[0]!.bitmap.data[0]).toBe(255);
    expect(extracted[0]!.bitmap.data[1]).toBe(255);
    expect(extracted[0]!.bitmap.data[2]).toBe(255);
    expect(extracted[0]!.bitmap.data[4]).toBe(51);
    expect(extracted[0]!.bitmap.data[5]).toBe(102);
    expect(extracted[0]!.bitmap.data[6]).toBe(204);

    expect(extracted[1]!.bitmap.data[0]).toBe(0);
    expect(extracted[1]!.bitmap.data[1]).toBe(255);
    expect(extracted[1]!.bitmap.data[2]).toBe(128);

    expect(extracted[2]!.colorSpaceLabel).toBe("cal-gray");
    expect(extracted[2]!.bitmap.data[0]).toBeGreaterThan(100);
  });

  it("evaluates FunctionType 4 PostScript and FunctionType 0 Sampled tint transforms on /DeviceN and /Separation images", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    // 1. /DeviceN [/ChA /ChB] with FunctionType 4 PostScript stream:
    // Input stack: [s0, s1]; `{ exch 0.5 }` leaves [s1, s0, 0.5] -> R=s1, G=s0, B=0.5
    const fn4Ref = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("{ exch 0.5 }"), {
        dict: cosDict({
          FunctionType: cosNumber(4),
          Domain: cosArray([cosNumber(0), cosNumber(1), cosNumber(0), cosNumber(1)]),
          Range: cosArray([
            cosNumber(0), cosNumber(1),
            cosNumber(0), cosNumber(1),
            cosNumber(0), cosNumber(1),
          ]),
        }),
        compress: false,
      })
    );
    const devNImgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([50, 200]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosArray([
            cosName("DeviceN"),
            cosArray([cosName("ChA"), cosName("ChB")]),
            cosName("DeviceRGB"),
            fn4Ref,
          ]),
        }),
      })
    );

    // 2. /Separation /SpotPurple with FunctionType 0 Sampled table (2 entries: [255,255,255] at t=0, [120,20,180] at t=1)
    const fn0Ref = doc.cos.allocateObject(
      cosStream(Uint8Array.from([255, 255, 255, 120, 20, 180]), {
        dict: cosDict({
          FunctionType: cosNumber(0),
          Domain: cosArray([cosNumber(0), cosNumber(1)]),
          Range: cosArray([
            cosNumber(0), cosNumber(1),
            cosNumber(0), cosNumber(1),
            cosNumber(0), cosNumber(1),
          ]),
          Size: cosArray([cosNumber(2)]),
          BitsPerSample: cosNumber(8),
        }),
        compress: false,
      })
    );
    const sepImgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([255]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosArray([
            cosName("Separation"),
            cosName("SpotPurple"),
            cosName("DeviceRGB"),
            fn0Ref,
          ]),
        }),
      })
    );

    const k1 = page.ensureXObjectResource(devNImgRef);
    const k2 = page.ensureXObjectResource(sepImgRef);
    page.setRawContentStream(`q 10 0 0 10 10 10 cm /${k1} Do Q q 10 0 0 10 30 10 cm /${k2} Do Q`);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(2);
    // R=200, G=50, B=128 (0.5 * 255)
    expect(extracted[0]!.bitmap.data[0]).toBe(200);
    expect(extracted[0]!.bitmap.data[1]).toBe(50);
    expect(extracted[0]!.bitmap.data[2]).toBe(128);

    // Sampled FunctionType 0 at t=1 -> R=120, G=20, B=180
    expect(extracted[1]!.bitmap.data[0]).toBe(120);
    expect(extracted[1]!.bitmap.data[1]).toBe(20);
    expect(extracted[1]!.bitmap.data[2]).toBe(180);
  });

  it("decodes /Indexed image XObjects whose base color space is /Separation", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const idxSepImgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0, 1]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosArray([
            cosName("Indexed"),
            cosArray([
              cosName("Separation"),
              cosName("SpotGreen"),
              cosName("DeviceRGB"),
              cosDict({
                FunctionType: cosNumber(2),
                C0: cosArray([cosNumber(1), cosNumber(1), cosNumber(1)]),
                C1: cosArray([cosNumber(0), cosNumber(0.8), cosNumber(0.2)]),
                N: cosNumber(1),
              }),
            ]),
            cosNumber(1),
            cosStream(Uint8Array.from([0, 255])),
          ]),
        }),
      })
    );
    const kImg = page.ensureXObjectResource(idxSepImgRef);
    page.setRawContentStream(`q 20 0 0 10 10 10 cm /${kImg} Do Q`);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.colorSpaceLabel).toBe("index");
    // Index 0 -> tint 0 -> C0 = [255, 255, 255]
    expect(extracted[0]!.bitmap.data[0]).toBe(255);
    expect(extracted[0]!.bitmap.data[1]).toBe(255);
    expect(extracted[0]!.bitmap.data[2]).toBe(255);
    // Index 1 -> tint 1.0 -> C1 = [0, 204, 51]
    expect(extracted[0]!.bitmap.data[4]).toBe(0);
    expect(extracted[0]!.bitmap.data[5]).toBe(204);
    expect(extracted[0]!.bitmap.data[6]).toBe(51);
  });

  it("resolves /DecodeParms [null << ... >>] array on multi-filter JBIG2/CCITT streams and single /DecodeParms dict on multi-stage Flate streams", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 100, height: 100 });

    const jb2GlobalsRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]), {
        dict: cosDict({}),
      })
    );
    const hexJb2Payload = new TextEncoder().encode("0000000230>");
    const jb2ImgRef = doc.cos.allocateObject(
      cosStream(hexJb2Payload, {
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

    // Multi-filter [/ASCIIHexDecode /FlateDecode] with a single /DecodeParms << /Predictor 2 ... >> dict
    const rawTiffRow = Uint8Array.from([10, 20, 30, 5, 5, 5]); // With TIFF Predictor 2: pixel0=[10,20,30], pixel1=[15,25,35]
    const zlib = require("zlib");
    const flateBytes = new Uint8Array(zlib.deflateSync(rawTiffRow));
    const hexStr = Array.from(flateBytes).map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
    const predImgRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode(hexStr), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(2),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosName("DeviceRGB"),
          Filter: cosArray([cosName("ASCIIHexDecode"), cosName("FlateDecode")]),
          DecodeParms: cosDict({
            Predictor: cosNumber(2),
            Columns: cosNumber(2),
            Colors: cosNumber(3),
            BitsPerComponent: cosNumber(8),
          }),
        }),
      })
    );

    const k1 = page.ensureXObjectResource(jb2ImgRef);
    const k2 = page.ensureXObjectResource(predImgRef);
    page.setRawContentStream(`q 20 0 0 20 10 10 cm /${k1} Do Q q 20 0 0 10 50 10 cm /${k2} Do Q`);

    const extracted = extractDocumentImages(doc.cos);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]!.encoding).toBe("jbig2");
    expect(extracted[0]!.rawEncodedBytes).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x02, 0x30]));
    expect(extracted[0]!.jbig2GlobalsBytes).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00]));
    expect(Array.from(extracted[1]!.bitmap.data.slice(0, 8))).toEqual([10, 20, 30, 255, 15, 25, 35, 255]);
  });
});
