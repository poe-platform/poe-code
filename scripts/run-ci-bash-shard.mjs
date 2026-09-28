import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceBuildPlan } from "./build-workspaces.mjs";
import { checkCacheDirectory, createCheckCache, createTaskFingerprints, taskCacheKey } from "./check-cache.mjs";

export function runCiBashShard(root, {
  environment = process.env,
  spawn = spawnSync,
  cacheStore
} = {}) {
  const plan = createWorkspaceBuildPlan(root);
  const shardArgs = [
    environment.SAFE_BASH_TEST_SHARD ?? "",
    environment.SAFE_BASH_TEST_CONCURRENCY ?? "",
    environment.SAFE_BASH_TEST_BASH_SHA256 ?? ""
  ];
  const cacheEnabled = environment.TURBO_FORCE !== "true" && environment.POE_CHECK_CACHE !== "0";
  const store = cacheEnabled ? (cacheStore ?? createCheckCache({ directory: checkCacheDirectory(environment) })) : undefined;
  const fingerprints = cacheEnabled
    ? createTaskFingerprints(plan, { selected: ["@poe-platform/safe-bash"], event: "test:unit", environment })
    : new Map();
  const fingerprint = fingerprints.get("@poe-platform/safe-bash");
  const key = fingerprint ? taskCacheKey(fingerprint, "test:unit:bash-shard", shardArgs) : undefined;
  if (store && key && store.read(key)?.success === true) {
    console.log(`Unit workspace @poe-platform/safe-bash (${environment.SAFE_BASH_TEST_SHARD ?? "1/1"}): cached Bash shard task`);
    return 0;
  }
  const started = performance.now();
  const executable = environment.npm_execpath ? process.execPath : "npm";
  const args = environment.npm_execpath
    ? [environment.npm_execpath, "run", "test:unit", "--workspace=@poe-platform/safe-bash"]
    : ["run", "test:unit", "--workspace=@poe-platform/safe-bash"];
  const result = spawn(executable, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status === 0 && store && key) {
    const after = createTaskFingerprints(plan, { selected: ["@poe-platform/safe-bash"], event: "test:unit", environment }).get("@poe-platform/safe-bash");
    if (after === fingerprint) {
      store.write(key, { success: true, durationMs: Math.round(performance.now() - started) });
    }
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCiBashShard(fileURLToPath(new URL("../", import.meta.url)));
}
