import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/dict-view-comparison-subtypes-3.14.7.json";

it.each(reference)("matches dict view comparison: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200000, maxAllocatedBytes: 2000000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(observation)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});
