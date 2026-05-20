import {
  runExplorer,
  type ExplorerConfig
} from "@poe-code/design-system";
import { buildMaestroExplorerConfig } from "./explorer-config.js";
import type { BuildMaestroExplorerConfigOptions } from "./explorer-config.js";

export { buildMaestroExplorerConfig } from "./explorer-config.js";
export type { BuildMaestroExplorerConfigOptions } from "./explorer-config.js";

type RunExplorerImpl = (config: ExplorerConfig<void>) => Promise<void | null>;

export interface RunMaestroTuiOptions extends BuildMaestroExplorerConfigOptions {
  runExplorerImpl?: RunExplorerImpl;
}

export async function runMaestroTui(options: RunMaestroTuiOptions): Promise<void> {
  const config = buildMaestroExplorerConfig(options);
  await (options.runExplorerImpl ?? runExplorer)(config);
}
