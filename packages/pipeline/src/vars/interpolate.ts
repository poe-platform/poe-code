const PIPELINE_VAR_NAME_PATTERN = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*";
const PLACEHOLDER_PATTERN = new RegExp(
  `\\\\(\\{\\{\\s*${PIPELINE_VAR_NAME_PATTERN}\\s*\\}\\})|\\{\\{\\s*(${PIPELINE_VAR_NAME_PATTERN})\\s*\\}\\}`,
  "g"
);

export function interpolatePipelineVars(
  template: string,
  values: Record<string, string>,
  context = "template"
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, escaped: string | undefined, key: string | undefined) => {
    if (escaped !== undefined) return escaped;
    const name = key as string;
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Missing pipeline variable "${name}" in ${context}.`);
    }
    return values[name] as string;
  });
}
