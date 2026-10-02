import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdfuniteCli, runPdfseparateCli } from "./index.js";

it("reports Poppler's damaged-document status and diagnostic for missing unite inputs", async () => {
  const result = await runPdfuniteCli(["missing.pdf", "second.pdf", "out.pdf"], new Map());
  assert.equal(result.exitCode, 255);
  assert.ok(result.stderr.includes("Syntax Error: Could not merge damaged documents ('missing.pdf')"));
});

it("rejects invalid separate page numbers before creating output", async () => {
  const doc = PdfDocument.create();
  doc.addPage();
  for (const value of ["abc", "1.5", "Infinity"]) {
    const files = new Map([["in.pdf", doc.save()]]);
    const result = await runPdfseparateCli(["-f", value, "in.pdf", "out.pdf"], files);
    assert.equal(result.exitCode, 99, value);
    assert.equal(files.has("out.pdf"), false);
  }
});
