import type {CodeConstants} from "./code-constants.js";
import type {ExecutionMeter} from "./execution-budget.js";

export interface CompilationFilename<Value> {
  /** Host diagnostic spelling; not a lossless serialization of guest code points. */
  readonly displayName:string;
  /** Already allocated guest filename, retained without conversion. */
  readonly value:Value;
}

export interface CodeCompilationOptions<Value=unknown> {
  readonly stripDocstring:boolean;
  readonly optimize?:0|1|2;
  /** Diagnostic identity only: no path resolution, normalization or file I/O. */
  readonly filename?:string|CompilationFilename<Value>;
}

/** One originating source shared by module and nested code. A wrapper preserves
 * a valid undefined constant in generic compiler integrations. */
export interface CompilationSource<Value> {readonly filename:Value}

export function createCompilationSource<Value>(filename:string|CompilationFilename<Value>,constants:Pick<CodeConstants<Value>,"string">,meter:ExecutionMeter):CompilationSource<Value> {
  meter.checkpoint(1,32);
  try{return Object.freeze({filename:typeof filename==="string"?constants.string(filename):filename.value});}
  finally{meter.checkpoint();}
}

/** Snapshot a host-owned descriptor before compilation callbacks can mutate it. */
export function snapshotCompilationFilename<Value>(filename:string|CompilationFilename<Value>,meter:ExecutionMeter):string|CompilationFilename<Value> {
  try {
    if(typeof filename==="string")return filename;
    meter.checkpoint(1,48);
    return Object.freeze({displayName:filename.displayName,value:filename.value});
  } finally {meter.checkpoint();}
}
