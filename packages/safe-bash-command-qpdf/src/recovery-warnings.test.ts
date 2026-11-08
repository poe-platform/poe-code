import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const fixtures = ["pdfbox-5250-pattern-reduced3.pdf", "pdfbox-5842-reduced.pdf", "pdfjs-issue11549_reduced.pdf", "pdfjs-xobject-image.pdf"];
for (const name of fixtures) for (const check of [false, true]) for (const warningExit0 of [false, true]) {
  it(`reports recovery for ${name}, check=${check}, warningExit0=${warningExit0}`, async () => {
    const input = readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url));
    const args = check ? ["--check", "in.pdf"] : ["in.pdf", "out.pdf"];
    if (warningExit0) args.push("--warning-exit-0");
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map([["in.pdf", input as Uint8Array]]);
      const result = await run(args, files);
      assert.equal(result.exitCode, warningExit0 ? 0 : 3, result.stderr);
      assert.ok(result.stderr.startsWith("WARNING: in.pdf:"));
      assert.ok(result.stderr.endsWith("qpdf: operation succeeded with warnings\n"));
      assert.ok(!result.stdout.includes("No syntax or stream encoding errors"));
      if (name.startsWith("pdfbox")) assert.equal(result.stderr, "WARNING: in.pdf: xref entry for the xref stream itself is missing - a common error handled correctly by qpdf and most other applications\nqpdf: operation succeeded with warnings\n");
      if (name === "pdfjs-issue11549_reduced.pdf") {
        assert.ok(result.stderr.includes("Reported number of objects"));
        assert.ok(result.stderr.includes("dictionary key"));
      }
      if (name === "pdfjs-xobject-image.pdf") assert.ok(result.stderr.includes("Recovered stream length"));
      if (!check) {
        assert.ok(PdfDocument.load(files.get("out.pdf")!).getPageCount() > 0);
        const repaired = await run(["--check", "out.pdf"], files);
        assert.equal(repaired.exitCode, 0, repaired.stderr);
        assert.equal(repaired.stderr, "");
      }
    }
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const stderr: Uint8Array[] = [], stdout: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    assert.equal(result.exitCode, warningExit0 ? 0 : 3, Buffer.concat(stderr).toString());
    assert.ok(Buffer.concat(stderr).toString().startsWith("WARNING: in.pdf:"));
    assert.ok(Buffer.concat(stderr).toString().endsWith("qpdf: operation succeeded with warnings\n"));
    assert.ok(!Buffer.concat(stdout).toString().includes("No syntax or stream encoding errors"));
    if (!check) assert.ok(PdfDocument.load(await fs.readFile("/out.pdf")).getPageCount() > 0);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
