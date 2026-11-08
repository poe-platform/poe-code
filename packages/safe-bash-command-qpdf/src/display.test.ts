import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosNumber, PdfDocument } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";
import { displayNodeParts } from "./display.js";

// Native qpdf 12.4.2 output for the checked-in fixture.
for (const [object, expected] of [
  ["1", "<< /Count 3 /Kids [ 4 0 R 5 0 R 6 0 R ] /Type /Pages >>\n"],
  ["0", ""],
  ["999", "null\n"],
]) {
  it(`matches native qpdf --show-object=${object} through public command paths`, async () => {
    const input = readFileSync(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
    const args = [`--show-object=${object}`, "/in.pdf"];
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.pdf", input);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stdout).toString(), expected);
    assert.equal(Buffer.concat(stderr).toString(), "");
    assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(input));
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const buffered = await run(args, new Map([["/in.pdf", input]]));
      assert.equal(buffered.exitCode, 0);
      assert.equal(buffered.stdout, expected);
      assert.equal(buffered.stderr, "");
    }
  });
}

it("sorts nested dictionary keys without changing stored entries", () => {
  const nested = cosDict({ z: cosNumber(1), a: cosNumber(2), Z: cosNumber(3), A: cosNumber(4) });
  const node = cosDict({ Z: nested, A: cosArray([nested]) });
  const original = structuredClone(node);
  assert.equal(Array.from(displayNodeParts(node)).join(""), "<< /A [ << /A 4 /Z 3 /a 2 /z 1 >> ] /Z << /A 4 /Z 3 /a 2 /z 1 >> >>");
  assert.deepEqual(node, original);
});

it("preserves UTF-16 string bytes when inspecting the compressed fixture", async () => {
  const input = readFileSync(new URL("./fixtures/compressed-pages.pdf", import.meta.url));
  const args = ["--show-object=3", "/in.pdf"];
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(stderr).toString(), "");
  const outputs = [Buffer.concat(stdout).toString()];
  for (const run of [runQpdfCli, runQpdfCliSync]) {
    const buffered = await run(args, new Map([["/in.pdf", input]]));
    assert.equal(buffered.exitCode, 0);
    assert.equal(buffered.stderr, "");
    outputs.push(buffered.stdout);
  }
  // Native qpdf 12.4.2; check fields independently of dictionary ordering.
  const hex = "feff007000640066002d006c006900620020002800680074007400700073003a002f002f006700690074006800750062002e0063006f006d002f0048006f007000640069006e0067002f007000640066002d006c006900620029";
  for (const output of outputs) {
    for (const key of ["Creator", "Producer"]) assert.ok(output.includes(`/${key} <${hex}>`), output);
    assert.ok(output.includes("/CreationDate (D:20261105002909Z)"));
  }
  assert.deepEqual(await fs.readFile("/in.pdf"), new Uint8Array(input));
});

for (const format of ["literal", "hex"] as const) {
  it(`matches native string escaping for ${format} input syntax`, async () => {
    const doc = PdfDocument.create();
    doc.addPage();
    const ref = doc.cos.allocateObject(cosArray([
      { kind: "string", format, bytes: Uint8Array.from([65, 40, 41, 92, 10, 13, 9, 8, 12]) },
      { kind: "string", format, bytes: Uint8Array.from([0, 1, 31, 127, 128, 255]) },
      { kind: "string", format, bytes: Uint8Array.from([65, 66]) },
      { kind: "string", format, bytes: new Uint8Array() },
    ]));
    const input = doc.save();
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const result = await run([`--show-object=${ref.objectNumber}`, "/in.pdf"], new Map([["/in.pdf", input]]));
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "[ (A\\(\\)\\\\\\n\\r\\t\\b\\f) <00011f7f80ff> (AB) () ]\n");
    }
  });
}
