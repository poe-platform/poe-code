import type { Pattern } from "./pattern-ast.js";
import type { TokenCursor } from "./token-cursor.js";

/** Validate captures and return whether the pattern is irrefutable. */
export function validatePattern(pattern: Pattern, cursor: TokenCursor): boolean {
  function bind(names: Set<string>, name: string): void {
    if (names.has(name)) throw cursor.error(`multiple assignments to name '${name}' in pattern`);
    names.add(name);
  }
  function visit(pattern: Pattern, names: Set<string>): boolean {
    switch (pattern.kind) {
      case "capture": case "star":
        if (pattern.name) bind(names, pattern.name.name);
        return true;
      case "value": case "singleton": return false;
      case "as": {
        const irrefutable = visit(pattern.pattern, names);
        bind(names, pattern.name.name);
        return irrefutable;
      }
      case "or": {
        let previous: Set<string> | undefined;
        let irrefutable = false;
        for (const alternative of pattern.patterns) {
          if (irrefutable) throw cursor.error("irrefutable pattern makes remaining alternatives unreachable");
          const captures = new Set<string>();
          irrefutable = visit(alternative, captures);
          if (previous && (previous.size !== captures.size || [...previous].some(name => !captures.has(name)))) {
            throw cursor.error("alternative patterns bind different names");
          }
          previous = captures;
        }
        for (const name of previous ?? []) bind(names, name);
        return irrefutable;
      }
      case "sequence": {
        let starred = false;
        for (const item of pattern.items) {
          if (item.kind === "star") {
            if (starred) throw cursor.error("multiple starred names in sequence pattern");
            starred = true;
          }
          visit(item, names);
        }
        return false;
      }
      case "mapping":
        for (const entry of pattern.entries) visit(entry.pattern, names);
        if (pattern.rest) bind(names, pattern.rest.name);
        return false;
      case "class":
        for (const child of pattern.positional) visit(child, names);
        for (const keyword of pattern.keywords) visit(keyword.pattern, names);
        return false;
      default: { const exhaustive: never = pattern; throw new Error(`unknown pattern: ${exhaustive}`); }
    }
  }
  return visit(pattern, new Set());
}
