import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseHtmlBlocks } from "./html.js";
import { runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

test("HTML breaks survive whitespace normalization and inline elements", () => {
  assert.deepEqual(parseHtmlBlocks("<p> Top \n text <br> <b>Bottom</b><br/><br>End </p><h1>A<br>B</h1>").map(block => block.text),
    ["Top text\nBottom\n\nEnd", "A\nB"]);
});

for (const mode of ["sync", "async", "filesystem"]) {
  for (const target of ["cat", "txt", "pdf"]) {
    for (const tag of ["p", "h1"]) test(`HTML ${tag} breaks survive ${target} (${mode})`, async () => {
      const input = new TextEncoder().encode(`<html><body><${tag}>Top<br>Bottom</${tag}></body></html>`);
      const files = new Map([["/break.html", input]]);
      const args = target === "cat" ? ["--cat", "/break.html"] : ["--convert-to", target, "/break.html"];
      let text = "";
      let bytes: Uint8Array | undefined;
      if (mode === "filesystem") {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/break.html", input);
        const result = await runSofficeFileCli(args, { filesystem,
          stdout: { async write(bytes) { text += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } }
        });
        assert.equal(result.exitCode, 0);
        if (target !== "cat") bytes = await filesystem.readFile(`/break.${target}`);
      } else {
        const result = mode === "sync" ? runSofficeCliSync(args, files) : await runSofficeCli(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        text = result.stdout;
        bytes = files.get(`/break.${target}`);
      }
      if (target !== "cat") text = target === "pdf" ? PdfDocument.load(bytes!).extractText() : new TextDecoder().decode(bytes);
      assert.equal(text.trimEnd(), target === "pdf" && tag === "h1" ? "Top\n\nBottom" : "Top\nBottom");
    });
  }
}
