import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function prepareSafeBashUnitBuild(root, { environment = process.env, spawn = spawnSync } = {}) {
  const receipt = environment.POE_SAFE_BASH_VERIFIED_BUILD_REUSE;
  if (receipt !== undefined) {
    const { GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt, GITHUB_SHA: sha } = environment;
    // The workflow issues this attestation only after restoring and checking its
    // same-run build. A generic CI flag is not evidence that a build is ready.
    if (environment.GITHUB_ACTIONS !== "true"
      || !/^[1-9][0-9]*$/.test(runId ?? "")
      || !/^[1-9][0-9]*$/.test(attempt ?? "")
      || !/^[0-9a-f]{40}$/.test(sha ?? "")
      || receipt !== `${runId}:${attempt}:${sha}`) {
      throw new Error("Invalid verified build reuse receipt for the current GitHub Actions run");
    }
    console.log("Safe Bash unit prerequisite: reusing the verified same-run build");
    return 0;
  }

  const args = ["--prefix", root, "run", "build", "--workspaces=false"];
  const executable = environment.npm_execpath ? process.execPath : "npm";
  if (environment.npm_execpath) args.unshift(environment.npm_execpath);
  const result = spawn(executable, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = prepareSafeBashUnitBuild(fileURLToPath(new URL("../", import.meta.url)));
}
