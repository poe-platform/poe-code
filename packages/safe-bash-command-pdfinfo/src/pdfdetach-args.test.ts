import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPdfdetachCommand, runPdfdetachCli, runPdfdetachCliSync } from "./index.js";

const doc = PdfDocument.create();
doc.addPage([8, 8]);
const pdf = doc.save();

const invalid = [
  ["-bogus", "in.pdf"], ["in.pdf", "-bogus"],
  ["extra.pdf", "in.pdf"], ["in.pdf", "extra.pdf"], ["-", "in.pdf"],
  ...["x", "1x", "1.5", "", "+", "-", " 1", "0x1", "0", "-1", "9007199254740992"].map(value => ["-save", value, "in.pdf"]),
  ...["-save", "-savefile", "-o", "-upw", "-opw", "-enc"].map(flag => ["in.pdf", flag]),
];

for (const args of invalid) {
  it(`rejects invalid pdfdetach arguments ${JSON.stringify(args)} before reading input`, async () => {
    const expected = { exitCode: 99, stdout: "", stderr: args[0] === "-save" && args[1] === "-1" ? "Command Line Error: Invalid file number\n" : "Usage: pdfdetach [options] <PDF-file>\n" };
    const files = new Map([["in.pdf", pdf]]);
    files.get = () => assert.fail("must not read input for invalid arguments");
    files.set = () => assert.fail("must not write output for invalid arguments");
    assert.deepEqual(await runPdfdetachCli(args, files), expected);
    assert.deepEqual(runPdfdetachCliSync(args, files), expected);
    let stdout = "", stderr = "";
    const fs = createMemoryFileSystem();
    fs.mkdir = async () => { assert.fail("must not access storage for invalid arguments"); };
    const result = await createPdfdetachCommand().execute({
      command: "pdfdetach", args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield assert.fail("must not consume stdin"); } },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    assert.deepEqual({ ...result, stdout, stderr }, expected);
  });
}

for (const run of [runPdfdetachCli, runPdfdetachCliSync]) {
  it(`${run.name} preserves valid listing`, async () => {
    assert.deepEqual(await run(["-list", "in.pdf"], new Map([["in.pdf", pdf]])), {
      exitCode: 0, stdout: "0 embedded files\n", stderr: "",
    });
  });
}
