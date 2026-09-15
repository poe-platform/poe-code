import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecNativeWideModuleCases} from "./codec-native-wide-module-cases.js";

it.each(codecNativeWideModuleCases)("native wide codec module: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 3000000, maxAllocatedBytes: 32000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});
