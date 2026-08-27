import assert from "node:assert/strict";
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, inventory, location, owned, readJson, repository, save, sha, status } from "./common.mjs";

assert.equal(process.cwd(), repository);
const work = realpathSync(mkdtempSync("/tmp/safe-bash-quiet-postfix-review-"));
writeFileSync(location, `${work}\n`, { flag: "wx" });
const baselinePath = "tests/commands/diff-patch-stress/gnu-revised-acceptance/original-manifest.json";
const baseline = readJson(baselinePath);
const original237 = Object.fromEntries(Object.entries(baseline.originalFiles).filter(([path]) => path.startsWith("tests/")));
const original70 = Object.fromEntries(baseline.original3758.testFiles.map(path => [path, sha(git("show", `4d4f5ca:${path}`))]));
assert.equal(Object.keys(original237).length, 237);
assert.equal(Object.keys(original70).length, 70);
for (const [path, hash] of Object.entries({ ...original237, ...original70 })) assert.equal(sha(readFileSync(path)), hash, path);
const profiles = ["common.mjs", "native.mjs", "engine.mjs", "recipes.mjs", "inventory.mjs"];
for (const name of profiles) assert.equal(sha(readFileSync(`benchmarks/expanded/${name}`)), sha(git("show", `d1b10a3:benchmarks/expanded/${name}`)), `corrected helper changed: ${name}`);
const accepted = Object.fromEntries([["96564fe", "src/commands/diff-patch/"], ["386196b", "src/commands/metadata/"]].flatMap(([commit, prefix]) => git("ls-tree", "-r", "--name-only", commit, "--", prefix).toString().trim().split("\n").map(path => [path, { commit: git("rev-parse", commit).toString().trim(), expected: sha(git("show", `${commit}:${path}`)), actual: sha(readFileSync(path)) }])));
save(join(work, "accepted-source.json"), accepted);
for (const [path, value] of Object.entries(accepted)) assert.equal(value.actual, value.expected, `accepted source drift: ${path}`);
const evidencePaths = [
  baselinePath,
  "tests/commands/diff-patch-stress/gnu-revised-full/delta-v1.mjs",
  "tests/commands/diff-patch-stress/gnu-revised-full/run.mjs",
  "tests/commands/diff-patch-stress/gnu-revised-full/proof.json",
  "tests/commands/diff-patch-stress/gnu-revised-full-review/run-review.mjs",
  "tests/commands/diff-patch-stress/gnu-revised-full-review/native-preparation.json",
  "tests/commands/diff-patch-stress/gnu-revised-full-review/native-product.json",
  "tests/commands/diff-patch-stress/gnu-revised-full-review/delta-audit.json",
  "tests/commands/diff-patch-stress/gnu-revised-full-review/RESULT.json",
  "tests/commands/diff-patch-stress/gnu-rmdir-checkpoint/guard.mjs",
  "tests/commands/diff-patch-stress/gnu-followup-checkpoint/reporter.mjs",
  "tests/commands/diff-patch-stress/routed-five-checkpoint/frozen-eighteen-failures.json",
  "tests/commands/diff-patch-stress/routed-five-review/five-replay.json",
  "benchmarks/reports/expanded-20260827/native-corrected/native.json",
  "benchmarks/reports/expanded-20260827/native-scratch-aligned/native.json",
  "benchmarks/reports/expanded-20260827/SCRATCH_PROFILE_DELTA.md",
];
const sourcePaths = git("ls-files", "src").toString().trim().split("\n");
const benchmarkPaths = git("ls-files", "benchmarks/expanded").toString().trim().split("\n");
const paths = [...new Set([...sourcePaths, ...Object.keys(original237), ...evidencePaths, ...benchmarkPaths, "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"])].sort();
let snapshot, inputs, dependencies;
const captures = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  const before = inventory(repository, paths), dependencyBefore = inventory(repository, ["node_modules"]);
  const candidate = join(work, `snapshot-${attempt}`);
  mkdirSync(candidate);
  for (const path of paths) {
    const destination = join(candidate, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repository, path), destination);
    chmodSync(destination, before[path].mode);
  }
  cpSync(join(repository, "node_modules"), join(candidate, "node_modules"), { recursive: true, verbatimSymlinks: true });
  const copied = inventory(candidate, paths), dependencyCopied = inventory(candidate, ["node_modules"]);
  const after = inventory(repository, paths), dependencyAfter = inventory(repository, ["node_modules"]);
  const stable = [copied, after].every(value => sha(JSON.stringify(value)) === sha(JSON.stringify(before))) && [dependencyCopied, dependencyAfter].every(value => sha(JSON.stringify(value)) === sha(JSON.stringify(dependencyBefore)));
  captures.push({ attempt, stable, before: sha(JSON.stringify(before)), copied: sha(JSON.stringify(copied)), after: sha(JSON.stringify(after)) });
  if (stable) { snapshot = candidate; inputs = copied; dependencies = dependencyCopied; break; }
}
assert(snapshot, "could not capture stable current input bytes; no runs authorized");
const oldProfile = join(work, "old-profile");
for (const name of profiles) {
  const destination = join(oldProfile, "benchmarks/expanded", name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, git("show", `0294afb:benchmarks/expanded/${name}`));
}
copyFileSync(join(snapshot, "package.json"), join(oldProfile, "package.json"));
cpSync(join(snapshot, "node_modules"), join(oldProfile, "node_modules"), { recursive: true, verbatimSymlinks: true });
const historicalRoot = "/tmp/safe-bash-diff-rmdir-final-PRIFIp";
const groups = readJson(join(historicalRoot, "test-census.json")).original;
const historicalResult = readJson(join(historicalRoot, "result.json"));
assert.deepEqual(Object.values(groups).flat().sort(), Object.keys(original70).sort());
for (const name of ["result.json", "test-census.json", ...Object.keys(groups).map(name => `${name}.events.jsonl`)]) {
  const destination = join(work, "historical", name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(historicalRoot, name), destination);
}
const commits = Object.fromEntries(["96564fe", "386196b", "d506d040", "d1b10a3", "5ddce1b", "5ce557d", "0294afb", "4d4f5ca", "c623665"].map(commit => [commit, git("rev-parse", commit).toString().trim()]));
const manifest = { startedAt: new Date().toISOString(), work, snapshot, oldProfile, captures, commits, head: git("rev-parse", "HEAD").toString().trim(), gitStatus: git("status", "--short").toString(), index: git("ls-files", "--stage").toString(), original237, original70, groups, inputs, dependencies, accepted, historicalResult, oldHelpers: inventory(oldProfile, profiles.map(name => `benchmarks/expanded/${name}`)), sourceAggregate: sha(JSON.stringify(Object.fromEntries(Object.entries(inputs).filter(([path]) => path.startsWith("src/"))))), runtime: { node: process.version, executable: process.execPath, executableSha256: sha(readFileSync(process.execPath)), platform: process.platform, arch: process.arch, dependencies: readJson("package.json").dependencies ?? {}, tooling: Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => [name, readJson(`node_modules/${name}/package.json`).version])) } };
save(join(work, "manifest.json"), manifest);
save(join(repository, owned, "INPUT-MANIFEST.json"), manifest);
status(`Frozen current inputs: ${work}\nHEAD ${manifest.head}\nSource ${manifest.sourceAggregate}\nAccepted patch/stat bytes match; original 70 tests / 237 fixtures unchanged. Corrected helpers match d1b10a3. No tests run yet.`);
