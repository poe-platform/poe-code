import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

assert.equal(process.argv.length, 2, "Read-only preparation inspection only; no execution arguments");
assert.equal(process.cwd(), "/Users/kjopek/Workspace/safe-bash");
const provenance = "tests/integration/safejs-owned-output-prototype-review/provenance";
const preparationCommit = "f666ad8c76ea4362b093ee52e3e7e3b5c3702916";
const git = (...args) => execFileSync("/usr/bin/git", args, {
  env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, maxBuffer: 32 * 1024 * 1024, timeout: 20000,
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const load = filename => JSON.parse(readFileSync(filename, "utf8"));
const assembly = load(`${provenance}/assembly.json`);
const before = load(`${provenance}/snapshot-before.json`);
const prepared = assembly.task;
function record(filename, name = filename) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.equal(realpathSync(filename), resolve(filename), filename);
  return { path: name, bytes: stat.size, sha256: sha(readFileSync(filename)) };
}
function inventory(root) {
  const entries = [];
  function visit(directory) {
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, filename);
      if (stat.isDirectory()) visit(filename);
      else entries.push(record(filename, relative(root, filename)));
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const candidate = inventory(assembly.candidate);
assert.deepEqual(candidate, assembly.candidateFiles);
const sources = candidate.filter(entry => entry.path.startsWith("src/"));
const compiled = candidate.filter(entry => entry.path.startsWith("dist/"));
assert.equal(sources.length, 213);
assert.equal(compiled.length, 708);
assert.equal(sha(JSON.stringify(sources)), "6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea");
assert.equal(sha(JSON.stringify(compiled)), assembly.compiledManifestSha256);
const engine = inventory(join(prepared, "engine"));
const expectedEngine = Object.entries(before.private.engine).map(([filename, entry]) => ({ path: filename, bytes: entry.bytes, sha256: entry.sha256 }))
  .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
assert.deepEqual(engine, expectedEngine);
assert.equal(engine.length, 264);
const installedRoot = join(prepared, "consumer/node_modules/virtual-bash");
const installed = inventory(installedRoot);
for (const entry of installed) {
  const expected = candidate.find(item => item.path === entry.path);
  assert.ok(expected, entry.path);
  assert.deepEqual(entry, expected);
}
const tooling = assembly.tooling.map(tool => {
  const entries = inventory(join(prepared, "node_modules", tool.name));
  assert.deepEqual(entries, tool.files);
  return { name: tool.name, version: tool.package, regularFiles: entries.length, inventorySha256: sha(JSON.stringify(entries)) };
});
const receipts = [
  ...["SEAL.json", "assembly.json", "build-proof.json", "snapshot-before.json", "snapshot-after.json", "PROVENANCE.md"]
    .map(filename => [preparationCommit, `${provenance}/${filename}`]),
  ...["owned-output-streaming-prototype/CONTRACT.md", "owned-output-qualified-prototype/CONTRACT.md", "owned-output-qualified-review/ordering-replay-q1/REPORT.md"]
    .map(filename => ["e57b5aa16f749b6fac558877dff0712e64df05a8", `tests/shell-stress/first-read-contract-review/${filename}`]),
].map(([commit, filename]) => {
  const entry = record(filename);
  assert.equal(sha(git("show", `${commit}:${filename}`)), entry.sha256, filename);
  return { ...entry, commit, gitBlob: git("rev-parse", `${commit}:${filename}`).toString().trim() };
});
const inspected = [
  "package.json", "src/index.ts", "src/contracts/index.ts", "src/contracts/command.ts", "src/contracts/command.md", "src/contracts/io.ts", "src/contracts/output.ts",
  "src/commands/index.ts", "src/commands/safejs/index.ts", "src/commands/safejs/io.ts", "src/commands/safejs/options.ts", "src/commands/safejs/types.ts",
  "src/integrations/safejs/index.ts", "src/integrations/safejs/shell.ts", "src/integrations/safejs/values.ts",
  "src/shell/shell.ts", "src/shell/runtime.ts", "src/shell/input.ts", "src/shell/cleanup.ts", "src/shell/types.ts",
  "src/commands/network/index.ts", "src/commands/network/types.ts", "src/commands/network/curl.ts", "src/commands/network/transport.ts", "src/commands/network/output.ts",
  "dist/index.d.ts", "dist/contracts/output.d.ts", "dist/commands/safejs/types.d.ts", "dist/integrations/safejs/shell.d.ts", "dist/commands/network/types.d.ts",
].map(filename => record(join(assembly.candidate, filename), filename));
const engineReferences = ["src/run.ts", "src/interp/budget.ts", "src/modules/fs.ts", "src/interp/host-bridge.ts", "src/interp/promise.ts", "src/interp/promise-tracker.ts", "src/interp/values.ts", "src/run.promise-order.test.ts", "src/interp/promise.test.ts"]
  .map(filename => record(join(prepared, "engine", filename), filename));
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(), role: "lifecycle/budget planner; prepare/freeze only", threadId: "01a04292-c8dd-7331-9dac-619c9861b11b",
  independentReceiptVerdict: "PENDING; retrieval and local equality are not chain/current-assembly authentication", rootExecutionRelease: false,
  executionCounts: { guest: 0, engineImports: 0, productImports: 0, productBuilds: 0, privateQueries: 0, dependencyInstalls: 0, nativeProbes: 0 },
  preparationCommit, candidateEvidenceCommit: assembly.evidenceCommit, historicalBaseCommit: assembly.baseCommit,
  preparedReadOnlyRoot: prepared, candidateReadOnlyRoot: assembly.candidate, publicPackageReadOnlyRoot: installedRoot,
  staticReadEquality: { candidateFiles: candidate.length, candidateInventorySha256: sha(JSON.stringify(candidate)), sourceFiles: sources.length, sourceManifestSha256: sha(JSON.stringify(sources)), compiledFiles: compiled.length, compiledManifestSha256: sha(JSON.stringify(compiled)), installedPackageFiles: installed.length, installedPackageInventorySha256: sha(JSON.stringify(installed)), allComparedBytesMatchRecordedManifests: true, noNewAssemblyOrExtraction: true },
  privateExpectedAtRelease: { head: before.private.head, tree: before.private.tree, index: before.private.index, status: before.private.status, staged: before.private.staged, metadata: before.private.metadata, engineRegularFiles: engine.length, engineInventorySha256: sha(JSON.stringify(engine)), authority: "Historical f666 snapshot only; fresh actual private before/after required after release" },
  loader: record(join(prepared, "loader.mjs"), "loader.mjs"), tooling, node: before.node, receiptInputs: receipts,
  retrievalOnlyHandoffs: ["/tmp/safe-bash-owned-output-prototype-provenance-ready.txt", "/tmp/safe-bash-owned-output-provenance-handoff-result.txt"]
    .map(filename => ({ ...record(realpathSync(filename)), requestedPath: filename })),
  publicSourceReferences: inspected, copiedEngineSourceReferences: engineReferences,
  actualApi: { publicImports: ["virtual-bash", "virtual-bash/contracts", "virtual-bash/contracts/output", "virtual-bash/commands/network"], symbols: ["Shell", "MemoryFileSystem", "safeJsCommands", "makeSafeJsShellModule", "makeSafeJsFsModule", "createOutputOperation", "curlCommands"], capability: ["consumerClosed", "write"], operation: ["signal", "output", "registerCleanup", "acquire", "child", "close"], privateDefinitionHooks: ["src/run.ts#run", "src/interp/budget.ts#Budget", "src/modules/fs.ts#makeFsModule", "src/interp/host-bridge.ts#declareHostOperation"], notPublicRuntimeImports: ["shell/runtime", "commands/safejs/io", "private src/index.ts"], safeJsWrapperImplicitOptIn: false },
  instructions: [record("AGENTS.md"), record("../AGENTS.md")],
  publicReadOnlyState: { head: git("rev-parse", "HEAD").toString().trim(), status: git("status", "--porcelain=v1").toString(), staged: git("diff", "--cached", "--name-status").toString() },
  limitations: ["No independent receipt verdict inferred", "No candidate/product/engine executed", "No private checkout access in this preparation", "No new surface-worker cases read", "No actual loaded-module count inferred from static references", "No runtime acceptance or prototype promotion"],
}, null, 2));
