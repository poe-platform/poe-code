import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, loadBoundaries } from "./integration-inputs.mjs";
import { reporterArguments } from "./test-reporting.mjs";
import { planTestPhases, planTestShards, validateShardArguments } from "./test-shards.mjs";

export function parseTestExecution(env) {
  const sharded = Object.hasOwn(env, "SAFE_BASH_TEST_SHARD");
  const concurrent = Object.hasOwn(env, "SAFE_BASH_TEST_CONCURRENCY");
  if (!sharded && !concurrent) return undefined;
  const shard = sharded ? env.SAFE_BASH_TEST_SHARD : "1/1";
  assert.ok(!sharded || ["1/4", "2/4", "3/4", "4/4"].includes(shard), "SAFE_BASH_TEST_SHARD must be 1/4, 2/4, 3/4 or 4/4");
  const concurrency = concurrent ? env.SAFE_BASH_TEST_CONCURRENCY : "1";
  assert.ok(concurrency === "1" || concurrency === "2", "SAFE_BASH_TEST_CONCURRENCY must be 1 or 2");
  for (const flag of ["--test-concurrency", "--test-shard", "--experimental-test-isolation", "--test-force-exit"]) {
    assert.ok(!env.NODE_OPTIONS?.includes(flag), `Conflicting NODE_OPTIONS with Bash scheduling: ${flag}`);
  }
  return { shardIndex: Number(shard.split("/")[0]) - 1, shardCount: sharded ? 4 : 1, concurrency: Number(concurrency) };
}

export function runTests(root, args, spawn = spawnSync, fileSystem, execution) {
  const boundaries = loadBoundaries(root, fileSystem);
  const files = discoverTests(root, boundaries, fileSystem);
  console.log(`# safe-bash discovery: ${files.length} active TypeScript test files; ${boundaries.fixtureDirectories.length} authenticated fixture roots; ${boundaries.heldEvidenceDirectories.length} held evidence roots`);
  if (execution) {
    validateShardArguments(args);
    assert.ok(Number.isInteger(execution.shardIndex) && execution.shardIndex >= 0 && execution.shardIndex < execution.shardCount, "Invalid Bash shard index");
    const input = fileSystem ?? fs;
    const profile = JSON.parse(input.readFileSync(resolve(root, "scripts/test-duration-weights.json")));
    assert.equal(profile.version, 1, "Unsupported duration profile version");
    const shards = planTestShards(files, profile.weights, execution.shardCount, profile.unknownWeightMs);
    const selected = shards[execution.shardIndex];
    const review = execution.concurrency === 2 ? JSON.parse(input.readFileSync(resolve(root, "scripts/test-parallel-review.json"))) : undefined;
    const phases = planTestPhases(root, selected.files, execution.concurrency, review, input);
    const membership = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    console.log(`# safe-bash shard: ${execution.shardIndex + 1}/${execution.shardCount}; ${selected.files.length} files; estimated ${selected.estimatedMs} ms; membership ${membership}`);
    const env = { ...process.env };
    delete env.SAFE_BASH_TEST_SHARD;
    delete env.SAFE_BASH_TEST_CONCURRENCY;
    for (const phase of phases) {
      console.log(`# safe-bash phase: ${phase.files.length} files; concurrency ${phase.concurrency}`);
      const result = spawn(process.execPath, ["--import", "tsx", "--test", `--test-concurrency=${phase.concurrency}`, ...args, ...phase.files], { cwd: root, stdio: "inherit", env });
      if (result.error) throw result.error;
      const status = result.status ?? 1;
      if (status !== 0) return status;
    }
    return 0;
  }
  const concurrency = args.some(argument => argument === "--test-concurrency" || argument.startsWith("--test-concurrency=")) ? [] : ["--test-concurrency=1"];
  const result = spawn(process.execPath, ["--import", "tsx", "--test", ...concurrency, ...args, ...files], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  process.exitCode = runTests(fileURLToPath(new URL("../", import.meta.url)), [...reporterArguments(args), ...args], spawnSync, undefined, parseTestExecution(process.env));
}
