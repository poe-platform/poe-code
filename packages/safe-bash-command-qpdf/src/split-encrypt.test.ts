import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));

for (const path of ["buffered", "sync", "retained"]) {
  const group = 2;
  it(`${path}: encrypts every split output for groups of ${group}`, async () => {
    const files = new Map<string, Uint8Array>([["in.pdf", input]]);
    const args = ["in.pdf", `--split-pages=${group}`, "out.pdf", "--encrypt", "reader", "owner", "256", "--"];
    if (path === "retained") {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch");
      await fs.writeFile("/in.pdf", input);
      const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({
        command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() { assert.fail("Unexpected stdout"); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      });
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(errors).toString(), "");
      files.clear();
      for (const entry of await fs.readdir("/")) {
        if (entry.name !== "scratch") files.set(entry.name, await fs.readFile(`/${entry.name}`));
      }
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else {
      const result = await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    const names = [];
    for (let start = 1; start <= 10; start += group) {
      const end = Math.min(10, start + group - 1);
      const range = `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`;
      const name = `out-${range}.pdf`;
      names.push(name);
      const bytes = files.get(name)!;
      assert.throws(() => PdfDocument.load(bytes));
      assert.throws(() => PdfDocument.load(bytes, { password: "wrong" }));
      for (const password of ["reader", "owner"]) {
        assert.equal(PdfDocument.load(bytes, { password }).getPageCount(), end - start + 1);
      }
      assert.deepEqual(await runQpdfCli([name, "--is-encrypted"], files), {
        exitCode: 0, stdout: "", stderr: ""
      });
    }
    assert.deepEqual([...files.keys()].sort(), ["in.pdf", ...names].sort());
    assert.deepEqual(Buffer.from(files.get("in.pdf")!), input);
  });
}

it("does not publish split outputs when encryption exceeds the output budget", async () => {
  const doc = PdfDocument.create(); doc.addPage(); doc.addPage();
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", doc.save());
  const original = new Uint8Array([9]);
  await fs.writeFile("/out-1.pdf", original); await fs.writeFile("/out-2.pdf", original);
  const carrier = createCommandArguments(["in.pdf", "out.pdf", "--split-pages", "--encrypt", "reader", "owner", "256", "--"]);
  await assert.rejects(async () => createQpdfCommand({ limits: { maxOutputBytes: 1000 } }).execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() { assert.fail("Unexpected stdout"); } }, stderr: { async write() {} }
  }), /output byte limit exceeded/i);
  assert.deepEqual(await fs.readFile("/out-1.pdf"), original);
  assert.deepEqual(await fs.readFile("/out-2.pdf"), original);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
