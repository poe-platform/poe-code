import { getSandboxDataProperty } from "../../src/interp/object-model.js";
import { isSandboxClosure, type SandboxValue } from "../../src/interp/values.js";
import type { PreparedTest262 } from "./metadata.js";
import type { ScriptOutcome } from "./realm.js";

export type Test262Result = { status: "passed" } | {
  status: "failed";
  detail?: Record<string, string>;
  reason: "host-error" | "unexpected-throw" | "missing-throw" | "wrong-phase" | "wrong-error-type";
};

export function classifyScriptOutcome(
  outcome: ScriptOutcome,
  negative?: Extract<PreparedTest262, { kind: "test" }>["negative"]
): Test262Result {
  if (outcome.status === "normal") return negative === undefined ? { status: "passed" }
    : { status: "failed", reason: "missing-throw" };
  const detail: Record<string, string> = { phase: outcome.status === "throw" ? outcome.phase : "host" };
  if (outcome.error !== null && typeof outcome.error === "object") {
    for (const key of ["message", "code", "budget"]) {
      const value = outcome.status === "host-error" || outcome.error instanceof Error
        ? Object.getOwnPropertyDescriptor(outcome.error, key)?.value
        : getSandboxDataProperty(outcome.error as SandboxValue, key);
      if (typeof value === "string") detail[key] = value;
    }
  }
  if (outcome.status === "host-error") return { status: "failed", reason: "host-error", detail };
  let type: unknown;
  if (outcome.phase === "parse" && outcome.error instanceof Error) {
    const constructor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(outcome.error), "constructor")?.value;
    type = typeof constructor === "function" ? Object.getOwnPropertyDescriptor(constructor, "name")?.value : undefined;
  } else if (outcome.error !== null && typeof outcome.error === "object") {
    const constructor = getSandboxDataProperty(outcome.error as SandboxValue, "constructor");
    if (isSandboxClosure(constructor)) type = getSandboxDataProperty(constructor, "name");
  }
  if (typeof type === "string") detail.type = type;
  else if (outcome.error === null || typeof outcome.error !== "object") {
    detail.type = typeof outcome.error;
    if (typeof outcome.error === "string" || typeof outcome.error === "number" || typeof outcome.error === "boolean") detail.value = String(outcome.error);
  }
  if (negative === undefined) return { status: "failed", reason: "unexpected-throw", detail };
  if (outcome.phase !== negative.phase) return { status: "failed", reason: "wrong-phase", detail };
  return type === negative.type ? { status: "passed" } : { status: "failed", reason: "wrong-error-type", detail };
}
