import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

function session() {
  return new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
}
function scalar(s: PythonSession, source: string) {
  const result = s.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error("expected a guest value");
  return result.value.primitive;
}

it("publishes vars and returns the active module namespace identity", () => {
  const s = session();
  expect(scalar(s, "vars() is globals()")).toBe(true);
  expect(s.exec("vars()['answer']=42")).toEqual({ status: "ok" });
  expect(scalar(s, "answer")).toBe(42n);
});

it("returns independent optimized-frame snapshots without mutating fast locals", () => {
  const s = session();
  expect(s.exec("def f():\n x=1\n first=vars()\n first['x']=99\n second=vars()\n return x==1 and second['x']==1 and first is not second")).toEqual({ status: "ok" });
  expect(scalar(s, "f()")).toBe(true);
});

it("preserves the instance dictionary identity and class mapping proxy", () => {
  const s = session();
  expect(s.exec("class C: pass\nc=C()\nvars(c)['answer']=42")).toEqual({ status: "ok" });
  expect(scalar(s, "vars(c) is c.__dict__ and c.answer==42")).toBe(true);
  expect(scalar(s, "type(vars(C)).__name__")).toBe("mappingproxy");
});

it("performs full guest attribute lookup once and returns arbitrary __dict__ values", () => {
  const s = session();
  expect(s.exec("events=[]\nclass C:\n def __getattribute__(self,name):\n  events.append(name)\n  return 42\nc=C()")).toEqual({ status: "ok" });
  expect(scalar(s, "vars(c)")).toBe(42n);
  expect(scalar(s, "events==['__dict__']")).toBe(true);
});

it.each([
  ["vars(1)", "vars() argument must have __dict__ attribute"],
  ["vars(1,2)", "vars expected at most 1 argument, got 2"],
  ["vars(1,2,x=3)", "vars() takes no keyword arguments"],
  ["vars(x=3)", "vars() takes no keyword arguments"]
])("matches argument error precedence for %s", (expression, message) => {
  const s = session();
  expect(s.exec(`message='no exception'\ntry: ${expression}\nexcept TypeError as e: message=e.args[0]`)).toEqual({ status: "ok" });
  expect(scalar(s, "message")).toBe(message);
});

it.each(["AttributeError", "ValueError"])("handles guest %s from __dict__ lookup", exception => {
  const s = session();
  expect(s.exec(`class C:\n def __getattribute__(self,name): raise ${exception}('lookup')\ntry: vars(C())\nexcept Exception as e: result=(e.__class__.__name__,e.args[0])`)).toEqual({ status: "ok" });
  expect(scalar(s, "result[0]")).toBe(exception === "AttributeError" ? "TypeError" : "ValueError");
  expect(scalar(s, "result[1]")).toBe(exception === "AttributeError" ? "vars() argument must have __dict__ attribute" : "lookup");
});
