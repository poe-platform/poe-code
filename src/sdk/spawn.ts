import type { SpawnOptions, SpawnResult } from "./types.js";
import { createSdkContainer } from "./container.js";
import { getPoeApiKey } from "./credentials.js";
import { spawnCore } from "./spawn-core.js";

/**
 * Runs a single prompt through a configured service CLI.
 *
 * @param service - Service identifier (claude-code, codex, opencode)
 * @param options - Configuration for the spawn
 * @returns Promise resolving to SpawnResult with stdout, stderr, and exitCode
 * @throws Error if no API key found or service doesn't support spawn
 *
 * @example
 * ```typescript
 * import { spawn } from "poe-code"
 *
 * const result = await spawn("claude-code", {
 *   prompt: "Fix the bug in auth.ts",
 *   cwd: "/path/to/project",
 *   model: "claude-sonnet-4"
 * })
 *
 * console.log(result.stdout)
 * ```
 */
export async function spawn(
  service: string,
  options: SpawnOptions
): Promise<SpawnResult> {
  // Validate API key exists (throws if not found)
  await getPoeApiKey();

  // Create SDK container with cwd from options
  const container = createSdkContainer({
    cwd: options.cwd
  });

  // Delegate to core spawn implementation
  return spawnCore(container, service, {
    prompt: options.prompt,
    cwd: options.cwd,
    model: options.model,
    args: options.args,
    useStdin: false
  });
}
