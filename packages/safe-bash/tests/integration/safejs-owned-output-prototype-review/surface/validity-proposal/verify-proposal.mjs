import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../..");
const hash = value => createHash("sha256").update(value).digest("hex");
function readRegular(filename) {
  assert.equal(realpathSync(filename), filename);
  assert.ok(lstatSync(filename).isFile());
  return readFileSync(filename);
}
const sealBytes = readRegular(join(owned, "SEAL.json"));
const seal = JSON.parse(sealBytes);
for (const entry of seal.files) {
  assert.ok(!entry.path.includes("/") && !entry.path.includes(".."));
  const bytes = readRegular(join(owned, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const capture = JSON.parse(readRegular(join(owned, "PROOF.json")));
assert.equal(capture.status, 0);
assert.equal(capture.proof.execution.guests, 0);
for (const binding of capture.proof.bindings) {
  assert.equal(hash(readRegular(join(repository, binding.path))), binding.sha256, binding.path);
}
for (const binding of seal.preservedArtifacts) {
  const committed = execFileSync("/usr/bin/git", ["-C", repository, "show", `${binding.commit}:${binding.path}`], {
    env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, timeout: 20000, maxBuffer: 1048576,
  });
  assert.equal(hash(committed), binding.sha256);
  assert.deepEqual(readRegular(join(repository, binding.path)), committed);
}
const basePath = "tests/integration/safejs-owned-output-prototype-review/surface/execution-v1/child.mjs";
const base = execFileSync("/usr/bin/git", ["-C", repository, "show", `${seal.baseRunnerCommit}:${basePath}`], {
  env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, timeout: 20000, maxBuffer: 1048576,
});
assert.equal(hash(base), seal.baseChildSha256);
const baseLines = base.toString("utf8").trimEnd().split("\n");
const patch = readRegular(join(owned, "observer-only.patch-data")).toString("utf8");
const lines = patch.trimEnd().split("\n");
assert.deepEqual(lines.splice(0, 2), ["--- a/child.mjs", "+++ b/child.mjs"]);
const hunks = [];
const additions = [];
const removals = [];
while (lines.length) {
  const header = lines.shift();
  const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(header);
  assert.ok(match, header);
  const oldLines = [];
  let newCount = 0;
  while (lines.length && !lines[0].startsWith("@@")) {
    const line = lines.shift();
    assert.ok([" ", "+", "-"].includes(line[0]), line);
    if (line[0] !== "+") oldLines.push(line.slice(1));
    if (line[0] !== "-") newCount += 1;
    if (line[0] === "+") additions.push(line.slice(1));
    if (line[0] === "-") removals.push(line.slice(1));
  }
  assert.equal(oldLines.length, Number(match[2]), header);
  assert.equal(newCount, Number(match[4]), header);
  assert.deepEqual(baseLines.slice(Number(match[1]) - 1, Number(match[1]) - 1 + oldLines.length), oldLines);
  hunks.push({ originalStart: Number(match[1]), oldCount: oldLines.length, proposedStart: Number(match[3]), newCount });
}
assert.equal(hunks.length, 2);
assert.deepEqual(removals, ["      const result = await run(actualSource, forwarded);"]);
const addedText = additions.join("\n");
assert.equal((addedText.match(/\brun\(actualSource, forwarded\)/g) ?? []).length, 1);
assert.equal((addedText.match(/\bawait\s/g) ?? []).length, 1);
assert.ok(addedText.includes("result = await pending;"));
assert.ok(addedText.includes("throw reason;"));
assert.ok(!/reason\.|errorInfo\(|record\.engine\s*=|setTimeout|Promise\.|String\(|JSON\./.test(addedText));
const schema = JSON.parse(readRegular(join(owned, "proposed-record.data.json")));
assert.equal(schema.assertionChanges, 0);
assert.equal(schema.guestChanges, 0);
assert.equal(schema.newCount, null);
assert.deepEqual(schema.originalCount, { executed: 8, pass: 7, fail: 1 });
process.stdout.write(JSON.stringify({ status: "STATIC_TEXT_CHECK_ONLY", sealSha256: hash(sealBytes),
  baseChildSha256: hash(base), originalBoundFilesUnchanged: capture.proof.bindings.length,
  hunks, addedLines: additions.length, removedLines: removals.length,
  revisedFileMaterialized: false, patchApplied: false, runtimeImports: 0, guestExecutions: 0,
  originalAssertionChanges: 0, originalGuestChanges: 0, newPassCount: null,
}, null, 2) + "\n");
