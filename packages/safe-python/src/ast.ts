import type { SourcePosition } from "./source.js";

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type CallArgument = SourceSpan & (
  | { readonly kind: "positional" | "starred" | "mapping"; readonly value: Expression }
  | { readonly kind: "keyword"; readonly spelling: string; readonly value: Expression }
);

export type SubscriptItem = Expression | (SourceSpan & (
  | { readonly kind: "slice"; readonly lower: Expression | null; readonly upper: Expression | null; readonly step: Expression | null }
  | { readonly kind: "unpack"; readonly value: Expression }
));

export type Expression = SourceSpan & (
  | { readonly kind: "literal"; readonly literalKind: "integer" | "float" | "imaginary" | "string" | "bytes" | "boolean" | "none" | "ellipsis";
      readonly value: bigint | number | Uint32Array | Uint8Array | boolean | null }
  | { readonly kind: "name"; readonly spelling: string }
  | { readonly kind: "attribute"; readonly object: Expression; readonly spelling: string }
  | { readonly kind: "call"; readonly callee: Expression; readonly arguments: readonly CallArgument[] }
  | { readonly kind: "subscript"; readonly object: Expression; readonly items: readonly SubscriptItem[]; readonly tuple: boolean }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: Expression }
  | { readonly kind: "binary" | "boolean"; readonly operator: string; readonly left: Expression; readonly right: Expression }
  | { readonly kind: "comparison"; readonly operands: readonly Expression[]; readonly operators: readonly string[] }
  | { readonly kind: "conditional"; readonly condition: Expression; readonly consequent: Expression; readonly alternate: Expression }
);
