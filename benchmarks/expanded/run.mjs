import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { cpus, loadavg, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, hash } from "./common.mjs";
import { recipes, performanceRecipes } from "./recipes.mjs";
import { inventory } from "./inventory.mjs";
import { localServer } from "./server.mjs";
import { session } from "./session.mjs";
import { transportControls } from "./transport.mjs";

const repo = process.cwd(), output = resolve(process.argv[2]);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const revision = git("rev-parse", process.argv[3] ?? "HEAD");
const harnessRevision = git("rev-parse", process.argv[4] ?? "HEAD");
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const trackedHarness = git("ls-tree", "--name-only", harnessRevision, "benchmarks/expanded");
assert.ok(trackedHarness, "Commit the corpus and harness before scoring product outcomes");
const goldPath = resolve(process.argv[5] ?? "benchmarks/reports/expanded-20260827/native-scratch-aligned/native.json");
const goldBytes = await readFile(goldPath), gold = JSON.parse(goldBytes);
const corpus = recipes(), performanceCorpus = performanceRecipes();
for (const specimen of [...corpus, ...performanceCorpus]) assert.equal(gold.observations.find(row => row.id === specimen.id)?.recipeHash, hash(JSON.stringify(specimen)), `Native-first recipe changed: ${specimen.id}`);
for (const [path, digest] of Object.entries(gold.sourceHashes)) assert.equal(hash(await readFile(join(harnessRoot, path))), digest, `Native capture source changed: ${path}`);
const harnessHashes = {};
for (const name of (await readdir(harnessRoot)).filter(name => name.endsWith(".mjs")).sort()) {
  const bytes = await readFile(join(harnessRoot, name));
  assert.equal(hash(bytes), hash(execFileSync("git", ["show", `${harnessRevision}:benchmarks/expanded/${name}`], { cwd: repo })), `Uncommitted harness: ${name}`);
  harnessHashes[name] = hash(bytes);
}
await mkdir(output, { recursive: false });
const scratch = await mkdtemp(join(tmpdir(), "safe-bash-expanded-frozen-"));
const sourceRoot = join(scratch, "source"), baselineRoot = resolve("benchmarks/node_modules/just-bash");
await mkdir(sourceRoot);
execFileSync("git", ["archive", "-o", join(scratch, "source.tar"), revision, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"], { cwd: repo });
execFileSync("tar", ["-xf", join(scratch, "source.tar"), "-C", sourceRoot]);
await symlink(join(repo, "node_modules"), join(sourceRoot, "node_modules"), "dir");
const sourceHashes = {};
async function hashTree(directory, relative = "src") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name), key = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(path, key); else sourceHashes[key] = hash(await readFile(path));
  }
}
await hashTree(join(sourceRoot, "src"));
for (const name of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]) sourceHashes[name] = hash(await readFile(join(sourceRoot, name)));
const server = await localServer(), sessions = new Map();
const engines = ["virtual-bash", "just-bash"];
const startedAt = new Date().toISOString(), startLoad = loadavg();
const write = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const expectedFor = specimen => gold.observations.find(row => row.id === specimen.id);
async function run(engine, specimen, instrument = true, fresh = false, warmup = 0) {
  let worker;
  try {
    worker = !fresh && sessions.get(engine);
    if (!worker) { worker = await session(engine, sourceRoot, baselineRoot); if (!fresh) sessions.set(engine, worker); }
    const response = await worker.run(specimen, server.baseUrl, instrument, warmup);
    if (response.error) { await worker.close(); sessions.delete(engine); }
    const expected = expectedFor(specimen);
    return { ...response, status: !expected.oracleValid ? "invalid-oracle" : response.timeout ? "timeout" : response.error ? "harness-or-engine-error" : compare(expected, response.observation).pass ? "pass" : "fail",
      comparison: response.observation ? compare(expected, response.observation) : null };
  } catch (error) { return { status: "harness-or-engine-error", error: String(error.stack ?? error), comparison: null }; }
  finally { if (fresh && worker) await worker.close(); }
}
function totals(rows, key) {
  const result = { total: rows.length, pass: 0, fail: 0, timeout: 0, "harness-or-engine-error": 0, "invalid-oracle": 0, skipped: 0, pending: 0 };
  for (const row of rows) result[row[key].status]++;
  return result;
}
function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], min: sorted[0], max: sorted.at(-1) };
}
try {
  const names = await inventory(sourceRoot, baselineRoot), transport = await transportControls(baselineRoot);
  await write("transport-controls.json", transport);
  const results = [];
  for (const [index, specimen] of corpus.entries()) {
    const row = { id: specimen.id, group: specimen.group, command: specimen.command, optionFamily: specimen.optionFamily, expected: expectedFor(specimen), order: index % 2 ? [...engines].reverse() : engines };
    for (const engine of row.order) row[engine] = await run(engine, specimen);
    results.push(row);
    if ((index + 1) % 28 === 0) console.log(JSON.stringify({ completed: index + 1, virtual: totals(results, engines[0]), baseline: totals(results, engines[1]) }));
  }
  await write("functional.json", results);
  const neutrality = [];
  const controlIds = ["command/cat/binary-stdin", "command/echo/multiple", "command/chmod/numeric", "command/stat/fields", "command/patch/apply", "command/mktemp/file"];
  const controls = [...corpus.filter(specimen => controlIds.includes(specimen.id)), ...corpus.filter(specimen => ["tar", "jq", "join", "sed"].includes(specimen.command)).filter((specimen, index, array) => array.findIndex(other => other.command === specimen.command) === index), ...corpus.filter(specimen => specimen.group === "network").slice(0, 2)];
  for (const specimen of controls) for (const engine of engines) {
    const plain = await run(engine, specimen, false, true), traced = results.find(row => row.id === specimen.id)[engine];
    neutrality.push({ id: specimen.id, engine, plain, pass: !!plain.observation && !!traced.observation && compare(plain.observation, traced.observation).pass });
  }
  await write("instrumentation-controls.json", neutrality);
  for (const worker of sessions.values()) await worker.close(); sessions.clear();
  const performanceRows = [];
  for (const specimen of performanceCorpus) {
    const eligibility = {};
    for (const engine of engines) eligibility[engine] = await run(engine, specimen, false, true);
    const eligible = engines.every(engine => eligibility[engine].status === "pass");
    const trials = [];
    if (eligible) for (let repeat = 0; repeat < 5; repeat++) {
      const order = repeat % 2 ? [...engines].reverse() : engines;
      for (const engine of order) trials.push({ repeat, order, engine, loadBefore: loadavg(), ...await run(engine, specimen, false, true, 1), loadAfter: loadavg() });
    }
    performanceRows.push({ id: specimen.id, eligible, eligibility, trials, summary: Object.fromEntries(engines.map(engine => {
      const rows = trials.filter(row => row.engine === engine && row.status === "pass");
      return [engine, rows.length ? { executeMs: distribution(rows.map(row => row.observation.executeMs)), sampledPeakRssBytes: distribution(rows.map(row => row.observation.memory.sampledPeak.rss)), processMaxRssKiB: distribution(rows.map(row => row.observation.memory.processMaxRssKiB)) } : null];
    })) });
  }
  await write("performance.json", performanceRows);
  const hits = engine => [...new Set(results.flatMap(row => row[engine].observation?.registryEvents.map(event => event.name) ?? []))].sort();
  const reached = { virtual: hits(engines[0]), baseline: hits(engines[1]) };
  const report = { startedAt, finishedAt: new Date().toISOString(), revision, harnessRevision, movingHeadAtEnd: git("rev-parse", "HEAD"), dirtyAtEnd: git("status", "--short"),
    sourceSnapshot: "git archive at exact revision; no dirty production copied; cached development node_modules linked; source hashes recorded", sourceHashes, harnessHashes,
    nativeGolden: { path: goldPath, sha256: hash(goldBytes), profile: gold.primaryProfile, sourceHashes: gold.sourceHashes, toolIdentities: gold.toolIdentities },
    baseline: { version: JSON.parse(await readFile(join(baselineRoot, "package.json"), "utf8")).version, manifestSha256: hash(await readFile(join(baselineRoot, "package.json"))), bundleSha256: hash(await readFile(join(baselineRoot, "dist/bundle/index.js"))), lockSha256: hash(await readFile("benchmarks/package-lock.json")) },
    runtime: { node: process.version, versions: process.versions, platform: platform(), release: release(), arch: process.arch, cpus: cpus().map(cpu => cpu.model), totalMemoryBytes: totalmem(), startLoad, endLoad: loadavg() },
    totals: Object.fromEntries(engines.map(engine => [engine, totals(results, engine)])),
    intersections: { bothPass: results.filter(row => engines.every(engine => row[engine].status === "pass")).length, bothNonPass: results.filter(row => engines.every(engine => row[engine].status !== "pass")).map(row => row.id), virtualOnlyPass: results.filter(row => row[engines[0]].status === "pass" && row[engines[1]].status !== "pass").map(row => row.id), baselineOnlyPass: results.filter(row => row[engines[1]].status === "pass" && row[engines[0]].status !== "pass").map(row => row.id) },
    groups: Object.fromEntries([...new Set(results.map(row => row.group))].map(group => [group, Object.fromEntries(engines.map(engine => [engine, totals(results.filter(row => row.group === group), engine)]))])),
    inventory: names, reachedRegistry: reached,
    uncoveredRegistry: { virtual: names.virtual.unshadowedRegistry.filter(name => !reached.virtual.includes(name)), baseline: names.baseline.registered.filter(name => !reached.baseline.includes(name)) },
    commandCoverage: Object.fromEntries(names.virtual.registered.map(name => [name, { declaredRecipes: results.filter(row => row.group === "command" && row.command === name).map(row => row.id), actualRecipes: results.filter(row => row[engines[0]].observation?.registryEvents.some(event => event.name === name)).map(row => row.id), totals: Object.fromEntries(engines.map(engine => [engine, totals(results.filter(row => row.group === "command" && row.command === name), engine)])) }])),
    instrumentation: { total: neutrality.length, pass: neutrality.filter(row => row.pass).length, fail: neutrality.filter(row => !row.pass).length },
    performance: { total: performanceRows.length, eligible: performanceRows.filter(row => row.eligible).length, trials: performanceRows.flatMap(row => row.trials).length, failedTrials: performanceRows.flatMap(row => row.trials).filter(row => row.status !== "pass").length },
    limitations: ["224 additional recipes, not full Bash or utility coverage; three declared option families per default command do not establish complete support.", "Primary Bash5.3/coreutils9.7 plus individually hashed mixed native tool profiles, not uniformly GNU. Historical118 and prior19-unshadowed-plugin cohort unchanged.", "Exact stdout/stderr/status and /fixture tree bytes/types/links; selected mode assertions. No full timestamp, ownership, outside-root, backend protocol, concurrency or network-confinement proof.", "Public stdout byte-boundary differences retained; transport controls distinguish internal pipes/files from returned API encoding. No encoding heuristic or silent unsupported skip.", "Five performance repeats, one warmup per fresh child, alternating order, no instrumentation. Execution time excludes import/setup/snapshot; maxRSS is process-lifetime including setup/warmup. Sampled peaks can miss synchronous spikes; shared-host load and unequal implementation/lazy-load costs prevent general superiority claims.", "Baseline-only tools/kernel names are inventory gaps, not denominator-free passes; optional Python/JS/SafeJS and remote backends are unmeasured here.", "Different-agent fairness review pending. Product/72-hour/much-better requirement remains unproven."],
  };
  await write("report.json", report);
  await write("network-requests.json", server.requests);
  const lines = ["# Expanded comparison — frozen evidence", "", `Source revision: \`${revision}\`; just-bash \`${report.baseline.version}\`.`, "", "| Engine | Pass | Fail | Timeout | Harness/engine error | Total |", "|---|---:|---:|---:|---:|---:|"];
  for (const engine of engines) { const count = report.totals[engine]; lines.push(`| ${engine} | ${count.pass} | ${count.fail} | ${count.timeout} | ${count["harness-or-engine-error"]} | ${count.total} |`); }
  lines.push("", `Both pass: ${report.intersections.bothPass}; both non-pass: ${report.intersections.bothNonPass.length}. No skips/pending are passes.`, `Actual registry execution: virtual ${reached.virtual.filter(name => names.virtual.unshadowedRegistry.includes(name)).length}/${names.virtual.unshadowedRegistry.length} unshadowed default plugins; baseline ${reached.baseline.filter(name => names.baseline.registered.includes(name)).length}/${names.baseline.registered.length} registered names.`, `Instrumentation controls: ${report.instrumentation.pass}/${report.instrumentation.total}. Performance eligible: ${report.performance.eligible}/${report.performance.total}; failed measured trials: ${report.performance.failedTrials}.`, "", "## Failures (unchanged native expectation)", "", "| Recipe | virtual-bash | just-bash |", "|---|---|---|");
  for (const row of results.filter(row => engines.some(engine => row[engine].status !== "pass"))) lines.push(`| ${row.id.replaceAll("|", "\\|")} | ${engines.map(engine => row[engine].status === "pass" ? "pass" : `${row[engine].status}: ${row[engine].comparison?.assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field).join(", ") ?? "see raw error"}`).join(" | ")} |`);
  lines.push("", "## Limits", "", ...report.limitations.map(limit => `- ${limit}`), "", "Raw observations: functional.json; timings/memory: performance.json; byte API controls: transport-controls.json; exact inventory/source/oracle/runtime identities: report.json.", "");
  await writeFile(join(output, "REPORT.md"), lines.join("\n"), { flag: "wx" });
  console.log(JSON.stringify({ output, revision, totals: report.totals, instrumentation: report.instrumentation, performance: report.performance }, null, 2));
} finally {
  for (const worker of sessions.values()) await worker.close();
  await server.close();
  await rm(scratch, { recursive: true, force: true });
}
