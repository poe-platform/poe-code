import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { discoverPlans, formatPlanReadinessLabel } from "@poe-code/agent-harness-tools";

type DiscoveryFileStat = {
  isFile(): boolean;
};

export type ExperimentDiscoveryFs = {
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<DiscoveryFileStat>;
};

export interface DiscoverExperimentDocsOptions {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: ExperimentDiscoveryFs | FileSystem;
}

type SharedDiscoverPlansFs = NonNullable<Parameters<typeof discoverPlans>[0]["fs"]>;

export const discoverExperimentDocs = async (
  options: DiscoverExperimentDocsOptions
): Promise<Array<{ path: string; displayPath: string }>> => {
  const fs = options.fs;
  const plans = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: options.planDirectory?.trim() || ".poe-code/experiments",
    kinds: ["experiment"],
    fs: fs as unknown as SharedDiscoverPlansFs
  });

  return plans.map((plan) => ({
    path: plan.displayPath,
    displayPath: formatPlanReadinessLabel(plan.displayPath, plan.readiness)
  }));
};
