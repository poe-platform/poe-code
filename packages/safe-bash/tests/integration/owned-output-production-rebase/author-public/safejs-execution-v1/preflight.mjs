import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, git, inventory, json, regular, sha256, verifyReference, writeJson, writeNew } from "../harness/common.mjs";
import { expectedPrivateProfile, frozenAuthor, frozenJson, makeCurrentImportBinding } from "../harness/safejs-binding.mjs";

const current = dirname(fileURLToPath(import.meta.url));
const binding = json(join(current, "PUBLIC-BINDING.json"));
const origins = json(join(current, "ORIGINS.json"));
const source = verifyReference(origins.surfaceAssessment).toString();
const functionStart = source.indexOf("function assess(");
const functionEnd = source.indexOf("\nfunction auditImports(", functionStart);
const exactFunction = source.slice(functionStart, functionEnd).trimEnd();
assert.equal(sha256(exactFunction), origins.unchangedAssessmentFunctionSha256);
assert.ok(regular(join(current, "surface-assessment.mjs")).toString().includes(exactFunction));
verifyReference(origins.loaderReference);
const expected = expectedPrivateProfile();
const map = makeCurrentImportBinding({ candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree, authorCommit: "9513946ced0a3b9076770a3e4dfbc18bcd3c1f13", root: "/private/tmp/synthetic-current-source-binding", productEntries: binding.packageEntries, compilerEntries: binding.compilerEntries, engineEntries: expected.engine.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest })), driverEntries: [] });
assert.equal(map.allowedEnginePaths.length, 63);
for (const family of ["surface", "lifecycle", "controls"]) {
  const cases = frozenJson(`${frozenAuthor}/${family}/CASES.json`);
  assert.equal(family === "surface" ? cases.cases.slice(0, 8).length : cases.rows.length, { surface: 8, lifecycle: 11, controls: 6 }[family]);
}
const output = realpathSync(mkdtempSync("/tmp/safe-bash-author-safejs-loader-preflight-"));
const controls = [];
for (const mode of ["unknown-import", "changed-source"]) {
  const root = join(output, mode);
  copyTree(binding.compilerRoot, join(root, "node_modules/typescript"), binding.compilerEntries);
  writeNew(join(root, "loader.mjs"), regular(join(current, "loader.mjs")));
  writeNew(join(root, "consumer/target.mjs"), 'throw new Error("Synthetic source must never execute");\n');
  const files = inventory(join(root, "node_modules/typescript")).filter(entry => entry.kind === "file").map(entry => ({ ...entry, path: `node_modules/typescript/${entry.path}` }));
  if (mode === "changed-source") files.push({ path: "consumer/target.mjs", sha256: sha256("different authenticated bytes") });
  writeJson(join(root, "CURRENT-IMPORTS.json"), { root, candidateCommit: binding.candidateCommit, allowedEnginePaths: [], files });
  const result = spawnSync(binding.nodePath, ["--import", join(root, "loader.mjs"), join(root, "consumer/target.mjs")], { cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", SURFACE_ROOT: root, SURFACE_IMPORTS: join(root, "imports.ndjson") }, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  writeNew(join(root, "stdout.txt"), result.stdout ?? "");
  writeNew(join(root, "stderr.txt"), result.stderr ?? "");
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  const expectedMessage = mode === "unknown-import" ? "Unknown current import:" : "Changed current import:";
  assert.ok(result.stderr.includes(expectedMessage));
  assert.equal(result.stderr.includes("Error: Synthetic source must never execute"), false);
  controls.push({ mode, status: result.status, expectedGuard: expectedMessage, guardRejected: true, syntheticTargetExecuted: false, privateQueries: 0, guestRuns: 0, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) });
}
writeJson(join(output, "report.json"), { status: "CURRENT_BINDING_PREFLIGHT_PASS", candidateCommit: binding.candidateCommit, exactAssessmentFunctionSha256: origins.unchangedAssessmentFunctionSha256, unchangedSemanticRows: 25, privateQueries: 0, guestRuns: 0, productImports: 0, publicCompilerImports: 2, controls });
console.log(JSON.stringify({ status: "CURRENT_BINDING_PREFLIGHT_PASS", controls: controls.length, unchangedSemanticRows: 25, privateQueries: 0, guestRuns: 0, output }));
