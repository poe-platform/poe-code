import { native } from "./native.js";
import { graphSnapshot } from "./yaml-snapshot.js";

/** Value-only document adapter; task Markdown deliberately replaces frontmatter. */
export function parseDocument(content: string): { errors: Error[]; toJS(): unknown } {
  const result = native.configYamlParse(
    content,
    (epoch) => new Date(epoch).toString(),
    true,
    false
  );
  if (result.error) return { errors: [new Error(result.error.message)], toJS: () => undefined };
  const dates = new Map<number, Date>(),
    symbols = new Map<number, symbol>();
  let dateIndex = 0,
    symbolIndex = 0;
  for (const [path, epoch, description] of result.temporals) {
    let value: Date | symbol;
    if (epoch === "symbol") {
      const id = result.symbolIds[symbolIndex++];
      if (!symbols.has(id)) symbols.set(id, Symbol(description));
      value = symbols.get(id)!;
    } else {
      const id = result.dateIds[dateIndex++];
      if (!dates.has(id)) dates.set(id, new Date(epoch));
      value = dates.get(id)!;
    }
    if (path.length === 0) {
      result.value = value;
      continue;
    }
    let parent = result.value as Record<string, unknown>;
    for (let i = 0; i < path.length - 1; i++) parent = parent[path[i]] as Record<string, unknown>;
    Object.defineProperty(parent, path.at(-1)!, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return { errors: [], toJS: () => result.value };
}
export function stringify(value: unknown): string {
  return native.configYamlSerialize(graphSnapshot(value));
}
