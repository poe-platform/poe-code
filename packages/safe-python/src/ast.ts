import type { SourcePosition } from "./source.js";

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type Expression = SourceSpan & (
  | { readonly kind: "literal"; readonly literalKind: "integer" | "float" | "imaginary" | "string" | "bytes" | "boolean" | "none" | "ellipsis";
      readonly value: bigint | number | Uint32Array | Uint8Array | boolean | null }
  | { readonly kind: "name"; readonly spelling: string }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: Expression }
  | { readonly kind: "binary" | "boolean"; readonly operator: string; readonly left: Expression; readonly right: Expression }
  | { readonly kind: "comparison"; readonly operands: readonly Expression[]; readonly operators: readonly string[] }
  | { readonly kind: "conditional"; readonly condition: Expression; readonly consequent: Expression; readonly alternate: Expression }
);
