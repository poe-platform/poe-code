import type { CliSpawnConfig } from "./types.js";

export function shouldSendPromptViaStdin(
  config: CliSpawnConfig,
  options: { prompt: string; useStdin?: boolean }
): boolean {
  return !!config.stdinMode && (options.useStdin === true || options.prompt.includes("\0"));
}
