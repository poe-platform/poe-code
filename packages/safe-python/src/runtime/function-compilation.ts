import type { ModuleAnalysis } from "../analysis.js";
import type { Expression } from "../ast.js";
import type { FunctionExecutionKind, FunctionNode } from "../expression-context.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { CodeConstants } from "./code-constants.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { compileSuite } from "./suite-compilation.js";
import type { CompiledClassBody } from "./class-compilation.js";
import type { LiteralPool } from "./literal-pool.js";
import type { ComprehensionNode } from "./comprehension-execution.js";
import {compileCodeLocalLayout,type CodeLocalLayout} from "./code-local-layout.js";
import {createCompilationSource,type CompilationSource,type CodeCompilationOptions} from "./compilation-source.js";
import {compileCodeScopeFlags} from "./code-scope-flags.js";
import type {CompiledGeneratorExpression} from "./generator-expression-compilation.js";

export interface CompiledFunction<Value> {
  readonly flags?:number;
  readonly source?:CompilationSource<Value>;
  /** Real function/lambda code owns this layout; synthetic class code does not. */
  readonly localLayout?:CodeLocalLayout;
  readonly comprehensions?: ReadonlyMap<ComprehensionNode,ResolvedScope>;
  readonly generatorExpressions?:ReadonlyMap<ComprehensionNode,CompiledGeneratorExpression<Value>>;
  /** Literal objects belong to the originating compilation, not each call. */
  readonly literals?: LiteralPool<Value>;
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
  scope: ResolvedScope, analysis: Pick<ModuleAnalysis, "qualifiedNames" | "functionKinds"> & Partial<Pick<ModuleAnalysis,"scopes"|"futureFeatures">>,
  options: CodeCompilationOptions, constants: CodeConstants<Value>, meter: ExecutionMeter,source?:CompilationSource<Value>,scopeFlags?:number
): CompiledFunction<Value> {
  meter.checkpoint();
  const node = scope.scope.node;
  if ((scope.scope.kind !== "function" || node.kind !== "function") && (scope.scope.kind !== "lambda" || node.kind !== "lambda"))
    throw new Error("function code requires a function or lambda scope");
  const qualified = analysis.qualifiedNames.get(scope.scope), kind = analysis.functionKinds.get(node);
  if (qualified === undefined || kind === undefined) throw new Error("missing analyzed function metadata");
  if(scopeFlags===undefined&&analysis.scopes!==undefined&&analysis.futureFeatures!==undefined)scopeFlags=compileCodeScopeFlags(analysis.scopes.scope,analysis.futureFeatures,meter).get(scope.scope);
  source??=createCompilationSource(options.filename??"<string>",constants,meter);
  const name = constants.string(node.kind === "function" ? node.name.name : "<lambda>");
  meter.checkpoint();
  const qualifiedName = constants.string(qualified);
  meter.checkpoint();
  const firstSite = node.kind === "function" ? node.decorators[0] ?? node : node;
  const firstLine = constants.integer(("contentSpan" in firstSite ? firstSite.contentSpan : undefined)?.start.line ?? firstSite.start.line);
  const localLayout=compileCodeLocalLayout(scope,meter);
  let flags=scopeFlags;
  if(flags!==undefined)flags|=(localLayout.varPositional?4:0)|(localLayout.varKeyword?8:0)|(kind==="generator"?0x20:kind==="coroutine"?0x80:kind==="async-generator"?0x200:0);
  if (node.kind === "lambda") return { flags,source,scope, kind, name, qualifiedName, firstLine, localLayout, docstring: undefined, body: { kind: "expression", expression: node.body } };
  const suite = compileSuite(node.body, options.stripDocstring, constants, meter);
  if(flags!==undefined&&suite.docstring!==undefined)flags|=0x4000000;
  return { flags,source,scope, kind, name, qualifiedName, firstLine, localLayout, docstring: suite.docstring, body: { kind: "suite", statements: suite.statements } };
}
