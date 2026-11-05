import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { docxDocumentPrefix, docxDocumentSuffix, docxMetadata } from "./docx-parts.js";
import { createStoredZipArchive, runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const document = createStoredZipArchive({
  ...Object.fromEntries(Object.entries(docxMetadata).map(([name, text]) => [name, encode(text)])),
  "word/document.xml": encode(docxDocumentPrefix + "<w:p><w:r><w:t>One</w:t></w:r></w:p>" + docxDocumentSuffix)
});

for (const api of ["memory", "sync", "filesystem"]) {
  for (const mode of ["txt", "cat", "html"]) {
    for (const extension of ["docx", "rtf"]) it(`${api} ${extension} ${mode} preserves native text BOM bytes`, async () => {
      const input = `/input.${extension}`;
      const bytes = extension === "docx" ? document : encode("{\\rtf1 One}");
      const args = mode === "cat" ? ["--cat", input] : ["--convert-to", mode, "--outdir", "/out", input];
      let output: Uint8Array;
      if (api === "filesystem") {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile(input, bytes);
        const chunks: number[] = [];
        const result = await runSofficeFileCli(args, { filesystem,
          stdout: { async write(chunk) { chunks.push(...chunk); } },
          stderr: { async write(chunk) { assert.fail(new TextDecoder().decode(chunk)); } }
        });
        assert.equal(result.exitCode, 0);
        output = mode === "cat" ? Uint8Array.from(chunks) : await filesystem.readFile(`/out/input.${mode}`);
      } else {
        const files = new Map([[input, bytes]]);
        const result = api === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        output = mode === "cat" ? encode(result.stdout) : files.get(`/out/input.${mode}`)!;
      }
      if (mode === "html") assert.equal(output[0], 60);
      else assert.deepEqual(output, encode((extension === "docx" ? "\uFEFF" : "") + "One\n"));
    });
  }
}
