import type { Expression, SourceSpan } from "./ast.js";

export type Statement = SourceSpan & (
  | { readonly kind: "pass" }
  | { readonly kind: "expression-statement"; readonly expression: Expression }
  | { readonly kind: "assignment"; readonly targets: readonly Expression[]; readonly value: Expression }
  | { readonly kind: "augmented-assignment"; readonly target: Expression; readonly operator: string; readonly value: Expression }
  // Annotation expressions are parsed but deliberately absent from executable trees.
  | { readonly kind: "annotated-assignment"; readonly target: Expression; readonly simple: boolean; readonly value: Expression | null }
);

export type Module = SourceSpan & { readonly kind: "module"; readonly body: readonly Statement[] };
