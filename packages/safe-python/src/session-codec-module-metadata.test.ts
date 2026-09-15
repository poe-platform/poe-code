import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import cases from "./runtime/__snapshots__/codec-module-metadata-3.14.7.json";

// Complete programs captured from the pinned external oracle. Only the guest
// interpreter executes them in unit tests; no host modules or values are injected.
it.each(cases)("codec module metadata: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  expect(session.exec(source).status).toBe("ok");
});
