import type { Expression } from "./ast.js";
import type { Pattern } from "./pattern-ast.js";

export function* patternExpressions(pattern: Pattern): Generator<Expression> {
  switch (pattern.kind) {
    case "capture": case "star": return;
    case "value": case "singleton": yield pattern.value; return;
    case "as": yield* patternExpressions(pattern.pattern); return;
    case "or": for (const alternative of pattern.patterns) yield* patternExpressions(alternative); return;
    case "sequence": for (const item of pattern.items) yield* patternExpressions(item); return;
    case "mapping":
      for (const entry of pattern.entries) { yield entry.key; yield* patternExpressions(entry.pattern); }
      return;
    case "class":
      yield pattern.class;
      for (const child of pattern.positional) yield* patternExpressions(child);
      for (const keyword of pattern.keywords) yield* patternExpressions(keyword.pattern);
      return;
    default: { const exhaustive: never = pattern; throw new Error(`unknown pattern: ${exhaustive}`); }
  }
}
