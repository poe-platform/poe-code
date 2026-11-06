import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { docxDocumentPrefix, docxDocumentSuffix, docxMetadata } from "./docx-parts.js";
import { createSofficeCommand, createStoredZipArchive } from "./index.js";

for (const text of ["Hello Tokyo 東京 and café.", "A東京B café ? € — 𠮷"])
for (const location of ["paragraph", "heading", "table"]) test(`DOCX PDF preserves mixed CJK and WinAnsi text in ${location}: ${text}`, async () => {
  const paragraph = `<w:p>${location === "heading" ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const encode = (value: string) => new TextEncoder().encode(value);
  const input = createStoredZipArchive({
    ...Object.fromEntries(Object.entries(docxMetadata).map(([name, value]) => [name, encode(value)])),
    "word/document.xml": encode(docxDocumentPrefix + (location === "table" ? `<w:tbl><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>` : paragraph) + docxDocumentSuffix)
  });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.docx", input);
  const result = await createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs,
    ...createCommandArguments(["--headless", "--convert-to", "pdf", "/input.docx"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(PdfDocument.load(await fs.readFile("/input.pdf")).extractText().trim(), text);
});
