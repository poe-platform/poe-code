import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { docxDocumentPrefix, docxDocumentSuffix, docxMetadata } from "./docx-parts.js";
import { createStoredZipArchive, runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

for (const paragraphs of [["One", "Two"], ["One", "Two", "Three"], ["One\n\ncontinued", "Two"]]) {
  for (const api of ["memory", "sync", "filesystem"]) it(`exports DOCX paragraphs on consecutive TXT lines (${api}, ${JSON.stringify(paragraphs)})`, async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const document = createStoredZipArchive({
      ...Object.fromEntries(Object.entries(docxMetadata).map(([name, text]) => [name, encode(text)])),
      "word/document.xml": encode(docxDocumentPrefix + paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join("") + docxDocumentSuffix)
    });
    const args = ["--headless", "--convert-to", "txt", "--outdir", "/out", "/input.docx"];
    let output: Uint8Array | undefined;
    if (api !== "filesystem") {
      const files = new Map([["/input.docx", document]]);
      const result = api === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      output = files.get("/out/input.txt");
    } else {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/input.docx", document);
      const result = await runSofficeFileCli(args, { filesystem, stdout: { async write() {} }, stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } } });
      assert.equal(result.exitCode, 0);
      output = await filesystem.readFile("/out/input.txt");
    }
    assert.ok(output);
    assert.equal(new TextDecoder().decode(output), paragraphs.join("\n") + "\n");
  });
}
