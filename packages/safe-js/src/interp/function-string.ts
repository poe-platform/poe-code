import type { SandboxClosure } from "./values.js";
import { runResources } from "./resources.js";

export function functionString(value: SandboxClosure): string {
  if (runResources.getStore()?.functionSourceText === false) return "[object Object]";
  const source = value.sourceRange;
  if (source !== undefined) return source.text.slice(source.start, source.end);
  let name = value.boundTarget === undefined ? (value.name?.split("#").at(-1) ?? "") : "";
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 36 ||
        code === 95 ||
        (index > 0 && code >= 48 && code <= 57)
      )
    ) {
      name = "";
      break;
    }
  }
  return `function ${name}() { [native code] }`;
}
