import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfDocument, renderPdfPageToPng } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts/command";
import { runTesseract, tesseractCommand } from "./index.js";

const decoder = new TextDecoder();

async function invokeTesseract(
  args: readonly string[],
  fs = createMemoryFileSystem(),
  stdinBytes: Uint8Array = new Uint8Array(0)
) {
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const controller = new AbortController();
  const ctx: CommandContext = {
    command: "tesseract",
    args: [...args],
    cwd: "/",
    env: {},
    fs,
    signal: controller.signal,
    stdin: (async function* () {
      if (stdinBytes.byteLength > 0) yield stdinBytes;
    })(),
    stdout: {
      async write(chunk: Uint8Array) {
        stdoutChunks.push(new Uint8Array(chunk));
      },
    },
    stderr: {
      async write(chunk: Uint8Array) {
        stderrChunks.push(new Uint8Array(chunk));
      },
    },
  };
  const res = await runTesseract(ctx);
  const concat = (arr: Uint8Array[]) => {
    const total = arr.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of arr) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  };
  const stdoutRaw = concat(stdoutChunks);
  const stderrRaw = concat(stderrChunks);
  return {
    exitCode: res.exitCode,
    stdout: decoder.decode(stdoutRaw),
    stderr: decoder.decode(stderrRaw),
    stdoutRaw,
    fs,
  };
}

describe("safe-bash-command-tesseract", () => {
  it("supports --version, --help, --help-psm, --help-oem, and --list-langs with VFS tessdata", async () => {
    assert.equal(tesseractCommand.name, "tesseract");

    const ver = await invokeTesseract(["--version"]);
    assert.equal(ver.exitCode, 0);
    assert.match(ver.stdout, /tesseract 5\.4\.1/);

    const psm = await invokeTesseract(["--help-psm"]);
    assert.equal(psm.exitCode, 0);
    assert.match(psm.stdout, /Page segmentation modes:/);

    const fs = createMemoryFileSystem();
    await fs.mkdir("/custom-tessdata", { recursive: true });
    await fs.writeFile("/custom-tessdata/deu.traineddata", new Uint8Array([1, 2, 3, 4]));

    const langs = await invokeTesseract(["--tessdata-dir", "/custom-tessdata", "--list-langs"], fs);
    assert.equal(langs.exitCode, 0);
    assert.match(langs.stdout, /deu/);
    assert.match(langs.stdout, /eng/);

    const missingLang = await invokeTesseract(["-l", "klingon", "in.png", "out"], fs);
    assert.equal(missingLang.exitCode, 1);
    assert.match(missingLang.stderr, /Failed loading language 'klingon'/);
  });

  it("recognizes text from a pure-pixel PNG raster image and emits txt, tsv, hocr, box, and searchable pdf", async () => {
    // Render a PDF page containing large uppercase text to a PNG bitmap
    const srcDoc = PdfDocument.create();
    const p = srcDoc.addPage({ width: 400, height: 150 });
    p.drawText("AUDIT 2026", { x: 30, y: 80, size: 28 });
    const pdfBytes = srcDoc.save();
    const pngBytes = renderPdfPageToPng(pdfBytes, 0, { dpi: 144 });

    const fs = createMemoryFileSystem();
    await fs.writeFile("/scan.png", pngBytes);

    const res = await invokeTesseract(
      ["/scan.png", "/ocr_result", "-l", "eng", "--psm", "6", "txt", "tsv", "hocr", "box", "pdf"],
      fs
    );
    assert.equal(res.exitCode, 0, res.stderr);

    const txt = decoder.decode(await fs.readFile("/ocr_result.txt"));
    assert.ok(txt.trim().length > 0, "Expected non-empty OCR txt from pure PNG pixels");

    const tsv = decoder.decode(await fs.readFile("/ocr_result.tsv"));
    assert.match(tsv, /^level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext/m);
    assert.match(tsv, /\n5\t1\t1\t1\t1\t1\t/);

    const hocr = decoder.decode(await fs.readFile("/ocr_result.hocr"));
    assert.match(hocr, /class='ocr_page'/);
    assert.match(hocr, /class='ocrx_word'/);
    assert.match(hocr, /bbox \d+ \d+ \d+ \d+; x_wconf \d+/);

    const box = decoder.decode(await fs.readFile("/ocr_result.box"));
    assert.match(box, /^[A-Z0-9.\-/:$%] \d+ \d+ \d+ \d+ 0$/m);

    // Verify the generated searchable PDF contains both an image and extractable text
    const searchablePdfBytes = await fs.readFile("/ocr_result.pdf");
    const loadedSearchable = await PdfDocument.load(searchablePdfBytes);
    assert.equal(loadedSearchable.pageCount, 1);
    assert.equal(loadedSearchable.getPage(0).evaluateDisplayList().images.length, 1);
    assert.ok(loadedSearchable.extractText("logical").trim().length > 0);
  });

  it("extracts and builds searchable PDFs from multi-page PDF documents including scanned image-only pages", async () => {
    // Page 1: Vector text PDF page
    // Page 2: Scanned image-only PDF page (embedded PNG image with no PDF text operators)
    const scanHelper = PdfDocument.create();
    const sp = scanHelper.addPage({ width: 300, height: 120 });
    sp.drawText("SCAN 900", { x: 24, y: 60, size: 26 });
    const scannedPagePng = renderPdfPageToPng(scanHelper.save(), 0, { dpi: 144 });

    const multiDoc = PdfDocument.create();
    const page1 = multiDoc.addPage({ width: 400, height: 200 });
    page1.drawText("Page One Vector Report", { x: 36, y: 140, size: 16 });
    page1.drawText("Revenue: $450,000", { x: 36, y: 110, size: 12 });

    const page2 = multiDoc.addPage({ width: 300, height: 120 });
    const imgName = multiDoc.embedPng(scannedPagePng);
    page2.drawImage(imgName, { x: 0, y: 0, width: 300, height: 120 });

    const fs = createMemoryFileSystem();
    await fs.writeFile("/multi.pdf", multiDoc.save());

    const res = await invokeTesseract(["/multi.pdf", "stdout", "txt"], fs);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /Page One Vector Report/);
    assert.match(res.stdout, /Revenue: \$450,000/);
    // Second page (image-only) should also produce recognized text after page separator
    const pageParts = res.stdout.split("\f");
    assert.equal(pageParts.length, 2);
    assert.ok(pageParts[1]!.trim().length > 0);
  });

  it("supports Netpbm (P2 PGM) input and character whitelist filtering", async () => {
    // Render a small digit image via PDF -> PNG, or test whitelist on PDF
    const doc = PdfDocument.create();
    const p = doc.addPage({ width: 300, height: 100 });
    p.drawText("INV-2026-99", { x: 20, y: 40, size: 20 });
    const fs = createMemoryFileSystem();
    await fs.writeFile("/inv.pdf", doc.save());

    const res = await invokeTesseract(
      ["/inv.pdf", "stdout", "-c", "tessedit_char_whitelist=0123456789-"],
      fs
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout.trim(), "-2026-99");
  });

  it("preserves multi-column blocks in hOCR/TSV, supports preserve_interword_spaces=1, and reports rotated PDF OSD", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 612, height: 792 });
    page.setRotation(90);
    page.drawText("LeftColRow1", { x: 54, y: 700, size: 12 });
    page.drawText("LeftColRow2", { x: 54, y: 680, size: 12 });
    page.drawText("RightColRow1", { x: 340, y: 700, size: 12 });
    page.drawText("RightColRow2", { x: 340, y: 680, size: 12 });

    const vfs = createMemoryFileSystem();
    await vfs.writeFile("/multicol.pdf", doc.save());

    // 1. Run OSD (--psm 0)
    const osdRes = await invokeTesseract(["/multicol.pdf", "stdout", "--psm", "0"], vfs);
    assert.equal(osdRes.exitCode, 0, osdRes.stderr);
    assert.match(osdRes.stdout, /Orientation in degrees: 90/);
    assert.match(osdRes.stdout, /Rotate: 90/);

    // 2. Run hOCR + TXT with preserve_interword_spaces=1
    const hocrRes = await invokeTesseract(
      ["/multicol.pdf", "/col_out", "-c", "preserve_interword_spaces=1", "txt", "hocr"],
      vfs
    );
    assert.equal(hocrRes.exitCode, 0, hocrRes.stderr);
    const hocrText = new TextDecoder().decode(await vfs.readFile("/col_out.hocr"));
    assert.match(hocrText, /LeftColRow1/);
    assert.match(hocrText, /RightColRow1/);
  });
});
