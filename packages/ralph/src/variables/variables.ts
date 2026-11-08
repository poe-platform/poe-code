export type VariableMap = Record<string, string>;

export function interpolateVariables(
  template: string,
  variables: VariableMap
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    return Object.hasOwn(variables, name) ? variables[name]! : match;
  });
}
