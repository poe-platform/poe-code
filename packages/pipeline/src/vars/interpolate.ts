const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function interpolatePipelineVars(
  template: string,
  values: Record<string, string>,
  context = "template"
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Missing pipeline variable "${key}" in ${context}.`);
    }
    return values[key] as string;
  });
}
