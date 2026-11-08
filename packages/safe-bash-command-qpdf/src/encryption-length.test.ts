import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const length of ["40", "128", "0", "invalid", "256junk", undefined]) {
  for (const weak of [false, true]) it(`rejects encryption length ${length} without changing output (allow-weak-crypto=${weak})`, async () => {
    const doc = PdfDocument.create(); doc.addPage();
    const input = doc.save(), original = new TextEncoder().encode("existing output");
    const args = ["in.pdf", "out.pdf", ...(weak ? ["--allow-weak-crypto"] : []), "--encrypt", "reader", "owner", ...(length === undefined ? [] : [length]), "--"];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const files = new Map([["in.pdf", input], ["out.pdf", original]]);
      const result = await run(args, files);
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("only 256-bit encryption is supported"));
      assert.equal(result.stdout, "");
      assert.deepEqual(files.get("out.pdf"), original);
      assert.deepEqual(files.get("in.pdf"), input);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/out.pdf", original);
    const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 2);
    assert.ok(Buffer.concat(errors).toString().includes("only 256-bit encryption is supported"));
    assert.deepEqual(await fs.readFile("/out.pdf"), original);
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}
