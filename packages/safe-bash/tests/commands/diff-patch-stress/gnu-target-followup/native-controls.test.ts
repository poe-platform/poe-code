import assert from "node:assert/strict";
import test from "node:test";
import { cwd } from "../safety/helpers.js";
import { captured } from "./evidence.js";
import { metadataProbes, missingParentProbes, overlapDefaultProbes, overlapProbes } from "./fixtures.js";
import { nativeProbe, type NamespaceEntry } from "./helpers.js";

function expectedNamespace(before: NamespaceEntry[], changes: Readonly<Record<string, string>>, directories: string[] = []): NamespaceEntry[] {
  const entries = new Map(before.map(entry => [entry.path, entry]));
  for (const [path, data] of Object.entries(changes)) entries.set(path, { path, type: "file", hex: Buffer.from(data).toString("hex") });
  for (const path of directories) entries.set(path, { path, type: "directory" });
  return [...entries.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

for (const probe of metadataProbes) test(`pinned native accepts ${probe.id}`, async () => {
  const reference = await nativeProbe(probe);
  assert.deepEqual(reference, captured(probe));
  assert.equal(reference.exitCode, 0);
  assert.equal(reference.stdout, "patching file first\npatching file target\n");
  assert.equal(reference.stderr, "");
  assert.deepEqual(reference.after, expectedNamespace(reference.before, { [`${cwd}/first`]: "new\n", [`${cwd}/target`]: "new\n" }));
});

for (const probe of missingParentProbes) test(`pinned native creates ${probe.id}`, async () => {
  const reference = await nativeProbe(probe);
  assert.deepEqual(reference, captured(probe));
  const target = probe.args.includes("-p0") ? "missing/child" : "child";
  assert.equal(reference.exitCode, 0);
  assert.equal(reference.stdout, `patching file first\npatching file ${target}\n`);
  assert.equal(reference.stderr, "");
  assert.deepEqual(reference.after, expectedNamespace(reference.before, { [`${cwd}/first`]: "new\n", [`${cwd}/${target}`]: "created\n" }, target === "child" ? [] : [`${cwd}/missing`]));
});

for (const probe of [...overlapProbes, ...overlapDefaultProbes]) test(`pinned native conflict, not invalid syntax: ${probe.id}`, async () => {
  const reference = await nativeProbe(probe);
  assert.deepEqual(reference, captured(probe));
  assert.equal(reference.exitCode, 1);
  assert.equal(reference.stdout, "patching file target\nmisordered hunks! output would be garbled\nHunk #2 FAILED at 1.\n1 out of 2 hunks FAILED -- saving rejects to file reject\n");
  assert.equal(reference.stderr, "");
  const reject = probe.id.includes("normal-overlapping") ? "*** /dev/null\n--- /dev/null\n***************\n*** 1\n- old\n--- 1 -----\n+ new\n"
    : "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n";
  assert.deepEqual(reference.after, expectedNamespace(reference.before, { [`${cwd}/target`]: "new\nkeep\nend\n", [`${cwd}/reject`]: reject }));
});
