import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PdfDocument,
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
});
