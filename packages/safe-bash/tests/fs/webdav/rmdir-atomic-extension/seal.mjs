import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (path) => sha256(await readFile(path));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const cohorts = ["first", "serialized", "serialized-applied", "final", "final-replay"];
const inputs = ["server.mjs", "run.mjs", "proposal.ts"];
const summaries = {};
for (const cohort of cohorts) {
  const directory = join(here, "evidence", cohort);
  const baseline = await readJson(join(directory, "baseline.json"));
  const summary = await readJson(join(directory, "summary.json"));
  assert.equal(summary.frozenInputsUnchanged, true);
  assert.equal(summary.cleanup.rootRemoved, true);
  assert.deepEqual(summary.cleanup.server, { listening: false, pending: 0 });
  assert.equal(await lstat(summary.cleanup.ownedRoot).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error)), false);
  for (const name of inputs) {
    const snapshot = join(here, "evidence", cohort === "serialized" ? "first" : cohort, "inputs", name);
    assert.equal(await fileHash(snapshot), baseline.sourceInputs[relative(repository, join(here, name))]);
  }
  summaries[cohort] = { head: baseline.head, profileSha256: baseline.profileSha256, totals: summary.totals,
    requests: summary.requests, cleanup: summary.cleanup };
}
const final = await readJson(join(here, "evidence/final/baseline.json"));
for (const [path, expected] of Object.entries(final.sourceInputs)) assert.equal(await fileHash(join(repository, path)), expected, path);
const commands = [
  [process.execPath, ["--check", join(here, "server.mjs")]],
  [process.execPath, ["--check", join(here, "run.mjs")]],
  [join(repository, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", join(here, "proposal.ts")]],
  ["git", ["diff", "--check", "--", relative(repository, here)]],
];
const validation = commands.map(([executable, args]) => {
  const result = spawnSync(executable, args, { cwd: repository, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return { executable, args, status: result.status, stdout: result.stdout, stderr: result.stderr };
});
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (path === join(here, "CHECKPOINT.json")) continue;
    if (entry.isDirectory()) files.push(...await collect(path));
    else files.push([relative(here, path), await fileHash(path)]);
  }
  return files;
}
const checkpoint = {
  createdAt: new Date().toISOString(), authorOnly: true, productionChanged: false,
  originalProviderMatrixChanged: false, rootDecisionPending: true,
  headBeforeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
  unchangedBaselineInputs: final.sourceInputs, cohorts: summaries, validation,
  typescriptPackageSha256: await fileHash(join(repository, "node_modules/typescript/package.json")),
  typescriptCompilerSha256: await fileHash(join(repository, "node_modules/typescript/lib/_tsc.js")),
  files: Object.fromEntries(await collect(here)),
};
await writeFile(join(here, "CHECKPOINT.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ files: Object.keys(checkpoint.files).length, cohorts: cohorts.length, checks: validation.length }));
