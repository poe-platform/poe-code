import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(join(directory, path), "utf8"));
const manifest = await json("MANIFEST.json");
assert.equal(manifest.decision, "HOLD");
assert.equal(manifest.sourceCandidate, "38cb670acf0826467e928ea30cdcb0524436d144");
for (const artifact of manifest.artifacts) {
  const bytes = await readFile(join(directory, artifact.path));
  assert.equal(hash(bytes), artifact.sha256, artifact.path);
  assert.equal(bytes.length, artifact.bytes, artifact.path);
}
for (const artifact of manifest.preparation) assert.equal(hash(await readFile(join(directory, "..", artifact.path))), artifact.sha256, "Original preparation changed");
const before = await json("postfix/postfix-auth-before.json");
const after = await json("postfix/postfix-auth-final.json");
for (const key of ["sourceDigest", "gitInventorySha256", "dependencyInventorySha256"]) assert.equal(before[key], after[key]);
assert.equal(before.archive.sha256, after.archive.sha256);
assert.equal(before.verifiedGitBlobs, 25490);
assert.equal(before.sourceDigest, "06a48bca73584c719bad2fa5db1e447e87c63f900e5dc715c80244701d125a75");
for (const [path, status] of Object.entries(manifest.commandStatuses)) {
  const record = await json(`postfix/${path}`);
  assert.equal(record.status, status, path);
  assert.equal(record.termination, null, "Forced retirement cannot be a product pass");
  assert.equal(record.spawnError, null);
  assert.equal(record.signal, null);
}
const stress = await json("postfix/postfix-stress.json");
assert.equal(stress.counts.topLevelRecipes, 40);
assert.equal(stress.counts.topLevelPass, 37);
assert.equal(stress.counts.topLevelFail, 3);
assert.equal(stress.counts.topLevelUnexecuted, 0);
assert.equal(stress.counts.executedVariants, 88);
assert.equal(stress.counts.originalRecipeVariants, 84);
assert.equal(stress.counts.supplementalVariants, 4);
assert.equal(stress.counts.variantPass, 85);
assert.equal(stress.counts.variantFail, 3);
assert.deepEqual(stress.unhandledRejections, []);
assert.deepEqual(stress.cases.filter((record) => record.verdict === "fail").map((record) => `${record.recipe}/${record.variant}`), ["N01/literal", "N03/two-delimiters", "S38/known-root-hidden-external-stdin-return-boundary"]);
assert.equal(stress.expectationsSha256, hash(await readFile(join(directory, "expectations.json"))));
assert.equal(stress.harnessSha256, hash(await readFile(join(directory, "stress.mjs"))));
assert.equal(stress.safetySha256, hash(await readFile(join(directory, "safety.mjs"))));
const profiles = {};
for (const record of stress.cases) for (const comparison of record.nativeComparisons ?? []) {
  profiles[comparison.profile] ??= { total: 0, exact: 0, different: 0 };
  const profile = profiles[comparison.profile]; profile.total++;
  if (comparison.statusEqual && comparison.stdoutEqual && comparison.stderrEqual) profile.exact++; else profile.different++;
}
assert.deepEqual(profiles, { "bsd-darwin": { total: 44, exact: 12, different: 32 }, "util-linux-2.41.2-darwin": { total: 44, exact: 18, different: 26 } });
const packed = await json("postfix/packed-runtime.json");
assert.equal(packed.passed, 5); assert.equal(packed.failed, 1);
assert.equal(packed.artifactUnchangedDuringExecution, true);
assert.equal(packed.results.find((record) => record.verdict === "fail").name, "external-hidden-return-root-boundary-remains-blocking");
assert.deepEqual(packed.results.find((record) => record.verdict === "fail").beforeRelease, { settled: true, disposed: true, returns: 1 });
assert.deepEqual(packed.results.find((record) => record.name === "owned-vfs-cancellation-awaits-return-and-dispose").beforeRelease, { settled: false, disposed: false, returns: 1 });
assert.equal(packed.packageInventorySha256, hash(JSON.stringify(packed.packageInventory)));
const trace = await json("postfix/packed-types-strict-trace-command.json");
const text = Buffer.from(trace.stdoutHex, "hex").toString();
assert(text.includes("Module name 'virtual-bash' was successfully resolved to '/private/tmp/safe-bash-column-verify-yttMz8/moved/node_modules/virtual-bash/dist/index.d.ts'"));
assert(text.includes("Module name './node_modules/virtual-bash/dist/commands/column/index.js' was successfully resolved to '/private/tmp/safe-bash-column-verify-yttMz8/moved/node_modules/virtual-bash/dist/commands/column/index.d.ts'"));
const root = await json("postfix/root-repro.json");
assert.equal(root.acceptance, "HOLD");
assert.deepEqual(root.beforeGateRelease, { returns: 1, execSettled: true, disposeSettled: true });
console.log(JSON.stringify({ staticEvidenceValidation: "passed", productDecision: "HOLD", sourceCandidate: manifest.sourceCandidate, recipePartition: { passing: 37, documentedNativeProfileAssertionsStillFailing: 2, rootBlocked: 1 }, packedPartition: { pass: 5, rootBlocked: 1 }, nativeProfiles: profiles, noProductExecution: true }, null, 2));
