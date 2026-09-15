import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerResultIdentityCases} from "./codec-handler-result-identity-cases.js";

it.each(codecHandlerResultIdentityCases)("public codec handler identity: $name", ({source}) => {
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
