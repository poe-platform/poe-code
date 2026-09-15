import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/string-containment-subtypes-3.14.7.json";

it.each(reference.programs)("matches string containment: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [0n, 0n]});
  const result = session.exec(source);
  let diagnostic = result.status;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const rendered = session.eval("repr(failure)");
    if (rendered.status === "ok") diagnostic += ": " + rendered.value.primitive;
  }
  expect(result.status, diagnostic).toBe("ok");
});
