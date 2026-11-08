import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus, loadavg, release, tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compare, hash } from "./common.mjs";
import { performanceRecipes } from "./recipes.mjs";
import { session } from "./session.mjs";

const repo = process.cwd(), output = resolve(process.argv[2]);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const base = git("rev-parse", "b5ec52a"), patch = git("rev-parse", "f3eb0fe");
const specimen = performanceRecipes().find(row => row.id === "performance/sort-5000");
const goldenBytes = await readFile("benchmarks/reports/expanded-20260827/native-corrected/native.json");
const expected = JSON.parse(goldenBytes).observations.find(row => row.id === specimen.id);
assert.equal(expected.recipeHash, hash(JSON.stringify(specimen)));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "safe-sort-review-"));
const sources = {}, sourceHashes = {};
async function hashes(directory, prefix = "src", result = {}) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) await hashes(join(directory, entry.name), `${prefix}/${entry.name}`, result);
    else result[`${prefix}/${entry.name}`] = hash(await readFile(join(directory, entry.name)));
  }
  return result;
}
try {
  for (const name of ["before", "after"]) {
    const root = join(scratch, name); await mkdir(root); sources[name] = root;
    execFileSync("git", ["archive", "-o", join(scratch, `${name}.tar`), base, "src", "package.json", "package-lock.json"]);
    execFileSync("tar", ["-xf", join(scratch, `${name}.tar`), "-C", root]);
    if (name === "after") await writeFile(join(root, "src/commands/text.ts"), execFileSync("git", ["show", `${patch}:src/commands/text.ts`]));
    await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
    sourceHashes[name] = await hashes(join(root, "src"));
  }
  const changedFiles = Object.keys(sourceHashes.before).filter(path => sourceHashes.before[path] !== sourceHashes.after[path]);
  assert.deepEqual(changedFiles, ["src/commands/text.ts"]);
  const baselineRoot = join(repo, "benchmarks/node_modules/just-bash");
  const controls = [], trials = [];
  async function observe(name, warmup = 0) {
    const worker = await session(name === "just-bash" ? "just-bash" : "virtual-bash", sources[name] ?? sources.before, baselineRoot);
    try {
      const beforeLoad = loadavg(), result = await worker.run(specimen, undefined, false, warmup);
      return { name, beforeLoad, afterLoad: loadavg(), ...result, comparison: result.observation ? compare(expected, result.observation) : null };
    } finally { await worker.close(); }
  }
  for (const name of ["before", "after", "just-bash"]) controls.push(await observe(name));
  const eligible = controls.every(row => row.comparison?.pass);
  const orders = [["before", "after", "just-bash"], ["after", "just-bash", "before"], ["just-bash", "before", "after"], ["just-bash", "after", "before"], ["after", "before", "just-bash"], ["before", "just-bash", "after"]];
  if (eligible) for (const [repeat, order] of orders.entries()) for (const name of order) trials.push({ repeat, order, ...await observe(name, 1) });
  const median = values => { const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const summary = Object.fromEntries(["before", "after", "just-bash"].map(name => {
    const rows = trials.filter(row => row.name === name);
    return [name, { total: rows.length, pass: rows.filter(row => row.comparison?.pass).length, medianMs: rows.length ? median(rows.map(row => row.observation.executeMs)) : null,
      medianPeakRssBytes: rows.length ? median(rows.map(row => row.observation.memory.sampledPeak.rss)) : null }];
  }));
  const harnessHashes = {};
  for (const path of ["sort-review.mjs", "session.mjs", "engine.mjs", "common.mjs", "recipes.mjs"]) harnessHashes[path] = hash(await readFile(new URL(path, import.meta.url)));
  const report = { createdAt: new Date().toISOString(), base, patch, actualMovingHead: git("rev-parse", "HEAD"),
    sourceComposition: "Both snapshots use git archive b5ec52a. After replaces ONLY src/commands/text.ts with the committed f3eb0fe blob. This intentionally derived snapshot isolates the sort change from concurrent owners; it is not an entire later HEAD.",
    sourceHashes, changedFiles, harnessHashes, baseline: { version: JSON.parse(await readFile(join(baselineRoot, "package.json"), "utf8")).version, bundleSha256: hash(await readFile(join(baselineRoot, "dist/bundle/index.js"))), lockSha256: hash(await readFile("benchmarks/package-lock.json")) },
    goldenSha256: hash(goldenBytes), specimen, expected, eligible, controls, trials, summary,
    runtime: { node: process.version, osRelease: release(), cpus: cpus().map(cpu => cpu.model) },
    limitations: ["All six order permutations, fresh child each trial, one warmup, no command instrumentation; matching stdout/stderr/status/files required before timing and for every trial.", "Shared cohost load is uncontrolled but recorded each trial; six repeats are descriptive. No performance pass when bytes/effects differ.", "Product TypeScript under tsx versus baseline installed bundle; memory includes loading/setup/warmup. Samples can miss synchronous peaks. No general speed/memory/superiority claim.", "Original 224 recipe outcomes and original sort slowdown stay immutable. Different-agent verification remains required."] };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ eligible, summary, output }, null, 2));
  assert.ok(eligible && trials.every(row => row.comparison?.pass), "Performance evidence requires exact output/effect parity");
} finally { await rm(scratch, { recursive: true, force: true }); }
