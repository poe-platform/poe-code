import type { ListValue, RuntimeValue } from "./runtime-values.js";

/** Trusted native storage lookup, never guest attribute or special-method access. */
export function runtimeListPayload(value: RuntimeValue): ListValue | undefined {
  return value.kind === "list" ? value : value.kind === "instance" && value.native?.kind === "list" ? value.native : undefined;
}
