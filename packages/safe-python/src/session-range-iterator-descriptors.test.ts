import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/range-iterator-descriptors-3.14.7.json";

it.each(reference.rows)("matches native range iterator behavior: $name", ({ source, expected }) => {
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [0n, 0n]
  });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(actual)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["range(3)", "range(2**100)"])("keeps cancellation in %s reduction lookup fatal", range => {
  const controller = new AbortController(), writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 200_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    signal: controller.signal,
    hashSeed: [0n, 0n],
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  expect(session.exec(`
i = iter(${range})
class Builtins(dict):
    def __getitem__(self, name):
        if name == 'iter':
            print('cancel')
        return dict.__getitem__(self, name)
def template():
    pass
__builtins__ = Builtins(template.__builtins__)
def reduce():
    return i.__reduce__()
try:
    reduce()
except BaseException:
    print('recovered')
`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
});
