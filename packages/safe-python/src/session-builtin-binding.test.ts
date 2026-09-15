import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/builtin-binding-3.14.7.json";

it.each(reference.bindingProbes)("matches pinned builtin binding: $source", ({ source, expected, contract }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  const result = session.eval(source);
  expect(result.status).toBe(expected.status);
  if (result.status === "exception") {
    session.globals.set("observed", result.exception);
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
    expect(session.eval("str(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.message } });
  } else if (result.status === "ok") {
    session.globals.set("observed", result.value);
    expect(session.eval("type(observed).__name__")).toMatchObject({ status: "ok", value: { primitive: expected.type } });
    if (contract === undefined) {
      expect(session.eval("repr(observed)")).toMatchObject({ status: "ok", value: { primitive: expected.repr } });
    } else {
      // CPython does not promise fixed addresses/hashes across processes.
      expect(session.eval(`observed == ${source}`)).toMatchObject({ status: "ok", value: { primitive: true } });
      if (source === "id(None)") {
        expect(session.eval("observed != id(True) and observed != id(False) and id(None) == id(None)")).toMatchObject({ status: "ok", value: { primitive: true } });
      }
    }
  }
});
