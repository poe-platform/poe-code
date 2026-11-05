import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runQpdfCli } from "../../safe-bash-command-qpdf/src/index.js";

it("native qpdf confirms --print=low denies high-resolution printing", async () => {
  const out = resolve(import.meta.dirname, "../../../out");
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(resolve(out, "qpdf-print-low-"));
  try {
    const doc = PdfDocument.create();
    doc.addPage();
    const files = new Map([["in.pdf", doc.save()]]);
    const result = await runQpdfCli(["--encrypt", "reader", "owner", "256", "--print=low", "--", "in.pdf", "out.pdf"], files);
    assert.equal(result.exitCode, 0, result.stderr);
    const encryptedPath = resolve(dir, "encrypted.pdf");
    await writeFile(encryptedPath, files.get("out.pdf")!);
    const native = spawnSync("qpdf", ["--password=reader", "--show-encryption", encryptedPath], { encoding: "utf8" });
    assert.equal(native.status, 0, native.error?.message ?? native.stderr);
    const lines = native.stdout.split("\n");
    assert.ok(lines.includes("P = -2052"), native.stdout);
    assert.ok(lines.includes("print low resolution: allowed"), native.stdout);
    assert.ok(lines.includes("print high resolution: not allowed"), native.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
