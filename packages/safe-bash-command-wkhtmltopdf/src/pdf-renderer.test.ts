import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts/io";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import {
  createPdfAstRenderer,
  createPdfAstWkhtmltopdfCommand,
  pdfAstRenderer,
  runWkhtmltopdf,
  wkhtmltopdfLimits,
} from "./index.js";

test("createPdfAstRenderer converts multi-section HTML with tables, lists, links, images, and furniture into a valid multi-page PDF", async () => {
  const fs = new MemoryFileSystem();
  const samplePng = encodePng({
    width: 16,
    height: 16,
    data: new Uint8Array(16 * 16 * 4).fill(180),
  });
  const b64Png = Buffer.from(samplePng).toString("base64");

  const html = `<!DOCTYPE html>
<html>
<head><title>Architecture Report 2026</title></head>
<body>
  <h1>Executive Summary</h1>
  <p>This report covers the <strong>@poe-code/pdf-ast</strong> unified PDF engine and <a href="https://example.com/spec">specification</a>.</p>
  <ul>
    <li>Zero native dependencies</li>
    <li>Deterministic static layout</li>
  </ul>
  <table>
    <tr><th>Component</th><th>Status</th></tr>
    <tr><td>Lexer &amp; Parser</td><td>Ready</td></tr>
    <tr><td>Rasterizer</td><td>Verified</td></tr>
  </table>
  <pre>const doc = PdfDocument.create();</pre>
  <img src="data:image/png;base64,${b64Png}" width="64" height="64" />
  <div class="page-break"></div>
  <h2>Page Two Details</h2>
  <p>Second page content rendered with headers and footers.</p>
</body>
</html>`;

  await fs.writeFile("/report.html", new TextEncoder().encode(html));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];

  const result = await runWkhtmltopdf(
    {
      args: [
        "--page-size",
        "Letter",
        "--orientation",
        "Portrait",
        "--header-left",
        "[title]",
        "--footer-right",
        "Page [page] of [topage]",
        "--footer-line",
        "/report.html",
        "/report.pdf",
      ],
      fs,
      cwd: "/",
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write(b) { stdout.push(new Uint8Array(b)); } },
      stderr: { async write(b) { stderr.push(new Uint8Array(b)); } },
    },
    {
      limits: wkhtmltopdfLimits,
      renderer: createPdfAstRenderer(),
    }
  );

  assert.equal(result.exitCode, 0);
  const pdfBytes = await fs.readFile("/report.pdf");
  const doc = PdfDocument.load(pdfBytes);
  assert.equal(doc.pageCount, 2);
  assert.equal(doc.getMetadata().title, "Architecture Report 2026");

  const page1Text = doc.extractText(0);
  assert.ok(page1Text.includes("Executive Summary"));
  assert.ok(page1Text.includes("Zero native dependencies"));
  assert.ok(page1Text.includes("Lexer & Parser"));
  assert.ok(page1Text.includes("Page 1 of 2"));

  const page2Text = doc.extractText(1);
  assert.ok(page2Text.includes("Page Two Details"));
  assert.ok(page2Text.includes("Page 2 of 2"));

  const cmd = createPdfAstWkhtmltopdfCommand();
  assert.equal(cmd.name, "wkhtmltopdf");
  assert.equal(pdfAstRenderer.profile.id, "pdf-ast-static");
});
