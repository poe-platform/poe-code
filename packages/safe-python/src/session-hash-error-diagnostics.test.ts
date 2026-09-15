import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/hash-error-diagnostics-3.14.7.json";

it.each(reference.cases)("matches hash-error diagnostics: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(observation)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["{key}", "{key: 1}"])("keeps cancellation fatal while rendering the hash error for %s", expression => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
class Message:
    def __str__(self):
        print('cancel')
        return 'details'
class K:
    def __hash__(self):
        raise TypeError(Message())
key = K()
try:
    result = ${expression}
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
