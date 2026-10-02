import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdfseparateCli } from "./index.js";

function fixture() {
  const doc = PdfDocument.create();
  for (let p = 1; p <= 3; p++) doc.addPage([100 + p, 200]).drawText(`Page ${p}`, { x: 1, y: 2 });
  return doc.save();
}
it("extracts a selected range with zero padding and escaped percent signs", async () => {
  const files = new Map([["in.pdf", fixture()]]);
  assert.equal((await runPdfseparateCli(["-f", "2", "-l", "3", "in.pdf", "%%page-%03d.pdf"], files)).exitCode, 0);
  assert.equal(files.has("%page-001.pdf"), false);
  for (const p of [2, 3]) {
    const page = PdfDocument.load(files.get(`%page-00${p}.pdf`)!);
    assert.equal(page.pageCount, 1); assert.ok(page.extractText().includes(`Page ${p}`));
    assert.equal(page.getPage(0).getSize().width, 100 + p);
  }
});
it("requires a valid integer pattern for multiple pages, permits a literal single-page destination", async () => {
  for (const pattern of ["out.pdf", "out-%s.pdf", "out-%%d.pdf"]) {
    const files = new Map([["in.pdf", fixture()]]);
    assert.equal((await runPdfseparateCli(["in.pdf", pattern], files)).exitCode, 99);
    assert.equal(files.size, 1);
  }
  const files = new Map([["in.pdf", fixture()]]);
  assert.equal((await runPdfseparateCli(["-f", "2", "-l", "2", "in.pdf", "out.pdf"], files)).exitCode, 0);
  assert.ok(PdfDocument.load(files.get("out.pdf")!).extractText().includes("Page 2"));
});
it("bounds output, page count, filename width and cancellation", async () => {
  for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxPages: 1 }, { maxObjects: 1 }]) {
    await assert.rejects(runPdfseparateCli(["in.pdf", "out-%d.pdf"], new Map([["in.pdf", fixture()]]), undefined, { limits }), /limit/i);
  }
  await assert.rejects(runPdfseparateCli(["in.pdf", "out-%999999999d.pdf"], new Map([["in.pdf", fixture()]])), /limit/i);
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(runPdfseparateCli(["in.pdf", "out-%d.pdf"], new Map([["in.pdf", fixture()]]), controller.signal), /cancelled/);
});
