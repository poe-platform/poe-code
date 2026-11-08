import type { CliSpawnConfig } from "./types.js";

const PROMPT_STDIN_FALLBACK_BYTES = 64 * 1024;
export const REDACTED_PROMPT_ARG = "[prompt redacted]";

export function shouldSendPromptViaStdin(
  config: CliSpawnConfig,
  options: { prompt: string; useStdin?: boolean }
): boolean {
  return (
    !!config.stdinMode &&
    (options.useStdin === true ||
      options.prompt.includes("\0") ||
      (config.stdinMode.automaticFallback !== false &&
        Buffer.byteLength(options.prompt, "utf8") > PROMPT_STDIN_FALLBACK_BYTES))
  );
}

export function redactPromptArgIndexes(args: string[], promptArgIndexes: Set<number>): string[] {
  if (promptArgIndexes.size === 0) {
    return args;
  }

  return args.map((arg, index) => promptArgIndexes.has(index) ? REDACTED_PROMPT_ARG : arg);
}
