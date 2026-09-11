import {analyzeModule,analyzeExpression} from "../analysis.js";
import type {LexerOptions} from "../lexer.js";
import type {ClassConstants} from "./class-compilation.js";
import type {CodeCompilationOptions} from "./compilation-source.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {LiteralExpression} from "./literal-pool.js";
import {compileProgram,type CompiledProgram} from "./program-compilation.js";
import {normalizeFutureFlags} from "../future-flags.js";

export interface SourceCompilationOptions extends CodeCompilationOptions,Pick<LexerOptions,"onWarning"|"onComment"|"futureFlags"> {
  /** Module suites by default; eval preserves and returns one expression. */
  readonly mode?:"exec"|"eval";
  /** Required host recursion policy, shared with the calling execution. */
  readonly enterRecursiveCall:()=>()=>void;
}
export interface ProgramConstants<Value> extends ClassConstants<Value> {
  literal?(node:LiteralExpression):Value;
}

/** Compile a module or expression without executing guest code or loading files/imports.
 * Analysis and code preparation share one cumulative meter and diagnostic
 * filename. Constant adapters must charge their own guest allocations. These
 * cooperative controls do not preempt indivisible host operations.
 */
export function compileSourceProgram<Value>(text:string,options:SourceCompilationOptions,constants:ProgramConstants<Value>,meter:ExecutionMeter):CompiledProgram<Value> {
  try {
    meter.checkpoint(1,120);
    const enterRecursiveCall=options.enterRecursiveCall;
    if(typeof enterRecursiveCall!=="function")throw new TypeError("source compilation requires a recursion guard");
    const mode=options.mode??"exec";
    if(mode!=="exec"&&mode!=="eval")throw new TypeError("unsupported source compilation mode");
    const futureFlags=normalizeFutureFlags(options.futureFlags,meter);
    const settings={filename:options.filename??"<string>",stripDocstring:options.stripDocstring,onWarning:options.onWarning,onComment:options.onComment,enterRecursiveCall,meter,futureFlags};
    const analysis=mode==="eval"?analyzeExpression(text,settings):analyzeModule(text,settings);
    return compileProgram(analysis,settings,constants,meter);
  } finally {meter.checkpoint();}
}
