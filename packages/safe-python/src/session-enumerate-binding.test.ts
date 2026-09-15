import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/enumerate-binding-3.14.7.json";

it.each(reference.cases)("matches enumerate binding ($mode): $expression", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [0n, 0n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});
