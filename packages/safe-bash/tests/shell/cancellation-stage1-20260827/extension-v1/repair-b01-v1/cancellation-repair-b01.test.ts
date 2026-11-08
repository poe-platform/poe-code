import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activateChildCancellation,
  createRootCancellationLink,
  prepareChildCancellation,
  selectRuntimeCancellationOutcome,
  subscribeCancellation,
} from "../../../../../src/shell/cancellation.js";
import type {
  CancellationAdmissionSnapshot,
  CancellationBoundary,
  CancellationOrigin,
  CancellationReport,
  CancellationSelection,
  CapturedCancellationOutcome,
} from "../../../../../src/shell/cancellation.js";

type ControlRole = "budget-control" | "pipeline-control";

const metadata = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as {
  cases: { id: string; expected: string }[];
};
const declaredCases = new Set(metadata.cases.map(row => row.id));

function bounds(depth: number): CancellationAdmissionSnapshot {
  return { depth, maxDepth: 8, resourceLimit: 24 };
}

function thrown(reason: unknown, report?: CancellationReport): CapturedCancellationOutcome<never> {
  return report === undefined ? { kind: "throw", reason } : { kind: "throw", reason, report };
}

function returned<Value>(value: Value): CapturedCancellationOutcome<Value> {
  return { kind: "return", value };
}

function assertThrow(
  selection: CancellationSelection<unknown>,
  reason: unknown,
  origin?: CancellationOrigin,
): void {
  assert.equal(selection.outcome.kind, "throw");
  if (selection.outcome.kind === "throw") assert.ok(Object.is(selection.outcome.reason, reason));
  if (origin === undefined) assert.equal(selection.report, undefined);
  else assert.ok(selection.report?.origin === origin, "selection must retain the authenticated origin identity");
}

function focusedTest(id: string, name: string, body: () => void): void {
  test(`${id} ${name}`, () => {
    assert.ok(declaredCases.has(id), `missing frozen case ${id}`);
    body();
  });
}

function controlLineage(role: ControlRole): {
  readonly caller: AbortController;
  readonly outerInvoke: AbortController;
  readonly control: AbortController;
  readonly root: CancellationBoundary;
  readonly outer: CancellationBoundary;
  readonly stage: CancellationBoundary;
  readonly inner: CancellationBoundary;
  readonly observed: CancellationOrigin[];
  close(): void;
} {
  const caller = new AbortController();
  const outerInvoke = new AbortController();
  const control = new AbortController();
  const innerInvoke = new AbortController();
  const root = createRootCancellationLink({ callerSignal: caller.signal, admission: bounds(0) });
  const outer = activateChildCancellation(prepareChildCancellation(root, { signal: outerInvoke.signal }, bounds(1)));
  const stage = activateChildCancellation(prepareChildCancellation(outer, undefined, bounds(2), [
    { role, signal: control.signal },
  ]));
  const inner = activateChildCancellation(prepareChildCancellation(stage, { signal: innerInvoke.signal }, bounds(3)));
  const observed: CancellationOrigin[] = [];
  const detach = subscribeCancellation(inner, origin => { observed.push(origin); });
  return {
    caller,
    outerInvoke,
    control,
    root,
    outer,
    stage,
    inner,
    observed,
    close() {
      detach();
      inner.close();
      stage.close();
      outer.close();
      root.close();
    },
  };
}

focusedTest("B01-R01-budget-observed-control", "preserves observed budget control", () => {
  const fixture = controlLineage("budget-control");
  try {
    const controlFailure = { marker: "budget-failure" };
    const outerCancellation = { marker: "outer-cancel" };
    fixture.control.abort(controlFailure);
    const origin = fixture.observed[0];
    assert.equal(origin?.role, "budget-control");
    fixture.outerInvoke.abort(outerCancellation);

    assertThrow(selectRuntimeCancellationOutcome(fixture.inner, thrown(controlFailure), origin), controlFailure, origin);
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R02-pipeline-observed-falsy", "preserves observed falsy pipeline control", () => {
  const fixture = controlLineage("pipeline-control");
  try {
    fixture.control.abort(false);
    const origin = fixture.observed[0];
    assert.equal(origin?.role, "pipeline-control");
    fixture.outerInvoke.abort("outer-cancel");

    assertThrow(selectRuntimeCancellationOutcome(fixture.inner, thrown(false), origin), false, origin);
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R03-budget-descendant-report", "preserves a budget descendant report", () => {
  const fixture = controlLineage("budget-control");
  try {
    fixture.control.abort(0);
    const origin = fixture.observed[0];
    assert.equal(origin?.role, "budget-control");
    const childSelection = selectRuntimeCancellationOutcome(fixture.inner, thrown(0), origin);
    assertThrow(childSelection, 0, origin);
    assert.ok(childSelection.report);
    fixture.outerInvoke.abort("outer-cancel");

    assertThrow(
      selectRuntimeCancellationOutcome(fixture.stage, thrown(0, childSelection.report)),
      0,
      origin,
    );
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R04-pipeline-report-equal-invoke", "keeps control provenance for equal reasons", () => {
  const fixture = controlLineage("pipeline-control");
  try {
    fixture.control.abort("");
    const origin = fixture.observed[0];
    assert.equal(origin?.role, "pipeline-control");
    const childSelection = selectRuntimeCancellationOutcome(fixture.inner, thrown(""), origin);
    assertThrow(childSelection, "", origin);
    assert.ok(childSelection.report);
    fixture.outerInvoke.abort("");

    const selection = selectRuntimeCancellationOutcome(fixture.stage, thrown("", childSelection.report));
    assertThrow(selection, "", origin);
    assert.strictEqual(selection.report?.origin.signal, fixture.control.signal);
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R05-actual-root-priority", "retains actual root priority", () => {
  const fixture = controlLineage("budget-control");
  try {
    const controlFailure = { marker: "control-failure" };
    const rootCancellation = { marker: "root-cancel" };
    fixture.control.abort(controlFailure);
    const controlOrigin = fixture.observed[0];
    fixture.outerInvoke.abort({ marker: "outer-cancel" });
    fixture.caller.abort(rootCancellation);

    const selection = selectRuntimeCancellationOutcome(fixture.inner, thrown(controlFailure), controlOrigin);
    assert.equal(selection.outcome.kind, "throw");
    if (selection.outcome.kind === "throw") assert.strictEqual(selection.outcome.reason, rootCancellation);
    assert.equal(selection.report?.origin.role, "root-caller");
    assert.strictEqual(selection.report?.origin.signal, fixture.caller.signal);
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R06-unknown-equal-remains-unrelated", "does not infer provenance from equality", () => {
  const fixture = controlLineage("budget-control");
  try {
    fixture.control.abort(0);
    fixture.outerInvoke.abort("outer-cancel");

    assertThrow(selectRuntimeCancellationOutcome(fixture.inner, thrown(0)), 0);
  } finally {
    fixture.close();
  }
});

focusedTest("B01-R07-genuine-invoke-remains-ranked", "continues ranking authenticated invokes", () => {
  const outerInvoke = new AbortController();
  const innerInvoke = new AbortController();
  const root = createRootCancellationLink({ admission: bounds(0) });
  const outer = activateChildCancellation(prepareChildCancellation(root, { signal: outerInvoke.signal }, bounds(1)));
  const inner = activateChildCancellation(prepareChildCancellation(outer, { signal: innerInvoke.signal }, bounds(2)));
  const observed: CancellationOrigin[] = [];
  const detach = subscribeCancellation(inner, origin => { observed.push(origin); });
  try {
    const innerReason = { marker: "inner-invoke" };
    const outerReason = { marker: "outer-invoke" };
    innerInvoke.abort(innerReason);
    const innerOrigin = observed[0];
    assert.equal(innerOrigin?.role, "invoke-option");
    outerInvoke.abort(outerReason);

    const selection = selectRuntimeCancellationOutcome(inner, thrown(innerReason), innerOrigin);
    assert.equal(selection.outcome.kind, "throw");
    if (selection.outcome.kind === "throw") assert.strictEqual(selection.outcome.reason, outerReason);
    assert.equal(selection.report?.origin.role, "invoke-option");
    assert.strictEqual(selection.report?.origin.signal, outerInvoke.signal);
  } finally {
    detach();
    inner.close();
    outer.close();
    root.close();
  }
});

focusedTest("B01-R08-close-stability", "keeps closed child selection stable", () => {
  const fixture = controlLineage("pipeline-control");
  try {
    const controlFailure = { marker: "control-before-close" };
    fixture.control.abort(controlFailure);
    const origin = fixture.observed[0];
    assert.equal(origin?.role, "pipeline-control");
    fixture.inner.close();
    fixture.outerInvoke.abort({ marker: "late-outer" });

    assertThrow(selectRuntimeCancellationOutcome(fixture.inner, thrown(controlFailure), origin), controlFailure, origin);
    assert.deepEqual(selectRuntimeCancellationOutcome(fixture.inner, returned(7)), { outcome: { kind: "return", value: 7 } });
  } finally {
    fixture.close();
  }
});
