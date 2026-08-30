import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { cases } from "./cases.js";
import { compare, totals, type Comparison } from "./model.js";
import { native } from "./native.js";
import { VirtualSession } from "./session.js";
import { safetyProbes } from "./safety.js";
import type { Execution } from "./model.js";
import { oraclePolicy, selectOracle } from "./oracle-policy.js";

async function fingerprint(directory: URL): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (root: URL): Promise<void> => {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), root);
      if (entry.isDirectory()) await visit(child);
      else { hash.update(child.href.slice(directory.href.length)); hash.update(await readFile(child)); }
    }
  };
  await visit(directory);
  return hash.digest("hex");
}

const startedAt = new Date().toISOString();
const sourceBefore = await fingerprint(new URL("../../../src/", import.meta.url));
const session = new VirtualSession();
const results: Comparison[] = [];
const liveNativeResults: Comparison[] = [];
const oracleKinds: Record<string, number> = {};
const safety: { name: string; status: Comparison["status"]; result: Execution }[] = [];
try {
  for (const fixture of cases) {
    const [oracle, actual] = await Promise.all([native(fixture), session.run({ fixture })]);
    liveNativeResults.push(compare(fixture, oracle, actual));
    const selected = selectOracle(fixture, oracle);
    oracleKinds[selected.kind] = (oracleKinds[selected.kind] ?? 0) + 1;
    const result = compare(fixture, selected.execution, actual);
    results.push(result);
    if (result.status !== "pass") console.log(`${result.status}: ${fixture.name}: ${result.differences.join(", ")}`);
  }
  for (const probe of safetyProbes) {
    const result = await session.run({ fixture: { name: probe.name, tool: probe.tool, feature: "safety", args: probe.args }, probe });
    const status = result.status === "completed" ? result.observation.exitCode === 0 ? "pass" : "fail" : result.status;
    safety.push({ name: probe.name, status, result });
    if (status !== "pass") console.log(`${status}: ${probe.name}`);
  }
} finally { await session.dispose(); }
const sourceAfter = await fingerprint(new URL("../../../src/", import.meta.url));
const binaries: Record<string, string> = {};
for (const path of ["/usr/bin/sed", "/usr/bin/awk", "/bin/bash"]) {
  try { binaries[path] = createHash("sha256").update(await readFile(path)).digest("hex"); }
  catch (error) { binaries[path] = `unavailable: ${String(error)}`; }
}
const summary = totals(results);
const report = {
  schemaVersion: 2, startedAt, completedAt: new Date().toISOString(),
  provenance: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: release(), nativeExecutableSha256: binaries,
    sourceBefore, sourceAfter, sourceChanged: sourceBefore !== sourceAfter,
    casesSha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex") },
  methodology: { nativeScope: "trusted repository fixtures only; fresh owned temporary directories; fixed native executable argv; curated pipelines only",
    locale: "C", nativeUmask: "000 (matches virtual filesystem creation defaults)", seededFileMode: "0644",
    virtualWorkerDeadlineMs: 3000, nativeDeadlineMs: 3000, outputLimitBytes: 1024 * 1024,
    assertions: ["stdout bytes", "stderr bytes", "exit status", "complete descendant file/directory map, bytes and mode"],
    pendingIsSuccess: false, unsupportedIsSuccess: false, superiorityDemonstrated: false,
    performanceClaim: "None: one cold-to-warm correctness run, not a controlled throughput benchmark" },
  oraclePolicy: { ...oraclePolicy, denominator: cases.length, byExpectationSource: oracleKinds },
  summary,
  liveNativeComparison: { role: "Unmodified live host comparison; BSD disagreement is not a GNU failure or a reclassified unsupported feature", summary: totals(liveNativeResults), results: liveNativeResults },
  byTool: Object.fromEntries(["sed", "awk", "pipeline"].map(tool => [tool, totals(results.filter(result => result.tool === tool))])),
  byFeature: Object.fromEntries([...new Set(cases.map(fixture => fixture.feature))].map(feature => [feature, totals(results.filter(result => result.feature === feature))])),
  safety: { summary: totals(safety), probes: safetyProbes, results: safety },
  combinedSummary: totals([...results, ...safety]), backgroundErrors: session.backgroundErrors, cases, results,
};
const path = new URL("./latest-report.json", import.meta.url);
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: path.pathname, summary, liveNativeSummary: report.liveNativeComparison.summary, oracleKinds, safety: report.safety.summary, combinedSummary: report.combinedSummary, sourceChanged: report.provenance.sourceChanged, backgroundErrors: report.backgroundErrors }));
if (report.combinedSummary.pass !== report.combinedSummary.total || report.provenance.sourceChanged || report.backgroundErrors.length) process.exitCode = 1;
