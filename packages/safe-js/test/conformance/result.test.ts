import { expect, it } from "vitest";
import { createTest262Realm } from "./realm.js";
import { classifyScriptOutcome } from "./result.js";

it.each([
  { source: "1", expected: undefined, status: "passed" },
  { source: "throw 42", expected: undefined, status: "failed" },
  { source: "return 1", expected: { phase: "parse", type: "SyntaxError" }, status: "passed" },
  { source: "missing", expected: { phase: "runtime", type: "ReferenceError" }, status: "passed" },
  { source: 'throw new TypeError("expected")', expected: { phase: "runtime", type: "TypeError" }, status: "passed" },
  { source: 'throw new TypeError("wrong phase")', expected: { phase: "parse", type: "TypeError" }, status: "failed" },
  { source: "return 1", expected: { phase: "runtime", type: "SyntaxError" }, status: "failed" },
  { source: "1", expected: { phase: "runtime", type: "TypeError" }, status: "failed" },
  { source: "missing", expected: { phase: "runtime", type: "TypeError" }, status: "failed" },
  { source: 'throw {name:"TypeError"}', expected: { phase: "runtime", type: "TypeError" }, status: "failed" },
  { source: 'throw "TypeError"', expected: { phase: "runtime", type: "TypeError" }, status: "failed" }
] as const)("classifies $source against $expected as $status", async ({ source, expected, status }) => {
  const realm = createTest262Realm();
  try {
    expect(classifyScriptOutcome(await realm.evaluate(source), expected)).toMatchObject({ status });
  } finally { await realm.dispose(); }
});

it("never accepts host failures as a matching negative", () => {
  expect(classifyScriptOutcome({ status: "host-error", error: new TypeError("host failure") },
    { phase: "runtime", type: "TypeError" }))
    .toMatchObject({ status: "failed", reason: "host-error" });
});

it("does not invoke a thrown object's constructor getter during reporting", async () => {
  const realm = createTest262Realm();
  try {
    const outcome = await realm.evaluate('globalThis.reads=0;throw {get constructor(){reads++;return TypeError}}');
    expect(classifyScriptOutcome(outcome, { phase: "runtime", type: "TypeError" })).toMatchObject({ status: "failed" });
    expect(await realm.evaluate("reads")).toMatchObject({ status: "normal", value: 0 });
  } finally { await realm.dispose(); }
});

it("records actionable error phase, constructor, and budget diagnostics without invoking guest getters", async () => {
  const realm = createTest262Realm();
  try {
    expect(classifyScriptOutcome(await realm.evaluate('throw new TypeError("counterexample")')))
      .toMatchObject({ status: "failed", detail: { phase: "runtime", type: "TypeError", message: "counterexample" } });
    expect(classifyScriptOutcome({ status: "host-error", error: Object.assign(new Error("step cap"), { code: "budgetExceeded", budget: "steps" }) }))
      .toMatchObject({ status: "failed", detail: { message: "step cap", code: "budgetExceeded", budget: "steps" } });
  } finally { await realm.dispose(); }
});
