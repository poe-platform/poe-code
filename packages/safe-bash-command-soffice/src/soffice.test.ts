import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createStoredZipArchive, runSofficeCli } from "./index.js";

function buildTestDocx(): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Executive Summary 2026</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Revenue grew by 28% year-over-year across all enterprise segments.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Q3 Revenue</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>North America</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$42.5M</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>EMEA</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>$29.1M</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  return createStoredZipArchive({
    "word/document.xml": new TextEncoder().encode(documentXml)
  });
}

function buildTestXlsx(): Uint8Array {
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Product</t></si>
  <si><t>Notes;Special</t></si>
  <si><t>Enterprise Suite</t></si>
  <si><t>Fast, reliable; "quoted"</t></si>
</sst>`;
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1"><v>2026</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
      <c r="C2"><v>1499.50</v></c>
    </row>
  </sheetData>
</worksheet>`;
  return createStoredZipArchive({
    "xl/sharedStrings.xml": new TextEncoder().encode(sharedStringsXml),
    "xl/worksheets/sheet1.xml": new TextEncoder().encode(sheet1Xml)
  });
}

function buildTestPptx(): Uint8Array {
  const slide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Architecture Overview</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Layer 1: COS Object Graph</a:t></a:r></a:p><a:p><a:r><a:t>Layer 2: Content Stream Display List</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  const slide2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Performance Benchmarks</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Zero native binary dependencies</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  return createStoredZipArchive({
    "ppt/slides/slide1.xml": new TextEncoder().encode(slide1Xml),
    "ppt/slides/slide2.xml": new TextEncoder().encode(slide2Xml)
  });
}

describe("safe-bash-command-soffice", () => {
  it("converts DOCX to styled PDF via writer_pdf_Export and preserves headings, text, and tables", async () => {
    const docxBytes = buildTestDocx();
    const files = new Map<string, Uint8Array>([["/docs/report.docx", docxBytes]]);

    const res = await runSofficeCli(
      ["--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", "/out", "/docs/report.docx"],
      files
    );
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /convert \/docs\/report\.docx -> \/out\/report\.pdf using filter : writer_pdf_Export/);

    const pdfBytes = files.get("/out/report.pdf");
    assert.ok(pdfBytes);
    const pdfDoc = PdfDocument.load(pdfBytes);
    assert.equal(pdfDoc.getPageCount(), 1);
    const text = pdfDoc.extractText();
    assert.match(text, /Executive Summary 2026/);
    assert.match(text, /Revenue grew by 28%/);
    assert.match(text, /North America/);
    assert.match(text, /\$42\.5M/);
  });

  it("converts XLSX to tabular PDF via calc_pdf_Export and to StarCalc CSV with custom separators", async () => {
    const xlsxBytes = buildTestXlsx();
    const files = new Map<string, Uint8Array>([["/sheets/finance.xlsx", xlsxBytes]]);

    const pdfRes = await runSofficeCli(
      ["--headless", "--convert-to", "pdf:calc_pdf_Export", "--outdir", "/out", "/sheets/finance.xlsx"],
      files
    );
    assert.equal(pdfRes.exitCode, 0);
    const pdfDoc = PdfDocument.load(files.get("/out/finance.pdf")!);
    const text = pdfDoc.extractText();
    assert.match(text, /Enterprise Suite/);
    assert.match(text, /1499\.50/);

    // Convert to CSV with StarCalc filter options: 59 (';'), 34 ('"'), 76 (UTF-8), 1
    const csvRes = await runSofficeCli(
      [
        "--headless",
        "--convert-to",
        "csv:Text - txt - csv (StarCalc):59,34,76,1",
        "--outdir",
        "/out",
        "/sheets/finance.xlsx"
      ],
      files
    );
    assert.equal(csvRes.exitCode, 0);
    const csvText = new TextDecoder().decode(files.get("/out/finance.csv")!);
    // "Notes;Special" contains ';' so it must be quoted; "Fast, reliable; "quoted"" has doubled quotes
    assert.match(csvText, /Product;"Notes;Special";2026/);
    assert.match(csvText, /Enterprise Suite;"Fast, reliable; ""quoted""";1499\.50/);
  });

  it("converts PPTX slide decks to multi-page landscape 16:9 PDF via impress_pdf_Export", async () => {
    const pptxBytes = buildTestPptx();
    const files = new Map<string, Uint8Array>([["/slides/deck.pptx", pptxBytes]]);

    const res = await runSofficeCli(
      ["--headless", "--convert-to", "pdf:impress_pdf_Export", "--outdir", "/out", "/slides/deck.pptx"],
      files
    );
    assert.equal(res.exitCode, 0);
    const pdfDoc = PdfDocument.load(files.get("/out/deck.pdf")!);
    assert.equal(pdfDoc.getPageCount(), 2);
    // Landscape widescreen 720x405
    assert.equal(pdfDoc.getPage(0).width, 720);
    assert.equal(pdfDoc.getPage(0).height, 405);
    assert.match(pdfDoc.getPage(0).extractText(), /Architecture Overview/);
    assert.match(pdfDoc.getPage(1).extractText(), /Performance Benchmarks/);
  });

  it("converts PDF and DOCX to TXT and HTML", async () => {
    const docxBytes = buildTestDocx();
    const files = new Map<string, Uint8Array>([["/docs/report.docx", docxBytes]]);
    await runSofficeCli(
      ["--headless", "--convert-to", "pdf", "--outdir", "/out", "/docs/report.docx"],
      files
    );

    const txtRes = await runSofficeCli(
      ["--headless", "--convert-to", "txt", "--outdir", "/out", "/out/report.pdf"],
      files
    );
    assert.equal(txtRes.exitCode, 0);
    const txt = new TextDecoder().decode(files.get("/out/report.txt")!);
    assert.match(txt, /Executive Summary 2026/);

    const htmlRes = await runSofficeCli(
      ["--headless", "--convert-to", "html", "--outdir", "/out", "/docs/report.docx"],
      files
    );
    assert.equal(htmlRes.exitCode, 0);
    const html = new TextDecoder().decode(files.get("/out/report.html")!);
    assert.match(html, /<h1>Executive Summary 2026<\/h1>/);
    assert.match(html, /<table>/);
  });
});
