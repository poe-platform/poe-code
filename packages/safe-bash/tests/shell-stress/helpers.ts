import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxBatchCases } from "./model.js";
import type { BatchRequest, ChildRequest, Observation, ScriptOutcome, StressCase } from "./model.js";
import { isolatedSpawn } from "./process.js";
import { collectSourceInputs } from "../source-census.js";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const hardDeadlineMs = 5000;
const maxBuffer = 1024 * 1024;

export function sourceEvidence() {
  const captured = collectSourceInputs(root);
  const hashes: Record<string, string> = {};
  for (const [path, bytes] of [...captured.files, ...captured.admissionInputs]) {
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
  }
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "tests/fixtures/shell-cases.json"]) {
    hashes[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  }
  return {
    time: new Date().toISOString(),
    revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000 }).stdout.trim(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    aggregate: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"),
    hashes,
    sourceAdmission: captured.admission,
  };
}

function environment(home: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: home, LANG: "C", LC_ALL: "C", TZ: "UTC" };
}

function checkChild(result: { error?: Error | undefined; signal: NodeJS.Signals | null; status: number | null }, label: string): void {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label}: killed by ${result.signal}`);
  assert.notEqual(result.status, null, `${label}: no exit status`);
}

async function executeVirtual(request: ChildRequest | BatchRequest, dependencies = { sourceEvidence, isolatedSpawn }) {
  const before = dependencies.sourceEvidence();
  const result = await dependencies.isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./virtual-child.ts", import.meta.url))], {
    cwd: root, env: environment(tmpdir()), input: JSON.stringify(request),
    timeout: hardDeadlineMs, maxBuffer,
  });
  const after = dependencies.sourceEvidence();
  const name = request.kind === "batch" ? request.fixtures.map(fixture => fixture.name).join(", ") : request.fixture?.name ?? request.probe;
  const context = `${name}; source ${before.revision} ${before.aggregate} @ ${before.time}; after ${after.aggregate} @ ${after.time}`;
  checkChild(result, context);
  assert.equal(result.status, 0, `${context}\n${result.stderr}\n${result.stdout}`);
  assert.equal(result.stderr.toString(), "", `${context}: unexpected child stderr`);
  assert.equal(after.aggregate, before.aggregate, `${context}: source changed during execution; rerun instead of attributing this result`);
  return { value: JSON.parse(result.stdout.toString()) as unknown, before, after };
}

export async function runVirtual(request: ChildRequest): Promise<Observation | { passed: string }> {
  const { value } = await executeVirtual(request);
  assert.ok(value && typeof value === "object" && ("exitCode" in value || "passed" in value));
  return value as Observation | { passed: string };
}

export async function runVirtualBatch(fixtures: readonly StressCase[], dependencies = { sourceEvidence, isolatedSpawn }) {
  assert.ok(fixtures.length > 0 && fixtures.length <= maxBatchCases, `Virtual batch requires 1..${maxBatchCases} cases`);
  const { value, before, after } = await executeVirtual({ kind: "batch", fixtures }, dependencies);
  assert.ok(Array.isArray(value), "Virtual batch must return an outcome array");
  assert.equal(value.length, fixtures.length, "Virtual batch must return every case outcome");
  for (const [index, outcome] of value.entries()) {
    assert.equal(outcome.name, fixtures[index]!.name, "Virtual batch case order/name mismatch");
    assert.ok(outcome.status === "fulfilled" || outcome.status === "rejected", "Invalid virtual batch outcome");
    if (outcome.status === "fulfilled") assert.ok(outcome.observation && "exitCode" in outcome.observation, `Missing observation: ${outcome.name}`);
    else assert.equal(typeof outcome.error, "string", `Missing failure: ${outcome.name}`);
  }
  return { outcomes: value as ScriptOutcome[], before, after };
}

export async function runVirtualScript(fixture: StressCase): Promise<Observation> {
  const result = await runVirtual({ kind: "script", fixture });
  assert.ok("exitCode" in result);
  return result;
}
