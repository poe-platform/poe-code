import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

interface Reference {
  oracle: { name: string; executableSHA256: string };
  fixtures: { file: string; sha256: string }[];
  records: {
    name: string;
    args: string[];
    argv0: string | null;
    inputHex: string | null;
    expected: { status: number; stdoutHex: string; stderrHex: string };
  }[];
}

const bytes = readFileSync(new URL("./function-origin-primary-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "343c78bd12023ce290bfae00fada5feaa203848b6ec3b6ec10164b2a48842a41");
const reference = JSON.parse(bytes.toString()) as Reference;
assert.equal(reference.oracle.name, "5.3.0");
assert.equal(reference.oracle.executableSHA256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.records.length, 31);
assert.equal(new Set(reference.records.map(record => record.name)).size, 31);
for (const fixture of reference.fixtures) {
  assert.equal(createHash("sha256").update(readFileSync(new URL(fixture.file, import.meta.url))).digest("hex"), fixture.sha256);
}

export function primaryReference(name: string, script: string, options: { stdin?: boolean; name?: string; argv0?: string } = {}) {
  const record = reference.records.find(entry => entry.name === name);
  assert.ok(record, `Missing primary Bash 5.3 reference: ${name}`);
  assert.deepEqual(record.args, options.stdin ? ["--noprofile", "--norc"] : ["--noprofile", "--norc", "-c", script, options.name ?? "shell"]);
  assert.equal(record.inputHex, options.stdin ? Buffer.from(script).toString("hex") : null);
  assert.equal(record.argv0, options.argv0 ?? null);
  return { status: record.expected.status, stdout: Buffer.from(record.expected.stdoutHex, "hex"), stderr: Buffer.from(record.expected.stderrHex, "hex") };
}
