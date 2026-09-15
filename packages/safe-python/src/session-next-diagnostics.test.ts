import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/next-diagnostics-3.14.7.json";

it.each(reference)("matches next diagnostic precedence: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200000, maxAllocatedBytes: 2000000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  const result = session.eval("repr(observation)");
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.value.primitive).toBe(expected);
});
