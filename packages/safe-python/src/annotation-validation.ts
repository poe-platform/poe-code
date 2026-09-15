import type { Expression } from "./ast.js";
import type { TokenCursor } from "./token-cursor.js";
import { validateExpression } from "./expression-validation.js";
import { validateExpressionContext } from "./expression-context.js";

/** Annotations have their own non-async scope, including local annotations and
 * future-stringized annotations. Nested lambdas and generators own their scope. */
export function validateAnnotation(expression: Expression, cursor: TokenCursor): void {
  validateExpression(expression, cursor.filename, {
    iterations: new Set(), iterable: false, target: false, assignments: null, typeScope: "annotation"
  }, cursor.meter);
  validateExpressionContext(expression, { kind: "function", generator: false }, cursor.filename, undefined, cursor.meter);
}
