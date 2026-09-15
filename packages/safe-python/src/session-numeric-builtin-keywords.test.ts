import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/numeric-builtin-keywords-3.14.7.json";

it.each(reference.cases)("matches CPython numeric builtin keyword binding: $source", ({ source, expected, setup, events }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  if (setup !== undefined) expect(session.exec(setup)).toEqual({ status: "ok" });
  const result = session.eval(source);
  expect(result.status).toBe(expected.status);
  if (result.status === "exception") {
    session.globals.set("observed", result.exception);
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
    expect(session.eval("str(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.message } });
  } else if (result.status === "ok") {
    session.globals.set("observed", result.value);
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
    expect(session.eval("repr(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.repr } });
  }
  if (events !== undefined) expect(session.eval("repr(events)")).toMatchObject({ status: "ok", value: { primitive: events } });
});
