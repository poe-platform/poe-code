import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { boundedProcess, head, immutableJson, owned, sanitizedEnv, sha256, sourceHashes } from "./harness.js";
import type { ProcessResult } from "./harness.js";

interface RefreshRecord {
  timestamp: string;
  phase: string;
  beforeHead: string;
  afterHead: string;
  guardMode: string;
  importedSource: Record<string, { before: string | null; after: string | null }>;
  imports: string[];
  configsBefore: Record<string, string>;
  configsAfter: Record<string, string>;
  changedRelevant: string[];
  proofPresent: boolean;
  stable: boolean;
  totals: Record<string, number>;
  runs: ProcessResult[];
}

const prefix = process.argv[2] ?? "refreshed";
assert.match(prefix, /^[a-zA-Z0-9-]+$/u);
const shellCommit = "21a6b9149e3a0e35e14f1c740860971f08053686";
const cohortCommit = "c440c1aa51ce9f08deb822e30e31d5c171954965";
const temporary = await mkdtemp(resolve(owned, ".refresh-"));
const startHead = head();
const startSource = await sourceHashes();
const preservedPaths = (await readdir(owned)).filter(name => name.startsWith("post-ready-") && name.endsWith(".json"));
const preserved = Object.fromEntries(await Promise.all(preservedPaths.map(async name => [name, sha256(await readFile(`${owned}/${name}`))])));
const frozenChecks = [];
for (const [commit, directory] of [[shellCommit, "src/shell"], [cohortCommit, owned]] as const) {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "--", directory], { encoding: "utf8" }).trim().split("\n").filter(path => !path.endsWith(".md"));
  for (const path of paths) {
    const expected = sha256(execFileSync("git", ["show", `${commit}:${path}`]));
    const actual = sha256(await readFile(path));
    assert.equal(actual, expected, path);
    frozenChecks.push({ path, expected, actual });
  }
}
await immutableJson(`${prefix}-start.json`, { timestamp: new Date().toISOString(), startHead, shellCommit, cohortCommit, frozenChecks, preserved,
  cpCommit: "37e19b7", cpCommittedFilesystemHash: sha256(execFileSync("git", ["show", "37e19b7:src/commands/filesystem.ts"])),
  startingFilesystemHash: startSource["src/commands/filesystem.ts"],
  status: execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" }), index: execFileSync("git", ["diff", "--cached", "--name-status"], { encoding: "utf8" }) });

async function typeInputs(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") Object.assign(result, await typeInputs(path));
    } else if (/\.(?:ts|mts|cts|tsx|js|mjs|json)$/u.test(entry.name) && !path.endsWith(".json")) result[path] = sha256(await readFile(path));
  }
  return result;
}

const traced = ["--unhandled-rejections=strict", "--import", "tsx", "--import", `./${owned}/trace.mjs`];
const phases = [
  { name: "holdout", args: [...traced, "--test", `${owned}/holdout.test.ts`] },
  { name: "author", args: [...traced, "--test", "tests/shell/invocation-modes.test.ts"] },
  { name: "file", args: [...traced, "--test", "tests/shell/script-entrypoint.test.ts", "tests/shell-stress/script-entrypoint/holdout.test.ts"] },
  { name: "regression", args: [...traced, "--test", ...["core", "invoke", "stdin-origin", "input-units", "descriptor-inheritance", "glob-budget", "inline-input-limits"].map(name => `tests/shell/${name}.test.ts`)] },
  { name: "raw", args: [...traced, `${owned}/compare-frozen.ts`, `${prefix}-raw-comparison.json`, `${prefix}-holdout.json`] },
  { name: "global-types", args: ["node_modules/typescript/bin/tsc", "--noEmit", "--listFiles"], types: true },
  { name: "build-types", args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit", "--listFiles"], types: true },
];
const records: RefreshRecord[] = [];
try {
  for (const phase of phases) {
    const trace = `${temporary}/${phase.name}.log`;
    const beforeHead = head();
    const before = await sourceHashes();
    if (phase.types) {
      for (const directory of ["tests", "benchmarks", "node_modules/typescript/lib", "node_modules/@types/node", "node_modules/undici-types"]) Object.assign(before, await typeInputs(directory));
    }
    const configsBefore = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    const result = await boundedProcess(process.execPath, phase.args, { cwd: process.cwd(), env: { ...sanitizedEnv(), PATH: "/usr/bin:/bin", INVOCATION_TRACE: trace }, deadlineMs: 120000 });
    const after = await sourceHashes();
    const imports = phase.types
      ? [...new Set(result.stdout.split("\n").filter(line => line.startsWith(`${process.cwd()}/`) && /\.(?:ts|mts|cts|tsx)$/u.test(line)).map(path => relative(process.cwd(), path)))].sort()
      : [...new Set((await readFile(trace, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(path => relative(process.cwd(), path)))].sort();
    if (phase.types) for (const path of imports) after[path] = sha256(await readFile(path));
    const importedSource = Object.fromEntries(imports.map(path => [path, { before: before[path] ?? null, after: after[path] ?? null }]));
    const changedRelevant = Object.entries(importedSource).filter(([, hashes]) => hashes.before === null || hashes.before !== hashes.after).map(([path]) => path);
    const configsAfter = Object.fromEntries(await Promise.all(["tsconfig.json", "tsconfig.build.json"].map(async path => [path, sha256(await readFile(path))])));
    if (phase.types) for (const path of Object.keys(configsBefore)) if (configsBefore[path] !== configsAfter[path]) changedRelevant.push(path);
    const proofPresent = phase.types ? imports.length > 0 : imports.includes("src/shell/runtime.ts") && imports.every(path => path.endsWith(".ts"));
    const stable = changedRelevant.length === 0 && proofPresent;
    const totals = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].flatMap(key => {
      const match = new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout);
      return match ? [[key, Number(match[1])]] : [];
    }));
    const record = { timestamp: new Date().toISOString(), phase: phase.name, beforeHead, afterHead: head(),
      guardMode: phase.types ? "actual tsc --listFiles inputs and configs" : "actual .ts load-hook imports",
      importedSource, imports, configsBefore, configsAfter, changedRelevant, proofPresent, stable, totals, runs: [result] };
    await immutableJson(`${prefix}-${phase.name}.json`, record);
    records.push(record);
    console.log(`${phase.name}: exit=${result.code}, stable=${stable}, imports=${imports.length}, totals=${JSON.stringify(totals)}, changed=${JSON.stringify(changedRelevant)}`);
  }
  const endSource = await sourceHashes();
  const actualImports = [...new Set(records.filter(record => record.guardMode === "actual .ts load-hook imports").flatMap(record => record.imports))].sort();
  const endTree = Object.fromEntries(actualImports.map(path => [path, { start: startSource[path] ?? null, end: endSource[path] ?? null,
    phases: records.filter(record => record.importedSource[path]).map(record => ({ phase: record.phase, ...record.importedSource[path] })) } ]));
  const preservedAfter = Object.fromEntries(await Promise.all(preservedPaths.map(async name => [name, sha256(await readFile(`${owned}/${name}`))])));
  const pids = records.flatMap(record => record.runs.map(run => run.pid)).filter((pid): pid is number => pid !== undefined);
  for (const line of records[0]!.runs[0]!.stdout.split("\n").filter(line => line.startsWith('# {"id":'))) {
    const match = /"pid":(\d+)/u.exec(line);
    if (match) pids.push(Number(match[1]));
  }
  const survivingGroups = pids.filter(pid => { try { process.kill(-pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; return false; } });
  const summaries = records.map(record => ({ phase: record.phase, file: `${prefix}-${record.phase}.json`, code: record.runs[0]!.code, stable: record.stable,
    changedRelevant: record.changedRelevant, totals: record.totals, timedOut: record.runs[0]!.timedOut, overflow: record.runs[0]!.overflow }));
  await immutableJson(`${prefix}-summary.json`, { timestamp: new Date().toISOString(), startHead, endHead: head(), shellCommit, cohortCommit, summaries, endTree,
    endDiffersFromStart: actualImports.filter(path => startSource[path] !== endSource[path]), preserved, preservedAfter, recordedProcessGroups: pids, survivingGroups, watchersStarted: 0,
    currentStatus: execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" }), snapshotRule: "Reject only runs with relevant during-run drift; separately report end-tree differences. No retries or permanent foreign-owner freeze assumed." });
  assert.deepEqual(preservedAfter, preserved);
  assert.deepEqual(survivingGroups, []);
  if (summaries.some(record => record.code !== 0 || !record.stable || record.timedOut || record.overflow)) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
