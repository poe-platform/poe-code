import type { Expression, SourceSpan } from "./ast.js";

export type DeclaredName = SourceSpan & { readonly name: string; readonly spelling: string };
export type ImportItem = SourceSpan & { readonly path: readonly DeclaredName[]; readonly alias: DeclaredName | null };
export type ConditionalBranch = { readonly condition: Expression; readonly body: readonly Statement[] };

export type Statement = SourceSpan & (
  | { readonly kind: "if"; readonly branches: readonly ConditionalBranch[]; readonly otherwise: readonly Statement[] }
  | { readonly kind: "while"; readonly condition: Expression; readonly body: readonly Statement[]; readonly otherwise: readonly Statement[] }
  | { readonly kind: "pass" | "break" | "continue" }
  | { readonly kind: "return"; readonly value: Expression | null }
  | { readonly kind: "raise"; readonly exception: Expression | null; readonly cause: Expression | null }
  | { readonly kind: "assert"; readonly condition: Expression; readonly message: Expression | null }
  | { readonly kind: "global" | "nonlocal"; readonly names: readonly DeclaredName[] }
  | { readonly kind: "delete"; readonly targets: readonly Expression[] }
  | { readonly kind: "import"; readonly imports: readonly ImportItem[] }
  | { readonly kind: "import-from"; readonly module: readonly DeclaredName[]; readonly level: number; readonly imports: readonly ImportItem[] | "*" }
  | { readonly kind: "expression-statement"; readonly expression: Expression }
  | { readonly kind: "assignment"; readonly targets: readonly Expression[]; readonly value: Expression }
  | { readonly kind: "augmented-assignment"; readonly target: Expression; readonly operator: string; readonly value: Expression }
  // Annotation expressions are parsed but deliberately absent from executable trees.
  | { readonly kind: "annotated-assignment"; readonly target: Expression; readonly simple: boolean; readonly value: Expression | null }
);

export type Module = SourceSpan & { readonly kind: "module"; readonly body: readonly Statement[] };
