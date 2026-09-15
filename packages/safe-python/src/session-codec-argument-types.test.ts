import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecArgumentTypeCases} from "./codec-argument-type-cases.js";

it.each(codecArgumentTypeCases)("codec argument diagnostic: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 300000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail ?? (result.status === "terminated" ? result.message : undefined)).toBe("ok");
});
