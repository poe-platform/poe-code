import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/exception-native-descriptor-contracts-3.14.7.json";

it.each(reference.cases)("matches native exception descriptor contract: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 100_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  try {
    expect(session.exec(source)).toEqual({ status: "ok" });
    expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
  } finally {
    session.close();
  }
});
