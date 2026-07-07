export const FRONTIER_MODELS = [
  "anthropic/claude-opus-4.7",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.4-pro",
  "google/gemini-3.1-pro"
] as const;

export const DEFAULT_FRONTIER_MODEL = "anthropic/claude-opus-4.7";
export const DEFAULT_CURSOR_MODEL = DEFAULT_FRONTIER_MODEL;

export const CLAUDE_CODE_VARIANTS = {
  haiku: "anthropic/claude-haiku-4.5",
  sonnet: "anthropic/claude-sonnet-4.6",
  opus: "anthropic/claude-opus-4.7"
} as const;

export const DEFAULT_CLAUDE_CODE_MODEL = CLAUDE_CODE_VARIANTS.sonnet;

/**
 * Extracts the model ID from a namespaced model slug (lowercase).
 * e.g., "anthropic/claude-sonnet-4.6" -> "claude-sonnet-4.6"
 */
export function stripModelNamespace(model: string): string {
  const slashIndex = model.indexOf("/");
  const id = slashIndex === -1 ? model : model.slice(slashIndex + 1);
  return id.toLowerCase();
}

export const KIMI_MODELS = [
  "novitaai/kimi-k2.5",
  "novitaai/kimi-k2-thinking",
  "novitaai/kimi-k2.5-fw"
] as const;
export const DEFAULT_KIMI_MODEL = KIMI_MODELS[0];

export const GOOSE_MODELS = FRONTIER_MODELS;
export const DEFAULT_GOOSE_MODEL = DEFAULT_FRONTIER_MODEL;

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

export const DEFAULT_REASONING = "medium";
export const PROVIDER_NAME = "poe";
export const FEEDBACK_URL = "https://github.com/poe-platform/poe-code/issues";
