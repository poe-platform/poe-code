import type { SourcePosition } from "./source.js";

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/** Name-bearing nodes retain raw `spelling`; `name` is the NFKC binding key. */
export type Parameter = SourceSpan & {
  readonly spelling: string;
  readonly name: string;
  readonly kind: "positional-only" | "positional-or-keyword" | "keyword-only" | "var-positional" | "var-keyword";
  readonly default: Expression | null;
};

export type ComprehensionClause = SourceSpan & {
  readonly async: boolean;
  readonly target: Expression;
  readonly iterable: Expression;
  readonly filters: readonly Expression[];
};

export type InterpolatedPart = SourceSpan & (
  | { readonly kind: "text"; readonly value: Uint32Array }
  | { readonly kind: "field"; readonly expression: Expression; readonly expressionText: string;
      readonly debugText: string | null; readonly conversion: "s" | "r" | "a" | null;
      readonly format: readonly InterpolatedPart[] | null }
);

export type CallArgument = SourceSpan & (
  | { readonly kind: "positional" | "starred" | "mapping"; readonly value: Expression }
  | { readonly kind: "keyword"; readonly spelling: string; readonly name: string; readonly value: Expression }
);

export type CollectionItem = Expression | (SourceSpan & { readonly kind: "unpack"; readonly value: Expression });

export type DictionaryEntry = SourceSpan & (
  | { readonly kind: "entry"; readonly key: Expression; readonly value: Expression }
  | { readonly kind: "mapping"; readonly value: Expression }
);

export type SubscriptItem = CollectionItem | (SourceSpan & (
  { readonly kind: "slice"; readonly lower: Expression | null; readonly upper: Expression | null; readonly step: Expression | null }
));

export type Expression = SourceSpan & {
  /** Executable content before outer grouping parentheses widen the syntax
   * span. Syntax validation still uses start/end, including those delimiters. */
  readonly contentSpan?:SourceSpan;
} & (
  | { readonly kind: "await" | "yield-from"; readonly value: Expression }
  | { readonly kind: "yield"; readonly value: Expression | null }
  | { readonly kind: "interpolated-string"; readonly flavor: "formatted" | "template"; readonly parts: readonly InterpolatedPart[] }
  | { readonly kind: "literal"; readonly literalKind: "integer" | "float" | "imaginary" | "string" | "bytes" | "boolean" | "none" | "ellipsis";
      readonly value: bigint | number | Uint32Array | Uint8Array | boolean | null }
  | { readonly kind: "name"; readonly spelling: string; readonly name: string }
  | { readonly kind: "assignment-expression"; readonly target: SourceSpan & { readonly kind: "name"; readonly spelling: string; readonly name: string }; readonly value: Expression }
  | { readonly kind: "lambda"; readonly parameters: readonly Parameter[]; readonly body: Expression }
  | { readonly kind: "comprehension"; readonly collection: "list" | "set" | "generator"; readonly element: Expression; readonly clauses: readonly ComprehensionClause[] }
  | { readonly kind: "dictionary-comprehension"; readonly key: Expression; readonly value: Expression; readonly clauses: readonly ComprehensionClause[] }
  | { readonly kind: "tuple" | "list" | "set"; readonly items: readonly CollectionItem[] }
  | { readonly kind: "dictionary"; readonly entries: readonly DictionaryEntry[] }
  | { readonly kind: "attribute"; readonly object: Expression; readonly spelling: string; readonly name: string }
  | { readonly kind: "call"; readonly callee: Expression; readonly arguments: readonly CallArgument[] }
  | { readonly kind: "subscript"; readonly object: Expression; readonly items: readonly SubscriptItem[]; readonly tuple: boolean }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: Expression }
  | { readonly kind: "binary" | "boolean"; readonly operator: string; readonly left: Expression; readonly right: Expression }
  | { readonly kind: "comparison"; readonly operands: readonly Expression[]; readonly operators: readonly string[] }
  | { readonly kind: "conditional"; readonly condition: Expression; readonly consequent: Expression; readonly alternate: Expression }
);
