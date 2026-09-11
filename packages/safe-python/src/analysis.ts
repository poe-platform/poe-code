import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { parseModule } from "./module.js";
import { validateFutureImports } from "./future-imports.js";
import { validateControlFlow } from "./control-flow-validation.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols, type ResolvedScope } from "./symbol-resolution.js";
import type { FunctionExecutionKind, FunctionNode } from "./expression-context.js";
import type { SymbolScope } from "./symbol-collection.js";
import { collectQualifiedNames } from "./qualified-names.js";
import { collectStaticAttributes } from "./static-attributes.js";
import { PythonSyntaxError } from "./source.js";

export interface ModuleAnalysis {
  readonly module: Module;
  readonly futureFeatures: ReadonlySet<string>;
  readonly scopes: ResolvedScope;
  /** Same AST identities as lexical scopes; includes unreachable yields. */
  readonly functionKinds: ReadonlyMap<FunctionNode, FunctionExecutionKind>;
  /** Code-bearing scope identities only; inlined comprehensions have no entry. */
  readonly qualifiedNames: ReadonlyMap<SymbolScope, string>;
  /** Class scopes only; sorted, normalized, unmangled static store names. */
  readonly staticAttributes: ReadonlyMap<SymbolScope, readonly string[]>;
}

/** Parse and statically validate source without executing it or loading imports.
 * Returned scopes reference the same syntax tree. Readonly collections describe
 * the API contract; they are not an isolation boundary or frozen snapshots.
 */
export function analyzeModule(text: string, options: LexerOptions = {}): ModuleAnalysis {
  try {
    const module = parseModule(text, options);
    const futureFeatures = validateFutureImports(module, options.filename,options.meter);
    const functionKinds = validateControlFlow(module, options.filename,options.meter);
    const scopes = resolveSymbols(collectSymbols(module), options.filename);
    const qualifiedNames = collectQualifiedNames(scopes.scope);
    const staticAttributes = collectStaticAttributes(scopes.scope);
    return { module, futureFeatures, scopes, functionKinds, qualifiedNames, staticAttributes };
  } catch (error) {
    if (error instanceof PythonSyntaxError) error.withSource(text,false,options.meter);
    throw error;
  } finally {options.meter?.checkpoint();}
}
