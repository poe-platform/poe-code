import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdffontsCommand, runPdffontsCli, runPdffontsCliSync } from "./index.js";

const doc = PdfDocument.create();
doc.addPage([8, 8]);
const pdf = doc.save();

const invalid = [
  ["-bogus", "in.pdf"], ["in.pdf", "-bogus"],
  ["extra.pdf", "in.pdf"], ["in.pdf", "extra.pdf"], ["-", "in.pdf"],
  ...["-f", "-l"].flatMap(flag => [
    ...["x", "1x", "1.5", "", "+", "-", " 1", "0x1"].map(value => [flag, value, "in.pdf"]),
    ["in.pdf", flag],
  ]),
  ["in.pdf", "-upw"], ["in.pdf", "-opw"],
];

for (const args of invalid) {
  it(`rejects invalid pdffonts arguments ${JSON.stringify(args)} before reading input`, async () => {
    const expected = { exitCode: 99, stdout: "", stderr: "Usage: pdffonts [options] <PDF-file>\n" };
    const files = new Map([["in.pdf", pdf]]);
    assert.deepEqual(await runPdffontsCli(args, files), expected);
    assert.deepEqual(runPdffontsCliSync(args, files), expected);
    let stdout = "", stderr = "";
    const fs = createMemoryFileSystem();
    fs.mkdir = async () => { assert.fail("must not access storage for invalid arguments"); };
    const result = await createPdffontsCommand().execute({
      command: "pdffonts", args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield assert.fail("must not consume stdin"); } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    assert.deepEqual({ ...result, stdout, stderr }, expected);
  });
}

for (const value of ["1", "+1", "-1", "0"]) {
  it(`accepts signed decimal page arguments ${value}`, async () => {
    const result = await runPdffontsCli(["-f", value, "-l", value, "in.pdf"], new Map([["in.pdf", pdf]]));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("object ID"));
  });
}
