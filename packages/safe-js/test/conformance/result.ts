import { getSandboxDataProperty } from "../../src/interp/object-model.js";
import { isSandboxClosure, type SandboxValue } from "../../src/interp/values.js";
import type { PreparedTest262 } from "./metadata.js";
import type { ScriptOutcome } from "./realm.js";

export type Test262Result = { status: "passed" } | {
  status: "failed";
  reason: "host-error" | "unexpected-throw" | "missing-throw" | "wrong-phase" | "wrong-error-type";
};

export function classifyScriptOutcome(
  outcome: ScriptOutcome,
  negative?: Extract<PreparedTest262, { kind: "test" }>["negative"]
): Test262Result {
  if (outcome.status === "host-error") return { status: "failed", reason: "host-error" };
  if (negative === undefined) return outcome.status === "normal" ? { status: "passed" }
    : { status: "failed", reason: "unexpected-throw" };
  if (outcome.status === "normal") return { status: "failed", reason: "missing-throw" };
  if (outcome.phase !== negative.phase) return { status: "failed", reason: "wrong-phase" };
  let type: unknown;
  if (outcome.phase === "parse" && outcome.error instanceof Error) {
    const constructor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(outcome.error), "constructor")?.value;
    type = typeof constructor === "function" ? Object.getOwnPropertyDescriptor(constructor, "name")?.value : undefined;
  } else if (outcome.error !== null && typeof outcome.error === "object") {
    const constructor = getSandboxDataProperty(outcome.error as SandboxValue, "constructor");
    if (isSandboxClosure(constructor)) type = getSandboxDataProperty(constructor, "name");
  }
  return type === negative.type ? { status: "passed" } : { status: "failed", reason: "wrong-error-type" };
}
