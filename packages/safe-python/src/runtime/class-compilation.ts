import type { ModuleAnalysis } from "../analysis.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { cleanDocstring } from "./docstring.js";

export interface ClassConstants<Value> {
  /** Builtin constant allocation only, without invoking guest conversion hooks. */
  string(value: string): Value;
  integer(value: number): Value;
  tuple(values: readonly Value[]): Value;
}

export interface CompiledClassBody<Value> {
  readonly scope: ResolvedScope;
  readonly qualifiedName: Value;
  readonly firstLine: Value;
  readonly staticAttributes: Value;
  readonly docstring: { readonly value: Value } | undefined;
  readonly statements: readonly Statement[];
}

/** Prepare reusable class-suite constants from one analyzed scope. No defaults,
 * decorators, base expressions or guest body code execute here. Constant values
 * retain identity across activations; prepared namespaces and closure cells do
 * not. The outer compiler owns code caching and whole-program compilation order.
 * Constant allocation is adapter-metered; complete host metadata accounting and
 * concrete guest code objects remain unfinished.
 */
export function compileClassBody<Value>(
  scope: ResolvedScope, analysis: Pick<ModuleAnalysis, "qualifiedNames" | "staticAttributes">,
  options: { readonly stripDocstring: boolean }, constants: ClassConstants<Value>, meter: ExecutionMeter
): CompiledClassBody<Value> {
  meter.checkpoint();
  const node = scope.scope.node;
  if (scope.scope.kind !== "class" || node.kind !== "class") throw new Error("class bodies require a class scope");
  const name = analysis.qualifiedNames.get(scope.scope), attributes = analysis.staticAttributes.get(scope.scope);
  if (name === undefined || attributes === undefined) throw new Error("missing analyzed class metadata");
  const qualifiedName = constants.string(name);
  meter.checkpoint();
  const firstLine = constants.integer(node.decorators[0]?.start.line ?? node.start.line);
  const names: Value[] = [];
  for (const attribute of attributes) { meter.checkpoint(); names.push(constants.string(attribute)); }
  meter.checkpoint();
  const staticAttributes = constants.tuple(names);
  const first = node.body[0];
  const hasDocstring = first?.kind === "expression-statement" && first.expression.kind === "literal" && first.expression.literalKind === "string";
  let docstring: { readonly value: Value } | undefined;
  if (hasDocstring && !options.stripDocstring) {
    const text = cleanDocstring(first.expression.value as Uint32Array, meter);
    meter.checkpoint();
    docstring = { value: constants.string(text) };
  }
  const statements: Statement[] = [];
  for (let index = hasDocstring ? 1 : 0; index < node.body.length; index++) {
    meter.checkpoint(); statements.push(node.body[index]);
  }
  return { scope, qualifiedName, firstLine, staticAttributes, docstring, statements };
}
