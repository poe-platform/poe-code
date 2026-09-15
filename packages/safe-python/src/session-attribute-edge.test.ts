import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/attribute-edge-3.14.7.json";

it.each(reference.cases)("matches attribute edge behavior: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 1_000_000, maxAllocatedBytes: 8_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});
