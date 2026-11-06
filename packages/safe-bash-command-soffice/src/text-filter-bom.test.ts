import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { docxDocumentPrefix, docxDocumentSuffix, docxMetadata } from "./docx-parts.js";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const sources = {
  docx: createStoredZipArchive({
    ...Object.fromEntries(Object.entries(docxMetadata).map(([name, text]) => [name, encode(text)])),
    "word/document.xml": encode(docxDocumentPrefix + "<w:p><w:r><w:t>Typography</w:t></w:r></w:p>" + docxDocumentSuffix)
  }),
  html: encode("<p>Typography</p>"),
  htm: encode("<p>Typography</p>"),
  rtf: encode("{\\rtf1 Typography}"),
  txt: encode("Typography\n"),
  md: encode("Typography\n"),
  odt: createStoredZipArchive({ "content.xml": encode('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Typography</text:p></office:text></office:body></office:document-content>') })
};

for (const api of ["sync", "async", "command"]) {
  for (const [extension, bytes] of [...Object.entries(sources), ["txt", encode("\uFEFFTypography\n")] as const]) {
    it(`${api} ${extension} Text filter emits the UTF-8 signature`, async () => {
      const input = `/input.${extension}`;
      const args = ["--headless", "--convert-to", "txt:Text", "--outdir", "/out", input];
      let output: Uint8Array;
      if (api === "command") {
        const fs = new MemoryFileSystem();
        await fs.writeFile(input, bytes);
        const result = await createSofficeCommand().execute({
          command: "soffice", cwd: "/", env: {}, fs, ...createCommandArguments(args),
          signal: new AbortController().signal, stdin: toByteSource(""),
          stdout: { async write() {} },
          stderr: { async write(chunk) { assert.fail(new TextDecoder().decode(chunk)); } }
        });
        assert.equal(result.exitCode, 0);
        output = await fs.readFile("/out/input.txt");
      } else {
        const files = new Map([[input, bytes]]);
        const result = api === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        output = files.get("/out/input.txt")!;
      }
      assert.deepEqual(output, encode("\uFEFFTypography\n"));
    });
  }
}
