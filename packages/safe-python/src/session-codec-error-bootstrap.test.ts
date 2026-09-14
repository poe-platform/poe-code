import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecErrorBootstrapCases} from "./codec-error-bootstrap-cases.js";
import reference from "./runtime/__snapshots__/codec-error-bootstrap-3.14.7.json" with {type: "json"};

it.each(codecErrorBootstrapCases)("error registry bootstrap: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name);
  expect(expected).toMatchObject({source, status: 0, signal: null, stdout: "", stderr: ""});
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]
  });
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === "exception") {
    session.globals.set("failure_result", result.exception);
    detail = session.eval("str(failure_result)");
  }
  expect(result.status, JSON.stringify(detail)).toBe("ok");
});
