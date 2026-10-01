import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftohtmlCli } from "./index.js";

for (const mode of [[], ["-xml"]]) {
  for (const output of [["sub/report.html"], ["-"], ["-stdout"]]) {
    it(`places HTML images alongside output: ${[...mode, ...output].join(" ")}`, async () => {
      const doc = PdfDocument.create();
      const page = doc.addPage([8, 8]);
      page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
      const files = new Map([["in.pdf", doc.save()]]);
      const result = await runPdftohtmlCli([...mode, "in.pdf", ...output], files);
      assert.equal(result.exitCode, 0, result.stderr);
      if (output[0] === "sub/report.html") {
        assert.ok(files.has("sub/page1_1.png"));
        assert.ok(new TextDecoder().decode(files.get("sub/report.html")).includes('src="page1_1.png"'));
      } else {
        assert.deepEqual([...files.keys()], ["in.pdf"]);
        assert.ok(result.stdout.includes("<image") || result.stdout.includes("<img"));
      }
      assert.equal(files.has("page1_1.png"), false);
    });
  }
}
