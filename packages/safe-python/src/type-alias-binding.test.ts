import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

// Differential reference: CPython 3.14.7 / Unicode 16.0.0.
// Unreachable definitions still bind names during compilation; these cases
// exercise that contract independently of deferred alias value evaluation.
function session() {
  return new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
}

it.each([
  ["Alias=42\ndef f():\n return Alias\n type Alias=int", "f()", "UnboundLocalError", "cannot access local variable 'Alias' where it is not associated with a value"],
  ["def outer():\n def inner():return Alias\n return inner\n type Alias=int", "outer()()", "NameError", "cannot access free variable 'Alias' where it is not associated with a value in enclosing scope"],
  ["class C:\n def f(self):\n  return __Alias\n  type __Alias=int", "C().f()", "UnboundLocalError", "cannot access local variable '_C__Alias' where it is not associated with a value"],
])("binds unreachable aliases in lexical scope: %s", (source, call, name, message) => {
  const s = session();
  expect(s.exec(`${source}\ntry:\n ${call}\nexcept Exception as e:\n result=(type(e).__name__,str(e))\nelse:\n result=None`)).toEqual({ status: "ok" });
  expect(s.eval(`result == (${JSON.stringify(name)}, ${JSON.stringify(message)})`)).toMatchObject({ status: "ok", value: { primitive: true } });
});

it("allows nonlocal writes to a cell established by an unreachable alias", () => {
  const s = session();
  expect(s.exec(`def outer():
 def inner():
  nonlocal Alias
  Alias=42
 inner()
 return Alias
 type Alias=int
result=outer()
`)).toEqual({ status: "ok" });
  expect(s.eval("result")).toMatchObject({ status: "ok", value: { primitive: 42n } });
});

it.each([
  ["def f():\n type Alias=int\n global Alias", "name 'Alias' is assigned to before global declaration"],
  ["def outer():\n Alias=1\n def inner():\n  type Alias=int\n  nonlocal Alias", "name 'Alias' is assigned to before nonlocal declaration"],
  ["type Alias=int\nglobal Alias", "name 'Alias' is assigned to before global declaration"],
])("rejects declarations after alias bindings before any source runs: %s", (source, message) => {
  const s = session();
  expect(s.exec(`events=[]\n${source}`, { filename: "alias-scope.py" })).toMatchObject({ status: "diagnostic", diagnostic: { name: "SyntaxError", message, filename: "alias-scope.py" } });
  expect(s.globals.get("events")).toBeUndefined();
});

it("keeps explicit global declarations and class namespace lookup distinct from function locals", () => {
  const s = session();
  expect(s.exec(`Alias=42
def f():
 global Alias
 return Alias
 type Alias=int
class C:
 result=Alias
 if False:
  type Alias=int
result=f()
`)).toEqual({ status: "ok" });
  expect(s.eval("result == 42 and C.result == 42")).toMatchObject({ status: "ok", value: { primitive: true } });
});
