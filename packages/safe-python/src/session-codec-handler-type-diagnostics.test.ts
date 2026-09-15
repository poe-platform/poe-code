import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

import {codecHandlerTypeDiagnosticCases} from "./codec-handler-type-diagnostic-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-type-diagnostics-3.14.7.json" with {type: "json"};

it.each(codecHandlerTypeDiagnosticCases)("standard codec handler argument type: $name", ({name, source}) => {
  expect(reference.cases.find(row => row.name === name)).toMatchObject({source, status: 0, signal: null, stdout: "", stderr: ""});
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    detail = session.eval("str(failure)");
  }
  expect(result.status, JSON.stringify(detail)).toBe("ok");
});
