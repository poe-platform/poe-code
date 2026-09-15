import type {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {PythonSyntaxError,type SourcePosition} from "../source.js";

/** A native diagnostic containing guest Unicode retains its original points.
 * Error.message is for host diagnostics only; guest args must not decode that
 * UTF-16 spelling, which would merge adjacent surrogate code points. */
export class PythonUnicodeMessageError extends PythonRuntimeError {
  constructor(name:ConstructorParameters<typeof PythonRuntimeError>[0],readonly messagePoints:CodePointString,meter:ExecutionMeter) {
    meter.checkpoint(1,messagePoints.length*2);
    let message="";
    for(const point of messagePoints){meter.checkpoint(1,point>0xffff?4:2);message+=String.fromCodePoint(point);}
    super(name,message);
  }
}

/** Tokenizer initialization may translate a lossless native diagnostic into a
 * SyntaxError. Retain its points separately from the host diagnostic spelling,
 * just as PythonUnicodeMessageError does for ordinary runtime exceptions. */
export class PythonUnicodeSyntaxError extends PythonSyntaxError {
  constructor(message:string,filename:string,position:SourcePosition,readonly messagePoints:CodePointString) {
    super(message,filename,position);
  }
}
