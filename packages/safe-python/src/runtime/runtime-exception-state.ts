import type { TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Internal exception storage is distinct from overridable guest attributes. */
export class RuntimeExceptionState {
  readonly kind="exception";
  #args:TupleConstant<RuntimeValue>;
  constructor(args:TupleConstant<RuntimeValue>,meter:ExecutionMeter) {
    meter.checkpoint(1,32);this.#args=args;Object.freeze(this);
  }
  get args():TupleConstant<RuntimeValue>{return this.#args;}
  assignArgs(args:TupleConstant<RuntimeValue>,meter:ExecutionMeter):void {
    meter.checkpoint();this.#args=args;
  }
}

export function runtimeExceptionPayload(value:RuntimeValue):RuntimeExceptionState|undefined {
  return value.kind==="instance"&&value.native?.kind==="exception"?value.native:undefined;
}
