import assert from "node:assert/strict";
import { test } from "node:test";
import { readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const mode of ["sync", "async"]) test(`plain text DOCX conversion emits an OOXML archive (${mode})`, async () => {
  const files = new Map([["/note.txt", new TextEncoder().encode("Hello LibreOffice\nLine Two\n")]]);
  const args = ["--headless", "--convert-to", "docx", "--outdir", "/", "/note.txt"];
  const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
  assert.equal(result.exitCode, 0);
  const bytes = files.get("/note.docx")!;
  assert.deepEqual([...bytes.subarray(0, 4)], [80, 75, 3, 4]);
  assert.ok(readZipArchiveEntries(bytes).has("word/document.xml"));
  const restored = await runSofficeCli(["--cat", "/note.docx"], files);
  assert.equal(restored.exitCode, 0);
  assert.equal(restored.stderr, "");
  assert.equal(restored.stdout, "Hello LibreOffice\nLine Two\n");
});

for (const run of [runSofficeCliSync, runSofficeCli]) test(`Markdown to DOCX preserves heading and paragraph content (${run.name})`, async () => {
  const files = new Map([["/note.md", new TextEncoder().encode("# Heading\n\nBody text\n")]]);
  const result = await run(["--headless", "--convert-to", "docx", "/note.md"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  const xml = new TextDecoder().decode(readZipArchiveEntries(files.get("/note.docx")!).get("word/document.xml"));
  assert.ok(xml.includes('w:val="Heading1"'), xml);
  const restored = await runSofficeCli(["--cat", "/note.docx"], files);
  assert.equal(restored.stdout, "Heading\nBody text\n");
});

for (const run of [runSofficeCliSync, runSofficeCli]) {
  for (const extension of ["csv", "xlsx"]) test(`${extension} to DOCX preserves a structured table (${run.name})`, async () => {
    const files = new Map([["/data.csv", new TextEncoder().encode('Name,Value\n"Alice & Bob",42\n')]]);
    if (extension === "xlsx") {
      const prepared = await run(["--convert-to", "xlsx", "/data.csv"], files);
      assert.equal(prepared.exitCode, 0, prepared.stderr);
    }
    const result = await run(["--convert-to", "docx", `/data.${extension}`], files);
    assert.equal(result.exitCode, 0, result.stderr);
    const entries = readZipArchiveEntries(files.get("/data.docx")!);
    assert.ok(entries.has("[Content_Types].xml"));
    const xml = new TextDecoder().decode(entries.get("word/document.xml"));
    assert.ok(xml.includes("<w:tbl>"), xml);
    const restored = await run(["--cat", "/data.docx"], files);
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "Name\tValue\nAlice & Bob\t42\n");
  });
}

for (const run of [runSofficeCliSync, runSofficeCli]) {
  for (const extension of ["html", "htm", "txt", "md"]) test(`${extension} round-trips through DOCX to plain text (${run.name})`, async () => {
    const source = extension === "html" || extension === "htm"
      ? "<html><body><h1>Document title</h1><p>Document paragraph</p></body></html>"
      : extension === "md" ? "# Document title\n\nDocument paragraph"
      : "Document title\nDocument paragraph";
    const files = new Map([[`/page.${extension}`, new TextEncoder().encode(source)]]);
    const converted = await run(["--headless", "--convert-to", "docx", `/page.${extension}`], files);
    assert.equal(converted.exitCode, 0, converted.stderr);
    const entries = readZipArchiveEntries(files.get("/page.docx")!);
    assert.ok(entries.has("[Content_Types].xml"));
    assert.ok(entries.has("word/document.xml"));
    const restored = await run(["--headless", "--convert-to", "txt", "--outdir", "/restored", "/page.docx"], files);
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(new TextDecoder().decode(files.get("/restored/page.txt")), "Document title\n\nDocument paragraph\n");
  });
}
