import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = JSON.parse(fs.readFileSync(path.join(own, "SEAL.json"), "utf8"));
const gitBlob = (commit, relative) => {
  const result = spawnSync("git", ["show", `${commit}:${relative}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
for (const [relative, expected] of Object.entries(seal.artifacts)) {
  assert.equal(digest(fs.readFileSync(path.join(own, relative))), expected, relative);
}
for (const [relative, expected] of Object.entries(seal.parentArtifacts)) {
  const filename = path.resolve(own, "..", relative);
  assert.equal(digest(fs.readFileSync(filename)), expected, relative);
  assert.equal(digest(gitBlob(seal.packetCommit, path.relative(repository, filename))), expected, relative);
}
const binding = JSON.parse(fs.readFileSync(path.resolve(own, "../BINDING.json"), "utf8"));
for (const source of binding.sources) {
  assert.equal(digest(gitBlob(source.commit, source.path)), source.sha256, source.path);
}
assert.deepEqual(seal.ratified, ["R1", "R2", "R3", "R4"]);
assert.equal(seal.implementationAuthorized, false);
assert.equal(seal.runtimeWindow, "released for LET first");
assert.equal(seal.futureLetComposition, null);
console.log(JSON.stringify({
  verified: true,
  role: "ratified design and immutable prerequisites only",
  pinnedSourceBlobs: binding.sources.length,
  parentArtifacts: Object.keys(seal.parentArtifacts).length,
  ratified: seal.ratified,
  runtimeWindow: seal.runtimeWindow,
  liveSourceCompared: false,
  productOrNativeExecuted: false,
  implementationAuthorized: false,
  futureLetComposition: null,
  originalComparisons: "0/34 unchanged",
  topologyNativeOnly: 4,
  additionalNativeOnly: 8,
}));
