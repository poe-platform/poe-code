import type { AgentPlugin } from "./plugin-types.js";
import type { RunContext } from "./run-context.js";
export declare function runPluginSetup(
  plugins: AgentPlugin[],
  runContext: RunContext
): Promise<void>;
