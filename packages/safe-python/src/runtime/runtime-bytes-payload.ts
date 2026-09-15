import type {RuntimeValue} from "./runtime-values.js";

/** Pure bytes storage inspection, including native heap subtype payloads. */
export function runtimeBytesPayload(value:RuntimeValue):Extract<RuntimeValue,{kind:"bytes"}>|undefined {
  const payload=value.kind==="instance"?value.native:value;
  return payload?.kind==="bytes"?payload:undefined;
}
