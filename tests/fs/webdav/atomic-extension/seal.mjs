import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const source = "d1174e2db9f4a4c92403842dee6fb3d4ff57ec96";
const earlier = "e9daab5722c682377cc59abec099648e3692c6ec";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const preserved = {};
for (const path of git("ls-tree", "-r", "--name-only", earlier, "--", "tests/fs/webdav/rmdir-atomic-extension", "tests/fs/webdav/rmdir-real-service").toString().trim().split("\n")) {
  const expected = hash(git("show", `${earlier}:${path}`));
  assert.equal(hash(await readFile(join(repo, path))), expected, path);
  preserved[path] = expected;
}
const sources = {};
for (const path of ["src/fs/webdav/webdav.ts", "src/fs/webdav/index.ts", "src/fs/webdav/README.md"]) {
  const expected = hash(git("show", `${source}:${path}`));
  assert.equal(hash(await readFile(join(repo, path))), expected, path);
  sources[path] = expected;
}
const cohorts = {};
for (const label of ["provider-second", "provider-final"]) {
  const directory = join(own, "evidence", label);
  const baseline = await json(join(directory, "baseline.json"));
  const run = await json(join(directory, "run.json"));
  const summary = await json(join(directory, "summary.json"));
  const audit = await json(join(directory, "audit.json"));
  const packageInfo = await json(join(directory, "package.json"));
  const fixtureHashes = await json(join(directory, "fixture-hashes.json"));
  assert.equal(baseline.source, source);
  assert.equal(baseline.webdavSha256, sources["src/fs/webdav/webdav.ts"]);
  for (const [path, expected] of Object.entries(fixtureHashes)) {
    assert.equal(hash(await readFile(join(directory, "inputs", path))), expected, `${label}/${path}`);
    assert.equal(hash(await readFile(join(own, path))), expected, path);
  }
  assert.equal(run.failure, undefined);
  assert.equal(run.cleanup.removed, true);
  assert.equal(run.cleanup.closureError, undefined);
  assert.equal(await lstat(run.cleanup.workspace).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error)), false);
  assert.equal(audit.providerHookAndNativeEffectsVerified, true);
  assert.equal(audit.descendantVisits, 0);
  assert.equal(summary.retainedLocks, 0);
  cohorts[label] = { source, archiveSha256: baseline.archiveSha256, packageSha256: packageInfo.sha256,
    profileSha256: (await json(join(directory, "profile.json"))).sha256, totals: summary.totals,
    runtimeClosureSha256: hash(await readFile(join(directory, "runtime-closure.json"))), cleanup: run.cleanup };
}
assert.equal(cohorts["provider-second"].packageSha256, cohorts["provider-final"].packageSha256);
const commands = await json(join(own, "evidence/source-qualified/commands.json"));
assert.ok(commands.every((command) => command.status === 0));
const validation = commands.map((command) => ({ command: command.command, args: command.args, status: command.status,
  totals: command.stdout?.match(/# (?:tests|pass|fail) \d+/gu) ?? null }));
async function files(directory) {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (path === join(own, "CHECKPOINT.json")) continue;
    assert.ok(!entry.isSymbolicLink());
    if (entry.isDirectory()) Object.assign(result, await files(path));
    else result[relative(own, path)] = hash(await readFile(path));
  }
  return result;
}
const checkpoint = {
  source, authorOnly: true, independentAcceptancePending: true, originalAggregateMatrixUnchanged: true,
  headAtSeal: git("rev-parse", "HEAD").toString().trim(), sources, cohorts, validation,
  preservedEarlierRevision: earlier, preservedEarlierFiles: preserved,
  typescriptVersion: (await json(join(repo, "node_modules/typescript/package.json"))).version,
  compilerSha256: hash(await readFile(join(repo, "node_modules/typescript/lib/_tsc.js"))),
  artifacts: await files(own),
};
await writeFile(join(own, "CHECKPOINT.json"), JSON.stringify(checkpoint, null, 2), { flag: "wx" });
console.log({ sealedFiles: Object.keys(checkpoint.artifacts).length, preservedEarlierFiles: Object.keys(preserved).length,
  source, cohorts });
