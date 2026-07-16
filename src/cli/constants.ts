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

export const KIMI_MODELS = ["novita ai/kimi-k2.5", "novita ai/kimi-k2-thinking"] as const;
export const DEFAULT_KIMI_MODEL = KIMI_MODELS[0];

export const GOOSE_MODELS = FRONTIER_MODELS;
export const DEFAULT_GOOSE_MODEL = DEFAULT_FRONTIER_MODEL;

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

/**
 * Every model id this CLI ships as a default or choice. The model catalog check
 * (scripts/check-model-catalog.ts) resolves each entry against the live
 * /v1/models catalog so a retired id cannot stay baked into a default.
 */
export const DECLARED_MODEL_IDS: readonly string[] = [
  ...new Set<string>([
    ...FRONTIER_MODELS,
    ...Object.values(CLAUDE_CODE_VARIANTS),
    ...KIMI_MODELS,
    DEFAULT_GEMINI_MODEL
  ])
];

export const DEFAULT_REASONING = "medium";
export const PROVIDER_NAME = "poe";
export const FEEDBACK_URL = "https://github.com/poe-platform/poe-code/issues";
