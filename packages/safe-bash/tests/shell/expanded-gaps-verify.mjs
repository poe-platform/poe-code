import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = process.argv[2];
assert.ok(output && !existsSync(output));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function snapshot() {
  const paths = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|json|mjs)$/.test(path)) paths.push(resolve(path));
    }
  }
  walk("src"); walk("tests/shell"); walk("tests/shell-stress/invocation-modes"); walk("tests/shell-stress/current-shell");
  return Object.fromEntries(paths.sort().map(path => [path, hash(readFileSync(path))]));
}
const testArgs = paths => ["--unhandled-rejections=strict", "--import", "tsx", "--import", "./tests/shell/invocation-discovery-fixes-imports.mjs", "--test", "--test-concurrency=1", ...paths];
const commands = [
  ["expanded-author", process.execPath, testArgs(["tests/shell/expanded-gaps-fallback.test.ts", "tests/shell/expanded-gaps-fallback-host.cases.ts", "tests/shell/expanded-gaps-env.test.ts", "tests/shell/expanded-gaps-env-host.cases.ts", "tests/shell/expanded-gaps-parameter.test.ts", "tests/shell/expanded-gaps-bounds.test.ts"])],
  ["env-author", process.execPath, testArgs(["tests/shell/env-replacement.cases.ts", "tests/shell/env-replacement-bounds.test.ts"])],
  ["current-shell43", process.execPath, testArgs(["tests/shell-stress/current-shell/current-shell.test.ts"])],
  ["previous86", process.execPath, testArgs(["tests/shell/source-dot-eval-source.test.ts", "tests/shell/source-dot-eval-source-host.test.ts", "tests/shell/source-dot-eval-eval.test.ts", "tests/shell/source-dot-eval-eval-host.test.ts"])],
  ["legacy415", process.execPath, testArgs(["tests/shell-stress/invocation-modes/holdout.test.ts", "tests/shell/invocation-modes.test.ts", "tests/shell/invocation-closure-discovery.test.ts", "tests/shell/invocation-closure-read.test.ts", "tests/shell/invocation-closure-sh.test.ts"])],
];
for (const [name, args] of [["global", []], ["build", ["-p", "tsconfig.build.json"]], ["benchmark", ["-p", "benchmarks/tsconfig.json"]]]) commands.push([name, "./node_modules/.bin/tsc", [...args, "--noEmit", "--listFiles"]]);
const report = { head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), node: process.version, runs: [] };
for (const [name, executable, args] of commands) {
  const compiler = executable.endsWith("/tsc");
  const enumeration = compiler ? spawnSync(executable, args.map(arg => arg === "--listFiles" ? "--listFilesOnly" : arg), { timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }) : undefined;
  if (enumeration) assert.equal(enumeration.status, 0, enumeration.stderr + enumeration.stdout);
  const compilerPaths = enumeration?.stdout.split("\n").filter(path => path.startsWith("/") && /\.\w*ts$/.test(path)) ?? [];
  const before = { ...snapshot(), ...Object.fromEntries(compilerPaths.map(path => [path, hash(readFileSync(path))])) };
  const importsPath = `/tmp/expanded-gaps-${name}-${process.pid}.jsonl`;
  const result = spawnSync(executable, args, { env: { ...process.env, DISCOVERY_FIX_IMPORTS: importsPath }, detached: true, timeout: 90000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
  if (result.pid) { try { process.kill(-result.pid, "SIGKILL"); } catch {} }
  const after = { ...snapshot(), ...Object.fromEntries(compilerPaths.map(path => [path, existsSync(path) ? hash(readFileSync(path)) : null])) };
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const imports = existsSync(importsPath) ? readFileSync(importsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const importedMismatch = imports.filter(entry => entry.hash !== before[entry.path] || entry.hash !== after[entry.path]);
  const stdout = result.stdout?.toString() ?? "";
  const actualCompilerPaths = compiler ? stdout.split("\n").filter(path => path.startsWith("/") && /\.\w*ts$/.test(path)) : [];
  const unguardedCompilerPaths = actualCompilerPaths.filter(path => !(path in before));
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  report.runs.push({ name, executable, args, pid: result.pid, status: result.status, error: result.error?.message, counts, stdout, stderr: result.stderr?.toString(), before, after, changed, imports, importedMismatch, actualCompilerPaths, unguardedCompilerPaths });
  console.log(JSON.stringify({ name, status: result.status, counts, changed, importedMismatch: importedMismatch.length, unguardedCompilerPaths, compilerInputs: compilerPaths.length }));
}
for (const run of report.runs) if (run.pid) for (const target of [run.pid, -run.pid]) assert.throws(() => process.kill(target, 0), error => error.code === "ESRCH");
for (const run of report.runs) {
  run.beforeDigest = hash(JSON.stringify(run.before)); run.afterDigest = hash(JSON.stringify(run.after));
  run.guardedFiles = Object.keys(run.before).length;
  run.compilerPathsDigest = hash(JSON.stringify(run.actualCompilerPaths)); run.compilerInputs = run.actualCompilerPaths.length;
  run.importedSource = run.imports.filter(entry => /\/src\/shell\//.test(entry.path));
  delete run.before; delete run.after; delete run.actualCompilerPaths; delete run.imports;
}
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
