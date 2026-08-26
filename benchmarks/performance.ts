import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, loadavg, release } from "node:os";
import { engines, sha256, type CaseResult, type Engine } from "./model.js";
import { EngineSession } from "./session.js";
import { pinnedJustBash } from "./engines.js";
import { latencySummary, performanceWorkloads } from "./performance-workloads.js";

async function sourceHash(): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: URL, relative = ""): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = relative + entry.name;
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await visit(child, path + "/");
      else { hash.update(path); hash.update(await readFile(child)); }
    }
  };
  await visit(new URL("../src/", import.meta.url));
  return hash.digest("hex");
}

const warmups = 2;
const measurements = 10;
const startedAt = new Date().toISOString();
const sourceBefore = await sourceHash();
const loadBefore = loadavg();
const sessions = Object.fromEntries(engines.map(engine => [engine, new EngineSession(engine)])) as Record<Engine, EngineSession>;
const workloads = performanceWorkloads();
const samples: { workload: string; engine: Engine; phase: "warmup" | "measured"; iteration: number; result: CaseResult }[] = [];
try {
  for (const fixture of workloads) {
    for (let iteration = 0; iteration < warmups + measurements; iteration++) {
      const order = iteration % 2 ? [...engines].reverse() : engines;
      for (const engine of order) {
        const result = await sessions[engine].run({ kind: "fixture", fixture });
        samples.push({ workload: fixture.name, engine, phase: iteration < warmups ? "warmup" : "measured", iteration, result });
      }
    }
    console.log(`${fixture.name}: ${engines.map(engine => `${engine}=${samples.filter(sample => sample.workload === fixture.name && sample.engine === engine && sample.result.status === "pass").length}/${warmups + measurements}`).join(" ")}`);
  }
} finally { await Promise.all(engines.map(engine => sessions[engine].dispose())); }
const sourceAfter = await sourceHash();
const sourceChanged = sourceBefore !== sourceAfter;
const backgroundErrors = engines.flatMap(engine => sessions[engine].backgroundErrors.map(error => ({ engine, error })));
const summaries = workloads.flatMap(fixture => engines.map(engine => {
  const measured = samples.filter(sample => sample.workload === fixture.name && sample.engine === engine && sample.phase === "measured");
  const statuses = Object.fromEntries(["pass", "fail", "error", "timeout", "pending", "unsupported"].map(status => [status, measured.filter(sample => sample.result.status === status).length]));
  return { workload: fixture.name, engine, expectedSamples: measurements, statuses,
    verifiedLatency: !sourceChanged && !backgroundErrors.length && measured.length === measurements && statuses.pass === measurements ? latencySummary(measured.map(sample => sample.result.durationMs)) : null };
}));
const rootPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string; dependencies?: Record<string, string> };
const comparatorLock = JSON.parse(await readFile(new URL("./package-lock.json", import.meta.url), "utf8")) as { packages: Record<string, unknown> };
let installedComparator: unknown;
try { installedComparator = (JSON.parse(await readFile(new URL("./node_modules/just-bash/package.json", import.meta.url), "utf8")) as { version: string }).version; }
catch (error) { installedComparator = `unavailable: ${String(error)}`; }
const report = {
  schemaVersion: 1, startedAt, completedAt: new Date().toISOString(),
  validity: { sourceChanged, backgroundErrors, allAssertionsPassed: samples.every(sample => sample.result.status === "pass") },
  methodology: { kind: "performance pilot, not a release gate or superiority claim", warmups, measurements,
    ordering: "paired serial measurements, engine order alternates; all outliers retained",
    timing: "worker-reported execution plus full filesystem snapshot and assertions; fresh filesystem/shell setup and worker transport excluded",
    isolation: "persistent dedicated engine workers; fresh shell and memory filesystem per sample; host load not controlled",
    correctnessGate: "every sample checks complete stdout/stderr bytes, exit status, and regular-file bytes; failed workloads have null verifiedLatency",
    limitations: ["no confidence intervals", "no peak RSS measurement", "no remote or real filesystem timing", "no steady-state persistent-shell throughput", "small fixed workload matrix", "concurrent developer activity"],
    superiorityDemonstrated: false },
  versions: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
    virtualBash: rootPackage.version, runtimeDependencies: rootPackage.dependencies ?? {}, sourceBefore, sourceAfter,
    justBash: { pinned: pinnedJustBash, installed: installedComparator, lockEntry: comparatorLock.packages["node_modules/just-bash"] },
    harnessSha256: sha256(await readFile(new URL("./performance.ts", import.meta.url))), workloadsSha256: sha256(await readFile(new URL("./performance-workloads.ts", import.meta.url))) },
  loadBefore, loadAfter: loadavg(),
  workloads: workloads.map(fixture => ({ name: fixture.name, script: fixture.script, inputBytes: Buffer.from(fixture.stdin, "base64").length,
    inputSha256: sha256(Buffer.from(fixture.stdin, "base64")), expectedSha256: sha256(JSON.stringify(fixture.expected)) })),
  summaries,
  samples: samples.map(({ result, ...sample }) => ({ ...sample, status: result.status, durationMs: result.durationMs, reason: result.reason,
    assertions: result.assertions.map(assertion => ({ name: assertion.name, status: assertion.status,
      ...(assertion.status === "pass" ? {} : { expected: assertion.expected, actual: assertion.actual, detail: assertion.detail }) })) })),
};
await writeFile(new URL("./reports/performance-pilot.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ samples: samples.length, pass: samples.filter(sample => sample.result.status === "pass").length, sourceChanged, backgroundErrors }));
if (sourceChanged || backgroundErrors.length || !report.validity.allAssertionsPassed) process.exitCode = 1;
