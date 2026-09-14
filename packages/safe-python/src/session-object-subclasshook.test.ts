import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/object-subclasshook-3.14.7.json";

it.each(reference.rows)("matches the native subclass hook: $name", ({ source, expected }) => {
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [1n, 2n]
  });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(actual)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});
