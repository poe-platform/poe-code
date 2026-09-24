import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { pdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { pdftotextCommands } from "../../src/commands/pdftotext/index.js";
import { qpdfCommands } from "../../src/commands/qpdf/index.js";
import { sofficeCommands, createStoredZipArchive } from "../../src/commands/soffice/index.js";
import { tesseractCommands } from "../../src/commands/tesseract/index.js";
import { exiftoolCommands } from "../../src/commands/exiftool/index.js";
import { pdfAstWkhtmltopdfCommands } from "../../src/commands/wkhtmltopdf/index.js";

describe("safe-bash PDF tooling suite (pdfinfo, pdftotext, qpdf, soffice, wkhtmltopdf, exiftool, tesseract)", () => {
  it("runs soffice -> pdfinfo -> pdftotext -> qpdf -> exiftool -> wkhtmltopdf -> tesseract pipeline inside virtual Shell", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(pdfinfoCommands())
      .use(pdftotextCommands())
      .use(qpdfCommands())
      .use(sofficeCommands())
      .use(tesseractCommands({ replace: true }))
      .use(exiftoolCommands({ replace: true }))
      .use(pdfAstWkhtmltopdfCommands({ replace: true }));

    const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Unified PDF AST Pipeline</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>First-party COS, content stream, and display list verification.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Module</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>pdf-ast</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Verified</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    await fs.writeFile(
      "/input.docx",
      createStoredZipArchive({
        "word/document.xml": new TextEncoder().encode(docxXml)
      })
    );

    // 1. Convert DOCX to PDF via soffice
    const sofficeRes = await shell.exec(
      "soffice --headless --convert-to pdf:writer_pdf_Export --outdir / /input.docx"
    );
    assert.equal(sofficeRes.exitCode, 0);
    assert.match(sofficeRes.stdout, /convert \/input\.docx -> \/input\.pdf/);

    // 2. Inspect generated PDF via pdfinfo
    const infoRes = await shell.exec("pdfinfo -box /input.pdf");
    assert.equal(infoRes.exitCode, 0);
    assert.match(infoRes.stdout, /Title:\s+input/);
    assert.match(infoRes.stdout, /Pages:\s+1/);
    assert.match(infoRes.stdout, /MediaBox:\s+0\.00\s+0\.00\s+612\.00\s+792\.00/);

    // 3. Edit and inspect PDF metadata via exiftool
    const exifWrite = await shell.exec(
      "exiftool -overwrite_original -Title=\"Enterprise PDF Spec\" -Author=\"Poe Platform\" /input.pdf"
    );
    assert.equal(exifWrite.exitCode, 0);

    const exifRead = await shell.exec("exiftool -j /input.pdf");
    assert.equal(exifRead.exitCode, 0);
    const exifJson = JSON.parse(exifRead.stdout);
    assert.equal(exifJson[0].Title, "Enterprise PDF Spec");
    assert.equal(exifJson[0].Author, "Poe Platform");

    // 4. Extract text and XHTML bbox via pdftotext
    const txtRes = await shell.exec("pdftotext /input.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /Unified PDF AST Pipeline/);
    assert.match(txtRes.stdout, /Verified/);

    // 5. Render HTML to multi-page PDF via wkhtmltopdf (pdfAstWkhtmltopdfCommands)
    await fs.writeFile(
      "/web.html",
      new TextEncoder().encode(
        "<html><head><title>HTML Report</title></head><body><h1>HTML Heading</h1><p>Rendered via pdf-ast.</p></body></html>"
      )
    );
    const wkRes = await shell.exec("wkhtmltopdf /web.html /web.pdf");
    assert.equal(wkRes.exitCode, 0);

    // 6. Run OCR / text extraction + searchable PDF generation via tesseract on /web.pdf
    const tessRes = await shell.exec("tesseract /web.pdf /ocr-out pdf txt tsv");
    assert.equal(tessRes.exitCode, 0);
    const ocrTxt = new TextDecoder().decode(await fs.readFile("/ocr-out.txt"));
    assert.match(ocrTxt, /HTML Heading/);
    const searchablePdfInfo = await shell.exec("pdfinfo /ocr-out.pdf");
    assert.equal(searchablePdfInfo.exitCode, 0);
    assert.match(searchablePdfInfo.stdout, /Pages:\s+1/);

    // 7. Merge /input.pdf and /web.pdf via qpdf, rotate, and encrypt
    const qpdfMergeRes = await shell.exec("qpdf --empty --pages /input.pdf /web.pdf -- /merged.pdf");
    assert.equal(qpdfMergeRes.exitCode, 0);

    const mergedInfo = await shell.exec("pdfinfo /merged.pdf");
    assert.equal(mergedInfo.exitCode, 0);
    assert.match(mergedInfo.stdout, /Pages:\s+2/);

    const qpdfEncRes = await shell.exec(
      "qpdf --encrypt userpw ownerpw 256 --print=none -- /merged.pdf /encrypted.pdf"
    );
    assert.equal(qpdfEncRes.exitCode, 0);

    const encInfoRes = await shell.exec("pdfinfo -upw userpw /encrypted.pdf");
    assert.equal(encInfoRes.exitCode, 0);
    assert.match(encInfoRes.stdout, /Encrypted:\s+yes \(print:no/);

    // 8. Verify Poppler pdftoppm, pdfunite, pdfseparate, pdftohtml, and libreoffice --cat in Shell
    const uniteRes = await shell.exec("pdfunite /input.pdf /web.pdf /united.pdf");
    assert.equal(uniteRes.exitCode, 0);

    const sepRes = await shell.exec("pdfseparate -f 1 -l 2 /united.pdf /page-%d.pdf");
    assert.equal(sepRes.exitCode, 0);

    const ppmRes = await shell.exec("pdftoppm -png -r 72 -singlefile /page-1.pdf /rendered-p1");
    assert.equal(ppmRes.exitCode, 0);
    const pngBytes = await fs.readFile("/rendered-p1.png");
    assert.equal(pngBytes[0], 137);
    assert.equal(pngBytes[1], 80);

    const htmlRes = await shell.exec("pdftohtml -xml -stdout /page-2.pdf");
    assert.equal(htmlRes.exitCode, 0);
    assert.match(htmlRes.stdout, /<pdf2xml/);
    assert.match(htmlRes.stdout, /HTML Heading/);

    const loCatRes = await shell.exec("libreoffice --cat /page-1.pdf");
    assert.equal(loCatRes.exitCode, 0);
    assert.match(loCatRes.stdout, /Unified PDF AST Pipeline/);
  });
});
