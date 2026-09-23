import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {verifyArtifact} from "./verify.mjs";

const repository = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("sources.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../../src/rendering/print/harfbuzz/data.ts", import.meta.url), "utf8");
const files = new Map(manifest.inputs.map(input => [input.path, readFileSync(new URL(input.path, repository))]));
const verify = (changes = {}) => verifyArtifact({source, manifest, files, ...changes});

test("authenticates the portable artifact and its build inputs", () => {
  const result = verify();
  assert.equal(result.byteLength, 553970);
  assert.equal(result.initialMemoryBytes, 262144);
  assert.equal(result.maximumMemoryBytes, 2147483648);
});

test("refuses executable or ambiguous generated source", () => {
  assert.throws(() => verify({source: source + "\nthrow new Error('injected');\n"}), /single exported string/);
  assert.throws(() => verify({source: source.replace('= "', '= String("').replace('";\n', '");\n')}), /string literal/);
});

test("refuses malformed base64 and changed binary bytes", () => {
  assert.throws(() => verify({source: source.replace('= "', '= "!')}), /base64/);
  const corrupt = source.replace('AGFzbQ', 'BGFzbQ');
  assert.notEqual(corrupt, source);
  assert.throws(() => verify({source: corrupt}), /digest/);
});

test("refuses a changed import or an unexpected export", () => {
  const changedImport = structuredClone(manifest);
  changedImport.artifact.imports[0].name = "fd_write";
  assert.throws(() => verify({manifest: changedImport}), /imports/);
  const changedExport = structuredClone(manifest);
  changedExport.artifact.exports.push({name: "review_install_fault", kind: "function"});
  assert.throws(() => verify({manifest: changedExport}), /exports/);
});

test("refuses changed memory limits", () => {
  const changed = structuredClone(manifest);
  changed.artifact.maximumMemoryBytes = 65536;
  assert.throws(() => verify({manifest: changed}), /memory/);
});

test("refuses missing or altered source and license bindings", () => {
  for (const entry of manifest.inputs) {
    const changed = new Map(files);
    changed.set(entry.path, Buffer.from("altered"));
    assert.throws(() => verify({files: changed}), /input digest/);
    changed.delete(entry.path);
    assert.throws(() => verify({files: changed}), /missing input/);
  }
});

test("refuses paths outside the owned asset and maintenance directories", () => {
  const changed = structuredClone(manifest);
  changed.inputs[0].path = "../../private";
  assert.throws(() => verify({manifest: changed}), /input path/);
});
