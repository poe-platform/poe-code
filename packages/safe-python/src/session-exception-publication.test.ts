import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import cases from "./runtime/__snapshots__/builtin-exception-publication-3.14.7.json";

it.each(cases)("matches pinned exception publication: $source ($setup)", ({ setup, source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(setup).status).toBe("ok");
  const result = session.eval(source);
  expect(result.status).toBe(expected.status);
  if (result.status === "ok") {
    session.globals.set("observed", result.value);
    expect(session.eval("repr(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.repr } });
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
  } else if (result.status === "exception") {
    session.globals.set("observed", result.exception);
    expect(session.eval("str(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.message } });
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
  }
});
