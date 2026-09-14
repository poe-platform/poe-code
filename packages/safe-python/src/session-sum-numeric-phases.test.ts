import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/sum-numeric-phases-3.14.7.json";

it.each(reference.rows)("matches sum numeric phase dispatch: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(actual)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});
