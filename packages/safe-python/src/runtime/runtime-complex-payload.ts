import type { RuntimeValue } from "./runtime-values.js";

/** Pure native complex membership, without calling guest conversion overrides. */
export function runtimeComplexPayload(value:RuntimeValue):Extract<RuntimeValue,{kind:"complex"}>|undefined {
  const payload=value.kind==="instance"?value.native:value;
  return payload?.kind==="complex"?payload:undefined;
}
