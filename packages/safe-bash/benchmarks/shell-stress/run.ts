import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bashVersion, root, sourceEvidence } from "../../tests/shell-stress/helpers.js";
import { isolatedSpawn } from "../../tests/shell-stress/process.js";

const before = sourceEvidence();
const authoredPaths = readdirSync(join(root, "tests/shell-stress")).filter(path => path.endsWith(".ts")).map(path => `tests/shell-stress/${path}`);
const reportPaths = readdirSync(join(root, "benchmarks/shell-stress")).filter(path => path.endsWith(".ts")).map(path => `benchmarks/shell-stress/${path}`);
const harnessHashes = Object.fromEntries([...authoredPaths, ...reportPaths].map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
const command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "tests/shell-stress/differential.test.ts", "tests/shell-stress/lifecycle.test.ts", "tests/shell-stress/process.test.ts"];
const result = await isolatedSpawn(process.execPath, command, {
  cwd: root, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
});
const scopedFlags = ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node"];
const validations = [];
for (const args of [["--noEmit"], [...scopedFlags, ...authoredPaths, ...reportPaths]]) {
  const started = new Date().toISOString();
  const command = ["node_modules/typescript/bin/tsc", ...args];
  const result = await isolatedSpawn(process.execPath, command, { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
  validations.push({ command: [process.execPath, ...command], started, finished: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString(), stderr: result.stderr.toString() });
}
const after = sourceEvidence();
const output = result.stdout.toString();
const totals = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(output)?.[1] ?? NaN)]));
const report = {
  command: [process.execPath, ...command],
  bash: bashVersion(),
  before,
  after,
  harnessHashes,
  validations,
  changedSources: [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].filter(path => before.hashes[path] !== after.hashes[path]),
  exitCode: result.status,
  signal: result.signal,
  error: result.error?.message,
  totals,
  stdout: output,
  stderr: result.stderr.toString(),
};
const json = JSON.stringify(report, null, 2);
if (process.argv.includes("--patch")) {
  console.log(`*** Begin Patch\n*** Add File: benchmarks/shell-stress/evidence.json\n${json.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`);
} else console.log(json);
process.exitCode = result.status === 0 && !result.error && validations.every(result => result.exitCode === 0) && report.changedSources.length === 0 ? 0 : 1;
