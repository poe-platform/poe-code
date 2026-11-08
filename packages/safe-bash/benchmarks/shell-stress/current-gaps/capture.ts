import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { oldGaps, additionalCases } from "../../../tests/shell-stress/current-gaps/cases.js";
import { independentBash, referenceIdentity } from "../../../tests/shell-stress/current-gaps/reference.js";
import { root, runVirtualScript, sourceEvidence } from "../../../tests/shell-stress/helpers.js";
import { isolatedSpawn } from "../../../tests/shell-stress/process.js";

const before = sourceEvidence();
const reference = await referenceIdentity();
const cases = [];
for (const fixture of [...oldGaps, ...additionalCases]) {
  const started = new Date().toISOString();
  const expected = await independentBash(fixture);
  try {
    const actual = await runVirtualScript(fixture);
    cases.push({ fixture, started, expected, actual, outcome: isDeepStrictEqual(actual, expected) ? "pass" : "fail" });
  } catch (error) {
    cases.push({ fixture, started, expected, outcome: "invalid", error: String(error) });
  }
}
const patterns = [];
for (const mode of ["matcher", "shell"] as const) {
  for (const length of [2048, 8192, 32768, 65536]) {
    const sampleBefore = sourceEvidence();
    const started = performance.now();
    const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("../../../tests/shell-stress/current-gaps/pattern-child.ts", import.meta.url))], {
      cwd: root, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      input: JSON.stringify({ mode, length }), timeout: 1500, maxBuffer: 65536,
    });
    const wallMs = performance.now() - started;
    const sampleAfter = sourceEvidence();
    patterns.push({ mode, length, wallMs, before: sampleBefore.aggregate, after: sampleAfter.aggregate,
      changedSources: Object.keys(sampleAfter.hashes).filter(path => sampleAfter.hashes[path] !== sampleBefore.hashes[path]),
      status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString(), stderr: result.stderr.toString() });
  }
}
const bashPattern = await independentBash({ name: "unmatched-bracket-bash-length-65536", script: 'case x in $VALUE) printf wrong;; *) printf nomatch;; esac', env: { VALUE: "[".repeat(65536) } });
const command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "tests/shell-stress/current-gaps/pattern.test.ts"];
const regression = await isolatedSpawn(process.execPath, command, { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 });
const after = sourceEvidence();
const harnessPaths = ["tests/shell-stress", "tests/shell-stress/current-gaps", "benchmarks/shell-stress/current-gaps"].flatMap(directory => readdirSync(directory).filter(name => name.endsWith(".ts")).map(name => `${directory}/${name}`));
const harnessHashes = Object.fromEntries(harnessPaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const report = {
  before, after, reference, harnessHashes,
  changedSources: [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].filter(path => before.hashes[path] !== after.hashes[path]),
  safety: { shell: false, detached: true, deadlineMs: 1500, maxCombinedOutputBytes: 65536, abortRequestMs: 10, repetitionsPerLengthAndMode: 1, cleanup: "existing isolatedSpawn process-group SIGKILL on timeout, exit, and close; sanitized per-reference temporary directory removed in finally" },
  cases, patterns, bashPattern,
  regression: { command: [process.execPath, ...command], status: regression.status, signal: regression.signal, error: regression.error?.message, stdout: regression.stdout.toString(), stderr: regression.stderr.toString() },
  totals: { cases: cases.length, pass: cases.filter(row => row.outcome === "pass").length, fail: cases.filter(row => row.outcome === "fail").length, invalid: cases.filter(row => row.outcome === "invalid").length, oldGaps: oldGaps.length, oldGapFailures: cases.slice(0, oldGaps.length).filter(row => row.outcome === "fail").length },
};
const json = JSON.stringify(report, null, 2);
console.log(`*** Begin Patch\n*** Add File: benchmarks/shell-stress/current-gaps/evidence.json\n${json.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`);
process.exitCode = cases.every(row => row.outcome === "pass") && regression.status === 0 && report.changedSources.length === 0 ? 0 : 1;
