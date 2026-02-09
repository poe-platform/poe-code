import { buildLoop, type BuildLoopOptions, type BuildResult, type WorktreeOptions } from "./build/loop.js";

export type { Plan, Story } from "./plan/types.js";
export { parsePlan } from "./plan/parser.js";
export { resolvePlanPath } from "./plan/resolver.js";
export type { ResolvePlanPathOptions } from "./plan/resolver.js";
export { ralphPlan } from "./plan/generator.js";
export type { RalphPlanOptions, RalphPlanResult } from "./plan/generator.js";
export { logActivity } from "./log/activity.js";
export type { ActivityLogFileSystem, LogActivityOptions } from "./log/activity.js";
export { loadConfig } from "./config/loader.js";
export type { RalphConfig, LoadConfigResult, ConfigSource } from "./config/loader.js";

export type { WorktreeOptions };

export type RalphBuildOptions = Omit<BuildLoopOptions, "cwd"> & {
  /**
   * Working directory used to resolve relative paths.
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
};

export type RalphBuildResult = BuildResult;

/**
 * Run Ralph's build loop programmatically.
 *
 * @example
 * ```ts
 * import { ralphBuild } from "@poe-code/ralph";
 *
 * const result = await ralphBuild({
 *   planPath: ".agents/tasks/plan.yml",
 *   maxIterations: 10,
 *   noCommit: false,
 *   agent: "codex",
 *   staleSeconds: 60
 * });
 * ```
 */
export async function ralphBuild(options: RalphBuildOptions): Promise<RalphBuildResult> {
  return buildLoop({
    ...options,
    cwd: options.cwd ?? process.cwd()
  });
}
