import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createQpdfCommand, iterateQpdfPageRange, parseQpdfPageRange } from "./index.js";

for (const [spec, expected] of [
  ["", []], ["1-z", [1, 2, 3, 4, 5, 6]], ["z-1:even", [5, 3, 1]],
  ["1-z,x2-4", [1, 5, 6]], ["1-3,x2,2", [1, 3, 2]],
  ["1-z,x2-5:even", [1, 2, 4, 6]], ["1-z,2:odd", [1, 3, 5, 2]],
  ["r1-r3", [6, 5, 4]], ["1-z,x3:even", [1, 2, 4, 5, 6]], ["1,1,2", [1, 1, 2]],
] as const) it(`iterates range ${spec} with compatible ordering and exclusions`, () => {
  assert.deepEqual([...iterateQpdfPageRange(spec, 6)], [...expected]);
  assert.deepEqual(parseQpdfPageRange(spec, 6), [...expected]);
});

it("produces a prefix of a huge selection without expanding its pages", () => {
  const range = iterateQpdfPageRange("1-z,x2-100000000:even", 100000000);
  assert.deepEqual([range.next().value, range.next().value, range.next().value], [1, 2, 4]);
  range.return(undefined);
});

for (const spec of ["0", "r0", "7", "1-", "1, x2", "1, ,2", "1-z,2:odd,x1-3", "1:even,2-4"]) it(`preserves invalid range diagnostics for ${spec}`, () => {
  let expected: unknown; try { parseQpdfPageRange(spec, 6); } catch (error) { expected = error; }
  assert.ok(expected instanceof Error);
  assert.throws(() => [...iterateQpdfPageRange(spec, 6)], error => error instanceof Error && error.message === expected.message);
});

for (const [spec, expected] of [
  ["1-4:odd,2", undefined], ["1-4:even,1", undefined],
  ["1-4:odd,x1", undefined], ["1-4:even,x4", undefined],
  ["1-4:odd,", undefined], ["1-4:even,1:odd", undefined],
  ["1-4:odd", [1, 3]], ["1-4:even", [2, 4]],
  ["4-1", [4, 3, 2, 1]], ["1-4,x2", [1, 3, 4]], ["1,1,2", [1, 1, 2]],
] as const) it(`validates page selection before publishing output: ${spec}`, async () => {
  const doc = PdfDocument.create();
  for (let page = 1; page <= 4; page++) doc.addPage([100 + page, 200]);
  const input = doc.save();
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", input);
  for (const existing of [false, true]) {
    if (existing) await fs.writeFile("/out.pdf", input);
    const carrier = createCommandArguments(["--empty", "--pages", "in.pdf", spec, "--", "out.pdf"]);
    const errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({
      command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() { assert.fail("Unexpected stdout"); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } },
    });
    assert.equal(result.exitCode, expected ? 0 : 2, Buffer.concat(errors).toString());
    if (expected) {
      const output = PdfDocument.load(await fs.readFile("/out.pdf"));
      assert.deepEqual(output.getPages().map(page => page.getSize().width), expected.map(page => 100 + page));
    } else {
      assert.ok(Buffer.concat(errors).toString().includes("expected :even or :odd"));
      if (existing) assert.deepEqual(await fs.readFile("/out.pdf"), input);
      else await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
    }
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
  }
});
