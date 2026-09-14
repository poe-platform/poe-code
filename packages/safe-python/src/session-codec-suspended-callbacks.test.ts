import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSuspendedCallbackCases} from "./codec-suspended-callback-cases.js";

it.each(codecSuspendedCallbackCases)("public codec suspension: $name", ({source}) => {
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}
  });
  try {
    const result = session.exec(source);
    let detail: string | undefined;
    if (result.status === "exception") {
      session.globals.set("failure", result.exception);
      const diagnostic = session.eval("str(failure)");
      if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
    }
    expect(result.status, detail).toBe("ok");
  } finally {
    session.close();
  }
});
