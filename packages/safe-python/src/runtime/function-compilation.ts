import type { ModuleAnalysis } from "../analysis.js";
import type { Expression } from "../ast.js";
import type { FunctionExecutionKind, FunctionNode } from "../expression-context.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { CodeConstants } from "./code-constants.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compileSuite } from "./suite-compilation.js";
import type { CompiledClassBody } from "./class-compilation.js";

export interface CompiledFunction<Value> {
  /** Originating program's code registry. Nested definitions follow their code,
   * not the caller's currently executing module. Standalone compilation may omit
   * it when the embedding runtime supplies its own definition resolver. */
  readonly definitions?: ReadonlyMap<FunctionNode, CompiledFunction<Value>>;
  readonly classDefinitions?: ReadonlyMap<Extract<Statement, { kind: "class" }>, CompiledFunction<Value>>;
  readonly scope: ResolvedScope;
  readonly kind: FunctionExecutionKind;
  readonly name: Value;
  readonly qualifiedName: Value;
  readonly firstLine: Value;
  readonly docstring: { readonly value: Value } | undefined;
  readonly body: { readonly kind: "suite"; readonly statements: readonly Statement[] }
    | { readonly kind: "expression"; readonly expression: Expression }
    | { readonly kind: "class"; readonly code: CompiledClassBody<Value> };
}

/** Compile function/lambda metadata using exact analyzed identities. Defaults and
 * decorators are definition-time operations, not compilation-time operations.
 * Suspended kinds are retained even for unreachable yields. The outer compiler
 * owns nested compilation/cache order; concrete guest code objects, function
 * metadata mutation and complete host allocation accounting remain unfinished.
 */
export function compileFunction<Value>(
  scope: ResolvedScope, analysis: Pick<ModuleAnalysis, "qualifiedNames" | "functionKinds">,
  options: { readonly stripDocstring: boolean }, constants: CodeConstants<Value>, meter: ExecutionMeter
): CompiledFunction<Value> {
  meter.checkpoint();
  const node = scope.scope.node;
  if ((scope.scope.kind !== "function" || node.kind !== "function") && (scope.scope.kind !== "lambda" || node.kind !== "lambda"))
    throw new Error("function code requires a function or lambda scope");
  const qualified = analysis.qualifiedNames.get(scope.scope), kind = analysis.functionKinds.get(node);
  if (qualified === undefined || kind === undefined) throw new Error("missing analyzed function metadata");
  const name = constants.string(node.kind === "function" ? node.name.name : "<lambda>");
  meter.checkpoint();
  const qualifiedName = constants.string(qualified);
  meter.checkpoint();
  const firstLine = constants.integer(node.kind === "function" ? node.decorators[0]?.start.line ?? node.start.line : node.start.line);
  if (node.kind === "lambda") return { scope, kind, name, qualifiedName, firstLine, docstring: undefined, body: { kind: "expression", expression: node.body } };
  const suite = compileSuite(node.body, options.stripDocstring, constants, meter);
  return { scope, kind, name, qualifiedName, firstLine, docstring: suite.docstring, body: { kind: "suite", statements: suite.statements } };
}
