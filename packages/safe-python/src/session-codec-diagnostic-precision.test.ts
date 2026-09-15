import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecDiagnosticPrecisionCases} from "./codec-diagnostic-precision-cases.js";

it.each(codecDiagnosticPrecisionCases)("public codec diagnostic precision: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});
