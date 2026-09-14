import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/attribute-name-dispatch-3.14.7.json";

it.each(reference.cases)("preserves attribute name dispatch: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["hash", "equality", "descriptor"])("keeps attribute %s cancellation fatal", stage => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
class Name(str):
    def __hash__(self):
        ${stage === "hash" ? "print('cancel')" : "pass"}
        return str.__hash__(self)
    def __eq__(self, other):
        ${stage === "equality" ? "print('cancel')" : "pass"}
        return str.__eq__(self, other)
class Descriptor:
    def __get__(self, obj, cls):
        ${stage === "descriptor" ? "print('cancel')" : "pass"}
        return 1
class C:
    field = Descriptor()
try:
    getattr(C(), Name('field'))
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
