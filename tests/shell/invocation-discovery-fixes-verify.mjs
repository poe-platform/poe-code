import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [phase, output] = process.argv.slice(2);
assert.ok(output && !existsSync(output), "provide a NEW evidence filename");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function snapshot() {
  const paths = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".ts") || path.endsWith(".json") || path.endsWith(".mjs")) paths.push(path);
    }
  }
  walk("src"); walk("tests/shell"); walk("tests/shell-stress/invocation-modes"); walk("tests/shell-stress/script-entrypoint");
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "benchmarks/tsconfig.json", "tests/shell-stress/helpers.ts", "tests/shell-stress/process.ts"]) paths.push(path);
  return Object.fromEntries(paths.sort().map(path => [resolve(path), hash(readFileSync(path))]));
}
const testArgs = files => ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell/invocation-discovery-fixes-imports.mjs", "--test", "--test-concurrency=1", ...files];
const commands = phase === "file-guard" ? [] : [["author", process.execPath, testArgs(["tests/shell/invocation-discovery-fixes.test.ts"])]];
if (phase === "final") {
  commands.push(["legacy", process.execPath, testArgs(["tests/shell-stress/invocation-modes/holdout.test.ts", "tests/shell/invocation-modes.test.ts"])]);
  commands.push(["closure-file", process.execPath, testArgs(["tests/shell/invocation-closure-discovery.test.ts", "tests/shell/invocation-closure-read.test.ts", "tests/shell/invocation-closure-sh.test.ts", "tests/shell/script-entrypoint.test.ts"])]);
}
if (phase === "checkpoint" || phase === "file-guard") commands.push(["file-holdout", process.execPath, testArgs(["tests/shell-stress/script-entrypoint/holdout.test.ts"])]);
if (phase === "final" || phase === "checkpoint") for (const [name, args] of [["global", []], ["build", ["-p", "tsconfig.build.json"]], ["benchmark", ["-p", "benchmarks/tsconfig.json"]]]) commands.push([name, "./node_modules/.bin/tsc", [...args, "--noEmit", "--listFiles"]]);
const report = { phase, head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), node: process.version, runs: [] };
for (const [name, executable, args] of commands) {
  const importsPath = `/tmp/safe-bash-discovery-fixes-${phase}-${name}-${process.pid}.jsonl`;
  const compiler = executable.endsWith("/tsc");
  const enumerate = compiler ? spawnSync(executable, args.map(arg => arg === "--listFiles" ? "--listFilesOnly" : arg), { timeout: 90000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }) : undefined;
  if (enumerate) assert.equal(enumerate.status, 0, enumerate.stdout + enumerate.stderr);
  const compilerPaths = enumerate?.stdout.trim().split("\n").filter(path => path.startsWith("/") && /\.\w*ts$/.test(path)) ?? [];
  const compilerBefore = Object.fromEntries(compilerPaths.map(path => [path, hash(readFileSync(path))]));
  const before = snapshot();
  const result = spawnSync(executable, args, { env: { ...process.env, DISCOVERY_FIX_IMPORTS: importsPath }, timeout: 90000, killSignal: "SIGKILL", detached: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.pid) { try { process.kill(-result.pid, "SIGKILL"); } catch {} }
  const after = snapshot();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const imports = existsSync(importsPath) ? readFileSync(importsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const importedMismatch = imports.filter(entry => before[entry.path] !== entry.hash || after[entry.path] !== entry.hash);
  const stdout = result.stdout?.toString() ?? "";
  const compilerAfter = Object.fromEntries(compilerPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null]));
  const compilerChanged = compilerPaths.filter(path => compilerBefore[path] !== compilerAfter[path]);
  const actualCompilerPaths = compiler ? stdout.split("\n").filter(path => path.startsWith("/") && /\.\w*ts$/.test(path)) : [];
  const unguardedCompilerPaths = actualCompilerPaths.filter(path => !(path in compilerBefore));
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  report.runs.push({ name, executable, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message, counts, stdout, stderr: result.stderr?.toString(), before, after, changed, imports, importedMismatch, compilerBefore, compilerAfter, compilerChanged, actualCompilerPaths, unguardedCompilerPaths });
  console.log(JSON.stringify({ name, status: result.status, counts, changed, importedMismatch: importedMismatch.length, productTs: new Set(imports.filter(entry => entry.path.includes("/src/")).map(entry => entry.path)).size, compilerChanged, unguardedCompilerPaths, compilerInputs: compilerPaths.length }));
}
for (const run of report.runs) if (run.pid) for (const target of [run.pid, -run.pid]) assert.throws(() => process.kill(target, 0), error => error.code === "ESRCH");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
