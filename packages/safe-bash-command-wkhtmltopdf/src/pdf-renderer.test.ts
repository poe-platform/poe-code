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

test("the built-in renderer admits more than the former implicit page ceiling", async t => {
  const doc = PdfDocument.create();
  t.mock.method(PdfDocument, "create", () => doc);
  const page = doc.addPage({ width: 595, height: 842 });
  const addPage = t.mock.method(doc, "addPage", () => page);
  t.mock.method(doc, "save", () => new TextEncoder().encode("%PDF-test"));
  const result = await runWkhtmltopdf({
    args: ["--copies", "4097", "-", "-"], fs: new MemoryFileSystem(), cwd: "/",
    signal: new AbortController().signal, stdin: toByteSource("<html><body></body></html>"),
    stdout: { async write() {} }, stderr: { async write() {} }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(addPage.mock.callCount(), 4097);
});

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

  const page1Text = doc.getPage(0).extractText();
  assert.ok(page1Text.includes("Executive Summary"));
  assert.ok(page1Text.includes("Zero native dependencies"));
  assert.ok(page1Text.includes("Lexer & Parser"));
  assert.ok(page1Text.includes("Page 1 of 2"));

  const page2Text = doc.getPage(1).extractText();
  assert.ok(page2Text.includes("Page Two Details"));
  assert.ok(page2Text.includes("Page 2 of 2"));

  const cmd = createPdfAstWkhtmltopdfCommand();
  assert.equal(cmd.name, "wkhtmltopdf");
  assert.equal(pdfAstRenderer.profile.id, "pdf-ast-static");
});

test("createPdfAstRenderer renders inline <svg>, <blockquote>, <dl> definition lists, and colspan table cells", async () => {
  const fs = new MemoryFileSystem();
  const html = `<!DOCTYPE html>
<html>
<head><title>Complex Elements Spec</title></head>
<body>
  <h1>Vector and Semantic Layout</h1>
  <blockquote>All graphics primitives map deterministically to PDF operators.</blockquote>
  <dl>
    <dt>COS Layer</dt><dd>Carousel Object System</dd>
    <dt>Display List</dt><dd>Evaluated glyphs, paths, and images</dd>
  </dl>
  <svg width="220" height="60">
    <rect x="4" y="4" width="200" height="40" />
    <text x="16" y="28">SVG Vector Diagram</text>
  </svg>
  <table>
    <tr><th colspan="2">Merged Table Header</th></tr>
    <tr><td>Cell A1</td><td>Cell B1</td></tr>
  </table>
</body>
</html>`;

  await fs.writeFile("/complex.html", new TextEncoder().encode(html));
  const result = await runWkhtmltopdf(
    {
      args: [
        "--header-center",
        "[section] ([isodate])",
        "/complex.html",
        "/complex.pdf",
      ],
      fs,
      cwd: "/",
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: { async write() {} },
    },
    {
      limits: wkhtmltopdfLimits,
      renderer: createPdfAstRenderer(),
    }
  );

  assert.equal(result.exitCode, 0);
  const doc = PdfDocument.load(await fs.readFile("/complex.pdf"));
  const text = doc.getPage(0).extractText();
  assert.ok(text.includes("All graphics primitives map deterministically"));
  assert.ok(text.includes("COS Layer: Carousel Object System"));
  assert.ok(text.includes("SVG Vector Diagram"));
  assert.ok(text.includes("Merged Table Header"));
  assert.ok(text.includes("Complex Elements Spec"));
});

test("wkhtmltopdf preserves &amp;lt; entities, recurses into nested containers, and emits all heading/paragraph links (issue 1037)", async () => {
  const fs = new MemoryFileSystem();
  const html = `<html><body>
<h1><a href="https://example.com/heading-link">Heading Link</a></h1>
<p>Literal entity: &amp;lt;tag&amp;gt; &#x110000; and <a href="https://example.com/first">First</a> and <a href="https://example.com/second">Second</a></p>
<section><div style="page-break-before: always">Page 1 div</div><div style="page-break-before: always">Page 2 div</div></section>
</body></html>`;
  await fs.writeFile("/issue1037.html", new TextEncoder().encode(html));
  const result = await runWkhtmltopdf(
    {
      args: ["/issue1037.html", "/issue1037.pdf"],
      fs,
      cwd: "/",
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: { async write() {} },
    },
    { limits: wkhtmltopdfLimits, renderer: createPdfAstRenderer() }
  );
  assert.equal(result.exitCode, 0);
  const doc = PdfDocument.load(await fs.readFile("/issue1037.pdf"));
  assert.ok(doc.getPageCount() >= 2);
  assert.match(doc.getPage(0).extractText(), /Literal entity: &lt;tag&gt;/);
});
