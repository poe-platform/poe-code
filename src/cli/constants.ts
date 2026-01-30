export const FRONTIER_MODELS = [
  "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.2",
  "google/gemini-3-pro"
] as const;

export const DEFAULT_FRONTIER_MODEL = "anthropic/claude-sonnet-4.5";

export const DEFAULT_TEXT_MODEL = "anthropic/claude-sonnet-4.5";
export const DEFAULT_IMAGE_BOT = "google/nano-banana-pro";
export const DEFAULT_AUDIO_BOT = "elevenlabs/elevenlabs-v3";
export const DEFAULT_VIDEO_BOT = "google/veo-3.1";

export const CLAUDE_CODE_VARIANTS = {
  haiku: "anthropic/claude-haiku-4.5",
  sonnet: "anthropic/claude-sonnet-4.5",
  opus: "anthropic/claude-opus-4.5"
} as const;

export const DEFAULT_CLAUDE_CODE_MODEL = CLAUDE_CODE_VARIANTS.opus;

/**
 * Extracts the model ID from a namespaced model slug (lowercase).
 * e.g., "anthropic/claude-sonnet-4.5" -> "claude-sonnet-4.5"
 */
export function stripModelNamespace(model: string): string {
  const slashIndex = model.indexOf("/");
  const id = slashIndex === -1 ? model : model.slice(slashIndex + 1);
  return id.toLowerCase();
}

export const CODEX_MODELS = [
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2-pro",
  "openai/gpt-5.1",
  "openai/gpt-5.1-codex-mini"
] as const;
export const DEFAULT_CODEX_MODEL = CODEX_MODELS[0];

export const KIMI_MODELS = [
  "novitaai/kimi-k2.5",
  "novitaai/kimi-k2-thinking",
] as const;
export const DEFAULT_KIMI_MODEL = KIMI_MODELS[0];

export const DEFAULT_REASONING = "medium";
export const PROVIDER_NAME = "poe";
export const FEEDBACK_URL = "https://github.com/poe-platform/poe-code/issues";
