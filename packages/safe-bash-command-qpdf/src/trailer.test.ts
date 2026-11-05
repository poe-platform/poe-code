import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";
import { displayNodeParts } from "./display.js";

for (const fixture of ["compressed-pages", "linearized", "linearized-malformed", "plain"]) {
  for (const flag of [undefined, "--raw-stream-data", "--filtered-stream-data"]) {
    it(`displays the actual ${fixture} trailer dictionary (${flag ?? "display"})`, async () => {
      const document = PdfDocument.create(); document.addPage();
      const input = fixture === "plain" ? document.save() : await readFile(new URL(`./fixtures/${fixture}.pdf`, import.meta.url));
      const trailer = PdfDocument.load(input).cos.revisions[0]!.trailer;
      const expected = Array.from(displayNodeParts(trailer)).join("") + "\n";
      assert.ok(expected.startsWith("<< "));
      assert.ok(expected.includes("/Root "));
      assert.ok(expected.includes("/Size "));
      if (fixture === "compressed-pages") {
        // Native qpdf 12.4.2 reports these XRef dictionary entries.
        for (const entry of ["/Filter /FlateDecode", "/Index [ 0 9 ]", "/Root 2 0 R", "/Size 9", "/Type /XRef", "/Length 38"]) assert.ok(expected.includes(entry));
      }
      const args = ["--show-object=trailer", ...(flag ? [flag] : []), "in.pdf"];
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } });
      assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(stderr).toString(), ""); assert.equal(Buffer.concat(stdout).toString(), expected);
      assert.deepEqual(await fs.readdir("/scratch"), []);
      for (const buffered of [await runQpdfCli(args, new Map([["in.pdf", input]])), runQpdfCliSync(args, new Map([["in.pdf", input]]))]) {
        assert.equal(buffered.exitCode, 0); assert.equal(buffered.stderr, ""); assert.equal(buffered.stdout, expected);
      }
    });
  }
}
