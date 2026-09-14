import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecModuleCacheCases} from "./codec-module-cache-cases.js";

it.each(codecModuleCacheCases)("public codec module: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    detail = session.eval("str(failure)");
  }
  expect(result.status, JSON.stringify(detail)).toBe("ok");
});
