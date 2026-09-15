import type { Expression, SourceSpan } from "./ast.js";
import type { DeclaredName } from "./statement-ast.js";

export type Pattern = SourceSpan & (
  | { readonly kind: "capture" | "star"; readonly name: DeclaredName | null }
  | { readonly kind: "value" | "singleton"; readonly value: Expression }
  | { readonly kind: "sequence"; readonly items: readonly Pattern[] }
  | { readonly kind: "mapping"; readonly entries: readonly { readonly key: Expression; readonly pattern: Pattern }[]; readonly rest: DeclaredName | null }
  | { readonly kind: "class"; readonly class: Expression; readonly positional: readonly Pattern[]; readonly keywords: readonly { readonly name: DeclaredName; readonly pattern: Pattern }[] }
  | { readonly kind: "or"; readonly patterns: readonly Pattern[] }
  | { readonly kind: "as"; readonly pattern: Pattern; readonly name: DeclaredName }
);
