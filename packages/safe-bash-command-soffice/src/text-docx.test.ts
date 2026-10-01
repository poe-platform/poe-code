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
