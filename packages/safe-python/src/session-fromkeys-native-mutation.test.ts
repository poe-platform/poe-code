import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/fromkeys-native-mutation-3.14.7.json";

it.each(reference.rows)("preserves native fromkeys traversal: $name", ({ source, expected }) => {
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [0n, 0n]
  });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(actual)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it("keeps cancellation during native fromkeys equality fatal", () => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [0n, 0n],
    signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
armed = False
class Key:
    def __hash__(self):
        return 1
    def __eq__(self, other):
        if armed:
            print('cancel')
        return False
source = {Key(): 1, Key(): 2}
armed = True
try:
    dict.fromkeys(source)
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
});
