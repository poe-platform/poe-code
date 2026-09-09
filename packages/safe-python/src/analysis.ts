import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { parseModule } from "./module.js";
import { validateFutureImports } from "./future-imports.js";
import { validateControlFlow } from "./control-flow-validation.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols, type ResolvedScope } from "./symbol-resolution.js";
import type { FunctionExecutionKind, FunctionNode } from "./expression-context.js";

export interface ModuleAnalysis {
  readonly module: Module;
  readonly futureFeatures: ReadonlySet<string>;
  readonly scopes: ResolvedScope;
  /** Same AST identities as lexical scopes; includes unreachable yields. */
  readonly functionKinds: ReadonlyMap<FunctionNode, FunctionExecutionKind>;
}

/** Parse and statically validate source without executing it or loading imports.
 * Returned scopes reference the same syntax tree. Readonly collections describe
 * the API contract; they are not an isolation boundary or frozen snapshots.
 */
export function analyzeModule(text: string, options: LexerOptions = {}): ModuleAnalysis {
  const module = parseModule(text, options);
  const futureFeatures = validateFutureImports(module, options.filename);
  const functionKinds = validateControlFlow(module, options.filename);
  const scopes = resolveSymbols(collectSymbols(module), options.filename);
  return { module, futureFeatures, scopes, functionKinds };
}
