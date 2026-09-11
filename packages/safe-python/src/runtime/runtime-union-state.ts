import type {TupleConstant} from "./constant-values.js";
import type {FrozenSetValue,RuntimeValue} from "./runtime-values.js";

export interface RuntimeUnionState {
  readonly kind:"union";
  readonly args:TupleConstant<RuntimeValue>;
  readonly hashable:FrozenSetValue;
  readonly unhashable:TupleConstant<RuntimeValue>|undefined;
}

export function runtimeUnionPayload(value:RuntimeValue):RuntimeUnionState|undefined {
  return value.kind==="instance"&&value.native?.kind==="union"?value.native:undefined;
}
