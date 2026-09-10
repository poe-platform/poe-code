import type { TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { InstanceValue,RuntimeValue } from "./runtime-values.js";

/** Internal exception storage is distinct from overridable guest attributes. */
export class RuntimeExceptionState {
  readonly kind="exception";
  #args:TupleConstant<RuntimeValue>;
  #cause:InstanceValue|null=null;
  #context:InstanceValue|null=null;
  #suppressContext=false;
  constructor(args:TupleConstant<RuntimeValue>,meter:ExecutionMeter) {
    meter.checkpoint(1,56);this.#args=args;Object.freeze(this);
  }
  get args():TupleConstant<RuntimeValue>{return this.#args;}
  get cause():InstanceValue|null{return this.#cause;}
  get context():InstanceValue|null{return this.#context;}
  get suppressContext():boolean{return this.#suppressContext;}
  assignArgs(args:TupleConstant<RuntimeValue>,meter:ExecutionMeter):void {
    meter.checkpoint();this.#args=args;
  }
  /** Both explicit exception causes and from None suppress implicit context. */
  assignCause(value:InstanceValue|null,meter:ExecutionMeter):void {
    meter.checkpoint();this.#cause=value;this.#suppressContext=true;
  }
  assignContext(value:InstanceValue|null,meter:ExecutionMeter):void {
    meter.checkpoint();this.#context=value;
  }
  assignSuppression(value:boolean,meter:ExecutionMeter):void {
    meter.checkpoint();this.#suppressContext=value;
  }
}

export function runtimeExceptionPayload(value:RuntimeValue):RuntimeExceptionState|undefined {
  return value.kind==="instance"&&value.native?.kind==="exception"?value.native:undefined;
}
