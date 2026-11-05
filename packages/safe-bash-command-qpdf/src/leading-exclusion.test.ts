import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const spec of ["x1-3,4", "x2", "x2:odd"]) {
  for (const existing of [false, true]) it(`rejects leading exclusion ${spec} without publishing output (existing=${existing})`, async () => {
    const doc = PdfDocument.create(); for (let i = 1; i <= 6; i++) doc.addPage([100 + i, 200]);
    const input = doc.save(), original = new TextEncoder().encode("existing output");
    const args = ["--empty", "--pages", "in.pdf", spec, "--", "out.pdf"];
    const diagnostic = `error at * in numeric range *${spec}: first range group may not be an exclusion`;
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

it("preserves valid exclusions after an inclusive range", async () => {
  const doc = PdfDocument.create(); for (let i = 1; i <= 6; i++) doc.addPage([100 + i, 200]);
  const input = doc.save();
  const args = ["--empty", "--pages", "in.pdf", "1-z,x2-4", "--", "out.pdf"];
  for (const run of [runQpdfCli, runQpdfCliSync]) {
    const files = new Map([["in.pdf", input]]);
    assert.equal((await run(args, files)).exitCode, 0);
    assert.deepEqual(PdfDocument.load(files.get("out.pdf")!).getPages().map(page => page.getSize().width), [101, 105, 106]);
  }
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write() { assert.fail("unexpected stderr"); } } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(PdfDocument.load(await fs.readFile("/out.pdf")).getPages().map(page => page.getSize().width), [101, 105, 106]);
});
