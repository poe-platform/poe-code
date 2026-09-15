import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/round-edge-cases-3.14.7.json";

it.each(reference.cases)("matches CPython rounding edge case $source with $setup", ({ source, setup, expected, events, warnings, eventContract }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  if (setup !== "") {
    const prepared = session.exec(setup);
    if (prepared.status === "exception") {
      session.globals.set("setup_error", prepared.exception);
      const detail = session.eval("str(setup_error)");
      expect(prepared.status, detail.status === "ok" ? String(detail.value.primitive) : "setup failed").toBe("ok");
    }
    expect(prepared.status).toBe("ok");
  }
  const result = session.eval(source);
  expect(result.status).toBe(expected.status);
  if (result.status === "exception") {
    session.globals.set("observed", result.exception);
    expect(session.eval("str(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.message } });
    expect(session.eval("repr(observed.args)")).toMatchObject({ status: "ok", value: { primitive: expected.args } });
  } else if (result.status === "ok") {
    session.globals.set("observed", result.value);
    expect(session.eval("repr(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.repr } });
  }
  expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
  if (eventContract !== undefined) {
    // Object addresses vary across executions; check the actual event contract
    // while retaining the unmodified reference repr in the evidence artifact.
    expect(session.eval(eventContract)).toMatchObject({ status: "ok", value: { primitive: true } });
  } else if (setup !== "") expect(session.eval("repr(events)")).toMatchObject({ status: "ok", value: { primitive: events } });
  expect(warnings).toEqual([]);
});
