import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
assert(process.argv[2]?.startsWith("/tmp/safe-bash-getopts-runtime."));
const output = realpathSync(process.argv[2]);
const run = JSON.parse(readFileSync(join(output, "RUN.json")));
const integrity = JSON.parse(readFileSync(join(output, "INTEGRITY.json")));
const baseline = JSON.parse(readFileSync(join(repo, "tests/shell/getopts/runtime/baseline.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { candidate: run.candidate, originalCore: run.rows.find(row => row.label === "legacy-core-final-02"), prerequisiteCorrection: "Initial core ran before build and lacked dist/commands/regex-execution/worker.js. Unmodified candidate build now exists; no test/production modification.", rows: [] };
const core = baseline.commands["legacy-core-final-02"];
if (process.argv.includes("--holdouts-only")) report.core = JSON.parse(readFileSync(join(output, "SUPPLEMENTAL.json"))).core;
else {
const result = spawnSync(process.execPath, core.slice(1), { cwd: join(output, "archive"), env: { ...process.env, TSX_DISABLE_CACHE: "1", TMPDIR: join(output, "tmp") }, timeout: 180000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
writeFileSync(join(output, "logs/core-built.stdout"), result.stdout ?? "");
writeFileSync(join(output, "logs/core-built.stderr"), result.stderr ?? "");
report.core = { command: [process.execPath, ...core.slice(1)], status: result.status, signal: result.signal, counts: Object.fromEntries([...String(result.stdout).matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) };
console.log("core-built", report.core);
}
const owner = "tests/integration/owned-output-production-independent-20260827";
const consumer = join(output, "holdout-consumer-resolved");
mkdirSync(consumer);
cpSync(join(output, "consumer/node_modules/virtual-bash"), join(consumer, "node_modules/virtual-bash"), { recursive: true });
writeFileSync(join(consumer, "package.json"), '{"type":"module","private":true}\n');
report.frozenInputs = {};
for (const name of ["CASES.json", "assert-observation.mjs", "candidate-v1/run-case.mjs", "candidate-v1/core-cases.mjs", "candidate-v1/network-cases.mjs", "candidate-v1/audit-loader.mjs"]) {
  const bytes = execFileSync("git", ["show", run.candidate + ":" + owner + "/" + name], { cwd: repo });
  writeFileSync(join(consumer, name.split("/").at(-1)), bytes);
  report.frozenInputs[owner + "/" + name] = hash(bytes);
}
const state = join(output, "holdout-state-resolved.json");
writeFileSync(state, JSON.stringify({ consumer, installed: Object.fromEntries(Object.entries(integrity.moved).filter(([path]) => !path.endsWith("/"))) }) + "\n");
for (const fixture of JSON.parse(readFileSync(join(consumer, "CASES.json"))).cases) {
  const command = ["--experimental-loader", join(consumer, "audit-loader.mjs"), join(consumer, "run-case.mjs"), fixture.id];
  const child = spawnSync(process.execPath, command, { cwd: consumer, env: { ...process.env, TMPDIR: join(output, "tmp"), REVIEW_STATE: state, REVIEW_TRACE: join(output, "logs/holdout-resolved-" + fixture.id + ".trace") }, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  writeFileSync(join(output, "logs/holdout-resolved-" + fixture.id + ".stdout"), child.stdout ?? "");
  writeFileSync(join(output, "logs/holdout-resolved-" + fixture.id + ".stderr"), child.stderr ?? "");
  let observation;
  try { observation = JSON.parse(child.stdout); } catch {}
  report.rows.push({ id: fixture.id, status: child.status, signal: child.signal, error: child.error?.message, observation });
  console.log(fixture.id, child.status, observation?.status);
}
report.childrenSettled = true;
writeFileSync(join(output, "SUPPLEMENTAL-resolved.json"), JSON.stringify(report, null, 2) + "\n");
if (report.core.status !== 0 || report.rows.some(row => row.status !== 0)) process.exitCode = 1;
