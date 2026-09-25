import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  decodePng,
  dictGet,
  dictSet,
} from "@poe-code/pdf-ast";
import {
  createPdftoppmCommand,
  pdftoppmPlugin,
  runPdftocairoCli,
  runPdftoppmCli,
} from "./index.js";

function createSamplePdf(pageCount: number, size: [number, number] = [144, 72]): Uint8Array {
  const doc = PdfDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage(size);
    page.drawRect({ x: 10, y: 10, width: 50, height: 30, fill: { r: 0.9, g: 0.1, b: 0.1 } });
    page.drawText(`Page ${i}`, { x: 20, y: 40, size: 12 });
  }
  return doc.save();
}

describe("safe-bash-command-pdftoppm", () => {
  it("renders pages to PNG at 150 DPI with Poppler zero-padded page suffixes", async () => {
    const pdfBytes = createSamplePdf(10, [72, 72]); // 1x1 inch -> 150x150 px at 150 DPI
    const files = new Map<string, Uint8Array>([["deck.pdf", pdfBytes]]);

    const res = await runPdftoppmCli(["-png", "-r", "150", "deck.pdf", "slide"], files);
    expect(res.exitCode).toBe(0);

    // 10 pages -> padded to 2 digits: slide-01.png .. slide-10.png
    expect(files.has("slide-01.png")).toBe(true);
    expect(files.has("slide-10.png")).toBe(true);

    const png1 = files.get("slide-01.png")!;
    expect(Array.from(png1.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = decodePng(png1);
    expect(decoded.width).toBe(150);
    expect(decoded.height).toBe(150);
  });

  it("supports -singlefile, -f/-l page ranges, -sep, and -rx/-ry asymmetric DPI", async () => {
    const pdfBytes = createSamplePdf(3, [72, 72]);
    const files = new Map<string, Uint8Array>([["report.pdf", pdfBytes]]);

    const res = await runPdftoppmCli(
      ["-png", "-singlefile", "-f", "2", "-l", "2", "-rx", "144", "-ry", "72", "report.pdf", "thumb"],
      files
    );
    expect(res.exitCode).toBe(0);
    expect(files.has("thumb.png")).toBe(true);
    expect(files.has("thumb-2.png")).toBe(false);

    const decoded = decodePng(files.get("thumb.png")!);
    expect(decoded.width).toBe(144);
    expect(decoded.height).toBe(72);

    const sepFiles = new Map<string, Uint8Array>([["report.pdf", pdfBytes]]);
    await runPdftoppmCli(["-png", "-f", "1", "-l", "2", "-sep", "_", "report.pdf", "pg"], sepFiles);
    expect(sepFiles.has("pg_1.png")).toBe(true);
    expect(sepFiles.has("pg_2.png")).toBe(true);
  });

  it("renders grayscale PGM (-gray), monochrome PBM (-mono), PPM default, and vector SVG (-svg)", async () => {
    const pdfBytes = createSamplePdf(1, [72, 72]);
    const files = new Map<string, Uint8Array>([["invoice.pdf", pdfBytes]]);

    await runPdftoppmCli(["-gray", "-r", "72", "-singlefile", "invoice.pdf", "gray1"], files);
    const pgm = files.get("gray1.pgm")!;
    expect(new TextDecoder().decode(pgm.subarray(0, 3))).toBe("P5\n");

    await runPdftoppmCli(["-mono", "-r", "72", "-singlefile", "invoice.pdf", "mono1"], files);
    const pbm = files.get("mono1.pbm")!;
    expect(new TextDecoder().decode(pbm.subarray(0, 3))).toBe("P4\n");

    await runPdftoppmCli(["-r", "72", "-singlefile", "invoice.pdf", "color1"], files);
    const ppm = files.get("color1.ppm")!;
    expect(new TextDecoder().decode(ppm.subarray(0, 3))).toBe("P6\n");

    await runPdftoppmCli(["-svg", "-singlefile", "invoice.pdf", "vec1"], files);
    const svg = new TextDecoder().decode(files.get("vec1.svg")!);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("supports sub-rectangle cropping (-x, -y, -W, -H), -cropbox, and stdout piping", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(72), cosNumber(72), cosNumber(216), cosNumber(288)])
    );
    const pdfBytes = doc.save();
    const files = new Map<string, Uint8Array>([["doc.pdf", pdfBytes]]);

    // Crop region to stdout
    const cropStdout = await runPdftoppmCli(
      ["-png", "-r", "72", "-f", "1", "-l", "1", "-x", "10", "-y", "10", "-W", "80", "-H", "60", "doc.pdf"],
      files
    );
    expect(cropStdout.exitCode).toBe(0);
    expect(cropStdout.stdoutBytes).toBeDefined();
    const cropPng = decodePng(cropStdout.stdoutBytes!);
    expect(cropPng.width).toBe(80);
    expect(cropPng.height).toBe(60);

    // -cropbox
    const cropBoxRes = await runPdftoppmCli(
      ["-png", "-r", "72", "-cropbox", "-singlefile", "doc.pdf", "cbox"],
      files
    );
    expect(cropBoxRes.exitCode).toBe(0);
    const cboxPng = decodePng(files.get("cbox.png")!);
    expect(cboxPng.width).toBe(144);
    expect(cboxPng.height).toBe(216);
  });

  it("exposes createPdftoppmCommand and pdftoppmPlugin for safe-bash registration", () => {
    const cmd = createPdftoppmCommand();
    expect(cmd.name).toBe("pdftoppm");
    const plugin = pdftoppmPlugin();
    expect(plugin.name).toBe("pdftoppm");
  });

  it("supports -jpeg, -scale-to, -scale-to-x/-scale-to-y, -o/-e odd/even filtering, -forcenum, and -sz", async () => {
    const pdfBytes = createSamplePdf(4, [72, 144]);
    const files = new Map<string, Uint8Array>([["book.pdf", pdfBytes]]);

    // -jpeg with -singlefile and -forcenum
    const jpgRes = await runPdftoppmCli(["-jpeg", "-singlefile", "-forcenum", "book.pdf", "cover"], files);
    expect(jpgRes.exitCode).toBe(0);
    expect(files.has("cover-1.jpg")).toBe(true);
    const jpg = files.get("cover-1.jpg")!;
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);

    // -o odd pages only (pages 1 and 3)
    const oddFiles = new Map<string, Uint8Array>([["book.pdf", pdfBytes]]);
    await runPdftoppmCli(["-png", "-o", "book.pdf", "odd"], oddFiles);
    expect(oddFiles.has("odd-1.png")).toBe(true);
    expect(oddFiles.has("odd-2.png")).toBe(false);
    expect(oddFiles.has("odd-3.png")).toBe(true);
    expect(oddFiles.has("odd-4.png")).toBe(false);

    // -e even pages only (pages 2 and 4) with -scale-to 200 and -sz 50
    const evenFiles = new Map<string, Uint8Array>([["book.pdf", pdfBytes]]);
    await runPdftoppmCli(["-png", "-e", "-scale-to", "200", "-sz", "50", "book.pdf", "even"], evenFiles);
    expect(evenFiles.has("even-1.png")).toBe(false);
    expect(evenFiles.has("even-2.png")).toBe(true);
    expect(evenFiles.has("even-4.png")).toBe(true);
    const sqPng = decodePng(evenFiles.get("even-2.png")!);
    expect(sqPng.width).toBe(50);
    expect(sqPng.height).toBe(50);
  });

  it("supports Poppler -scale-to-x / -scale-to-y with -1 proportional aspect-ratio scaling and -upw decryption", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]); // 2:1 aspect ratio
    page.drawRect({ x: 10, y: 10, width: 180, height: 80, fill: { r: 0.2, g: 0.5, b: 0.8 } });
    const encryptedBytes = doc.save({
      encrypt: { userPassword: "pw1", ownerPassword: "pw2", revision: 6 },
    });
    const files = new Map<string, Uint8Array>([["enc.pdf", encryptedBytes]]);

    // -scale-to-x 300 -scale-to-y -1 on 200x100pt page -> 300x150 px
    const res1 = await runPdftoppmCli(
      ["-png", "-singlefile", "-scale-to-x", "300", "-scale-to-y", "-1", "-upw", "pw1", "enc.pdf", "prop-w"],
      files
    );
    expect(res1.exitCode).toBe(0);
    const png1 = decodePng(files.get("prop-w.png")!);
    expect(png1.width).toBe(300);
    expect(png1.height).toBe(150);

    // -scale-to-x -1 -scale-to-y 80 on 200x100pt page -> 160x80 px
    const res2 = await runPdftoppmCli(
      ["-png", "-singlefile", "-scale-to-x", "-1", "-scale-to-y", "80", "-upw", "pw1", "enc.pdf", "prop-h"],
      files
    );
    expect(res2.exitCode).toBe(0);
    const png2 = decodePng(files.get("prop-h.png")!);
    expect(png2.width).toBe(160);
    expect(png2.height).toBe(80);
  });

  it("applies -scale-to against inherited /CropBox when -cropbox is set and returns exit codes 1 and 99 on errors", async () => {
    const doc = PdfDocument.create();
    doc.addPage([612, 792]);
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    const pagesDict = doc.cos.resolveDict(dictGet(catalog, "Pages"))!;
    dictSet(
      pagesDict,
      "CropBox",
      cosArray([cosNumber(0), cosNumber(0), cosNumber(200), cosNumber(100)])
    );
    const pdfBytes = doc.save();
    const files = new Map<string, Uint8Array>([["inherited-crop.pdf", pdfBytes]]);

    const scaledCrop = await runPdftoppmCli(
      ["-png", "-cropbox", "-scale-to", "300", "-singlefile", "inherited-crop.pdf", "crop-scaled"],
      files
    );
    expect(scaledCrop.exitCode).toBe(0);
    const png = decodePng(files.get("crop-scaled.png")!);
    expect(png.width).toBe(300);
    expect(png.height).toBe(150);

    const noArgs = await runPdftoppmCli([], new Map());
    expect(noArgs.exitCode).toBe(99);

    const missingFile = await runPdftoppmCli(["missing.pdf", "out"], new Map());
    expect(missingFile.exitCode).toBe(1);
  });

  it("supports -tiff output, -hide-annotations, and Poppler rendering flags (-tiffcompression, -aa, -jpegopt)", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([144, 72]);
    const widgetDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosName("field1"),
      V: cosName("ANNOT_TEXT"),
      Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(120), cosNumber(50)]),
    });
    const widgetRef = doc.cos.allocateObject(widgetDict);
    dictSet(page.pageDict, "Annots", cosArray([widgetRef]));
    const pdfBytes = doc.save();

    const files = new Map<string, Uint8Array>([["annot.pdf", pdfBytes]]);
    const tiffRes = await runPdftoppmCli(
      ["-tiff", "-tiffcompression", "none", "-aa", "yes", "-singlefile", "annot.pdf", "page-tif"],
      files
    );
    expect(tiffRes.exitCode).toBe(0);
    const tifBytes = files.get("page-tif.tif");
    expect(tifBytes).toBeDefined();
    expect(Array.from(tifBytes!.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);

    const withAnnotRes = await runPdftoppmCli(
      ["-png", "-r", "72", "-singlefile", "annot.pdf", "with-annot"],
      files
    );
    const hideAnnotRes = await runPdftoppmCli(
      ["-png", "-r", "72", "-hide-annotations", "-singlefile", "annot.pdf", "no-annot"],
      files
    );
    expect(withAnnotRes.exitCode).toBe(0);
    expect(hideAnnotRes.exitCode).toBe(0);
    const bmpWith = decodePng(files.get("with-annot.png")!);
    const bmpWithout = decodePng(files.get("no-annot.png")!);
    const countDark = (data: Uint8Array) => {
      let c = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 250) c++;
      }
      return c;
    };
    expect(countDark(bmpWith.data)).toBeGreaterThan(0);
    expect(countDark(bmpWithout.data)).toBe(0);
  });

  it("applies -cropbox to -svg viewBox/dimensions and honors -jpegopt quality=<N> quantization", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(20), cosNumber(10), cosNumber(120), cosNumber(60)])
    );
    page.drawRect({ x: 25, y: 15, width: 50, height: 30, fillColor: { r: 0.8, g: 0.2, b: 0.4 } });

    const files = new Map<string, Uint8Array>([["crop-svg.pdf", doc.save()]]);

    const svgRes = await runPdftoppmCli(
      ["-svg", "-r", "72", "-cropbox", "-singlefile", "crop-svg.pdf", "cropped"],
      files
    );
    expect(svgRes.exitCode).toBe(0);
    const svgStr = new TextDecoder().decode(files.get("cropped.svg")!);
    expect(svgStr).toContain(`width="100" height="50" viewBox="20 40 100 50"`);

    const qLowRes = await runPdftoppmCli(
      ["-jpeg", "-jpegopt", "quality=20", "-singlefile", "crop-svg.pdf", "lowq"],
      files
    );
    const qHighRes = await runPdftoppmCli(
      ["-jpeg", "-jpegopt", "quality=95", "-singlefile", "crop-svg.pdf", "highq"],
      files
    );
    expect(qLowRes.exitCode).toBe(0);
    expect(qHighRes.exitCode).toBe(0);
    const lowJpg = files.get("lowq.jpg")!;
    const highJpg = files.get("highq.jpg")!;
    // DQT marker is at offset 20 (0xff 0xdb 0x00 0x43 0x00 <64 quant bytes>)
    expect(lowJpg[25]).toBeGreaterThan(highJpg[25]!);
  });

  it("supports -transp transparent PNG/SVG backgrounds, -progress stderr reporting, and -q quiet mode", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 80, height: 80 });
    page.drawRect({ x: 20, y: 20, width: 40, height: 40, fill: { r: 1, g: 0, b: 0 } });
    const files = new Map<string, Uint8Array>([["doc.pdf", doc.save()]]);

    const pngRes = await runPdftoppmCli(["-png", "-transp", "-progress", "-r", "72", "doc.pdf", "tr"], files);
    expect(pngRes.exitCode).toBe(0);
    expect(pngRes.stderr).toBe("1 1 tr-1.png\n");

    const decoded = decodePng(files.get("tr-1.png")!);
    // Background pixel at (5, 5) has alpha = 0
    const bgIdx = (5 * decoded.width + 5) * 4;
    expect(decoded.data[bgIdx + 3]).toBe(0);
    // Drawn rectangle pixel at (40, 40) has alpha = 255 and red = 255
    const fgIdx = (40 * decoded.width + 40) * 4;
    expect(decoded.data[fgIdx]).toBe(255);
    expect(decoded.data[fgIdx + 3]).toBe(255);

    // SVG with -transp omits background <rect fill="#ffffff"/>, and -q suppresses -progress stderr
    const svgRes = await runPdftoppmCli(["-svg", "-transp", "-progress", "-q", "doc.pdf", "trsvg"], files);
    expect(svgRes.exitCode).toBe(0);
    expect(svgRes.stderr).toBe("");
    const svgText = new TextDecoder().decode(files.get("trsvg-1.svg")!);
    expect(svgText).not.toContain('fill="#ffffff"');
  });

  it("supports -setpageno to override starting page numbering and -sz square crop", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 100, height: 100 }).drawText("P1", { x: 10, y: 50, size: 12 });
    doc.addPage({ width: 100, height: 100 }).drawText("P2", { x: 10, y: 50, size: 12 });
    doc.addPage({ width: 100, height: 100 }).drawText("P3", { x: 10, y: 50, size: 12 });
    const files = new Map<string, Uint8Array>([["deck.pdf", doc.save()]]);

    const res = await runPdftoppmCli(
      ["-png", "-r", "72", "-f", "2", "-l", "3", "-setpageno", "10", "-sz", "40", "-overprint", "deck.pdf", "slide"],
      files
    );
    expect(res.exitCode).toBe(0);
    expect(files.has("slide-10.png")).toBe(true);
    expect(files.has("slide-11.png")).toBe(true);
    const png10 = decodePng(files.get("slide-10.png")!);
    expect(png10.width).toBe(40);
    expect(png10.height).toBe(40);
  });

  it("supports -svg and -png cropping with -x / -y when -W / -H are omitted and supports -jpegcmyk", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawText("Offset Crop", { x: 60, y: 40, size: 12 });
    const files = new Map<string, Uint8Array>([["in.pdf", doc.save()]]);

    const svgRes = await runPdftoppmCli(["-svg", "-r", "72", "-x", "50", "-y", "20", "-singlefile", "in.pdf", "cropped"], files);
    expect(svgRes.exitCode).toBe(0);
    const svgStr = new TextDecoder().decode(files.get("cropped.svg")!);
    expect(svgStr).toContain("width=\"150\" height=\"80\"");
    expect(svgStr).toContain("viewBox=\"50 20 150 80\"");

    const jpgRes = await runPdftoppmCli(["-jpegcmyk", "-r", "72", "-singlefile", "in.pdf", "cmyk_out"], files);
    expect(jpgRes.exitCode).toBe(0);
    const jpgBytes = files.get("cmyk_out.jpg")!;
    expect(jpgBytes[0]).toBe(0xff);
    expect(jpgBytes[1]).toBe(0xd8);
  });

  it("renders /Filter /CCITTFaxDecode Group 4 2D monochrome XObject images via pdftoppm", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([80, 40]);
    // 8x1 Group 4 CCITT stream: 4 white pixels followed by 4 black pixels
    const g4Bits = Uint8Array.from([0b00110110, 0b11000000, 0b00000100, 0b00000001]);
    const faxRef = doc.cos.allocateObject(
      cosStream(g4Bits, {
        compress: false,
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(8),
          Height: cosNumber(1),
          ColorSpace: cosName("DeviceGray"),
          BitsPerComponent: cosNumber(1),
          Filter: cosName("CCITTFaxDecode"),
          DecodeParms: cosDict({
            K: cosNumber(-1),
            Columns: cosNumber(8),
            Rows: cosNumber(1),
          }),
        }),
      })
    );
    dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ ImFax: faxRef }) }));
    page.setRawContentStream("q 80 0 0 40 0 0 cm /ImFax Do Q");

    const files = new Map<string, Uint8Array>([["fax.pdf", doc.save()]]);
    const res = await runPdftoppmCli(["-png", "-r", "72", "-singlefile", "fax.pdf", "fax_out"], files);
    expect(res.exitCode).toBe(0);
    const png = decodePng(files.get("fax_out.png")!);
    // Left half (x=10, y=20) is white (255); right half (x=60, y=20) is black (0)
    const leftIdx = (20 * png.width + 10) * 4;
    const rightIdx = (20 * png.width + 60) * 4;
    expect(png.data[leftIdx]).toBe(255);
    expect(png.data[rightIdx]).toBe(0);
  });

  it("rejects invalid page ranges with exitCode 99 and suppresses stderr with -q", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 100, height: 100 });
    const files = new Map<string, Uint8Array>([["one.pdf", doc.save()]]);
    const badRange = await runPdftoppmCli(["-png", "-f", "3", "-l", "1", "one.pdf", "out"], files);
    expect(badRange.exitCode).toBe(99);
    expect(badRange.stderr).toContain("Wrong page range given");

    const quietBadRange = await runPdftoppmCli(["-png", "-q", "-f", "3", "-l", "1", "one.pdf", "out"], files);
    expect(quietBadRange.exitCode).toBe(99);
    expect(quietBadRange.stderr).toBe("");
  });

  it("supports -singlefile -forcenum -sep _ and emits SVG stroke-linecap/linejoin/non-scaling-stroke for 0 w hairlines", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 100, height: 80 });
    p1.setRawContentStream("q 0 w 2 J 1 j 5 M 1 0 0 RG 10 10 m 90 10 l S Q");
    doc.addPage({ width: 100, height: 80 });

    const files = new Map<string, Uint8Array>([["two.pdf", doc.save()]]);
    const res = await runPdftoppmCli(
      ["-svg", "-singlefile", "-forcenum", "-sep", "_", "-setpageno", "7", "two.pdf", "render"],
      files
    );
    expect(res.exitCode).toBe(0);
    // -singlefile with -forcenum and -sep _ and -setpageno 7 produces render_7.svg
    expect(files.has("render_7.svg")).toBe(true);
    const svgText = new TextDecoder().decode(files.get("render_7.svg")!);
    expect(svgText).toContain('vector-effect="non-scaling-stroke"');
    expect(svgText).toContain('stroke-linecap="square"');
    expect(svgText).toContain('stroke-linejoin="round"');
    expect(svgText).toContain('stroke-miterlimit="5"');
  });

  it("charges rendered RGBA bitmap and encoded output bytes via onAllocateBytes", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 100, height: 100 });
    const files = new Map<string, Uint8Array>([["mem.pdf", doc.save()]]);
    const charges: number[] = [];
    const res = await runPdftoppmCli(["-png", "-r", "72", "-singlefile", "mem.pdf", "mem"], files, {
      onAllocateBytes: (bytes) => charges.push(bytes),
    });
    expect(res.exitCode).toBe(0);
    expect(charges[0]).toBe(100 * 100 * 4);
    expect(charges[1]).toBe(files.get("mem.png")!.byteLength);
  });

  it("supports -tiff -tiffcompression packbits/deflate and rejects unknown -tiffcompression with exitCode 99", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 32, height: 32 });
    const files = new Map<string, Uint8Array>([["t.pdf", doc.save()]]);

    const pbRes = await runPdftoppmCli(
      ["-tiff", "-tiffcompression", "packbits", "-singlefile", "-r", "72", "t.pdf", "pb"],
      files
    );
    expect(pbRes.exitCode).toBe(0);
    const pbBytes = files.get("pb.tif")!;
    const pbView = new DataView(pbBytes.buffer, pbBytes.byteOffset, pbBytes.byteLength);
    // Entry 3 (tag 259 = Compression) is at IFD offset 8 + 2 + 3*12 = 46; value is at 46 + 8 = 54
    expect(pbView.getUint16(46, true)).toBe(259);
    expect(pbView.getUint16(54, true)).toBe(32773);

    const defRes = await runPdftoppmCli(
      ["-tiff", "-tiffcompression", "deflate", "-singlefile", "-r", "72", "t.pdf", "def"],
      files
    );
    expect(defRes.exitCode).toBe(0);
    const defBytes = files.get("def.tif")!;
    const defView = new DataView(defBytes.buffer, defBytes.byteOffset, defBytes.byteLength);
    expect(defView.getUint16(54, true)).toBe(8);
    expect(defBytes.byteLength).toBeLessThan(180 + 32 * 32 * 3);

    const badRes = await runPdftoppmCli(
      ["-tiff", "-tiffcompression", "invalid-codec", "t.pdf", "bad"],
      files
    );
    expect(badRes.exitCode).toBe(99);
    expect(badRes.stderr).toContain("Bad '-tiffcompression' value");
  });

  it("supports -aa yes|no, -aaVector yes|no, and -thinlinemode none|solid|shape and rejects bad values with exitCode 99", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 60, height: 60 });
    page.setRawContentStream("0 0 0 RG 0.4 w 5 5 m 55 55 l S BT /F1 16 Tf 10 20 Td (X) Tj ET");
    const files = new Map<string, Uint8Array>([["aa.pdf", doc.save()]]);

    const noAaRes = await runPdftoppmCli(
      ["-png", "-r", "72", "-aa", "no", "-aaVector", "no", "-thinlinemode", "solid", "-singlefile", "aa.pdf", "noaa"],
      files
    );
    expect(noAaRes.exitCode).toBe(0);
    const noAaPng = decodePng(files.get("noaa.png")!);
    // With -aa no and -aaVector no on a white background with black ink (alpha=1),
    // every pixel should be pure black (0,0,0) or pure white (255,255,255) without intermediate gray values
    let grayPixels = 0;
    for (let i = 0; i < noAaPng.width * noAaPng.height; i++) {
      const r = noAaPng.data[i * 4]!;
      if (r > 0 && r < 255) grayPixels++;
    }
    expect(grayPixels).toBe(0);

    const badAa = await runPdftoppmCli(["-aa", "maybe", "aa.pdf", "out"], files);
    expect(badAa.exitCode).toBe(99);
    const badAaVec = await runPdftoppmCli(["-aaVector", "bogus", "aa.pdf", "out"], files);
    expect(badAaVec.exitCode).toBe(99);
    const badThin = await runPdftoppmCli(["-thinlinemode", "invalid", "aa.pdf", "out"], files);
    expect(badThin.exitCode).toBe(99);
  });

  it("supports pdftocairo -svg, -pdf (with page selection & crop), -eps / -ps, -png -gray -singlefile, and -antialias validation", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 150 });
    p1.setRawContentStream("1 0 0 rg 10 10 80 60 re f BT /F1 12 Tf 20 100 Td (Cairo Page One) Tj ET");
    const p2 = doc.addPage({ width: 200, height: 150 });
    p2.drawText("Cairo Page Two", { x: 20, y: 100, size: 12 });

    const files = new Map<string, Uint8Array>([["deck.pdf", doc.save()]]);

    const svgRes = await runPdftocairoCli(["-svg", "deck.pdf", "chart.svg"], files);
    expect(svgRes.exitCode).toBe(0);
    expect(files.has("chart.svg")).toBe(true);
    expect(new TextDecoder().decode(files.get("chart.svg")!)).toContain("<svg");

    const pdfRes = await runPdftocairoCli(
      ["-pdf", "-f", "2", "-l", "2", "-x", "10", "-y", "20", "-W", "120", "-H", "90", "deck.pdf", "sub.pdf"],
      files
    );
    expect(pdfRes.exitCode).toBe(0);
    const subDoc = PdfDocument.load(files.get("sub.pdf")!);
    expect(subDoc.pageCount).toBe(1);
    expect(subDoc.extractText(0)).toContain("Cairo Page Two");
    expect(subDoc.getPage(0).getSize()).toEqual({ width: 120, height: 90 });

    const epsRes = await runPdftocairoCli(["-eps", "-f", "1", "-l", "1", "deck.pdf", "fig1.eps"], files);
    expect(epsRes.exitCode).toBe(0);
    const epsStr = new TextDecoder().decode(files.get("fig1.eps")!);
    expect(epsStr).toContain("%!PS-Adobe-3.0 EPSF-3.0");
    expect(epsStr).toContain("%%BoundingBox: 0 0 200 150");
    expect(epsStr).toContain("(Cairo Page One) show");

    const grayPngRes = await runPdftocairoCli(
      ["-png", "-gray", "-r", "72", "-singlefile", "deck.pdf", "graythumb"],
      files
    );
    expect(grayPngRes.exitCode).toBe(0);
    const grayPng = decodePng(files.get("graythumb.png")!);
    const sampleIdx = (120 * grayPng.width + 20) * 4;
    expect(grayPng.data[sampleIdx]).toBe(grayPng.data[sampleIdx + 1]);
    expect(grayPng.data[sampleIdx + 1]).toBe(grayPng.data[sampleIdx + 2]);
    expect(grayPng.data[sampleIdx]).toBeLessThan(200);

    const defaultRootRes = await runPdftocairoCli(["-png", "-singlefile", "deck.pdf"], files);
    expect(defaultRootRes.exitCode).toBe(0);
    expect(files.has("deck.png")).toBe(true);

    const badAa = await runPdftocairoCli(["-png", "-antialias", "bogus", "deck.pdf", "out"], files);
    expect(badAa.exitCode).toBe(99);
  });

  it("supports combining -png with -gray or -mono in pdftoppm", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 80, height: 80 });
    page.drawRect({ x: 0, y: 0, width: 80, height: 80, fill: { r: 1, g: 0, b: 0 } });

    const files = new Map<string, Uint8Array>([["color.pdf", doc.save()]]);
    const grayRes = await runPdftoppmCli(["-png", "-gray", "-singlefile", "-r", "72", "color.pdf", "gray-out"], files);
    expect(grayRes.exitCode).toBe(0);
    const grayPng = decodePng(files.get("gray-out.png")!);
    expect(grayPng.data[0]).toBe(grayPng.data[1]);
    expect(grayPng.data[1]).toBe(grayPng.data[2]);
    expect(grayPng.data[0]).toBeGreaterThan(50);
    expect(grayPng.data[0]).toBeLessThan(100);

    const monoRes = await runPdftoppmCli(["-mono", "-png", "-singlefile", "-r", "72", "color.pdf", "mono-out"], files);
    expect(monoRes.exitCode).toBe(0);
    const monoPng = decodePng(files.get("mono-out.png")!);
    expect(monoPng.data[0]).toBe(0);
    expect(monoPng.data[1]).toBe(0);
    expect(monoPng.data[2]).toBe(0);

    doc.setTitle("Cairo Paper Test");
    files.set("color.pdf", doc.save());
    const a4Res = await runPdftocairoCli(["-pdf", "-paper", "A4", "color.pdf", "a4.pdf"], files);
    expect(a4Res.exitCode).toBe(0);
    const a4Doc = PdfDocument.load(files.get("a4.pdf")!);
    expect(a4Doc.getMetadata().title).toBe("Cairo Paper Test");
    expect(a4Doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 });

    const origRes = await runPdftocairoCli(["-pdf", "-paper", "A4", "-origpagesizes", "color.pdf", "orig.pdf"], files);
    expect(origRes.exitCode).toBe(0);
    const origDoc = PdfDocument.load(files.get("orig.pdf")!);
    expect(origDoc.getPage(0).getSize()).toEqual({ width: 80, height: 80 });
  });
});
