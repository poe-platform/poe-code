import assert from "node:assert/strict";
import { test } from "node:test";
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

function createTwoPagePdfBytes(): Uint8Array {
  const pdf = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
5 0 obj
<< /Title (Original Financial Report) /Author (Risk Team) /Subject (Q3 Audit) /Keywords (finance, audit) /Producer (@poe-code/pdf-ast) >>
endobj
xref
0 6
0000000000 65535 f 
trailer
<< /Size 6 /Root 1 0 R /Info 5 0 R >>
startxref
380
%%EOF
`;
  return new TextEncoder().encode(pdf);
}

test("exiftool reads and writes PDF metadata, PageCount, and JSON", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/report.pdf", createTwoPagePdfBytes());

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
