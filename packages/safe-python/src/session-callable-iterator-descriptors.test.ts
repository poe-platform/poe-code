import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/callable-iterator-descriptors-3.14.7.json";

it.each(reference.rows)("matches callable iterator descriptors: $name", ({ source, expected }) => {
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [1n, 2n]
  });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(actual)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["bound", "unbound"])("keeps %s reduction lookup cancellation fatal", binding => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    signal: controller.signal, hashSeed: [1n, 2n],
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
i = iter(lambda: 42, None)
descriptor = type(i).__reduce__
class Builtins(dict):
    def __getitem__(self, name):
        if name == 'iter':
            print('cancel')
        return dict.__getitem__(self, name)
def original():
    pass
__builtins__ = Builtins(original.__builtins__)
def reduce():
    return ${binding === "bound" ? "i.__reduce__()" : "descriptor(i)"}
try:
    reduce()
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
