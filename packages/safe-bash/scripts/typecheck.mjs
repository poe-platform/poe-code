import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildForTypecheck, verifyTypecheckInputs, requireBuiltPackage } from "./typecheck-inputs.mjs";
import { checkCurrentConsumerTypes, checkSourceConsumerTypes, createBuiltPackageBinding } from "./typecheck-consumers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2), build = args.includes("--build"), consumersOnly = args.includes("--consumers");
const reportIndex = args.indexOf("--report"), reportPath = reportIndex < 0 ? undefined : resolve(args[reportIndex + 1] ?? "");
const options = args.filter((_, index) => index !== reportIndex && (reportIndex < 0 || index !== reportIndex + 1));
assert.ok(options.every(option => ["--build", "--consumers"].includes(option)) && new Set(options).size === options.length);
if (reportPath) { assert.ok(args[reportIndex + 1]); assert.equal(existsSync(reportPath), false, "typecheck report output must not exist"); mkdirSync(reportPath, { recursive: true }); }
const report = { startedAt: new Date().toISOString(), node: process.version, buildRequested: build, consumersOnly, builds: 0, phases: [], runtimeExecutions: 0 };
const temporary = mkdtempSync(join(tmpdir(), "safe-bash-typecheck-"));
const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const compile = (label, compilerArgs) => {
  const result = spawnSync(process.execPath, [compiler, ...compilerArgs], { cwd: root, env: { ...process.env, TSX_DISABLE_CACHE: "1" }, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  const record = { label, status: result.status, stdout: result.stdout, stderr: result.stderr }; report.phases.push(record);
  if (!label.startsWith("resolution-")) {
    console.log(`typecheck: ${label}: exit ${result.status}`);
    if (result.status !== 0 && !label.startsWith("negative-")) {
      process.stdout.write(compilerArgs.includes("--traceResolution") ? result.stdout.split("\n").filter(line => /error TS\d+:/u.test(line)).join("\n") + "\n" : result.stdout);
      process.stderr.write(result.stderr);
    }
  }
  return record;
};

try {
  if (!build) requireBuiltPackage(root);
  report.inputs = verifyTypecheckInputs(root);
  if (build) {
    report.builds++;
    await buildForTypecheck(root, compile);
  }
  requireBuiltPackage(root);
  const binding = createBuiltPackageBinding(root);
  report.candidateBinding = { metadataSha256: binding.metadataSha256, declarations: [...binding.declarations].map(([path, sha256]) => ({ path, sha256 })) };
  const global = consumersOnly ? null : compile("source-and-tests", ["--noEmit"]);
  const historical = compile("historical-build-first-consumer", ["--noEmit", "-p", "tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json"]);
  report.sourceConsumers = checkSourceConsumerTypes(root, temporary, compile, binding);
  report.consumers = checkCurrentConsumerTypes(root, temporary, compile, binding);
  const passed = (!global || global.status === 0) && historical.status === 0 && report.sourceConsumers.passed && report.consumers.passed;
  report.status = passed ? "typecheck-passed-not-runtime-acceptance" : "typecheck-failed";
  process.exitCode = passed ? 0 : 2;
} catch (error) {
  report.status = error.code === "TYPECHECK_BUILD_REQUIRED" ? "build-prerequisite-required" : "typecheck-failed";
  report.error = error.message; process.stderr.write(`typecheck: ${error.message}\n`);
  process.exitCode = error.code === "TYPECHECK_BUILD_REQUIRED" ? 78 : 2;
} finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString();
  if (reportPath) writeFileSync(join(reportPath, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, builds: report.builds, currentConsumerGroups: report.consumers?.groups.length ?? 0, heldEvidenceInputs: report.inputs?.standaloneAdmission.heldEvidence.length ?? 0, runtimeExecutions: 0, cleaned: report.cleaned }));
}
