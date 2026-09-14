import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/union-attribute-names-3.14.7.json";

it.each(reference.cases)("matches union attribute name behavior: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 100_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["__hash__", "__eq__"])("preserves cancellation from name %s during MRO lookup", method => {
  const controller = new AbortController();
  const writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 100_000, maxAllocatedBytes: 4_000_000, maxDepth: 100 },
    hashSeed: [1n, 2n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  const result = session.exec(`
class Name(str):
    __hash__ = str.__hash__
    def ${method}(self${method === "__eq__" ? ", other" : ""}):
        print('cancel')
        return 1
try:
    (int | str).__getattribute__(Name('__args__'))
except BaseException:
    print('recovered')
`);
  expect(writes).toEqual(["cancel"]);
  expect(result).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
