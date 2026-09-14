import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecPrivateNameCases} from "./codec-private-name-cases.js";

it.each(codecPrivateNameCases)("pinned codec private names, batch $index", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 2000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  try {
    const result = session.exec(source);
    let detail: unknown;
    if (result.status === "exception") {
      session.globals.set("failure", result.exception);
      const diagnostic = session.eval("str(failure)");
      if (diagnostic.status === "ok") detail = diagnostic.value.primitive;
    }
    expect(result.status, String(detail)).toBe("ok");
  } finally { session.close(); }
});
