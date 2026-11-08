import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { discoverPlans, formatPlanReadinessLabel } from "@poe-code/agent-harness-tools";
import type { RalphFileStat } from "../types.js";

type DiscoveryFs = {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  stat(path: string): Promise<RalphFileStat>;
};

type SharedDiscoverPlansFs = NonNullable<Parameters<typeof discoverPlans>[0]["fs"]>;


export async function discoverDocs(options: {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: DiscoveryFs | FileSystem;
}): Promise<Array<{ path: string; displayPath: string }>> {
  const plans = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: options.planDirectory?.trim() || ".poe-code/ralph/plans",
    kinds: ["ralph"],
    fs: options.fs as SharedDiscoverPlansFs | undefined
  });

  return plans.map((plan) => ({
    path: plan.displayPath,
    displayPath: formatPlanReadinessLabel(plan.displayPath, plan.readiness)
  }));
}
