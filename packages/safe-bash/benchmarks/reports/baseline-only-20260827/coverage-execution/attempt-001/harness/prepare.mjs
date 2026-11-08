import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { cases, environment, budgets, networkFixture, validateCases } from "./cases.mjs";

const root = "/Users/kjopek/Workspace/safe-bash";
const destination = "benchmarks/reports/baseline-only-20260827/coverage-execution";
const setup = "benchmarks/reports/baseline-only-20260827/coverage-setup";
assert.equal(process.cwd(), root, "Preparation is restricted to the assigned workspace");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const inventory = json(`${setup}/inventory.json`);
const counts = validateCases(inventory);
assert.equal(json("benchmarks/node_modules/just-bash/package.json").version, "3.4.2");
assert.equal(json("benchmarks/package-lock.json").packages["node_modules/just-bash"].version, "3.4.2");

const evidence = path => {
  const stat = lstatSync(path);
  return {
    path,
    realpath: realpathSync(path),
    symlink: stat.isSymbolicLink() ? readlinkSync(path) : null,
    bytes: readFileSync(path).length,
    sha256: hash(readFileSync(path)),
  };
};
const publish = (path, value) => {
  assert.equal(existsSync(path), false, `Preserve existing preparation capture: ${path}`);
  const source = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${path}\n${source.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`], { stdio: "inherit", maxBuffer: 1024 * 1024 });
};

const capturedAt = new Date().toISOString();
const marker = "/tmp/safe-bash-baseline-coverage-execute.ready";
const setupResult = "/tmp/safe-bash-baseline-coverage-setup-result.txt";
const declared = {
  schemaVersion: 1,
  capturedAt,
  status: "PREPARATION_ONLY_NOT_EXECUTED",
  productExecutions: 0,
  node: process.version,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceSnapshot: null,
  sourceSnapshotReason: "Freeze one current source tree only after root release; no live-HEAD acceptance claim.",
  releaseMarkerPresent: existsSync(marker),
  setupResultPresent: existsSync(setupResult),
  counts: { ...counts, historicalRows: inventory.rows.length, historicalOverlapControls: 3, sharedControls: 3 },
  evidence: [
    `${destination}/cases.mjs`, `${destination}/prepare.mjs`, `${destination}/README.md`, `${destination}/RUNNER_PLAN.md`,
    `${setup}/inventory.json`, `${setup}/SETUP.md`, `${setup}/setup-profiles.json`, `${setup}/setup-local.json`, `${setup}/primary-sources.json`,
    "benchmarks/node_modules/just-bash/package.json", "benchmarks/package-lock.json", "package.json", "package-lock.json",
  ].map(evidence),
  baselineIntegrity: json("benchmarks/package-lock.json").packages["node_modules/just-bash"].integrity,
  integrityLimit: "Preparation verifies package/lock version and hashes listed evidence only. Full source, dependency, runtime and symlink-chain freeze is still required before execution.",
  environment,
  budgets,
  networkFixture,
  configurationAuthority: `${setup}/setup-profiles.json`,
  cases: cases.map(specimen => ({ ...specimen, inputSha256: hash(JSON.stringify(specimen)) })),
};
publish(`${destination}/prepared-inputs.json`, declared);
publish(`${destination}/prepared-matrix.json`, {
  schemaVersion: 1,
  capturedAt,
  status: "UNEXECUTED_PREPARATION",
  recipesSha256: hash(JSON.stringify(declared.cases)),
  historical: inventory.historical,
  counts: inventory.counts,
  rows: inventory.rows.map(original => ({
    originalInventoryRow: original,
    name: original.name,
    plannedRecipeIds: cases.filter(specimen => specimen.name === original.name).map(specimen => specimen.id),
    currentEligibleBaselineOnly: original.currentBaselineOnly,
    executionStatus: "not-executed-root-release-pending",
    oursObservation: null,
    baselineObservation: null,
    functionalCredit: null,
  })),
  additionalOptional: inventory.addedOptional.map(original => ({
    originalInventoryRow: original,
    name: original.name,
    plannedRecipeIds: cases.filter(specimen => specimen.name === original.name).map(specimen => specimen.id),
    executionStatus: "not-executed-root-release-pending",
    oursObservation: null,
    baselineObservation: null,
    functionalCredit: null,
  })),
  controls: cases.filter(specimen => specimen.cohort.startsWith("shared")).map(specimen => ({ name: specimen.name, id: specimen.id, executionStatus: "not-executed-root-release-pending" })),
});
publish("/tmp/safe-bash-baseline-coverage-execution-plan.txt", [
  `PREPARED ${capturedAt}; product executions=0; root-marker=${existsSync(marker)}; setup-final-result=${existsSync(setupResult)}.`,
  `Names/configuration/cases derive from setup inventory and SETUP.md; complete final handoff and root marker still required.`,
  `Exact original unmeasured 50: ${inventory.exactDefaultUnmeasuredNames.join(", ")}.`,
  `Additional optional 4: ${inventory.addedOptional.map(row => row.name).join(", ")}.`,
  `Historical overlapping controls: ., eval, source. Shared controls: printf ASCII, printf binary/VFS, curl loopback. Total recipes=${cases.length}.`,
  `Baseline pin 3.4.2; Node ESM entry; python:true; javascript:true; sqlite3 default; network exact loopback origin/resource GET only. Existing shipped assets only; no installs/private runtime.`,
  `Ours uses public Shell + agentCommands; curl explicit networkCommands. safejs runtime unavailable in allowed package roots and not a name-compatible replacement.`,
  `Budgets ordinary=30000ms, optional=120000ms, cleanup=10000ms; output=4MiB, VFS census=32MiB/4096 entries/depth32.`,
  `Inputs: ${destination}/prepared-inputs.json. Full preserved-name matrix: ${destination}/prepared-matrix.json.`,
  `Runner design: ${destination}/RUNNER_PLAN.md. No executable benchmark runner yet; no source snapshot/load, server, native commands, workers, or product-case executions.`,
  `Read completed setup result, reconcile final deltas, implement guarded runner, freeze exact recipes/source/deps/loader and verify byte/mode/symlink/dispatch controls after release.`,
  `help informational and wait no-op never gain functional credit; node must be attempted operationally and classified honestly as the pinned diagnostic stub when observed.`,
  `Blocked prerequisites remain distinct; no optional setup failure becomes ours win; both-failing is never parity. All raw attempts and before/after drift must remain immutable.`,
].join("\n"));
console.log(JSON.stringify({ ...counts, productExecutions: 0, capturedAt, marker: existsSync(marker), setupResult: existsSync(setupResult) }));
