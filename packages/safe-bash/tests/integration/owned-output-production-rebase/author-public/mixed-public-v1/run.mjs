import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree, directory, git, inventory, json, owner, regular, sha256, verifyAuthor, verifyTooling, writeJson, writeNew } from "../harness/common.mjs";

const current = dirname(fileURLToPath(import.meta.url));
const freezePath = `${owner}/mixed-public-v1/EXECUTION-INPUTS.json`;
const freezeCommit = git("log", "-1", "--format=%H", "--", freezePath).toString().trim();
const bytes = git("show", `${freezeCommit}:${freezePath}`);
assert.deepEqual(regular(join(current, "EXECUTION-INPUTS.json")), bytes);
const frozen = JSON.parse(bytes);
for (const entry of frozen.files) {
  const actual = regular(join(current, entry.path));
  assert.equal(sha256(actual), entry.sha256);
  assert.deepEqual(actual, git("show", `${freezeCommit}:${owner}/mixed-public-v1/${entry.path}`));
}
verifyAuthor("e748f20fe9d0ea1d29aefe70939d3ee76951ef68");
verifyTooling();
const binding = json(join(directory, "safejs-execution-v1/PUBLIC-BINDING.json"));
assert.deepEqual(regular(join(directory, "safejs-execution-v1/PUBLIC-BINDING.json")), git("show", `7204b9e01752c700dd791afd332e7f1b5fd8ba73:${owner}/safejs-execution-v1/PUBLIC-BINDING.json`));
assert.equal(binding.candidateCommit, json(join(current, "PROVENANCE.json")).candidateCommit);
const root = realpathSync(mkdtempSync("/tmp/safe-bash-author-current-mixed-"));
const pending = join(root, "consumer-before-move");
const consumer = join(root, "consumer");
const report = { candidateCommit: binding.candidateCommit, sourceManifestSha256: binding.sourceManifestSha256, freezeCommit, root, commands: [], status: "STARTED", expectedCases: 4, privateQueries: 0, services: 0 };
let before;
const run = (label, args) => {
  const result = spawnSync(binding.nodePath, args, { cwd: consumer, env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, TSX_DISABLE_CACHE: "1", LC_ALL: "C", TZ: "UTC" }, timeout: label === "compile" ? 180000 : 15000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
  writeNew(join(root, `${label}.stdout.txt`), result.stdout ?? "");
  writeNew(join(root, `${label}.stderr.txt`), result.stderr ?? "");
  report.commands.push({ label, args, status: result.status, signal: result.signal, error: result.error?.message ?? null });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, label);
};
try {
  copyTree(binding.packageRoot, join(pending, "node_modules/virtual-bash"), binding.packageEntries);
  writeNew(join(pending, "package.json"), '{"private":true,"type":"module"}\n');
  for (const file of ["network.test.ts", "helpers.ts"]) writeNew(join(pending, file), regular(join(current, `${file}.data`)));
  writeJson(join(pending, "tsconfig.json"), { compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, verbatimModuleSyntax: true, skipLibCheck: false, typeRoots: [join(binding.productRoot, "node_modules/@types")], types: ["node"], outDir: "compiled" }, files: ["network.test.ts", "helpers.ts"] });
  renameSync(pending, consumer);
  assert.deepEqual(inventory(join(consumer, "node_modules/virtual-bash")), binding.packageEntries);
  run("compile", [join(binding.compilerRoot, "bin/tsc"), "-p", join(consumer, "tsconfig.json")]);
  before = inventory(consumer);
  writeJson(join(root, "consumer-before.json"), before);
  run("runtime", ["--unhandled-rejections=strict", "--test", "--test-concurrency=1", join(consumer, "compiled/network.test.js")]);
  const output = regular(join(root, "runtime.stdout.txt")).toString();
  assert.match(output, /# tests 4\n/u);
  assert.match(output, /# pass 4\n/u);
  assert.match(output, /# fail 0\n/u);
  report.status = "AUTHOR_MIXED_PUBLIC_4_PASS";
} catch (error) {
  report.status = "AUTHOR_MIXED_PUBLIC_NONPASS";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  try {
    if (before) { const after = inventory(consumer); writeJson(join(root, "consumer-after.json"), after); assert.deepEqual(after, before); }
    assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries);
    assert.deepEqual(inventory(binding.compilerRoot), binding.compilerEntries);
    report.beforeAfter = "UNCHANGED_INCLUDING_NEW_ENTRIES";
  } catch (error) { report.beforeAfter = error.message; report.status = "AUTHOR_MIXED_INPUT_NONPASS"; process.exitCode = 1; }
  writeJson(join(root, "report.json"), report);
  console.log(JSON.stringify({ status: report.status, root, expectedCases: 4 }));
}
