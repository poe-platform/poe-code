import {
  discoverPlans,
  type DiscoverPlansOptions
} from "@poe-code/agent-harness-tools";

export type ExperimentDiscoveryFs = NonNullable<DiscoverPlansOptions["fs"]>;

export interface DiscoverExperimentDocsOptions {
  cwd: string;
  homeDir: string;
  planDirectory?: string;
  fs?: ExperimentDiscoveryFs;
}

export async function discoverExperimentDocs(
  options: DiscoverExperimentDocsOptions
): Promise<Array<{ path: string; displayPath: string }>> {
  const docs = await discoverPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: options.planDirectory?.trim() || ".poe-code/experiments",
    kinds: ["experiment"],
    fs: options.fs
  });

  return docs.map((doc) => ({
    path: doc.displayPath,
    displayPath: doc.displayPath
  }));
}
