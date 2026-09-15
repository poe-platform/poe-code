import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/print-keyword-subtypes-3.14.7.json";

it.each(reference.cases)("preserves print keyword binding and stream effects: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [0n, 0n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["equality", "truth", "render"])("keeps cancellation fatal during print keyword %s", stage => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [0n, 0n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
class Truth:
    def __bool__(self):
        ${stage === "truth" ? "print('cancel')" : "pass"}
        return False
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        ${stage === "equality" ? "print('cancel')" : "pass"}
        return Truth()
    def __str__(self):
        ${stage === "render" ? "print('cancel')" : "pass"}
        return 'visible'
try:
    print(**{Key('sepp'): '|', 'file': None})
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
});
