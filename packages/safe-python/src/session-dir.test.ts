import { expect, it } from "vitest";
import { PythonSession } from "./index.js";
import reference from "./runtime/__snapshots__/dir-contracts-3.14.7.json";

it.each(reference.cases)("matches CPython directory introspection: $name", ({ source, expected }) => {
  const session = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(session.exec(source)).toEqual({ status: "ok" });
  expect(session.eval("repr(result)")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it.each(["directory", "namespace", "comparison"])("preserves cancellation from %s callbacks", phase => {
  const controller = new AbortController();
  const writes: string[] = [];
  const session = new PythonSession({
    limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n], signal: controller.signal,
    output: { write(text) { writes.push(text); controller.abort(); }, flush() {} }
  });
  const setup = phase === "directory" ? "class C:\n def __dir__(self): print('cancel'); return []\noperation=lambda:dir(C())"
    : phase === "namespace" ? "class C:\n def __getattribute__(self,name): print('cancel'); return None\noperation=lambda:object.__dir__(C())"
    : "class K:\n def __lt__(self,other): print('cancel'); return False\nclass C:\n def __dir__(self): return [K(),K()]\noperation=lambda:dir(C())";
  expect(session.exec(`${setup}\ntry:\n operation()\nexcept BaseException:\n print('recovered')`)).toMatchObject({ status: "terminated", reason: "cancelled" });
  expect(writes).toEqual(["cancel"]);
  expect(session.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
