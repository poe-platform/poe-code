/** Validate the outcome shared by the worker protocol and persisted reports. */
export function isTest262ExecutionResult(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as { status?: unknown; reason?: unknown; detail?: unknown };
  if (result.status === "passed") return result.reason === undefined && result.detail === undefined;
  if (result.status === "unsupported") return result.detail === undefined &&
    ["module", "blocking-mode", "agent", "shared-memory", "IsHTMLDDA", "gc"].includes(result.reason as string);
  if (result.status !== "failed" || ![
    "host-error", "unexpected-throw", "missing-throw", "wrong-phase", "wrong-error-type",
    "harness-error", "timeout", "async-failure", "unhandled-rejection"
  ].includes(result.reason as string)) return false;
  if (result.detail === undefined) return true;
  if (typeof result.detail === "string") return result.reason === "harness-error" || result.reason === "timeout" ||
    result.reason === "async-failure" || result.reason === "unhandled-rejection";
  if (result.detail === null || typeof result.detail !== "object") return false;
  const prototype = Object.getPrototypeOf(result.detail);
  return (prototype === Object.prototype || prototype === null) &&
    Object.values(result.detail).every(part => typeof part === "string");
}
