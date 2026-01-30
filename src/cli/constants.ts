export const FRONTIER_MODELS = [
  "Claude-Opus-4.5",
  "Claude-Sonnet-4.5",
  "gpt-5.2",
  "Gemini-3-Pro"
] as const;

export const DEFAULT_FRONTIER_MODEL = "Claude-Sonnet-4.5";

export const DEFAULT_TEXT_MODEL = "Claude-Sonnet-4.5";
export const DEFAULT_IMAGE_BOT = "nano-banana-pro";
export const DEFAULT_AUDIO_BOT = "ElevenLabs-v3";
export const DEFAULT_VIDEO_BOT = "veo-3.1";

export const CLAUDE_CODE_VARIANTS = {
  haiku: "Claude-Haiku-4.5",
  sonnet: "Claude-Sonnet-4.5",
  opus: "Claude-Opus-4.5"
} as const;

export const DEFAULT_CLAUDE_CODE_MODEL = CLAUDE_CODE_VARIANTS.opus;

export const CODEX_MODELS = [
  "GPT-5.2-codex",
  "gpt-5.2",
  "gpt-5.2-chat",
  "gpt-5.2-pro",
  "gpt-5.1",
  "gpt-5.1-codex-mini"
] as const;
export const DEFAULT_CODEX_MODEL = CODEX_MODELS[0];

export const KIMI_MODELS = [
  "Kimi-K2.5",
  "Kimi-K2-Thinking",
] as const;
export const DEFAULT_KIMI_MODEL = KIMI_MODELS[0];

export const DEFAULT_REASONING = "medium";
export const PROVIDER_NAME = "poe";
export const FEEDBACK_URL = "https://github.com/poe-platform/poe-code/issues";
