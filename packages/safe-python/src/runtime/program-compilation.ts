import type { ModuleAnalysis } from "../analysis.js";
import type { FunctionNode } from "../expression-context.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import { compileClassBody, type ClassConstants, type CompiledClassBody } from "./class-compilation.js";
import { compileFunction, type CompiledFunction } from "./function-compilation.js";
import { compileSuite } from "./suite-compilation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compileLiteralPool, type LiteralExpression, type LiteralPool } from "./literal-pool.js";
import type { ComprehensionNode } from "./comprehension-execution.js";

export interface CompiledModule<Value> {
  readonly scope: ResolvedScope;
  readonly docstring: { readonly value: Value } | undefined;
  readonly statements: readonly Statement[];
}

export interface CompiledProgram<Value> {
  readonly comprehensions?: ReadonlyMap<ComprehensionNode,ResolvedScope>;
  readonly literals?: LiteralPool<Value>;
  readonly module: CompiledModule<Value>;
  readonly functions: ReadonlyMap<FunctionNode, CompiledFunction<Value>>;
  readonly classes: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>;
  readonly classFunctions: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledFunction<Value>>;
}

/** Eagerly prepare all analyzed function/class code before module execution.
 * AST identity keys let definition/expression adapters obtain code without scope
 * searches or recompilation. Traversal includes unexecuted suites, defaults and
 * comprehension children; no guest code runs here. The maps are host compiler
 * metadata, not exposed guest mappings or a security boundary. Comprehension
 * scope identities travel with nested code. General constant folding, guest code objects and complete allocation
 * accounting remain unfinished; this is not a standalone Python execution API.
 */
export function compileProgram<Value>(
  analysis: ModuleAnalysis, options: { readonly stripDocstring: boolean },
  constants: ClassConstants<Value> & { literal?(node: LiteralExpression): Value }, meter: ExecutionMeter
): CompiledProgram<Value> {
  meter.checkpoint();
  if (analysis.scopes.scope.kind !== "module" || analysis.scopes.scope.node !== analysis.module)
    throw new Error("program compilation requires a matching analyzed module scope");
  const module: CompiledModule<Value> = { scope: analysis.scopes, ...compileSuite(analysis.module.body, options.stripDocstring, constants, meter) };
  const literals = constants.literal ? compileLiteralPool(analysis.module.body, constants.literal.bind(constants), meter, constants.tuple.bind(constants)) : undefined;
  const functions = new Map<FunctionNode, CompiledFunction<Value>>();
  meter.checkpoint(0,48);
  const comprehensions = new Map<ComprehensionNode,ResolvedScope>();
  const classes = new Map<Extract<Statement, { kind: "class" }>, CompiledClassBody<Value>>();
  const classFunctions = new Map<Extract<Statement, { kind: "class" }>, CompiledFunction<Value>>();
  const pending = [analysis.scopes];
  while (pending.length) {
    meter.checkpoint();
    const scope = pending.pop()!, node = scope.scope.node;
    if (node.kind === "function" || node.kind === "lambda") {
      const code = compileFunction(scope, analysis, options, constants, meter);
      meter.checkpoint(0, 104);
      functions.set(node, { ...code, definitions: functions, classDefinitions: classFunctions, comprehensions, literals });
    }
    else if (node.kind === "class") {
      const code = compileClassBody(scope, analysis, options, constants, meter);
      classes.set(node, code);
      meter.checkpoint(0, 136);
      classFunctions.set(node, {
        scope, kind: "function", name: constants.string(node.name.name),
        qualifiedName: code.qualifiedName, firstLine: code.firstLine,
        docstring: undefined, body: { kind: "class", code },
        definitions: functions, classDefinitions: classFunctions, comprehensions, literals
      });
    }
    else if(node.kind==="comprehension"||node.kind==="dictionary-comprehension") {
      meter.checkpoint(0,48);comprehensions.set(node,scope);
    }
    for (let index = scope.children.length - 1; index >= 0; index--) { meter.checkpoint(); pending.push(scope.children[index]); }
  }
  return { module, functions, classes, classFunctions, comprehensions, literals };
}
