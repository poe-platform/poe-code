import type {CodeConstants} from "./code-constants.js";
import type {ExecutionMeter} from "./execution-budget.js";

export interface CodeCompilationOptions {
  readonly stripDocstring:boolean;
  /** Diagnostic identity only: no path resolution, normalization or file I/O. */
  readonly filename?:string;
}

/** One originating source shared by module and nested code. A wrapper preserves
 * a valid undefined constant in generic compiler integrations. */
export interface CompilationSource<Value> {readonly filename:Value}

export function createCompilationSource<Value>(filename:string,constants:Pick<CodeConstants<Value>,"string">,meter:ExecutionMeter):CompilationSource<Value> {
  meter.checkpoint(1,32);
  try{return Object.freeze({filename:constants.string(filename)});}
  finally{meter.checkpoint();}
}
