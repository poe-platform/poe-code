import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/dictionary-cursor-mutation-3.14.7.json";

it.each(reference.rows)("matches dictionary cursor mutation: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 500_000, maxAllocatedBytes: 8_000_000, maxDepth: 100 }, hashSeed: [0n, 0n] });
  try {
    expect(session.exec(source)).toEqual({ status: "ok" });
    expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
  } finally { session.close(); }
});
