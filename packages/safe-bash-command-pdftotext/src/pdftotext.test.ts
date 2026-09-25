import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictSet,
  encodePng,
  parseCosDocument,
  encryptCosDocument
} from "@poe-code/pdf-ast";
import { extractPdfToTextBytes, runPdftotextCli, runPdftohtmlCli } from "./index.js";

function buildThreePageTestPdf(encrypt = false): Uint8Array {
  const doc = PdfDocument.create();
  doc.setTitle("Three Page Fixture");
  doc.setAuthor("Ada Lovelace");

  // Page 1: "Hello world" and "alpha beta"
  const p1 = doc.addPage([216, 144]);
  p1.drawText("Hello world", { x: 20, y: 120, size: 12 });
  p1.drawText("alpha beta", { x: 20, y: 100, size: 12 });

  // Page 2: hyphenated line wrap in col 1 ("hyphen-" / "ation") + "column two" in col 2
  const p2 = doc.addPage([216, 144]);
  p2.drawText("hyphen-", { x: 20, y: 120, size: 12 });
  p2.drawText("ation", { x: 20, y: 105, size: 12 });
  p2.drawText("column two", { x: 130, y: 105, size: 12 });

  // Page 3: empty rotated page
  const p3 = doc.addPage([216, 144]);
  p3.setRotation(90);

  const rawBytes = doc.save();
  if (encrypt) {
    const cos = parseCosDocument(rawBytes);
    return encryptCosDocument(cos, {
      userPassword: "reader-password",
      ownerPassword: "owner-password"
    });
  }
  return rawBytes;
}

describe("safe-bash-command-pdftotext", () => {
  it("extracts logical reading order with dehyphenation and page form feeds", () => {
    const pdf = buildThreePageTestPdf();
    const res = extractPdfToTextBytes(pdf, []);
    assert.equal(res.exitCode, 0);
    assert.match(res.output, /Hello world\nalpha beta/);
    assert.match(res.output, /hyphenation/);
    assert.match(res.output, /column two/);
    // Three pages => three form feeds (\f)
    const formFeeds = [...res.output].filter((c) => c === "\f").length;
    assert.equal(formFeeds, 3);
  });

  it("preserves hyphens and column gaps in -layout and stream order in -raw", () => {
    const pdf = buildThreePageTestPdf();
    const layoutRes = extractPdfToTextBytes(pdf, ["-layout"]);
    assert.equal(layoutRes.exitCode, 0);
    assert.match(layoutRes.output, /hyphen-\s*\n\s*ation\s{4,}column two/);

    const rawRes = extractPdfToTextBytes(pdf, ["-raw"]);
    assert.equal(rawRes.exitCode, 0);
    assert.match(rawRes.output, /hyphen-\nation/);
  });

  it("supports -nopgbrk, -eol dos|mac, and warns on invalid -eol while succeeding", () => {
    const pdf = buildThreePageTestPdf();
    const noBrk = extractPdfToTextBytes(pdf, ["-nopgbrk"]);
    assert.equal(noBrk.exitCode, 0);
    assert.equal(noBrk.output.includes("\f"), false);

    const dosRes = extractPdfToTextBytes(pdf, ["-f", "1", "-l", "1", "-eol", "dos"]);
    assert.equal(dosRes.exitCode, 0);
    assert.ok(dosRes.output.includes("\r\n"));

    const badEol = extractPdfToTextBytes(pdf, ["-f", "1", "-l", "1", "-eol", "bogus"]);
    assert.equal(badEol.exitCode, 0);
    assert.match(badEol.stderr, /Bad '-eol' value on command line/);
  });

  it("generates XHTML -bbox / -bbox-layout with 6-decimal boxes and DPI scaling", () => {
    const pdf = buildThreePageTestPdf();
    const bbox72 = extractPdfToTextBytes(pdf, ["-bbox", "-f", "1", "-l", "1"]);
    assert.equal(bbox72.exitCode, 0);
    assert.match(bbox72.output, /<page width="216\.000000" height="144\.000000">/);
    assert.match(bbox72.output, /<word xMin="20\.000000"/);
    assert.match(bbox72.output, />Hello<\/word>/);

    const bbox144 = extractPdfToTextBytes(pdf, ["-bbox-layout", "-r", "144", "-f", "1", "-l", "1"]);
    assert.equal(bbox144.exitCode, 0);
    // Page width/height remain in PDF points (216x144), while word coordinates scale 2x (xMin=40)
    assert.match(bbox144.output, /<page width="216\.000000" height="144\.000000">/);
    assert.match(bbox144.output, /<flow>/);
    assert.match(bbox144.output, /<word xMin="40\.000000"/);

    // Empty page 3 with flat -bbox prints 'no word list' to stderr
    const emptyBbox = extractPdfToTextBytes(pdf, ["-bbox", "-f", "3", "-l", "3"]);
    assert.equal(emptyBbox.exitCode, 0);
    assert.match(emptyBbox.stderr, /no word list/);
  });

  it("generates Poppler -tsv with par_num before block_num and 6-dec structural / 2-dec word boxes", () => {
    const pdf = buildThreePageTestPdf();
    const tsvRes = extractPdfToTextBytes(pdf, ["-tsv", "-f", "1", "-l", "1"]);
    assert.equal(tsvRes.exitCode, 0);
    const lines = tsvRes.output.trim().split("\n");
    assert.equal(
      lines[0],
      "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    );
    assert.ok(lines.some((l) => l.includes("###PAGE###") && l.includes("216.000000")));
    assert.ok(lines.some((l) => l.endsWith("\t100\tHello")));
  });

  it("supports -htmlmeta, crop box -x/-y/-W/-H, encrypted PDFs, and default output filenames", async () => {
    const pdf = buildThreePageTestPdf();
    const htmlMeta = extractPdfToTextBytes(pdf, ["-htmlmeta", "-f", "1", "-l", "1"]);
    assert.equal(htmlMeta.exitCode, 0);
    assert.match(htmlMeta.output, /<title>Three Page Fixture<\/title>/);
    assert.match(htmlMeta.output, /<meta name="Author" content="Ada Lovelace"\/>/);

    // Crop area selecting only the top line (y from 0 to 30 in top-down coords -> y=120 in PDF bottom-up)
    const cropped = extractPdfToTextBytes(pdf, [
      "-f",
      "1",
      "-l",
      "1",
      "-x",
      "0",
      "-y",
      "0",
      "-W",
      "200",
      "-H",
      "30",
      "-nopgbrk"
    ]);
    assert.equal(cropped.exitCode, 0);
    assert.match(cropped.output, /Hello world/);
    assert.equal(cropped.output.includes("alpha beta"), false);

    // Encrypted PDF
    const encPdf = buildThreePageTestPdf(true);
    const failEnc = extractPdfToTextBytes(encPdf, ["-upw", "wrong"]);
    assert.equal(failEnc.exitCode, 1);

    const okEnc = extractPdfToTextBytes(encPdf, ["-upw", "reader-password"]);
    assert.equal(okEnc.exitCode, 0);
    assert.match(okEnc.output, /Hello world/);

    // CLI default output file resolution (/report.pdf -> /report.txt)
    const files = new Map<string, Uint8Array>([["/report.pdf", pdf]]);
    const cliRes = await runPdftotextCli(["/report.pdf"], files);
    assert.equal(cliRes.exitCode, 0);
    assert.equal(cliRes.outputPath, "/report.txt");
    assert.match(cliRes.output, /Hello world/);

    // pdftohtml -xml and -stdout HTML conversion
    const xmlRes = await runPdftohtmlCli(["-xml", "-stdout", "/report.pdf"], files);
    assert.equal(xmlRes.exitCode, 0);
    assert.match(xmlRes.stdout, /<pdf2xml/);
    assert.match(xmlRes.stdout, /<page number="1"/);
    assert.match(xmlRes.stdout, /Hello world/);

    const htmlRes = await runPdftohtmlCli(["-s", "/report.pdf", "/report.html"], files);
    assert.equal(htmlRes.exitCode, 0);
    const htmlBytes = files.get("/report.html");
    assert.ok(htmlBytes);
    const htmlText = new TextDecoder().decode(htmlBytes);
    assert.match(htmlText, /<!DOCTYPE html>/i);
    assert.match(htmlText, /Hello world/);
  });

  it("filters words by crop-box center and recomputes line/block bboxes on -x/-y/-W/-H crop (poppler #1094)", () => {
    const pdf = buildThreePageTestPdf();
    // Crop x=[0..60] on page 1 so only "Hello" (x=20..48) remains from "Hello world" (world is x=51..82, center=66.7)
    // and verify line and block xMax are recomputed to Hello's xMax (< 55)
    const croppedBbox = extractPdfToTextBytes(pdf, [
      "-bbox",
      "-f",
      "1",
      "-l",
      "1",
      "-x",
      "0",
      "-y",
      "0",
      "-W",
      "60",
      "-H",
      "40"
    ]);
    assert.equal(croppedBbox.exitCode, 0);
    assert.match(croppedBbox.output, /<word[^>]*>Hello<\/word>/);
    assert.equal(croppedBbox.output.includes(">world<"), false);
    const lineMatch = /<line xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">/.exec(
      croppedBbox.output
    );
    assert.ok(lineMatch);
    const lineXMax = Number(lineMatch[3]);
    assert.ok(lineXMax < 55, `expected cropped line xMax < 55, got ${lineXMax}`);
  });

  it("supports -nodiag to discard 45-degree diagonal watermark text and -cropbox to filter words outside page /CropBox", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    dictSet(
      page.pageDict,
      "CropBox",
      cosArray([cosNumber(0), cosNumber(0), cosNumber(200), cosNumber(120)])
    );
    // 1. Horizontal body text inside CropBox (y=60)
    // 2. 45-degree diagonal watermark text inside CropBox ("CONFIDENTIAL")
    // 3. Header bleed text outside CropBox (y=170)
    const content = [
      "BT /F1 12 Tf 1 0 0 1 20 60 Tm (BodyInsideCropBox) Tj ET",
      "BT /F1 12 Tf 0.7071 0.7071 -0.7071 0.7071 50 50 Tm (DiagonalWatermark) Tj ET",
      "BT /F1 12 Tf 1 0 0 1 20 170 Tm (BleedOutsideCropBox) Tj ET"
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );
    const pdfBytes = doc.save();

    // Default extracts all three
    const allRes = extractPdfToTextBytes(pdfBytes, ["-"]);
    assert.match(allRes.output, /BodyInsideCropBox/);
    assert.match(allRes.output, /DiagonalWatermark/);
    assert.match(allRes.output, /BleedOutsideCropBox/);

    // With -nodiag and -cropbox, only BodyInsideCropBox remains
    const filteredRes = extractPdfToTextBytes(pdfBytes, ["-nodiag", "-cropbox", "-fixed", "4.0", "-"]);
    assert.equal(filteredRes.exitCode, 0);
    assert.match(filteredRes.output, /BodyInsideCropBox/);
    assert.equal(filteredRes.output.includes("DiagonalWatermark"), false);
    assert.equal(filteredRes.output.includes("BleedOutsideCropBox"), false);

    // With -cropbox -bbox, <page> dimensions reflect the 200x120 CropBox
    const bboxCrop = extractPdfToTextBytes(pdfBytes, ["-nodiag", "-cropbox", "-bbox", "-"]);
    assert.equal(bboxCrop.exitCode, 0);
    assert.ok(bboxCrop.output.includes("<page width=\"200.000000\" height=\"120.000000\">"));
  });

  it("supports pdftohtml -xml -zoom scaling, -enc/-fmt/-hidden/-nomerge flags, and stdin (-) input", async () => {
    const pdf = buildThreePageTestPdf();
    const files = new Map<string, Uint8Array>([["-", pdf]]);
    const xmlRes = await runPdftohtmlCli(
      ["-xml", "-stdout", "-zoom", "2", "-enc", "UTF-8", "-fmt", "png", "-hidden", "-nomerge", "-f", "1", "-l", "1", "-"],
      files
    );
    assert.equal(xmlRes.exitCode, 0);
    // Page 1 is 216x144 -> at -zoom 2 becomes width="432" height="288"
    assert.match(xmlRes.stdout, /<page number="1" position="absolute" top="0" left="0" height="288" width="432">/);
    assert.match(xmlRes.stdout, /Hello world/);
  });

  it("filters glyphs clipped by W n paths when -clip is passed and supports -table / -lineprinter", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    // Clip path [10, 10, 180, 100]: InsideClippedText at y=50 is inside; OutsideClippedText at y=160 is outside
    const content = [
      "q 10 10 170 90 re W n",
      "BT /F1 12 Tf 1 0 0 1 20 50 Tm (InsideClippedText) Tj ET",
      "BT /F1 12 Tf 1 0 0 1 20 160 Tm (OutsideClippedText) Tj ET",
      "Q",
    ].join("\n");
    dictSet(
      page.pageDict,
      "Contents",
      doc.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: false }))
    );
    const pdfBytes = doc.save();

    // Without -clip, both strings are extracted
    const unclipped = extractPdfToTextBytes(pdfBytes, ["-table", "-"]);
    assert.match(unclipped.output, /InsideClippedText/);
    assert.match(unclipped.output, /OutsideClippedText/);

    // With -clip, OutsideClippedText is excluded by the W n clipping path
    const clipped = extractPdfToTextBytes(pdfBytes, ["-clip", "-lineprinter", "-"]);
    assert.equal(clipped.exitCode, 0);
    assert.match(clipped.output, /InsideClippedText/);
    assert.equal(clipped.output.includes("OutsideClippedText"), false);
  });

  it("supports -htmlmeta -tsv pre wrapping, -raw -tsv page-only rows, -remove-hyphens, -urls/-colspacing/-q interactions, and strict numeric DPI validation", () => {
    const pdfBytes = buildThreePageTestPdf();

    // 1. htmlmeta + tsv in both option orders emits HTML <pre> wrapper around TSV
    const htmlTsv1 = extractPdfToTextBytes(pdfBytes, ["-htmlmeta", "-tsv", "-"]);
    const htmlTsv2 = extractPdfToTextBytes(pdfBytes, ["-tsv", "-htmlmeta", "-"]);
    assert.equal(htmlTsv1.exitCode, 0);
    assert.equal(htmlTsv1.output, htmlTsv2.output);
    assert.match(htmlTsv1.output, /<pre>\nlevel\tpage_num\tpar_num\tblock_num/);
    assert.match(htmlTsv1.output, /###PAGE###/);

    // 2. bbox + tsv in both option orders emits identical bbox XHTML
    const bboxTsv1 = extractPdfToTextBytes(pdfBytes, ["-bbox", "-tsv", "-"]);
    const bboxTsv2 = extractPdfToTextBytes(pdfBytes, ["-tsv", "-bbox", "-"]);
    assert.equal(bboxTsv1.output, bboxTsv2.output);
    assert.match(bboxTsv1.output, /<page width=/);

    // 3. raw + tsv retains header and ###PAGE### rows only (no ###FLOW### / ###LINE###)
    const rawTsv = extractPdfToTextBytes(pdfBytes, ["-raw", "-tsv", "-"]);
    assert.equal(rawTsv.exitCode, 0);
    assert.match(rawTsv.output, /###PAGE###/);
    assert.equal(rawTsv.output.includes("###FLOW###"), false);
    assert.equal(rawTsv.output.includes("###LINE###"), false);

    // 4. -remove-hyphens no preserves hyphens in logical mode; invalid -remove-hyphens exits 99 and respects -q
    const keepHyphens = extractPdfToTextBytes(pdfBytes, ["-remove-hyphens", "no", "-"]);
    assert.equal(keepHyphens.exitCode, 0);
    assert.match(keepHyphens.output, /hyphen-\nation/);

    const badHyphens = extractPdfToTextBytes(pdfBytes, ["-remove-hyphens", "invalid", "-"]);
    assert.equal(badHyphens.exitCode, 99);
    assert.ok(badHyphens.stderr.length > 0);

    const badHyphensQuiet = extractPdfToTextBytes(pdfBytes, ["-q", "-remove-hyphens", "invalid", "-"]);
    assert.equal(badHyphensQuiet.exitCode, 99);
    assert.equal(badHyphensQuiet.stderr, "");

    // 5. -q does NOT suppress early -urls or -colspacing error or invalid -eol diagnostic
    const urlsTsvQuiet = extractPdfToTextBytes(pdfBytes, ["-q", "-urls", "-tsv", "-"]);
    assert.equal(urlsTsvQuiet.exitCode, 99);
    assert.ok(urlsTsvQuiet.stderr.includes("-urls"));

    const colHelp = extractPdfToTextBytes(pdfBytes, ["-colspacing", "15", "-h"]);
    assert.equal(colHelp.exitCode, 99);
    assert.ok(colHelp.stderr.includes("Invalid column spacing"));

    const badEolQuiet = extractPdfToTextBytes(pdfBytes, ["-q", "-eol", "bogus", "-"]);
    assert.equal(badEolQuiet.exitCode, 0);
    assert.match(badEolQuiet.stderr, /Bad '-eol' value on command line/);

    // 6. Strict numeric validator rejects -r . and -r 1e2 with exitCode 99
    for (const badDpi of [".", "1e2", "-72", "0"]) {
      const badRes = extractPdfToTextBytes(pdfBytes, ["-r", badDpi, "-"]);
      assert.equal(badRes.exitCode, 99);
    }
  });

  it("adjusts column segmentation with -colspacing / -table and character pitch spacing with -fixed / -lineprinter", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 400, height: 200 });
    // Two words separated by a 25pt horizontal gap (at size 10, 25pt is 2.5x fontSize)
    page.drawText("ColA", { x: 20, y: 150, size: 10 });
    page.drawText("ColB", { x: 70, y: 150, size: 10 });
    const bytes = doc.save();

    // Narrow -fixed 3 produces more spaces between ColA and ColB than wide -fixed 12
    const narrowFixed = extractPdfToTextBytes(bytes, ["-layout", "-fixed", "3", "in.pdf", "-"]);
    const wideFixed = extractPdfToTextBytes(bytes, ["-layout", "-fixed", "12", "in.pdf", "-"]);
    assert.equal(narrowFixed.exitCode, 0);
    assert.equal(wideFixed.exitCode, 0);
    assert.ok(narrowFixed.output.indexOf("ColB") > wideFixed.output.indexOf("ColB"));

    // Tight -colspacing 0.3 splits ColA and ColB into separate <line> elements in -bbox
    const tightColBbox = extractPdfToTextBytes(bytes, ["-bbox", "-colspacing", "0.3", "in.pdf", "-"]);
    const wideColBbox = extractPdfToTextBytes(bytes, ["-bbox", "-colspacing", "2.0", "in.pdf", "-"]);
    const countLineTags = (s: string) => s.split("<line ").length - 1;
    assert.equal(countLineTags(tightColBbox.output), 2);
    assert.equal(countLineTags(wideColBbox.output), 1);
  });

  it("emits /Subtype /Link /URI annotations with pdftotext -urls and embeds data URLs / links in pdftohtml (-dataurls vs -i)", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 100 });
    page.drawText("Documentation", { x: 10, y: 70, size: 12 });

    const pngBytes = encodePng({
      width: 2,
      height: 2,
      data: Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]),
    });
    const imgHandle = doc.embedPng(pngBytes);
    page.drawImage(imgHandle, { x: 10, y: 10, width: 20, height: 20 });

    const linkAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(8), cosNumber(65), cosNumber(120), cosNumber(85)]),
        A: cosDict({
          S: cosName("URI"),
          URI: cosString("https://poe.com/docs"),
        }),
      })
    );
    dictSet(page.dict, "Annots", cosArray([linkAnnotRef]));
    const bytes = doc.save();

    // 1. pdftotext -urls includes the annotation URI in plain-text output
    const withUrls = extractPdfToTextBytes(bytes, ["-urls", "in.pdf", "-"]);
    assert.equal(withUrls.exitCode, 0);
    assert.match(withUrls.output, /Documentation/);
    assert.match(withUrls.output, /https:\/\/poe\.com\/docs/);

    // 2. pdftohtml -dataurls -stdout includes <img src="data:image/png;base64,..." and <a href="https://poe.com/docs">
    const files = new Map<string, Uint8Array>([["in.pdf", bytes]]);
    const htmlDataUrls = await runPdftohtmlCli(["-dataurls", "-stdout", "in.pdf"], files);
    assert.equal(htmlDataUrls.exitCode, 0);
    assert.match(htmlDataUrls.stdout, /data:image\/png;base64,/);
    assert.match(htmlDataUrls.stdout, /href="https:\/\/poe\.com\/docs"/);

    // 3. pdftohtml -i -stdout suppresses images
    const htmlNoImg = await runPdftohtmlCli(["-i", "-dataurls", "-stdout", "in.pdf"], files);
    assert.equal(htmlNoImg.exitCode, 0);
    assert.doesNotMatch(htmlNoImg.stdout, /data:image\/png;base64,/);
  });

  it("emits Document Outline navigation and internal #pageN links in pdftohtml and pdftohtml -xml", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 100 });
    p1.drawText("Jump to Chapter 2", { x: 10, y: 70, size: 12 });
    const p2 = doc.addPage({ width: 200, height: 100 });
    p2.drawText("Chapter 2 Body", { x: 10, y: 70, size: 12 });

    // Register named destination "chap2" pointing to p2.ref in /Root /Dests
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "Dests",
      doc.cos.allocateObject(
        cosDict({
          chap2: cosArray([p2.ref, cosName("XYZ"), cosNumber(0), cosNumber(100), cosNumber(0)]),
        })
      )
    );
    // Internal GoTo link annotation on page 1 pointing to named destination "chap2"
    const gotoAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(8), cosNumber(65), cosNumber(140), cosNumber(85)]),
        A: cosDict({
          S: cosName("GoTo"),
          D: cosString("chap2"),
        }),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([gotoAnnotRef]));

    // Create /Outlines hierarchy: Chapter 1 (page 1) -> Section 1.1 (page 1), Chapter 2 (page 2)
    const subItemRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Section 1.1"),
        Dest: cosArray([p1.ref, cosName("Fit")]),
      })
    );
    const chap2ItemRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Chapter 2"),
        Dest: cosArray([p2.ref, cosName("Fit")]),
      })
    );
    const chap1ItemRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Chapter 1"),
        Dest: cosArray([p1.ref, cosName("Fit")]),
        First: subItemRef,
        Last: subItemRef,
        Next: chap2ItemRef,
      })
    );
    dictSet(
      catalog,
      "Outlines",
      doc.cos.allocateObject(
        cosDict({
          Type: cosName("Outlines"),
          First: chap1ItemRef,
          Last: chap2ItemRef,
        })
      )
    );

    const files = new Map<string, Uint8Array>([["nav.pdf", doc.save()]]);
    const htmlRes = await runPdftohtmlCli(["-stdout", "nav.pdf"], files);
    assert.equal(htmlRes.exitCode, 0);
    assert.match(htmlRes.stdout, /<a href="#page2">Jump to Chapter 2<\/a>/);
    assert.match(htmlRes.stdout, /<h1>Document Outline<\/h1>/);
    assert.match(htmlRes.stdout, /<li><a href="#page1">Section 1\.1<\/a>/);
    assert.match(htmlRes.stdout, /<li><a href="#page2">Chapter 2<\/a>/);

    const xmlRes = await runPdftohtmlCli(["-xml", "-stdout", "nav.pdf"], files);
    assert.equal(xmlRes.exitCode, 0);
    assert.match(xmlRes.stdout, /<outline>/);
    assert.match(xmlRes.stdout, /<item page="2">Chapter 2<\/item>/);
    assert.match(xmlRes.stdout, /<a href="#page2">Jump to Chapter 2<\/a>/);
  });

  it("emits <image> elements and writes pageN_M.png files in pdftohtml -xml and HTML modes", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 100, height: 100 });
    const imgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([255, 0, 0]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosName("DeviceRGB"),
        }),
      })
    );
    const kImg = p1.ensureXObjectResource(imgRef);
    p1.setRawContentStream(`q 10 0 0 10 10 10 cm /${kImg} Do Q`);

    const files = new Map<string, Uint8Array>([["img.pdf", doc.save()]]);
    const xmlRes = await runPdftohtmlCli(["-xml", "-stdout", "img.pdf"], files);
    assert.equal(xmlRes.exitCode, 0);
    assert.match(xmlRes.stdout, /<image top="0" left="0" width="1" height="1" src="page1_1\.png"\/>/);
    assert.ok(files.has("page1_1.png"));
    assert.equal(files.get("page1_1.png")![0], 0x89);
  });

  it("supports -linespacing <fp> and -lineprinter vertical row spacing in physical layout mode", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    page.drawText("RowAlpha", { x: 20, y: 160, size: 12 });
    page.drawText("RowOmega", { x: 20, y: 88, size: 12 });

    const bytes = doc.save();
    const res = extractPdfToTextBytes(bytes, ["-layout", "-linespacing", "24", "-nopgbrk", "rows.pdf", "-"]);
    assert.equal(res.exitCode, 0);
    // Vertical separation is 160 - 88 = 72pt; with -linespacing 24, round(72/24) - 1 = 2 blank lines (\n\n\n total)
    assert.match(res.output, /RowAlpha\n\n\n\s*RowOmega/);

    const lpRes = extractPdfToTextBytes(bytes, ["-lineprinter", "-nopgbrk", "rows.pdf", "-"]);
    assert.equal(lpRes.exitCode, 0);
    assert.match(lpRes.output, /RowAlpha\n\n\n\s*RowOmega/);
  });

  it("emits fontspec and <b>/<i> tags in pdftohtml -xml, supports -fmt jpg, and validates page ranges", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 200 });
    p1.drawText("BoldHeading", { x: 20, y: 150, size: 18, font: "Helvetica-Bold" });
    p1.drawText("ItalicNote", { x: 20, y: 120, size: 14, font: "Times-Italic" });
    const imgRef = doc.cos.allocateObject(
      cosStream(Uint8Array.from([0, 255, 0]), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Image"),
          Width: cosNumber(1),
          Height: cosNumber(1),
          BitsPerComponent: cosNumber(8),
          ColorSpace: cosName("DeviceRGB"),
        }),
      })
    );
    p1.ensureXObjectResource(imgRef);

    const files = new Map<string, Uint8Array>([["styled.pdf", doc.save()]]);
    const xmlRes = await runPdftohtmlCli(["-xml", "-fmt", "jpg", "-stdout", "styled.pdf"], files);
    assert.equal(xmlRes.exitCode, 0);
    assert.match(xmlRes.stdout, /<fontspec id="1" size="18" family="Helvetica-Bold"/);
    assert.match(xmlRes.stdout, /<b>BoldHeading<\/b>/);
    assert.match(xmlRes.stdout, /<i>ItalicNote<\/i>/);
    assert.match(xmlRes.stdout, /src="page1_1\.jpg"/);
    assert.equal(files.get("page1_1.jpg")?.[0], 0xff);
    assert.equal(files.get("page1_1.jpg")?.[1], 0xd8);

    const htmlRes = await runPdftohtmlCli(["-stdout", "styled.pdf"], files);
    assert.equal(htmlRes.exitCode, 0);
    assert.match(htmlRes.stdout, /<b>BoldHeading<\/b>/);
    assert.match(htmlRes.stdout, /<i>ItalicNote<\/i>/);

    const badFmt = await runPdftohtmlCli(["-fmt", "bmp", "styled.pdf"], files);
    assert.equal(badFmt.exitCode, 99);

    const badRange = await runPdftohtmlCli(["-f", "5", "-l", "6", "styled.pdf"], files);
    assert.equal(badRange.exitCode, 99);
  });

  it("transliterates ligatures and accented characters with -enc ASCII7 in pdftotext and pdftohtml", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 300, height: 200 });
    const cmapStream = doc.cos.allocateObject(
      cosStream(
        new TextEncoder().encode(
          "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n" +
          "1 begincodespacerange\n<01> <02>\nendcodespacerange\n" +
          "2 beginbfchar\n<01> <FB01>\n<02> <00E9>\nendbfchar\n" +
          "endcmap CMapName currentdict /CMap defineresource pop end end\n"
        )
      )
    );
    const fontRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Helvetica"),
        ToUnicode: cmapStream,
      })
    );
    dictSet(page.getResourcesDict(), "Font", cosDict({ F1: fontRef }));
    dictSet(page.dict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("BT /F1 12 Tf 20 100 Td <0102> Tj ET"))));

    const pdfBytes = doc.save();
    const txtAscii = extractPdfToTextBytes(pdfBytes, ["-enc", "ASCII7", "-", "-"]);
    assert.equal(txtAscii.exitCode, 0);
    assert.ok(txtAscii.output.includes("fie"));

    const files = new Map<string, Uint8Array>([["enc.pdf", pdfBytes]]);
    const htmlAscii = await runPdftohtmlCli(["-enc", "ASCII7", "-stdout", "enc.pdf"], files);
    assert.equal(htmlAscii.exitCode, 0);
    assert.ok(htmlAscii.stdout.includes("fie"));

    const htmlBadEnc = await runPdftohtmlCli(["-enc", "InvalidEnc", "-stdout", "enc.pdf"], files);
    assert.equal(htmlBadEnc.exitCode, 99);
  });
});
