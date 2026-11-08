export const objectBatchCommands = Object.freeze([
  "vault get", "vault edit", "vault delete", "item get", "item delete", "item move", "vault group list", "document delete",
  "group get", "group edit", "group delete",
  "user get", "user edit", "user delete", "user confirm", "user reactivate", "user suspend"
]);

export function parseObjectSelectors(input: unknown): string[] {
  const selectors: string[] = [];
  const invalid = () => new Error("Object selectors are required");
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    if (typeof value === "string") {
      if (!value.trim()) throw invalid();
      selectors.push(value);
      return;
    }
    if (value === null || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    if (!descriptor) return;
    if (!("value" in descriptor) || typeof descriptor.value !== "string" || !descriptor.value.trim()) throw invalid();
    selectors.push(descriptor.value);
  };
  if (typeof input !== "string") collect(input);
  else {
    const source = input.trim();
    if (!source.startsWith("{") && !source.startsWith("[")) {
      for (const line of source.split("\n")) if (line.trim()) selectors.push(line.trim());
    } else {
      let start = 0;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = 0; index < source.length; index++) {
        const character = source[index]!;
        if (depth === 0) {
          if (!character.trim()) { start = index + 1; continue; }
          if (character !== "{" && character !== "[") throw invalid();
        }
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") {
          depth--;
          if (depth === 0) {
            let value: unknown;
            try { value = JSON.parse(source.slice(start, index + 1)); }
            catch { throw invalid(); }
            collect(value);
            start = index + 1;
          }
        }
      }
      if (depth !== 0 || quoted) throw invalid();
    }
  }
  if (!selectors.length) throw invalid();
  return selectors;
}
