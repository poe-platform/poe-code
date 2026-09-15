import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/dict-view-native-conversion-3.14.7.json";

it.each(reference.cases)("matches dictionary-view native conversion: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(observation)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["|", "-", "^"])("keeps cancellation fatal during dictionary-view %s conversion", operator => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
active = False
class D(dict):
    pass
class K:
    def __hash__(self):
        if active:
            print('cancel')
        return 7
d = D()
d[K()] = 1
active = True
try:
    result = d.keys() ${operator} []
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
