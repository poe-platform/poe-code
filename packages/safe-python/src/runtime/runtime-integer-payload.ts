import type { RuntimeValue } from "./runtime-values.js";

/** Pure native numeric membership; never invokes guest conversion overrides. */
export function runtimeIntegerPayload(value: RuntimeValue): Extract<RuntimeValue, { kind: "int" | "bool" }> | undefined {
  const payload = value.kind === "instance" ? value.native : value;
  return payload?.kind === "int" || payload?.kind === "bool" ? payload : undefined;
}
