import { spawn } from "node:child_process";
import type { HumanInLoopRuntimeOptions } from "./runtime-options.js";

export function spawnApprovalRunner(
  approvalId: string,
  runtimeOptions: Pick<HumanInLoopRuntimeOptions, "binPath">,
  spawnFn?: typeof import("node:child_process").spawn
): void {
  const { execPath, entryArgs } = runtimeOptions.binPath ?? {
    execPath: process.execPath,
    entryArgs: [process.argv[1]!],
  };
  const fn = spawnFn ?? spawn;
  const child = fn(execPath, [...entryArgs, "approvals", "run", approvalId], {
    detached: true,
    stdio: "ignore",
    env: process.env,
    cwd: process.cwd(),
  });

  child.unref();
}

export default spawnApprovalRunner;
