import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

import { encodeCases } from "./encode-compatibility-cases.js";

it.each(encodeCases)("public str.encode: %s", source => {
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source).status).toBe("ok");
});
