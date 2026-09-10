import type { RuntimeValue } from "./runtime-values.js";

/** Pure native float membership, without calling guest conversion overrides. */
export function runtimeFloatPayload(value: RuntimeValue): Extract<RuntimeValue, { kind: "float" }> | undefined {
  const payload = value.kind === "instance" ? value.native : value;
  return payload?.kind === "float" ? payload : undefined;
}
