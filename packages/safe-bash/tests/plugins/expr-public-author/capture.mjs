import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [output, finalDirectory, firstDirectory, secondDirectory] = process.argv.slice(2);
assert.ok(output && finalDirectory && firstDirectory && secondDirectory, "new output and three preserved run directories required");
const digest = bytes => createHash("sha256").update(bytes).digest("hex"), entries = [];
for (const [name, directory] of [["final", finalDirectory], ["initial", firstDirectory], ["synchronous-receipt-attempt", secondDirectory]]) {
  for (const filename of [...readdirSync(directory).filter(path => path.endsWith(".json")).sort(), "permissions-0/current-consumer-permission-admission.json", "permissions-1/current-consumer-permission-admission.json"]) {
    const path = join(directory, filename), bytes = readFileSync(path);
    entries.push({ name: `${name}/${filename}`, source: resolve(path), bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") });
  }
}
const final = JSON.parse(readFileSync(join(finalDirectory, "REPORT.json")));
assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
const payload = Buffer.from(JSON.stringify({ schema: 1, entries }) + "\n"), compressed = gzipSync(payload, { level: 9 });
mkdirSync(output);
writeFileSync(join(output, "RAW.json.gz.base64"), compressed.toString("base64") + "\n", { flag: "wx" });
writeFileSync(join(output, "MANIFEST.json"), JSON.stringify({ schema: 1, candidate: final.candidate, tree: final.tree, package: { metadataSha256: final.package.metadataSha256, tarballSha256: final.package.tarballSha256 }, payloadBytes: payload.length, payloadSha256: digest(payload), compressedSha256: digest(compressed), entries: entries.map(({ base64: _bytes, ...entry }) => entry) }, null, 2) + "\n", { flag: "wx" });
const before = JSON.parse(readFileSync(new URL("./PRE-WIRING.json", import.meta.url)));
const packageFiles = Object.fromEntries(final.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256]));
const handoff = {
  schema: 1, scope: "author expr76 integration; independent26 and whole gate remain unexecuted by this handoff",
  candidateCommit: final.candidate, candidateTree: final.tree,
  integrationSourceCommit: "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e",
  independentFreeze: before.freezeCommit, preWiringCommit: before.beforeCommit,
  baselineDU75: before.du75Commit, acceptedEngineCommit: before.acceptedEngineCommit,
  sourceInventory: final.inputs, engineBindings: before.engineBindings,
  declared76Inventory: { names: before.names76, baseline75Names: before.names75, getoptsBuiltinExcluded: true, optional: ["curl", "safejs"] },
  package: { metadataSha256: final.package.metadataSha256, tarballSha256: final.package.tarballSha256, authorTarballLocation: final.package.tarball },
  packageFiles, emittedFiles: Object.fromEntries(final.emittedBefore.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])),
  sourcePathsAndPolicy: { path: "tests/plugins/expr-public-author/POLICY.md", sha256: digest(readFileSync(new URL("./POLICY.md", import.meta.url))) },
  observerBindings: ["observer.mjs", "public.mjs", "silent-worker.mjs", "worker-layout-control.mjs", "verify-public.mjs"].map(name => ({ path: `tests/plugins/expr-public-author/${name}`, sha256: final.inputs.find(entry => entry.path === `tests/plugins/expr-public-author/${name}`).sha256 })),
  runtimeIdentities: final.runtimes.map(runtime => ({ executable: runtime.executable, sha256: runtime.sha256, version: runtime.identity.version, permissionFlag: runtime.flag })),
  checks: { source: final.sourceCounts, commandOutcomes: final.commands.length, supervisor: final.checks.length, authorPublicCasesPerContext: 12, installedAndMovedRuntimeContexts: 4, independentRuntimeCases: null },
  sourceScopeQualification: "The full package includes separately authored private shell/cancellation.ts differing from DU75; not approved by this integration and not loaded in recorded public contexts. Nine expr/shared-regex TS sources remain accepted c3 bytes.",
};
writeFileSync(join(output, "REVIEW-HANDOFF.json"), JSON.stringify(handoff, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, candidate: final.candidate, entries: entries.length, payloadBytes: payload.length, compressedBytes: compressed.length }));
