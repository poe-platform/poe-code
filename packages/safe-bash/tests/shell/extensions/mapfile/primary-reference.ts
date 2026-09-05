import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

interface Reference {
  schemaVersion: number;
  oracle: { name: string; executableSHA256: string };
  fixtures: { file: string; sha256: string }[];
  records: {
    fixture: string;
    captureIndex: number;
    args: string[];
    argv0: null;
    inputHex: string | null;
    expected: { status: number; stdoutHex: string; stderrHex: string };
  }[];
}

const referenceURL = new URL("./primary-reference.json", import.meta.url);
const stat = lstatSync(referenceURL);
assert.ok(stat.isFile() && stat.size <= 256 * 1024, "Primary reference must be a bounded regular file");
const bytes = readFileSync(referenceURL);
assert.equal(createHash("sha256").update(bytes).digest("hex"), "8b36b77a1a9e1d922dc7c69976c33da779a275251341bc5c8a96a532f48b3e6f");
const reference = JSON.parse(bytes.toString()) as Reference;
assert.equal(reference.schemaVersion, 1);
assert.equal(reference.oracle.name, "5.3.0");
assert.equal(reference.oracle.executableSHA256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.records.length, 170);
assert.equal(new Set(reference.records.map(record => record.captureIndex)).size, 170);
assert.equal(reference.fixtures.length, 7);
for (const fixture of reference.fixtures) {
  const file = new URL(fixture.file, import.meta.url);
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size <= 64 * 1024, "Primary fixture must be a bounded regular file");
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), fixture.sha256);
}

export function primaryReference(fixtureURL: string, script: string, input?: string) {
  const fixture = reference.fixtures.find(entry => new URL(entry.file, import.meta.url).href === fixtureURL);
  assert.ok(fixture, "Unknown primary mapfile fixture");
  const inputHex = input === undefined ? null : Buffer.from(input).toString("hex");
  const record = reference.records.find(entry => entry.fixture === fixture.file && entry.args[3] === script && entry.inputHex === inputHex);
  assert.ok(record, "Missing exact GNU Bash 5.3 mapfile request");
  assert.deepEqual(record.args, ["--noprofile", "--norc", "-c", script, "shell"]);
  assert.equal(record.argv0, null);
  assert.equal(record.inputHex, inputHex);
  return { status: record.expected.status, stdout: Buffer.from(record.expected.stdoutHex, "hex"), stderr: Buffer.from(record.expected.stderrHex, "hex") };
}
