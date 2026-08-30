import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const revision = git("rev-parse", process.argv[2] ?? "HEAD");
const harnessRevision = git("rev-parse", "0294afb");
const output = resolve(process.argv[3]);
const scratch = await mkdtemp(join(tmpdir(), "safe-core-six-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ids = ["command/realpath/relative", "command/wc/words-lines", "command/wc/unicode", "command/env/clean", "command/env/unset", "command/cksum/algorithm"];
const sourceHashes = {};
async function hashes(root, prefix = "src") {
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await hashes(root, path);
    else sourceHashes[path] = sha(await readFile(join(root, path)));
  }
}
try {
  const source = join(scratch, "source"), harness = join(scratch, "harness");
  await mkdir(source); await mkdir(harness);
  for (const [name, commit, paths] of [["source", revision, ["src", "package.json", "package-lock.json"]], ["harness", harnessRevision, ["benchmarks/expanded", "package.json"]]]) {
    execFileSync("git", ["archive", "-o", join(scratch, `${name}.tar`), commit, ...paths], { cwd: repo });
    execFileSync("tar", ["-xf", join(scratch, `${name}.tar`), "-C", join(scratch, name)]);
    await symlink(join(repo, "node_modules"), join(scratch, name, "node_modules"), "dir");
  }
  await hashes(source);
  const { session } = await import(pathToFileURL(join(harness, "benchmarks/expanded/session.mjs")).href);
  const { recipes } = await import(pathToFileURL(join(harness, "benchmarks/expanded/recipes.mjs")).href);
  const { compare, environment } = await import(pathToFileURL(join(harness, "benchmarks/expanded/common.mjs")).href);
  const goldenBytes = await readFile(join(repo, "benchmarks/reports/expanded-20260827/native-corrected/native.json"));
  const golden = JSON.parse(goldenBytes), rows = [];
  const worker = await session("virtual-bash", source, join(repo, "benchmarks/node_modules/just-bash"));
  try {
    for (const id of ids) {
      const specimen = recipes().find(row => row.id === id);
      const expected = golden.observations.find(row => row.id === id);
      assert.ok(specimen && expected?.oracleValid);
      assert.equal(sha(JSON.stringify(specimen)), expected.recipeHash);
      const result = await worker.run(specimen, undefined, false);
      rows.push({ id, script: specimen.script, expected, result, comparison: result.observation ? compare(expected, result.observation) : null });
    }
  } finally { await worker.close(); }
  const report = {
    capturedAt: new Date().toISOString(), revision, harnessRevision, environment, sourceHashes,
    goldenSha256: sha(goldenBytes),
    totals: { cases: rows.length, pass: rows.filter(row => row.comparison?.pass).length, fail: rows.filter(row => !row.comparison?.pass).length },
    scope: "Exact six historical recipes at committed source with original0294afb harness/environment and immutable corrected native expectations; no dirty product files or scratch-profile delta. This is not the full224 run or independent review.",
    rows,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ revision, harnessRevision, totals: report.totals, rows: rows.map(row => ({ id: row.id, pass: row.comparison?.pass, expected: Buffer.from(row.expected.stdout, "base64").toString(), actual: row.result.observation ? Buffer.from(row.result.observation.stdout, "base64").toString() : row.result })) }, null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
