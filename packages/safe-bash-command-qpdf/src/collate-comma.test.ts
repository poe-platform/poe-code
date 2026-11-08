import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const groups of ["1,", ",1", ",", "1,1,", ",1,1"]) {
  const sources = ["in.pdf", "in.pdf"];
  const diagnostic = "--collate: trailing comma";
  for (const existing of [false, true]) it(`rejects collate ${groups} for ${sources.length} specifications without publishing output (existing=${existing})`, async () => {
    const doc = PdfDocument.create(); for (let i = 0; i < 3; i++) doc.addPage();
    const input = doc.save(), original = new TextEncoder().encode("existing output");
    const args = ["--empty", `--collate=${groups}`, "--pages", ...sources, "--", "out.pdf"];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map([["in.pdf", input]]);
      if (existing) files.set("out.pdf", original);
      const result = await run(args, files);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, `qpdf: ${diagnostic}\n`);
      assert.equal(result.stdout, "");
      assert.deepEqual(files.get("out.pdf"), existing ? original : undefined);
      assert.deepEqual(files.get("in.pdf"), input);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    if (existing) await fs.writeFile("/out.pdf", original);
    const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 2);
    assert.equal(Buffer.concat(errors).toString(), `qpdf: ${diagnostic}\n`);
    if (existing) assert.deepEqual(await fs.readFile("/out.pdf"), original);
    else await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
