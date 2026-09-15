import type {ExecutionMeter} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";

/** Interpreter-owned traceback links, never host JavaScript stacks. Native
 * adapters validate constructor arguments and expose frame objects. Locations
 * belong to this traceback, independently of a frame's later execution state.
 * Only the -1 line sentinel requests instruction-to-line resolution. */
export class Traceback<Frame> {
  #next:Traceback<Frame>|null;
  constructor(
    next:Traceback<Frame>|null,
    readonly frame:Frame,
    readonly lastInstruction:number,
    private readonly storedLine:number,
    meter:ExecutionMeter
  ) {
    meter.checkpoint(1,64);this.#next=next;Object.freeze(this);
  }
  get next():Traceback<Frame>|null{return this.#next;}

  lineNumber(resolve:(frame:Frame,instruction:number)=>number|null,meter:ExecutionMeter):number|null {
    meter.checkpoint();
    if(this.storedLine!==-1)return this.storedLine;
    try{return resolve(this.frame,this.lastInstruction);}
    finally{meter.checkpoint();}
  }

  /** Validate the entire candidate chain before publishing. Private links make
   * traversal callback-free and preserve the old link on cancellation/failure.
   * Multiple tracebacks may share tails; cycles may never be introduced. */
  setNext(next:Traceback<Frame>|null,meter:ExecutionMeter):void {
    meter.checkpoint();
    for(let cursor=next;cursor!==null;cursor=cursor.#next) {
      meter.checkpoint();
      if(cursor===this)throw new PythonRuntimeError("ValueError","traceback loop detected");
    }
    this.#next=next;
  }
}
