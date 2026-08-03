/**
 * Extracts the model ID from a namespaced model slug (lowercase).
 * e.g., "anthropic/claude-sonnet-4.6" -> "claude-sonnet-4.6"
 */
export function stripModelNamespace(model: string): string {
  const slashIndex = model.indexOf("/");
  const id = slashIndex === -1 ? model : model.slice(slashIndex + 1);
  return id.toLowerCase();
}

export const DEFAULT_REASONING = "medium";
export const PROVIDER_NAME = "poe";
export const FEEDBACK_URL = "https://github.com/poe-platform/poe-code/issues";
