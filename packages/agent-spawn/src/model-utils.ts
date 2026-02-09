/**
 * Strips the provider namespace prefix from a model identifier.
 * e.g., "anthropic/claude-opus-4.6" → "claude-opus-4.6"
 *
 * CLI binaries expect bare model IDs without the provider namespace.
 */
export function stripModelNamespace(model: string): string {
  const slashIndex = model.indexOf("/");
  return slashIndex === -1 ? model : model.slice(slashIndex + 1);
}
