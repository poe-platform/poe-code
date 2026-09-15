import type {RuntimeValue} from "./runtime-values.js";

/** Pure native string storage inspection; never calls guest conversion slots. */
export function runtimeStringPayload(value:RuntimeValue):Extract<RuntimeValue,{kind:"str"}>|undefined {
  const payload=value.kind==="instance"?value.native:value;
  return payload?.kind==="str"?payload:undefined;
}
