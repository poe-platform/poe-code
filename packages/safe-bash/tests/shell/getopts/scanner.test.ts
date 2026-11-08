import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneGetoptsState, createGetoptsState, GetoptsError, scanGetopts, withGetoptsIndex } from "../../../src/shell/getopts.js";
import type { GetoptsState } from "../../../src/shell/getopts.js";
import { options } from "./helpers.js";

test("empty vectors, repeated end and consumed marker have no permanent done latch", async () => {
  const empty = await scanGetopts(createGetoptsState(), "", [], options());
  assert.equal(empty.status, 1);
  assert.equal(empty.optind, 1);
  const marker = await scanGetopts(empty.state, "a", ["--", "-a"], options());
  assert.equal(marker.status, 1);
  assert.equal(marker.optind, 2);
  const resumed = await scanGetopts(marker.state, "a", ["--", "-a"], options());
  assert.equal(resumed.option, "a");
  assert.equal(resumed.optind, 3);
  const end = await scanGetopts(resumed.state, "a", ["--", "-a"], options());
  assert.deepEqual(await scanGetopts(end.state, "a", ["--", "-a"], options()), end);
});

test("unknown options advance within a cluster without losing following options", async () => {
  const first = await scanGetopts(createGetoptsState(), "a", ["-zax"], options());
  assert.deepEqual(first.diagnostic, { kind: "unknown-option", option: "z" });
  assert.deepEqual(first.state, { index: 1, active: { argument: 0, offset: 2 } });
  const second = await scanGetopts(first.state, "a", ["-zax"], options());
  assert.equal(second.option, "a");
  const third = await scanGetopts(second.state, "a", ["-zax"], options());
  assert.equal(third.kind, "unknown-option");
  assert.equal(third.optind, 2);
  assert.deepEqual(first.state, { index: 1, active: { argument: 0, offset: 2 } });
});

for (const spec of ["aa:", "a:a", "a::", "?", ":?", ":", ""]) {
  test(`ASCII specification grammar: ${JSON.stringify(spec)}`, async () => {
    const result = await scanGetopts(createGetoptsState(), spec, ["-a", "value"], options());
    if (spec === "aa:") {
      assert.equal(result.kind, "option");
      assert.deepEqual(result.argument, { kind: "unset" });
      assert.equal(result.optind, 2);
    } else if (spec.startsWith("a:")) {
      assert.deepEqual(result.argument, { kind: "set", value: "value" });
      assert.equal(result.optind, 3);
    } else {
      assert.equal(result.kind, "unknown-option");
      assert.equal(result.diagnostic === null, spec.startsWith(":"));
    }
  });
}

for (const token of ["-?", "-:"]) {
  test(`question mark and colon remain invalid option characters: ${token}`, async () => {
    const result = await scanGetopts(createGetoptsState(), ":?:", [token], options());
    assert.equal(result.kind, "unknown-option");
    assert.deepEqual(result.argument, { kind: "set", value: token[1] });
    assert.equal(result.diagnostic, null);
  });
}

for (const value of ["", "é", "🦊 snow 雪", "-é", "--", "\ud800", "\udc00"]) {
  test(`ordinary Unicode and dash argument values: ${JSON.stringify(value)}`, async () => {
    const separate = await scanGetopts(createGetoptsState(), "a:", ["-a", value], options());
    assert.deepEqual(separate.argument, { kind: "set", value });
    if (value) {
      const attached = await scanGetopts(createGetoptsState(), "a:", [`-a${value}`], options());
      assert.deepEqual(attached.argument, { kind: "set", value });
      assert.equal(attached.optind, 2);
    }
  });
}

test("Unicode operands are not misclassified as option characters", async () => {
  const result = await scanGetopts(createGetoptsState(), "a", ["é", "-a"], options());
  assert.equal(result.kind, "end");
  assert.equal(result.optind, 1);
});

for (const [spec, args] of [["é", []], ["a🦊", ["-a"]], ["a", ["-é"]], ["a", ["-🦊"]]] as const) {
  test(`non-ASCII option refusal: ${JSON.stringify([spec, args])}`, async () => {
    const state = Object.freeze(createGetoptsState());
    await assert.rejects(scanGetopts(state, spec, args, options()), (error: unknown) => error instanceof GetoptsError && error.code === "NON_ASCII_OPTION");
    assert.deepEqual(state, { index: 0 });
  });
}

test("non-ASCII suffix refusal does not commit a transition or corrupt a prior cursor", async () => {
  const first = await scanGetopts(createGetoptsState(), "a", ["-aé"], options());
  const snapshot = cloneGetoptsState(first.state);
  await assert.rejects(scanGetopts(first.state, "a", ["-aé"], options()), { code: "NON_ASCII_OPTION" });
  assert.deepEqual(first.state, snapshot);
  const replacement = await scanGetopts(first.state, "ab", ["-ab"], options());
  assert.equal(replacement.option, "b");
});

test("clone and numeric index primitives own cursor storage and do not perform bindings", async () => {
  const first = await scanGetopts(createGetoptsState(), "abc", ["-abc"], options());
  const copy = cloneGetoptsState(first.state);
  const changed = withGetoptsIndex(first.state, 2);
  assert.notEqual(copy.active, first.state.active);
  assert.notEqual(changed.active, first.state.active);
  (copy.active as { offset: number }).offset = 3;
  assert.equal(first.state.active?.offset, 2);
  assert.deepEqual(withGetoptsIndex(first.state, 1), { index: 0 });
  assert.deepEqual(withGetoptsIndex(first.state, Number.MIN_SAFE_INTEGER), { index: 0 });
  assert.deepEqual(withGetoptsIndex(first.state, 0), { index: 0 });
  const reset = await scanGetopts(withGetoptsIndex(first.state, 1), "abc", ["-abc"], options());
  assert.equal(reset.option, "a");
  const untouched = await scanGetopts(first.state, "abc", ["-abc"], options());
  assert.equal(untouched.option, "b");
});

test("oversized safe indices normalize without index-sized loops or allocations", async () => {
  const state = withGetoptsIndex({ index: 1, active: { argument: 0, offset: 2 } }, Number.MAX_SAFE_INTEGER);
  const result = await scanGetopts(state, "a", ["-a"], options({ maxSteps: 10 }));
  assert.equal(result.kind, "end");
  assert.deepEqual(result.state, { index: 2 });
});

test("stale active slots and offsets are checked against the current argument vector", async () => {
  for (const active of [{ argument: 5, offset: 1 }, { argument: 0, offset: Number.MAX_SAFE_INTEGER }]) {
    const result = await scanGetopts({ index: 1, active }, "a", ["-a"], options());
    assert.equal(result.option, "a");
  }
  const result = await scanGetopts({ index: 1, active: { argument: 0, offset: 2 } }, "a", [""], options());
  assert.equal(result.kind, "end");
});

test("frozen inputs survive independent concurrent scans", async () => {
  const state = Object.freeze({ index: 1, active: Object.freeze({ argument: 0, offset: 2 }) });
  const args = Object.freeze(["-abc"]);
  const results = await Promise.all([scanGetopts(state, "abc", args, options()), scanGetopts(state, "abc", args, options())]);
  assert.deepEqual(results[0], results[1]);
  assert.notEqual(results[0]!.state.active, results[1]!.state.active);
  assert.deepEqual(state, { index: 1, active: { argument: 0, offset: 2 } });
});

for (const state of [null, [], {}, { index: -1 }, { index: NaN }, { index: Infinity }, { index: 1.5 }, { index: Number.MAX_SAFE_INTEGER + 1 }, { index: "1" }, { index: 1, active: null }, { index: 1, active: { argument: -1, offset: 1 } }, { index: 1, active: { argument: 0, offset: 0 } }, { index: 1, active: { argument: 0, offset: Infinity } }]) {
  test(`malformed state is rejected: ${JSON.stringify(state)}`, () => {
    assert.throws(() => cloneGetoptsState(state as GetoptsState), { code: "INVALID_INPUT" });
  });
}

for (const value of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, "1", 1n]) {
  test(`numeric index primitive refuses non-safe-number input: ${String(value)}`, () => {
    assert.throws(() => withGetoptsIndex(createGetoptsState(), value as number), { code: "INVALID_INPUT" });
  });
}
