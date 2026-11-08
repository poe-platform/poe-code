import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deterministicCases, parseFixtures, probes } from "./fixtures.js";
import { engines, sha256, summarize, type CaseResult, type Task } from "./model.js";
import { EngineSession } from "./session.js";
import { pluginFixtures } from "./plugin-fixtures.js";
import { dialectFixtures } from "./dialect-fixtures.js";

const root = fileURLToPath(new URL("../", import.meta.url));

async function sourceFingerprint(directory: string): Promise<string> {
  const entries: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (["node_modules", "reports"].includes(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:ts|[cm]?js|json)$/u.test(entry.name)) {
        entries.push(`${path}\0${sha256(await readFile(join(directory, path)))}`);
      }
    }
  };
  await walk("");
  return sha256(entries.join("\n"));
}

async function gitRevision(): Promise<string | null> {
  try {
    const head = (await readFile(join(root, ".git/HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    try { return (await readFile(join(root, ".git", ref), "utf8")).trim(); }
    catch {
      const packed = await readFile(join(root, ".git/packed-refs"), "utf8");
      return packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
    }
  } catch { return null; }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    output: { type: "string", default: "benchmarks/reports/current.json" },
    seed: { type: "string", default: "1526603814" },
    "timeout-ms": { type: "string", default: "6500" },
  } });
  const seed = Number(values.seed);
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be an unsigned 32-bit integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new RangeError("timeout-ms must be 100 through 60000");
  const corpusPath = join(root, "tests/fixtures/shell-cases.json");
  const corpusText = await readFile(corpusPath, "utf8");
  const fixtures = parseFixtures(corpusText);
  const generated = deterministicCases(seed);
  const integrations = pluginFixtures();
  const dialects = dialectFixtures();
  const tasks: Task[] = [...fixtures, ...generated, ...integrations, ...dialects].map((fixture) => ({ kind: "fixture", fixture }));
  tasks.push(...probes);
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string; dependencies?: Record<string, string> };
  const rootLockText = await readFile(join(root, "package-lock.json"), "utf8");
  const rootLock = JSON.parse(rootLockText) as { packages: Record<string, { version?: string }> };
  const benchmarkLockText = await readFile(new URL("./package-lock.json", import.meta.url), "utf8");
  const benchmarkLock = JSON.parse(benchmarkLockText) as { packages: Record<string, { version?: string; integrity?: string; resolved?: string }> };
  const comparator = benchmarkLock.packages["node_modules/just-bash"];
  let installedComparatorVersion: string | null = null;
  try { installedComparatorVersion = (JSON.parse(await readFile(new URL("./node_modules/just-bash/package.json", import.meta.url), "utf8")) as { version: string }).version; }
  catch {}
  const sourceBefore = await sourceFingerprint(join(root, "src"));
  const benchmarkBefore = await sourceFingerprint(fileURLToPath(new URL("./", import.meta.url)));
  const revisionBefore = await gitRevision();
  const startedAt = new Date().toISOString();
  const sessions = engines.map((engine) => new EngineSession(engine, timeoutMs));
  const results: CaseResult[] = [];
  try {
    for (const [index, task] of tasks.entries()) {
      const outcomes = await Promise.all(sessions.map((session) => session.run(task)));
      results.push(...outcomes);
      const name = task.kind === "fixture" ? task.fixture.name : task.name;
      console.error(`[${index + 1}/${tasks.length}] ${name}: ${outcomes.map((outcome) => `${outcome.engine}=${outcome.status}`).join(" ")}`);
    }
  } finally { await Promise.all(sessions.map((session) => session.dispose())); }
  const sourceAfter = await sourceFingerprint(join(root, "src"));
  const benchmarkAfter = await sourceFingerprint(fileURLToPath(new URL("./", import.meta.url)));
  const sourceChangedDuringRun = sourceBefore !== sourceAfter || benchmarkBefore !== benchmarkAfter;
  const backgroundErrors = sessions.flatMap((session) => session.backgroundErrors.map((message) => ({ engine: session.engine, message })));
  const summary = summarize(results);
  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    validity: { sourceChangedDuringRun, backgroundErrors,
      comparableSnapshot: !sourceChangedDuringRun && backgroundErrors.length === 0 },
    versions: {
      virtualBash: { packageVersion: packageJson.version, gitRevisionBefore: revisionBefore, gitRevisionAfter: await gitRevision(),
        sourceSha256Before: sourceBefore, sourceSha256After: sourceAfter, runtimeDependencies: packageJson.dependencies ?? {} },
      justBash: { pinnedVersion: "3.4.2", installedVersion: installedComparatorVersion, ...comparator,
        isolatedLockSha256: sha256(benchmarkLockText) },
      node: process.version, platform: platform(), architecture: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? "unknown",
      tooling: { rootLockSha256: sha256(rootLockText),
        versions: Object.fromEntries(["tsx", "typescript", "@types/node"].map((name) => [name, rootLock.packages[`node_modules/${name}`]?.version ?? null])) },
      harnessSha256Before: benchmarkBefore, harnessSha256After: benchmarkAfter,
    },
    corpus: { path: "tests/fixtures/shell-cases.json", sha256: sha256(corpusText), fixtureCount: fixtures.length,
      generatedCaseCount: generated.length, pluginIntegrationCount: integrations.length, pinnedGnuDialectCount: dialects.length,
      probeCount: probes.length, totalPerEngine: tasks.length, seed, filters: null, everyFixtureIncluded: true },
    methodology: {
      cwd: "/fixture", environment: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" },
      workerTimeoutMs: timeoutMs, runtimeTimeoutMs: 4500, maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000,
      fileSnapshot: "Complete fixture-root regular-file map, exact bytes; symlinks and special files fail; empty directories and metadata are outside oracle schema",
      output: "Exact byte comparison; native bytes for virtual-bash; just-bash declared bytes when available, otherwise explicit UTF-8 encoding of public text output",
      binaryOutput: "Invalid-UTF-8 expected output is pending when only a text API is exposed; binary file contents use raw filesystem reads",
      timing: "Descriptive single-run execution plus snapshot timings; not warmed, randomized, statistically analyzed, or a performance superiority claim",
      workerIsolation: "Separate engine worker threads, fresh in-memory filesystem and shell for each fixture; concurrent probe intentionally shares one shell",
      pluginInstallation: "All delivered standard/text/structured/search/byte/diff-patch plugins installed with Shell.use; empty execution awaits setup before timed workload; actual plugin and command names recorded per result",
      workerMemoryLimit: "256 MiB V8 old-generation limit only; not a hard RSS or external-buffer allocation bound",
      denominator: "All pass/fail/error/timeout/pending/unsupported results remain in totals, including every advanced-pending fixture",
    },
    primarySources: [
      "https://github.com/vercel-labs/just-bash",
      "https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/README.md",
      "https://registry.npmjs.org/just-bash/3.4.2",
      "Installed pinned package dist/Bash.d.ts, dist/types.d.ts, dist/encoding.d.ts, dist/fs/interface.d.ts",
    ],
    claims: { superiorityDemonstrated: false, scope: "This corpus and these probes only; full-shell, security, all tool flags, adapter breadth, and general performance superiority remain unproven" },
    summary,
    results,
  };
  const output = resolve(root, values.output!);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, validity: report.validity, summary: summary.byEngine, overall: summary.overall }));
  process.exitCode = sourceChangedDuringRun || backgroundErrors.length || summary.overall !== "pass" ? 1 : 0;
}

await main();
