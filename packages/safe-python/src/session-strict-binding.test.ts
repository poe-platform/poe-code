import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/strict-binding-3.14.7.json";

it.each(reference.cases)("matches strict binding ($mode): $expression", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [0n, 0n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["map", "zip"])("keeps cancellation fatal during %s keyword equality", operation => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [0n, 0n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
class Key(str):
 __hash__=str.__hash__
 def __eq__(self,other):
  print('cancel')
  return True
try:
 ${operation}(${operation === "map" ? "abs, [], " : ""}**{Key('strict'): True})
except BaseException:
 print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
});
