import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { directory, hash, root } from "./runner.mjs";

const output = resolve(directory, "author-snapshot.json");
assert.equal(existsSync(output), false, "immutable source capture already exists");
const evidenceBytes = readFileSync(resolve(directory, "../oracle-evidence.json"));
const evidence = JSON.parse(evidenceBytes);
const git = args => {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: root, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
assert.match(evidence.initialHead, /^[0-9a-f]{40}$/u);
assert.equal(git(["cat-file", "-t", evidence.initialHead]).toString().trim(), "commit");
const files = {};
for (const [name, expectedSha256] of Object.entries(evidence.authorFilesSha256)) {
  const path = `tests/commands/metadata/${name}`;
  const specifier = `${evidence.initialHead}:${path}`;
  const bytes = git(["cat-file", "blob", specifier]);
  const blob = git(["rev-parse", specifier]).toString().trim();
  assert.equal(hash(bytes), expectedSha256, name);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), blob, name);
  assert.deepEqual(Buffer.from(bytes.toString(), "utf8"), bytes, "lossless snapshot text");
  files[name] = { path, blob, sha256: expectedSha256, text: bytes.toString() };
}
const snapshot = { capturedAt: new Date().toISOString(), commit: evidence.initialHead, oracleEvidenceSha256: hash(evidenceBytes), method: "git --no-replace-objects cat-file blob <initialHead>:<path>; git --no-replace-objects rev-parse <initialHead>:<path>", files };
const text = `${JSON.stringify(snapshot, null, 2)}\n`;
const result = spawnSync("apply_patch", [], { encoding: "utf8", input: `*** Begin Patch\n*** Add File: ${output}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
assert.equal(result.status, 0, result.stderr);
console.log(JSON.stringify({ output, commit: snapshot.commit, snapshotSha256: hash(readFileSync(output)), oracleEvidenceSha256: snapshot.oracleEvidenceSha256, files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { blob: file.blob, sha256: file.sha256 }])) }, null, 2));
