import type { ModuleAnalysis } from "../analysis.js";
import type { Statement } from "../statement-ast.js";
import type { ResolvedScope } from "../symbol-resolution.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { CodeConstants } from "./code-constants.js";
import { compileSuite } from "./suite-compilation.js";
import {createCompilationSource,type CompilationSource,type CodeCompilationOptions} from "./compilation-source.js";
import {compileCodeScopeFlags} from "./code-scope-flags.js";

export interface ClassConstants<Value> extends CodeConstants<Value> {
  /** Builtin constant allocation only, without invoking guest conversion hooks. */
  tuple(values: readonly Value[]): Value;
}

export interface CompiledClassBody<Value> {
  readonly flags?:number;
  readonly source?:CompilationSource<Value>;
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
  scope: ResolvedScope, analysis: Pick<ModuleAnalysis, "qualifiedNames" | "staticAttributes"> & Partial<Pick<ModuleAnalysis,"scopes"|"futureFeatures"|"futureFlags">>,
  options: CodeCompilationOptions, constants: ClassConstants<Value>, meter: ExecutionMeter,source?:CompilationSource<Value>,flags?:number
): CompiledClassBody<Value> {
  try {
  meter.checkpoint(1, 160);
  const node = scope.scope.node;
  if (scope.scope.kind !== "class" || node.kind !== "class") throw new Error("class bodies require a class scope");
  const name = analysis.qualifiedNames.get(scope.scope), attributes = analysis.staticAttributes.get(scope.scope);
  if (name === undefined || attributes === undefined) throw new Error("missing analyzed class metadata");
  if(flags===undefined&&analysis.scopes!==undefined&&analysis.futureFeatures!==undefined)flags=compileCodeScopeFlags(analysis.scopes.scope,analysis.futureFeatures,meter,analysis.futureFlags).get(scope.scope);
  source??=createCompilationSource(options.filename??"<string>",constants,meter);
  const qualifiedName = constants.string(name);
  meter.checkpoint();
  const decorator = node.decorators[0];
  const firstLine = constants.integer(decorator?.contentSpan?.start.line ?? decorator?.start.line ?? node.start.line);
  const names: Value[] = [];
  for (const attribute of attributes) { meter.checkpoint(1, 8); names.push(constants.string(attribute)); }
  meter.checkpoint();
  const staticAttributes = constants.tuple(names);
  const suite = compileSuite(node.body, options.stripDocstring, constants, meter);
  return { flags,source,scope, qualifiedName, firstLine, staticAttributes, ...suite };
  } finally { meter.checkpoint(); }
}
