import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { exiftoolCommand } from "./command.js";

const decoder = new TextDecoder();

async function invoke(args: string[], fs = createMemoryFileSystem()) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const res = await exiftoolCommand.execute({
    args,
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(b: Uint8Array) { stdout.push(new Uint8Array(b)); } },
    stderr: { async write(b: Uint8Array) { stderr.push(new Uint8Array(b)); } },
  });
  const join = (arr: Uint8Array[]) => {
    const len = arr.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(len);
    let p = 0;
    for (const c of arr) { out.set(c, p); p += c.byteLength; }
    return decoder.decode(out);
  };
  return { exitCode: res.exitCode, stdout: join(stdout), stderr: join(stderr), fs };
}

test("exiftool reads and writes PDF metadata, PageCount, and JSON via @poe-code/pdf-ast", async () => {
  const doc = PdfDocument.create();
  doc.setTitle("Original Financial Report");
  doc.setAuthor("Risk Team");
  doc.setSubject("Q3 Audit");
  doc.setKeywords(["finance", "audit"]);
  const p1 = doc.addPage({ width: 612, height: 792 });
  p1.drawText("Page 1 Content", { x: 72, y: 700, size: 14 });
  const p2 = doc.addPage({ width: 612, height: 792 });
  p2.drawText("Page 2 Content", { x: 72, y: 700, size: 14 });

  const fs = createMemoryFileSystem();
  await fs.writeFile("/report.pdf", doc.save());

  const g1Res = await invoke(["-G1", "report.pdf"], fs);
  assert.equal(g1Res.exitCode, 0, g1Res.stderr);
  assert.match(g1Res.stdout, /^\[PDF\]\s+Title\s+: Original Financial Report$/m);

  const readRes = await invoke(["-j", "report.pdf"], fs);
  assert.equal(readRes.exitCode, 0, readRes.stderr);
  const parsed = JSON.parse(readRes.stdout);
  assert.equal(parsed[0].Title, "Original Financial Report");
  assert.equal(parsed[0].Author, "Risk Team");
  assert.equal(parsed[0].Subject, "Q3 Audit");
  assert.equal(parsed[0].PageCount, 2);

  const writeRes = await invoke(
    ["-overwrite_original", "-Title=Updated 2026 Audit", "-Author=Compliance Officer", "-Keywords+=verified", "report.pdf"],
    fs
  );
  assert.equal(writeRes.exitCode, 0, writeRes.stderr);
  assert.match(writeRes.stdout, /1 image files updated/);

  const verifyRes = await invoke(["-Title", "-Author", "-Keywords", "-s3", "report.pdf"], fs);
  assert.equal(verifyRes.exitCode, 0, verifyRes.stderr);
  assert.equal(
    verifyRes.stdout,
    "Updated 2026 Audit\nCompliance Officer\nfinance, audit, verified\n"
  );
});
