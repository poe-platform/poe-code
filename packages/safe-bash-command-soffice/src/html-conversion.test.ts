import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { readZipArchiveEntries, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const mode of ["sync", "async"]) {
  for (const extension of ["html", "htm"]) {
    for (const target of ["txt", "pdf", "docx"]) test(`${extension} to ${target} parses visible document content (${mode})`, async () => {
      const html = '<!doctype html><title>Hidden title</title><style>.x {color:red}</style><h1>Hello &amp; welcome</h1><div><p>A <span>fine</span> day &#33;</p><ul><li>First</li><li>Second</li></ul><table><tr><th>Name</th><th>Value</th></tr><tr><td>Alice</td><td>42</td></tr></table></div><script>hiddenScript()</script>';
      const files = new Map([[`/doc.${extension}`, new TextEncoder().encode(html)]]);
      const args = ["--headless", "--convert-to", target, "--outdir", "/out", `/doc.${extension}`];
      const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      const bytes = files.get(`/out/doc.${target}`)!;
      let text: string;
      if (target === "docx") {
        assert.ok(readZipArchiveEntries(bytes).has("word/document.xml"));
        text = (await runSofficeCli(["--cat", "/out/doc.docx"], files)).stdout;
      } else text = target === "pdf" ? PdfDocument.load(bytes).extractText() : new TextDecoder().decode(bytes);
      for (const expected of ["Hello & welcome", "A fine day !", "First", "Second", "Name", "Alice", "42"]) assert.ok(text.includes(expected), text);
      for (const hidden of ["<h1>", "<span>", "Hidden title", "hiddenScript", "color:red"]) assert.ok(!text.includes(hidden), text);
      if (target === "txt") assert.equal(text, "Hello & welcome\n\nA fine day !\n\nFirst\n\nSecond\n\nName\tValue\nAlice\t42\n");
    });
  }
}
