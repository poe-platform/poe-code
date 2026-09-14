import { types } from "node:util";

export function formatDiagnosticValue(value: unknown): string {
  const ancestors = new WeakSet<object>();
  let remaining = 100;

  function render(current: unknown, depth: number): string {
    if (remaining <= 0) return "…";
    remaining -= 1;
    if (current === null) return "null";
    if (current === undefined) return "undefined";
    if (typeof current === "string") {
      return JSON.stringify(current.length > 1000 ? `${current.slice(0, 1000)}…` : current);
    }
    if (typeof current === "function") return "[Function]";
    if (typeof current === "bigint") return `${current}n`;
    if (typeof current !== "object") return Object.is(current, -0) ? "-0" : String(current);
    if (types.isProxy(current)) return "[Proxy]";
    if (ancestors.has(current)) return "[Circular]";
    const array = Array.isArray(current);
    if (depth >= 4) return array ? "[Array]" : "[Object]";
    const keys = array
      ? Array.from({ length: Math.min(current.length, 25) }, (_value, index) => String(index))
      : Object.keys(current);
    const count = array ? current.length : keys.length;
    ancestors.add(current);
    try {
      const entries = keys.slice(0, 25).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        const rendered = descriptor === undefined
          ? "[Empty]"
          : "value" in descriptor ? render(descriptor.value, depth + 1) : "[Accessor]";
        return array ? rendered : `${JSON.stringify(key)}:${rendered}`;
      });
      if (count > entries.length) entries.push("…");
      return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  try {
    const rendered = render(value, 0);
    return rendered.length > 4000 ? `${rendered.slice(0, 4000)}…` : rendered;
  } catch {
    return "[Uninspectable]";
  }
}
