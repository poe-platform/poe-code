import {
  renderMarkdown,
  runExplorer,
  type ExplorerConfig
} from "toolcraft-design";
import { discoverAllPlans } from "./discovery.js";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import { loadPlanPreviewMarkdown } from "./format.js";
import type { ActionFs, DiscoveryFs, PlanEntry, PlanKind } from "./types.js";

type RunExplorerImpl = (config: ExplorerConfig<void>) => Promise<void | null>;

export async function runPlanBrowser(options: {
  cwd: string;
  homeDir: string;
  configPath: string;
  projectConfigPath: string;
  fs: DiscoveryFs & Partial<ActionFs>;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
  assumeYes?: boolean;
  onCreatePlan?: () => Promise<void>;
  runExplorerImpl?: RunExplorerImpl;
}): Promise<void> {
  const renderPlanPreview = async (
    entry: Pick<PlanEntry, "absolutePath" | "format" | "kind" | "title">
  ) => {
    const markdown = await loadPlanPreviewMarkdown(entry, options.fs);
    process.stdout.write(`${renderMarkdown(markdown).trimEnd()}\n`);
  };

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

  if (options.assumeYes || process.stdin.isTTY === false) {
    await renderPlanPreview(plans[0]!);
    return;
  }

  const config = buildPlanExplorerConfig({
    plans,
    fs: options.fs as ActionFs & DiscoveryFs,
    variables: options.variables ?? process.env,
    onRefresh: discover,
    onCreatePlan: options.onCreatePlan
  });
  await (options.runExplorerImpl ?? runExplorer)(config);
}
