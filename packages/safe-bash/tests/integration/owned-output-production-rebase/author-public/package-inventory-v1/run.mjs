import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, directory, git, inventory, json, owner, regular, sha256, writeJson, writeNew } from "../harness/common.mjs";

const current = dirname(fileURLToPath(import.meta.url));
const manifestPath = `${owner}/package-inventory-v1/EXECUTION-INPUTS.json`;
const commit = git("log", "-1", "--format=%H", "--", manifestPath).toString().trim();
const manifest = git("show", `${commit}:${manifestPath}`);
assert.deepEqual(regular(join(current, "EXECUTION-INPUTS.json")), manifest);
for (const entry of JSON.parse(manifest).files) {
  const bytes = regular(join(current, entry.path));
  assert.equal(sha256(bytes), entry.sha256);
  assert.deepEqual(bytes, git("show", `${commit}:${owner}/package-inventory-v1/${entry.path}`));
}
const bindingPath = `${owner}/safejs-execution-v1/PUBLIC-BINDING.json`;
const bindingBytes = git("show", `7204b9e01752c700dd791afd332e7f1b5fd8ba73:${bindingPath}`);
assert.deepEqual(regular(join(directory, "safejs-execution-v1/PUBLIC-BINDING.json")), bindingBytes);
const binding = JSON.parse(bindingBytes);
const root = realpathSync(mkdtempSync("/tmp/safe-bash-author-current-exports-"));
const pending = join(root, "consumer-before-move");
const consumer = join(root, "consumer");
copyTree(binding.packageRoot, join(pending, "node_modules/virtual-bash"), binding.packageEntries);
writeNew(join(pending, "package.json"), '{"private":true,"type":"module"}\n');
writeNew(join(pending, "probe.mjs"), regular(join(current, "probe.mjs")));
renameSync(pending, consumer);
const before = inventory(consumer);
writeJson(join(root, "consumer-before.json"), before);
const report = { candidateCommit: binding.candidateCommit, sourceManifestSha256: binding.sourceManifestSha256, freezeCommit: commit, root, status: "STARTED", privateQueries: 0, services: 0 };
try {
  assert.equal(sha256(regular(binding.nodePath)), binding.nodeSha256);
  const result = spawnSync(binding.nodePath, [join(consumer, "probe.mjs")], { cwd: consumer, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  writeNew(join(root, "stdout.json"), result.stdout ?? "");
  writeNew(join(root, "stderr.txt"), result.stderr ?? "");
  report.process = { status: result.status, signal: result.signal, error: result.error?.message ?? null };
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  report.result = json(join(root, "stdout.json"));
  report.status = "AUTHOR_COMPLETE_DECLARED_EXPORT_INVENTORY_PASS";
} catch (error) { report.status = "AUTHOR_EXPORT_INVENTORY_NONPASS"; report.error = error.message; process.exitCode = 1; }
finally {
  try { const after = inventory(consumer); writeJson(join(root, "consumer-after.json"), after); assert.deepEqual(after, before); assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries); report.beforeAfter = "UNCHANGED_INCLUDING_NEW_ENTRIES"; }
  catch (error) { report.beforeAfter = error.message; report.status = "AUTHOR_EXPORT_INTEGRITY_NONPASS"; process.exitCode = 1; }
  writeJson(join(root, "report.json"), report);
  console.log(JSON.stringify({ status: report.status, root, declaredExportKeys: report.result?.declaredExportKeys, probedSpecifiers: report.result?.probedSpecifiers }));
}
