import assert from "node:assert/strict";
import test from "node:test";
import { primaryReference } from "./primary-reference.js";
import { readCases, readErrors, readUsage } from "./cases.js";

for (const entry of readCases) test(`Frozen primary Bash 5.3.0 read: ${entry.name}`, () => {
  const actual = primaryReference("native.test.ts", `${"before" in entry ? entry.before : ""} read ${entry.args}; printf '%s:' "$?"; ${entry.after}`, entry.input);
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from(entry.output));
  assert.deepEqual(actual.stderr, Buffer.from("diagnostic" in entry ? `shell: line 1: ${entry.diagnostic}\n` : ""));
});

for (const entry of readErrors) test(`Frozen primary Bash 5.3.0 read diagnostic: ${entry.args}`, () => {
  const actual = primaryReference("native.test.ts", `read ${entry.args}`, "one\n");
  assert.equal(actual.status, entry.status);
  assert.deepEqual(actual.stdout, Buffer.alloc(0));
  assert.deepEqual(actual.stderr, Buffer.from(`shell: line 1: ${entry.diagnostic}\n${"usage" in entry ? readUsage : ""}`));
});

test("Frozen primary Bash 5.3.0 read readiness preserves names and the unread record", () => {
  const actual = primaryReference("native.test.ts", `value=old; read -t0 bad-name; printf '%s:' "$?"; read -r value; printf '<%s>' "$value"`, "one\n");
  assert.equal(actual.status, 0);
  assert.equal(actual.stdout.toString(), "0:<one>");
  assert.equal(actual.stderr.length, 0);
});

test("Frozen primary Bash 5.3.0 read descriptor alias shares stdin cursor", () => {
  const actual = primaryReference("native.test.ts", `read -u3 first 3<&0; read -r second; printf '<%s><%s>' "$first" "$second"`, "one\ntwo\n");
  assert.equal(actual.status, 0);
  assert.equal(actual.stdout.toString(), "<one><two>");
  assert.equal(actual.stderr.length, 0);
});

test("Frozen primary Bash 5.3.0 read promotes exported scalar to indexed", () => {
  const actual = primaryReference("native.test.ts", `export values=old; read -a values; printf '%s:' "$?"; printf '<%s>' "\${values[@]}"`, "one two\n");
  assert.equal(actual.status, 0);
  assert.equal(actual.stdout.toString(), "0:<one><two>");
  assert.equal(actual.stderr.length, 0);
});

for (const value of ["", "+", "-0.0000001", "1.000000extra"]) test(`Frozen primary Bash 5.3.0 read timeout lexical admission: ${JSON.stringify(value)}`, () => {
  const actual = primaryReference("native.test.ts", `read -t '${value}' value; printf '%s:<%s>' "$?" "\${value-unset}"`, "one\n");
  assert.equal(actual.status, 0);
  assert.equal(actual.stdout.toString(), value === "1.000000extra" ? "0:<one>" : "0:<unset>");
  assert.equal(actual.stderr.length, 0);
});

test("Frozen primary Bash 5.3.0 raw IFS and delimiter retain original byte identity", () => {
  const actual = primaryReference("native.test.ts", `IFS=$'\\xff'; read -ra values <<< $'\\xfe\\xff\\xfd'; printf '<%s>' "\${values[@]}"; read -rd$'\\xff' value <<< $'a\\xffb'; printf '%s' "$value"`);
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from([60, 254, 62, 60, 253, 62, 97]));
  assert.equal(actual.stderr.length, 0);
});

test("Frozen primary Bash 5.3.0 partial timeout assigns partial array and preserves subsequent reads", () => {
  const result = primaryReference("native.test.ts", `read -t .04 -a values; printf '%s:' "$?"; printf '<%s>' "\${values[@]}"; printf '\\n'; read -r tail; printf 'tail=<%s>' "$tail"`, undefined, [
    { fd: 0, method: "write", hex: Buffer.from("one two").toString("hex") },
    { fd: 0, method: "end", hex: Buffer.from("rest\n").toString("hex") },
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from("142:<one><two>\ntail=<rest>"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
});
