import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owned = dirname(fileURLToPath(import.meta.url));
const final = JSON.parse(readFileSync(join(owned, "attempts/r2/proof.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(final.status, "QUALIFIED_ACCEPT_ASSEMBLY_ONLY");
const attempts = ["r0", "r1", "r2"].map(name => {
  const proof = JSON.parse(readFileSync(join(owned, "attempts", name, "proof.json")));
  const before = JSON.parse(readFileSync(join(owned, "attempts", name, "private-before.json")));
  const after = JSON.parse(readFileSync(join(owned, "attempts", name, "private-after.json")));
  const children = JSON.parse(readFileSync(join(owned, "attempts", name, "children.json")));
  assert.deepEqual(before.private, after.private);
  assert.equal(hash(JSON.stringify(after.private)), final.privateClosure.privateStateSha256);
  assert.ok(children.every(child => child.status === 0 && child.signal === null && child.error === null && child.reaped));
  if (name !== "r2") assert.equal(existsSync(proof.scratch), false);
  return { name, status: proof.status, before: before.at, after: after.at, privateUnchanged: true, settledChildren: children.length, failedScratchAbsent: name === "r2" ? null : true };
});
function inventory(root) {
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) visit(path);
      else {
        assert.ok(stat.isFile());
        entries.push({ path: relative(root, path), bytes: stat.size, sha256: hash(readFileSync(path)) });
      }
    }
  }
  assert.equal(realpathSync(root), root);
  visit(root);
  return entries.sort((left, right) => left.path < right.path ? -1 : 1);
}
const actualRoute = inventory(final.routes.sourceRoute);
assert.deepEqual(actualRoute, final.routes.candidateFiles);
assert.deepEqual(inventory(final.routes.packagedRoute), actualRoute);
for (const comparison of final.retainedComparisons) {
  const actual = inventory(comparison.root);
  assert.equal(hash(JSON.stringify(actual)), comparison.actualManifestSha256);
}
const cleanExpected = final.baseline.choices.filter(entry => !entry.path.startsWith("tests/")).map(entry => ({ path: entry.path, sha256: entry.cleanSha256FreshlyComputed })).sort((left, right) => left.path < right.path ? -1 : 1);
const committedBase = inventory(join(final.retainedBefore.root, "committed-base"));
assert.deepEqual(committedBase.map(({ path, sha256 }) => ({ path, sha256 })), cleanExpected);
const frozen = JSON.parse(readFileSync(join(repository, "tests/shell-stress/first-read-contract-review/evidence/freeze.json")));
for (const line of frozen.status.split("\n").filter(line => line.startsWith("1 "))) {
  const fields = line.split(" ");
  const entry = final.baseline.choices.find(choice => choice.path === fields.slice(8).join(" "));
  assert.equal(entry.cleanGitBlob, fields[6]);
  assert.ok(entry.differsFromCleanGit);
}
const tested = JSON.parse(readFileSync(join(repository, "tests/shell-stress/first-read-contract-review/owned-output-streaming-prototype/tested-manifest.json")));
const compilerTools = tested.tools.compiler.map(entry => {
  const actualPath = join(final.scratch, relative(repository, entry.path));
  assert.equal(hash(readFileSync(actualPath)), entry.sha256);
  return { ...entry, actualPath, matched: true };
});
assert.equal(hash(readFileSync(process.execPath)), tested.tools.node.sha256);
for (const entry of final.artifacts) assert.equal(hash(readFileSync(join(repository, entry.path))), entry.sha256, entry.path);
const publicBefore = JSON.parse(readFileSync(join(owned, "attempts/r2/private-before.json")));
const publicAfter = JSON.parse(readFileSync(join(owned, "attempts/r2/private-after.json")));
const publicChanges = Object.keys({ ...publicBefore.publicSource, ...publicAfter.publicSource }).sort().filter(path => JSON.stringify(publicBefore.publicSource[path]) !== JSON.stringify(publicAfter.publicSource[path])).map(path => ({ path: "src/" + path, before: publicBefore.publicSource[path] ?? null, after: publicAfter.publicSource[path] ?? null, includedInCandidate: false }));
const result = {
  at: new Date().toISOString(), attempts, independentResultAssertions: "PASS", actualSourceRouteFiles: actualRoute.length,
  actualPackagedRouteFiles: actualRoute.length, committedBaseFilesIndependentlyMatched: committedBase.length,
  freshCleanGitBlobBindingsMatchedRecordedDirtyStatus: true, authorCompilerTools: compilerTools,
  node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), matchesAuthorNode: true },
  artifactCommitPathBindings: final.artifacts.length, uniqueArtifactPaths: new Set(final.artifacts.map(entry => entry.path)).size,
  currentArtifactBytesAllStillMatchFrozenBindings: true, publicChanges,
  currentWholeGateOrGuestRuntimeAcceptance: false,
};
writeFileSync(join(owned, "verification.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ result: "PASS", attempts: attempts.length, routeFiles: actualRoute.length, committedBaseFiles: committedBase.length, compilerTools: compilerTools.length, publicForeignChanges: publicChanges.map(entry => entry.path) }));
