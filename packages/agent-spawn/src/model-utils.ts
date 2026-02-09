/**
 * Strips the provider namespace prefix from a model identifier.
 * e.g., "anthropic/claude-opus-4.6" → "claude-opus-4.6"
 *
 * CLI binaries (claude, codex, opencode, kimi) only accept bare model IDs.
 * Passing a namespaced model like "anthropic/claude-opus-4.6" causes the
 * binary to fail with "model not found". This function MUST be called
 * before passing any model to a CLI binary via spawn args.
 */
export function stripModelNamespace(model: string): string {
  const slashIndex = model.indexOf("/");
  return slashIndex === -1 ? model : model.slice(slashIndex + 1);
}
