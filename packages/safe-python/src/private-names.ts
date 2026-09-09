/** Mangle normalized identifiers using their lexical class context. */
export function manglePrivateName(name: string, className: string | null): string {
  if (!className || !name.startsWith("__") || name.endsWith("__") || name.includes(".")) return name;
  let start = 0;
  while (className[start] === "_") start++;
  return start === className.length ? name : `_${className.slice(start)}${name}`;
}
