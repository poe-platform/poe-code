import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, loadavg, release, tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd(), temporary = mkdtempSync(join(tmpdir(), "safe-sort-independent-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const base = "b5ec52a0d3ff16da47e814729f72153f9b09b926", patch = "f3eb0feb320f5eaabe2524377bc49925a6bee096";
const harnessRevision = "97d04d4";
const harness = join(temporary, "harness"); mkdirSync(harness);
execFileSync("git", ["archive", "-o", join(temporary, "harness.tar"), harnessRevision, "benchmarks/expanded", "benchmarks/reports/expanded-20260827/native-corrected/native.json"], { cwd: root });
execFileSync("tar", ["-xf", join(temporary, "harness.tar"), "-C", harness]);
const { session } = await import(pathToFileURL(join(harness, "benchmarks/expanded/session.mjs")));
const { performanceRecipes } = await import(pathToFileURL(join(harness, "benchmarks/expanded/recipes.mjs")));
const { compare } = await import(pathToFileURL(join(harness, "benchmarks/expanded/common.mjs")));
const specimen = performanceRecipes().find(row => row.id === "performance/sort-5000");
const golden = readFileSync(join(harness, "benchmarks/reports/expanded-20260827/native-corrected/native.json"));
const expected = JSON.parse(golden).observations.find(row => row.id === specimen.id);
assert.equal(expected.recipeHash, sha(JSON.stringify(specimen)));
const gnu = process.env.CORE_GNU_BIN;
assert.ok(gnu, "CORE_GNU_BIN is required for independent output cross-check");
const sorted = spawnSync(join(gnu, "sort"), [], { input: Buffer.from(specimen.stdin, "base64"), cwd: temporary, env: { LC_ALL: "C" }, timeout: 3000 });
assert.equal(sorted.status, 0);
const unique = spawnSync(join(gnu, "uniq"), [], { input: sorted.stdout, cwd: temporary, env: { LC_ALL: "C" }, timeout: 3000 });
assert.equal(unique.status, 0);
assert.equal(unique.stdout.toString("base64"), expected.stdout);
const sources = {}, sourceHashes = {};
function tree(directory, prefix = "src", result = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) tree(join(directory, entry.name), `${prefix}/${entry.name}`, result);
    else result[`${prefix}/${entry.name}`] = sha(readFileSync(join(directory, entry.name)));
  }
  return result;
}
for (const name of ["before", "after", "reviewed-control"]) {
  const source = join(temporary, name); mkdirSync(source); sources[name] = source;
  execFileSync("git", ["archive", "-o", join(temporary, `${name}.tar`), base, "src", "package.json", "package-lock.json"], { cwd: root });
  execFileSync("tar", ["-xf", join(temporary, `${name}.tar`), "-C", source]);
  if (name === "after") writeFileSync(join(source, "src/commands/text.ts"), execFileSync("git", ["show", `${patch}:src/commands/text.ts`], { cwd: root }));
  if (name === "reviewed-control") writeFileSync(join(source, "src/commands/text.ts"), readFileSync(join(root, "src/commands/text.ts")));
  symlinkSync(join(root, "node_modules"), join(source, "node_modules"), "dir");
  sourceHashes[name] = tree(join(source, "src"));
}
assert.deepEqual(Object.keys(sourceHashes.before).filter(path => sourceHashes.before[path] !== sourceHashes.after[path]), ["src/commands/text.ts"]);
const baselineRoot = join(root, "benchmarks/node_modules/just-bash");
const version = JSON.parse(readFileSync(join(baselineRoot, "package.json"), "utf8")).version;
assert.equal(version, "3.4.2");
async function trial(name, warmup) {
  const worker = await session(name === "just-bash" ? name : "virtual-bash", sources[name] ?? sources.before, baselineRoot);
  try {
    const startLoad = loadavg(), response = await worker.run(specimen, undefined, false, warmup);
    const equivalence = response.observation ? compare(expected, response.observation) : null;
    const observed = response.observation;
    return { name, startLoad, endLoad: loadavg(), equivalence, error: response.error ?? null,
      observation: observed ? { ...observed, stdout: { bytes: Buffer.from(observed.stdout, "base64").length, sha256: sha(Buffer.from(observed.stdout, "base64")) }, stderr: observed.stderr } : null };
  } finally { await worker.close(); }
}
const controls = [];
for (const name of ["before", "after", "just-bash", "reviewed-control"]) controls.push(await trial(name, 0));
const eligible = controls.every(row => row.equivalence?.pass), samples = [];
const orders = [["after", "before", "just-bash"], ["just-bash", "after", "before"], ["before", "just-bash", "after"], ["just-bash", "before", "after"], ["before", "after", "just-bash"], ["after", "just-bash", "before"]];
if (eligible) for (let cycle = 0; cycle < 2; cycle++) for (const order of cycle ? [...orders].reverse() : orders) {
  for (const name of order) samples.push({ cycle, order, ...await trial(name, 1) });
}
const allEquivalent = eligible && samples.every(row => row.equivalence?.pass);
const median = numbers => { const ordered = [...numbers].sort((left, right) => left - right); return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2; };
const summary = allEquivalent ? Object.fromEntries(["before", "after", "just-bash"].map(name => {
  const rows = samples.filter(row => row.name === name); return [name, { samples: rows.length, medianMs: median(rows.map(row => row.observation.executeMs)), medianSampledPeakRss: median(rows.map(row => row.observation.memory.sampledPeak.rss)) }];
})) : null;
const report = { capturedAt: new Date().toISOString(), base, patch, harnessRevision, retainedSnapshot: temporary, sourceHashes,
  nativeCheck: { stdoutSha256: sha(unique.stdout), sortSha256: sha(readFileSync(join(gnu, "sort"))), uniqSha256: sha(readFileSync(join(gnu, "uniq"))) },
  harnessArchiveSha256: sha(readFileSync(join(temporary, "harness.tar"))), goldenSha256: sha(golden), recipeSha256: sha(JSON.stringify(specimen)), specimen, expected,
  baseline: { version, bundleSha256: sha(readFileSync(join(baselineRoot, "dist/bundle/index.js"))), lockSha256: sha(readFileSync(join(root, "benchmarks/package-lock.json"))) },
  eligible, allEquivalent, controls, samples, summary, runtime: { node: process.version, release: release(), cpus: cpus().map(cpu => cpu.model) },
  limits: "Two cycles of six order permutations, fresh worker per sample, one warmup; exact stdout/stderr/status/FS equality required. Shared host load uncontrolled. Source TypeScript versus installed bundle; sampled memory can miss synchronous peaks. No general superiority claim." };
console.log(JSON.stringify(report, null, 2));
if (!allEquivalent) process.exitCode = 1;
