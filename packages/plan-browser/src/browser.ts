import { runExplorer, type ExplorerConfig } from "toolcraft-design";
import { discoverAllPlans } from "./discovery.js";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import type { ActionFs, DiscoveryFs, PlanKind } from "./types.js";

type RunExplorerImpl = (config: ExplorerConfig<void>) => Promise<void | null>;

export async function runPlanBrowser(options: {
  cwd: string;
  homeDir: string;
  configPath: string;
  projectConfigPath: string;
  fs: DiscoveryFs & Partial<ActionFs>;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
  runExplorerImpl?: RunExplorerImpl;
}): Promise<void> {
  const discover = () => discoverAllPlans({
    cwd: options.cwd,
    homeDir: options.homeDir,
    configPath: options.configPath,
    projectConfigPath: options.projectConfigPath,
    fs: options.fs,
    kind: options.kind,
    variables: options.variables
  });

  const plans = await discover();

  if (plans.length === 0) {
    process.stdout.write("No plans found.\n");
    return;
  }

  if (process.stdin.isTTY !== true) {
    throw new Error(
      [
        "Plan browsing needs an interactive terminal. Name the plan you want with `poe-code plan view <path>`.",
        "",
        "Plans:",
        ...plans.map((plan) => `- ${plan.path}`)
      ].join("\n")
    );
  }

  const config = buildPlanExplorerConfig({
    plans,
    fs: options.fs as ActionFs & DiscoveryFs,
    variables: options.variables ?? process.env,
    homeDir: options.homeDir,
    onRefresh: discover
  });
  await (options.runExplorerImpl ?? runExplorer)(config);
}
