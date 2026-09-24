import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { pdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { pdftotextCommands } from "../../src/commands/pdftotext/index.js";
import { qpdfCommands } from "../../src/commands/qpdf/index.js";
import { sofficeCommands, createStoredZipArchive } from "../../src/commands/soffice/index.js";

describe("safe-bash PDF tooling suite (pdfinfo, pdftotext, qpdf, soffice)", () => {
  it("runs soffice -> pdfinfo -> pdftotext -> qpdf pipeline inside virtual Shell", async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs })
      .use(pdfinfoCommands())
      .use(pdftotextCommands())
      .use(qpdfCommands())
      .use(sofficeCommands());

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

    // 3. Extract text and XHTML bbox via pdftotext
    const txtRes = await shell.exec("pdftotext /input.pdf -");
    assert.equal(txtRes.exitCode, 0);
    assert.match(txtRes.stdout, /Unified PDF AST Pipeline/);
    assert.match(txtRes.stdout, /Verified/);

    const bboxRes = await shell.exec("pdftotext -bbox /input.pdf /input.html");
    assert.equal(bboxRes.exitCode, 0);
    const htmlBytes = await fs.readFile("/input.html");
    assert.match(new TextDecoder().decode(htmlBytes), /<word xMin="/);

    // 4. Rotate and encrypt via qpdf, then inspect with pdfinfo -upw
    const qpdfRotRes = await shell.exec("qpdf --rotate=+90:1 /input.pdf /rotated.pdf");
    assert.equal(qpdfRotRes.exitCode, 0);

    const qpdfEncRes = await shell.exec(
      "qpdf --encrypt userpw ownerpw 256 --print=none -- /rotated.pdf /encrypted.pdf"
    );
    assert.equal(qpdfEncRes.exitCode, 0);

    const encInfoRes = await shell.exec("pdfinfo -upw userpw /encrypted.pdf");
    assert.equal(encInfoRes.exitCode, 0);
    assert.match(encInfoRes.stdout, /Encrypted:\s+yes \(print:no/);
    assert.match(encInfoRes.stdout, /Page rot:\s+90/);
  });
});
