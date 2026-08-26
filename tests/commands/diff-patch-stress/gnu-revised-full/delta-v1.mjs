import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const digest = value => createHash("sha256").update(value).digest("hex");
const prefix = "tests/commands/diff-patch-stress/";
export const changes = [
  {
    file: `${prefix}editflows/quoted-safety.test.ts`,
    names: ["quoted-path security: quoted ancestor symlink"],
    before: `  assert.equal(result.status, 2, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(await fileBytes(filesystem, Object.keys(files)), expectedBytes(files));
  assert.deepEqual(await filesystem.lstat(linkPath), originalLink);`,
    after: `  assert.equal(result.status, name === "quoted ancestor symlink" ? 0 : 2, result.stderr.toString());
  assert.deepEqual(result.stdout, name === "quoted ancestor symlink" ? Buffer.from("patching file first\\npatching file target\\n") : Buffer.alloc(0));
  assert.deepEqual(await fileBytes(filesystem, Object.keys(files)), expectedBytes(name === "quoted ancestor symlink" ? { ...files, first: "new\\n", target: "new\\n" } : files));
  assert.deepEqual(await filesystem.lstat(linkPath), originalLink);`,
  },
  {
    file: `${prefix}fuzz/edits.test.ts`,
    names: ["atomic extension malformed backward-second-hunk is not swallowed after a valid file section"],
    before: `  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(await contents(filesystem, "first"), "keep\\n");`,
    after: `  assert.equal(result.exitCode, name === "backward-second-hunk" ? 1 : 2, result.stderr);
  assert.equal(await contents(filesystem, "first"), "keep\\n");`,
  },
  {
    file: `${prefix}emptyfile-delta/emptyfile.test.ts`,
    names: ["normal", "context", "unified"].flatMap(format => ["-E", "--remove-empty-files"].map(flag => `GNU default: ${format}/${flag}/apply`)),
    before: `  if (prunedParent) delete before["/authorized"];
  assert.deepEqual(after, before, "no decoys, reject files, backup files, or unrelated paths changed");
  if (vector.args.includes("--dry-run") || vector.status !== 0) assert.deepEqual(observed.mutations, []);
  else assert.deepEqual(observed.mutations.map(({ method, path }) => ({ method, path })),
    [{ method: vector.expected === null ? "rm" : "writeFile", path: target(vector) }, ...(prunedParent ? [{ method: "rm", path: "/authorized" }] : [])]);`,
    after: `  if (prunedParent) {
    delete before["/authorized"];
    const root = before["/"];
    assert(root !== null && typeof root === "object" && "nlink" in root && typeof root.nlink === "number");
    root.nlink -= 1;
  }
  assert.deepEqual(after, before, "no decoys, reject files, backup files, or unrelated paths changed");
  if (vector.args.includes("--dry-run") || vector.status !== 0) assert.deepEqual(observed.mutations, []);
  else assert.deepEqual(observed.mutations.map(({ method, path }) => ({ method, path })),
    [{ method: vector.expected === null ? "rm" : "writeFile", path: target(vector) }]);`,
  },
];

export function applyDelta(snapshot, original237, proof) {
  assert.notEqual(realpathSync(snapshot), realpathSync("/Users/kjopek/Workspace/safe-bash"));
  assert.equal(proof.exact.length, 8);
  assert.deepEqual(proof.exact.map(row => row.name).sort(), changes.flatMap(change => change.names).sort());
  const deltaFileSha256 = digest(readFileSync(new URL(import.meta.url)));
  return changes.flatMap(change => {
    const path = join(snapshot, change.file);
    const bytes = readFileSync(path);
    assert.equal(digest(bytes), original237[change.file]);
    const text = bytes.toString();
    assert.equal(text.split(change.before).length, 2, `unique expectation anchor: ${change.file}`);
    const revised = text.replace(change.before, change.after);
    assert.equal(revised.replace(change.after, change.before), text);
    writeFileSync(path, revised);
    return change.names.map(name => ({ name, file: change.file, originalFileSha256: digest(bytes), revisedFileSha256: digest(revised), deltaFileSha256, beforeAssertions: change.before, afterAssertions: change.after, proofRecordSha256: digest(JSON.stringify(proof.exact.find(row => row.name === name))) }));
  });
}
