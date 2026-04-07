export type VariableMap = Record<string, string>;

export function interpolateVariables(
  template: string,
  variables: VariableMap
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    return name in variables ? variables[name]! : match;
  });
}
