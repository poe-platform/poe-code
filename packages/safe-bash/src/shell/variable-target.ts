export const protectedReadArrays = new Set(["FUNCNAME", "BASH_ARGV", "BASH_ARGC", "BASH_SOURCE", "BASH_LINENO", "GROUPS"]);

export function isShellIdentifier(name: string): boolean {
  if (!name) return false;
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || index > 0 && code >= 48 && code <= 57) continue;
    return false;
  }
  return true;
}
export function variableTarget(name: string): { name: string; subscript?: string } | undefined {
  const bracket = name.indexOf("[");
  const base = bracket < 0 ? name : name.slice(0, bracket);
  if (!isShellIdentifier(base) || bracket >= 0 && (!name.endsWith("]") || bracket === name.length - 2)) return undefined;
  return bracket < 0 ? { name: base } : { name: base, subscript: name.slice(bracket + 1, -1) };
}
