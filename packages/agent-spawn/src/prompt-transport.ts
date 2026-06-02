import type { CliSpawnConfig } from "./types.js";

const MAX_SAFE_PROMPT_ARG_BYTES = 96 * 1024;

export function shouldSendPromptViaStdin(
  config: CliSpawnConfig,
  options: { prompt: string; useStdin?: boolean }
): boolean {
  return (
    !!config.stdinMode &&
    (options.useStdin === true ||
      options.prompt.includes("\0") ||
      Buffer.byteLength(options.prompt, "utf8") > MAX_SAFE_PROMPT_ARG_BYTES)
  );
}
