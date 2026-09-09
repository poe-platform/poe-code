import type { ModuleAnalysis } from "../analysis.js";
import type { FunctionNode } from "../expression-context.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import { compileClassBody, type ClassConstants, type CompiledClassBody } from "./class-compilation.js";
import { compileFunction, type CompiledFunction } from "./function-compilation.js";
import { compileSuite } from "./suite-compilation.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface CompiledModule<Value> {
  readonly scope: ResolvedScope;
  readonly docstring: { readonly value: Value } | undefined;
  readonly statements: readonly Statement[];
}

export interface CompiledProgram<Value> {
  readonly module: CompiledModule<Value>;
  readonly functions: ReadonlyMap<FunctionNode, CompiledFunction<Value>>;
  readonly classes: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>;
}

/** Eagerly prepare all analyzed function/class code before module execution.
 * AST identity keys let definition/expression adapters obtain code without scope
 * searches or recompilation. Traversal includes unexecuted suites, defaults and
 * comprehension children; no guest code runs here. The maps are host compiler
 * metadata, not exposed guest mappings or a security boundary. Comprehension
 * execution, general constant folding, guest code objects and complete allocation
 * accounting remain unfinished; this is not a standalone Python execution API.
 */
export function compileProgram<Value>(
  analysis: ModuleAnalysis, options: { readonly stripDocstring: boolean },
  constants: ClassConstants<Value>, meter: ExecutionMeter
): CompiledProgram<Value> {
  meter.checkpoint();
  if (analysis.scopes.scope.kind !== "module" || analysis.scopes.scope.node !== analysis.module)
    throw new Error("program compilation requires a matching analyzed module scope");
  const module: CompiledModule<Value> = { scope: analysis.scopes, ...compileSuite(analysis.module.body, options.stripDocstring, constants, meter) };
  const functions = new Map<FunctionNode, CompiledFunction<Value>>();
  const classes = new Map<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>();
  const pending = [analysis.scopes];
  while (pending.length) {
    meter.checkpoint();
    const scope = pending.pop()!, node = scope.scope.node;
    if (node.kind === "function" || node.kind === "lambda") functions.set(node, compileFunction(scope, analysis, options, constants, meter));
    else if (node.kind === "class") classes.set(node, compileClassBody(scope, analysis, options, constants, meter));
    for (let index = scope.children.length - 1; index >= 0; index--) { meter.checkpoint(); pending.push(scope.children[index]); }
  }
  return { module, functions, classes };
}
