import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { recipes } from "./recipes.mjs";
import { compare, decode, hash } from "./common.mjs";

const base = resolve("benchmarks/reports/expanded-20260827");
const first = JSON.parse(await readFile(join(base, "run-bd2cacb/functional.json"), "utf8"));
const corrected = JSON.parse(await readFile(join(base, "corrected-bd2cacb/functional.json"), "utf8"));
const report = JSON.parse(await readFile(join(base, "corrected-bd2cacb/report.json"), "utf8"));
const oldReport = JSON.parse(await readFile(join(base, "run-bd2cacb/report.json"), "utf8"));
assert.equal(report.revision, oldReport.revision);
assert.deepEqual(report.sourceHashes, oldReport.sourceHashes);
assert.deepEqual(report.baseline, oldReport.baseline);
const engines = ["virtual-bash", "just-bash"];
const drift = [], changedScores = Object.fromEntries(engines.map(engine => [engine, []]));
for (const row of corrected) {
  const previous = first.find(other => other.id === row.id);
  for (const engine of engines) {
    if (!compare(previous[engine].observation, row[engine].observation).pass) drift.push({ id: row.id, engine, comparison: compare(previous[engine].observation, row[engine].observation) });
    if (previous[engine].status !== row[engine].status) changedScores[engine].push({ id: row.id, before: previous[engine].status, after: row[engine].status });
  }
}
const classifications = {
  "command/realpath/relative": ["core / Curie", "unsupported flag", "--relative-to=. rejected; GNU9.7 returns the relative path"],
  "command/wc/words-lines": ["core / Curie", "output formatting", "GNU9.7 multi-column padding absent; counts match"],
  "command/wc/unicode": ["core / Curie", "locale semantics", "LC_ALL=C native -m counts six bytes; product counts five codepoints; do not relabel C as UTF-8 to pass"],
  "command/env/clean": ["core / Curie", "environment enumeration profile", "GNU preserves B then A insertion order here; product outputs A then B. Exact-profile mismatch, not proof POSIX mandates ordering"],
  "command/env/unset": ["core / Curie", "environment propagation", "nested env -u A leaks outer PATH/HOME/LANG/LC_ALL/TZ/PWD after env -i"],
  "command/cksum/algorithm": ["bytes / route via root", "unsupported flag", "GNU9.7 -a sha256 rejected"],
  "command/patch/apply": ["diff-patch / Faraday", "unsupported flag", "GNU2.8 patch -s rejected; output namespace stays unapplied"],
  "command/patch/dry-run": ["diff-patch / Faraday", "unsupported flag", "GNU2.8 patch -s rejected before dry-run"],
  "command/patch/reverse": ["diff-patch / Faraday", "unsupported flag", "GNU2.8 patch -s rejected before reverse application"],
  "composition/patch-hash/patch-hash": ["diff-patch / Faraday", "unsupported flag with downstream effects", "patch -s fails then later hash command succeeds; exact stderr and file/hash checks catch failure despite final exit0"],
  "command/stat/timestamp": ["metadata / Faraday", "timestamp rendering", "%y emits three fractional digits versus GNU9.7 nine; epoch value agrees"],
  "kernel/type/type": ["shell / Sagan", "introspection profile", "type -t emits command where GNU5.3 emits builtin/file; function agrees"],
  "kernel/executable-file/executable-file": ["shell / Sagan", "script dispatch", "executable without shebang rejected instead of Bash script fallback"],
  "kernel/env-shebang/env-shebang": ["shell / Sagan", "script dispatch", "#!/usr/bin/env bash rejected"],
  "kernel/source/source": ["shell / Sagan", "missing builtin", "source not found; later printf masks status but expected bytes/error checks fail"],
  "kernel/dot/dot": ["shell / Sagan", "missing builtin", ". not found; later printf masks status but expected bytes/error checks fail"],
  "kernel/eval/eval": ["shell / Sagan", "missing builtin", "eval not found"],
  "kernel/parameter/parameter": ["shell / Sagan", "parameter expansion", "combined prefix/suffix/global replacement recipe rejected at parameter expansion"],
};
const failures = corrected.filter(row => row[engines[0]].status !== "pass").map(row => {
  assert.ok(classifications[row.id], `Classify ${row.id}`);
  const [owner, category, finding] = classifications[row.id];
  return { id: row.id, owner, category, finding, script: recipes().find(specimen => specimen.id === row.id).script,
    expected: row.expected, actual: row[engines[0]].observation, comparison: row[engines[0]].comparison };
});
const recipeInputs = specimen => JSON.stringify({ script: specimen.script, files: specimen.files, stdin: specimen.stdin, directories: specimen.directories,
  fileModes: specimen.fileModes, fileTimes: specimen.fileTimes, modes: specimen.modes, network: specimen.network });
const duplicates = [], seen = new Map();
for (const specimen of recipes()) {
  const key = hash(recipeInputs(specimen));
  if (seen.has(key)) duplicates.push({ id: specimen.id, sameWorkloadAs: seen.get(key) }); else seen.set(key, specimen.id);
}
const historicalHashes = {};
for (const path of ["benchmarks/model.ts", "benchmarks/fixtures.ts", "benchmarks/plugin-fixtures.ts", "benchmarks/dialect-fixtures.ts", "tests/fixtures/shell-cases.json"]) {
  const bytes = await readFile(path);
  assert.equal(hash(bytes), hash(execFileSync("git", ["show", `${report.revision}:${path}`])));
  historicalHashes[path] = hash(bytes);
}
const { parseFixtures, deterministicCases, probes } = await import("../fixtures.ts");
const { pluginFixtures } = await import("../plugin-fixtures.ts");
const { dialectFixtures } = await import("../dialect-fixtures.ts");
const historical = [...parseFixtures(await readFile("tests/fixtures/shell-cases.json", "utf8")), ...deterministicCases(), ...pluginFixtures(), ...dialectFixtures()];
const historicalOverlap = recipes().flatMap(specimen => historical.filter(old => old.script === specimen.script).map(old => ({ id: specimen.id, historicalName: old.name, script: specimen.script,
  sameStdinAndFiles: specimen.stdin === old.stdin && JSON.stringify(specimen.files) === JSON.stringify(old.initialFiles) })));
const baselineMissingNames = corrected.filter(row => row.group === "command" && !report.inventory.baseline.union.includes(row.command)).map(row => row.id);
const baselineBinaryBoundary = corrected.filter(row => row[engines[1]].status === "fail").flatMap(row => {
  const expected = decode(row.expected.stdout), observed = decode(row[engines[1]].observation.stdout);
  let validUtf8 = true; try { new TextDecoder("utf-8", { fatal: true }).decode(expected); } catch { validUtf8 = false; }
  return !validUtf8 && Buffer.from(expected.toString("latin1"), "utf8").equals(observed) ? [{ id: row.id, fields: row[engines[1]].comparison.assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field),
    finding: "Returned bytes exactly match UTF8 re-encoding of expected latin1 view; uninstrumented controls establish public API metadata loss separately. Not a waiver or proof of internal command corruption." }] : [];
});
const summary = { createdAt: new Date().toISOString(), revision: report.revision, harnessRevision: report.harnessRevision, sourceHashesMatchHistoricalRun: true,
  identicalProductObservations: corrected.length * engines.length - drift.length, observationDrift: drift, oracleOnlyScoreChanges: changedScores,
  failures, ownerCounts: Object.fromEntries([...new Set(failures.map(row => row.owner))].map(owner => [owner, failures.filter(row => row.owner === owner).length])),
  corpus: { rows: recipes().length, uniqueInputWorkloads: seen.size, duplicateInputWorkloads: duplicates, historicalRecipes: historical.length, historicalProbes: probes.length, historicalScriptOverlap: historicalOverlap, historicalSourceHashes: historicalHashes },
  baselineMissingDeclaredCommandNames: baselineMissingNames, baselineTerminalEncodingEvidence: baselineBinaryBoundary,
  caveats: ["Failure ownership is routing, not authorization to edit during this benchmark task. These are frozen findings, not assertions that later concurrent source is unchanged.", "Exact-profile formatting/environment order failures remain counted but are not automatically semantic/data-loss bugs.", "Native correction changes scores, not product behavior. The first run remains historical. No repeated input recipe is presented as an additional unique workflow.", "Performance pilot loads product TypeScript through tsx and baseline installed bundled JavaScript. Execution timing excludes startup, but memory includes package/transpiler/setup differences; built-ESM parity and larger cohost-controlled measurements remain follow-up."] };
await writeFile(join(base, "ANALYSIS.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
const lines = ["# Expanded comparison triage and coverage", "", `Frozen production \`${report.revision}\`; corrected harness \`${report.harnessRevision}\`.`, "",
  `Corrected totals: virtual-bash **206 pass / 18 fail**; just-bash3.4.2 **155 pass / 69 fail**, each /224. Zero skips, timeouts, pending or harness/engine errors. Both pass148; both fail11; baseline alone passes7 kernel cases.`,
  "", `Initial191/224 versus146/224 is preserved, not accepted: correcting two oracle defects changes15/9 scores. Product source hashes match; ${summary.identicalProductObservations}/448 stdout/stderr/status/tree observations are unchanged across the two runs.`,
  "", "## Frozen failures to route", "", "| Recipe | Owner | Classification and finding |", "|---|---|---|"];
for (const row of failures) lines.push(`| ${row.id} | ${row.owner} | ${row.category}: ${row.finding} |`);
lines.push("", "## Actual coverage and missing scope", "",
  "- Default registrations56; actual kernel18 with three overlapping registry names; bash/sh add two entrypoints: union73. Baseline registry83 and kernel40 overlap three: union120. Optional curl and SafeJS are separate, not default-count inflation.",
  "- All53 unshadowed default plugin implementations execute, plus optional curl. The three shadowed registrations (true/false/pwd) are exercised as kernel behavior, not claimed as executed plugin code. Baseline executes48/83 registered implementations plus curl; unexecuted and baseline-only names are fully listed in corrected-bd2cacb/report.json.",
  `- The224 declared cases contain${seen.size} unique input workloads; duplicate inputs and the${historicalOverlap.length} exact-script overlaps with historical115 recipes+3 stress probes are enumerated in ANALYSIS.json. Recipes were not pruned after outcomes.`,
  `- Baseline${baselineMissingNames.length} rows target six names absent from its registry/kernel union (base32/cksum/mktemp/patch/realpath/xxd). They remain failures in the denominator; unsupported names are explicit, not silently skipped. The baseline also has53 union names absent from this product and not broadly tested here.`,
  `- ${baselineBinaryBoundary.length} baseline failures have exact evidence consistent with public terminal byte-tag loss; those failures remain raw API mismatches, not attributed to internal cat/gzip/curl without further evidence. Controls separately demonstrate internal byte pipe/file preservation.`,
  "- Kernel cohort is29/36 versus36/36; composition11/12 versus8/12; optional local-network8/8 versus2/8. No source/dot/eval or executable-script gaps are hidden by default-registration coverage.",
  "- Three command recipes do not exhaust flags: tar roundtrip/list/gzip-tree does not prove all header formats, hardlinks, extraction security or provider identity; metadata/table cases do not replace their independent suites. Optional SafeJS/Python/JS, remote backend capabilities, protocols and broad concurrent cancellation remain unmeasured here.",
  "", "## Matched performance pilot", "",
  "Three of four candidates match both engines; binary256KiB is excluded from timing because baseline returned bytes fail the native assertion, not because it is slow. Five fresh-process trials per engine, alternating order and one warmup each, produce30/30 matched measured results. Instrumentation controls24/24 pass.",
  "", "| Workload | virtual-bash median ms | just-bash median ms |", "|---|---:|---:|");
const performance = JSON.parse(await readFile(join(base, "corrected-bd2cacb/performance.json"), "utf8"));
for (const row of performance.filter(row => row.eligible)) lines.push(`| ${row.id} | ${row.summary[engines[0]].executeMs.median.toFixed(3)} | ${row.summary[engines[1]].executeMs.median.toFixed(3)} |`);
lines.push("", "The product is slower on sort5000; no combined speed score is reported. Raw memory/timing trials include before/after RSS, sampled peaks and process-lifetime maxRSS. Shared-host load, five repeats, sampling misses and TS-source versus installed-bundle startup/setup differences limit inference. Do not call these general speed/memory superiority results.", "", ...summary.caveats.map(caveat => `- ${caveat}`), "", "Different-agent fairness review is pending. No full-product,72-hour or ‘much better’ achievement claim.", "");
await writeFile(join(base, "ANALYSIS.md"), lines.join("\n"), { flag: "wx" });
console.log(JSON.stringify({ identicalProductObservations: summary.identicalProductObservations, drift, ownerCounts: summary.ownerCounts, corpus: summary.corpus, baselineMissing: baselineMissingNames.length, binaryBoundary: baselineBinaryBoundary.length }, null, 2));
