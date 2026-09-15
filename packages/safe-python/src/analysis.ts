import type { LexerOptions } from "./lexer.js";
import type { Module } from "./statement-ast.js";
import { parseModule } from "./module.js";
import { parseExpression } from "./expression.js";
import type { Expression } from "./ast.js";
import { validateFutureImports } from "./future-imports.js";
import { validateControlFlow } from "./control-flow-validation.js";
import { collectSymbols } from "./symbol-collection.js";
import { resolveSymbols, type ResolvedScope } from "./symbol-resolution.js";
import type { FunctionExecutionKind, FunctionNode } from "./expression-context.js";
import type { SymbolScope } from "./symbol-collection.js";
import { collectQualifiedNames } from "./qualified-names.js";
import { collectStaticAttributes } from "./static-attributes.js";
import { PythonSyntaxError } from "./source.js";
import {normalizeFutureFlags} from "./future-flags.js";

export interface ModuleAnalysis {
  /** Explicit/inherited bits, separate from source future directives. */
  readonly futureFlags?:number;
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

export interface ExpressionAnalysis extends ModuleAnalysis {
  /** Original expression, shared with the synthetic module's sole statement. */
  readonly expression:Expression;
}

/** Analyze eval grammar and its nested scopes without evaluating the expression.
 * A synthetic module supplies the global namespace for shared scope analysis;
 * it is not a statement-mode parse and must not be executed as a docstring suite.
 */
export function analyzeExpression(text:string,options:LexerOptions={}):ExpressionAnalysis {
  try {
    const futureFlags=normalizeFutureFlags(options.futureFlags,options.meter);
    options.meter?.checkpoint(0,96);
    const settings={...options,futureFlags};
    const expression=parseExpression(text,settings);
    options.meter?.checkpoint(1,176);
    const module:Module={kind:"module",start:expression.start,end:expression.end,body:[{kind:"expression-statement",expression,start:expression.start,end:expression.end}]};
    const analysis=analyzeTree(module,settings);
    options.meter?.checkpoint(1,112);
    return {...analysis,expression};
  } catch(error) {
    if(error instanceof PythonSyntaxError)error.withSource(text,false,options.meter);
    throw error;
  } finally {options.meter?.checkpoint();}
}

/** Parse and statically validate source without executing it or loading imports.
 * Returned scopes reference the same syntax tree. Readonly collections describe
 * the API contract; they are not an isolation boundary or frozen snapshots.
 */
export function analyzeModule(text: string, options: LexerOptions = {}): ModuleAnalysis {
  try {
    const futureFlags=normalizeFutureFlags(options.futureFlags,options.meter);
    options.meter?.checkpoint(0,96);
    const settings={...options,futureFlags};
    const module = parseModule(text, settings);
    return analyzeTree(module,settings);
  } catch (error) {
    if (error instanceof PythonSyntaxError) error.withSource(text,false,options.meter);
    throw error;
  } finally {options.meter?.checkpoint();}
}

function analyzeTree(module:Module,options:LexerOptions):ModuleAnalysis {
    const futureFeatures = validateFutureImports(module, options.filename,options.meter);
    const functionKinds = validateControlFlow(module, options.filename,options.meter);
    const scopes = resolveSymbols(collectSymbols(module,options.meter), options.filename,options.meter);
    const qualifiedNames = collectQualifiedNames(scopes.scope,options.meter);
    const staticAttributes = collectStaticAttributes(scopes.scope,options.meter);
    options.meter?.checkpoint(1,104);
    return { module, futureFeatures, scopes, functionKinds, qualifiedNames, staticAttributes,futureFlags:options.futureFlags };
}
