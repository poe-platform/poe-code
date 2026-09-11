import type { Statement } from "../statement-ast.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CodeConstants } from "./code-constants.js";
import { cleanDocstring } from "./docstring.js";
import {eliminateAssertions} from "./assertion-elimination.js";

/** Prepare noninteractive suite statements and a retained, cleaned docstring.
 * The AST remains unchanged. Even stripped docstrings are omitted from executable
 * statements, but their text is neither encoded nor materialized. A wrapper
 * distinguishes a guest undefined constant from an absent docstring.
 */
export function compileSuite<Value>(
  body: readonly Statement[], stripDocstring: boolean,
  constants: Pick<CodeConstants<Value>, "string">, meter: ExecutionMeter, removeAssertions=false
): { readonly docstring: { readonly value: Value } | undefined; readonly statements: readonly Statement[] } {
  try {
  meter.checkpoint(1, 80);
  const first = body[0];
  const hasDocstring = first?.kind === "expression-statement" && first.expression.kind === "literal" && first.expression.literalKind === "string";
  let docstring: { readonly value: Value } | undefined;
  if (hasDocstring && !stripDocstring) {
    const text = cleanDocstring(first.expression.value as Uint32Array, meter);
    meter.checkpoint(1, 32);
    docstring = { value: constants.string(text) };
  }
  const statements: Statement[] = [];
  for (let index = hasDocstring ? 1 : 0; index < body.length; index++) {
    meter.checkpoint(1, 8); statements.push(body[index]);
  }
  return { docstring, statements:removeAssertions?eliminateAssertions(statements,meter):statements };
  } finally { meter.checkpoint(); }
}
