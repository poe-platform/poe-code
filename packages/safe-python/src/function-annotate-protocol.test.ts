import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

function session() {
  return new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
}
function value(s: PythonSession, source: string) {
  const result = s.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error("guest evaluation failed");
  return result.value.primitive;
}

it("defers custom annotators, caches success by identity, and invalidates on callable assignment", () => {
  const s = session();
  expect(s.exec(`events=[]
def f():pass
def annotate(fmt):
 events.append(fmt)
 return {'x':int}
f.__annotate__=annotate
`)).toEqual({ status: "ok" });
  expect(value(s, "len(events)")).toBe(0n);
  expect(s.exec("first=f.__annotations__\nsecond=f.__annotations__")).toEqual({ status: "ok" });
  expect(value(s, "first is second")).toBe(true);
  expect(value(s, "events == [1]")).toBe(true);
  expect(s.exec("first['extra']=42\nf.__annotate__(1)\nf.__annotate__=annotate\nthird=f.__annotations__")).toEqual({ status: "ok" });
  expect(value(s, "events == [1,1,1]")).toBe(true);
  expect(value(s, "third is first")).toBe(false);
});

it("retries failed evaluations with live globals and preserves nested writes on failure", () => {
  const s = session();
  expect(s.exec(`events=[]
def f():pass
def annotate(fmt):
 events.append(fmt)
 return {'x':Missing}
f.__annotate__=annotate
`)).toEqual({ status: "ok" });
  for (let i = 0; i < 2; i++) expect(s.exec("f.__annotations__").status).toBe("exception");
  expect(value(s, "events == [1,1]")).toBe(true);
  expect(s.exec("Missing=int\nresult=f.__annotations__")).toEqual({ status: "ok" });
  expect(value(s, "result['x'] is int")).toBe(true);
  expect(s.exec(`def nested(fmt):
 f.__annotations__={'saved':42}
 raise ValueError('failed')
f.__annotate__=nested
try:f.__annotations__
except ValueError:pass
`)).toEqual({ status: "ok" });
  expect(value(s, "f.__annotations__['saved']")).toBe(42n);
});

it("matches annotation descriptor resets and errors", () => {
  const s = session();
  expect(s.exec(`def f():pass
def annotate(fmt):return {'x':int}
f.__annotate__=annotate
f.__annotations__=None
`)).toEqual({ status: "ok" });
  expect(value(s, "f.__annotate__ is None and f.__annotations__ == {}")).toBe(true);
  expect(s.exec("cache={'x':1}\nf.__annotations__=cache\nf.__annotate__=None")).toEqual({ status: "ok" });
  expect(value(s, "f.__annotations__ is cache")).toBe(true);
  for (const [source, message] of [
    ["f.__annotate__=1", "__annotate__ must be callable or None"],
    ["del f.__annotate__", "__annotate__ cannot be deleted"],
    ["f.__annotate__=lambda fmt:1\nf.__annotations__", "__annotate__ returned non-dict of type 'int'"]
  ]) {
    expect(s.exec(`try:\n ${source.split("\n").join("\n ")}\nexcept TypeError as e:\n message=str(e)\nelse:\n message='no error'`)).toEqual({ status: "ok" });
    expect(value(s, "message")).toBe(message);
  }
});


it("evaluates callable instances and closures without binding the annotator to its owner", () => {
  const s = session();
  expect(s.exec(`def f():pass
class Annotator:
 def __call__(self, fmt):return {'format':fmt}
f.__annotate__=Annotator()
first=f.__annotations__
def factory():
 value=1
 def annotate(fmt):return {'value':value}
 def change(new):
  nonlocal value
  value=new
 return annotate,change
annotate,change=factory()
f.__annotate__=annotate
change(42)
second=f.__annotations__
change(99)
third=f.__annotations__
fourth=f.__annotate__(1)
`)).toEqual({ status: "ok" });
  expect(value(s, "first['format']")).toBe(1n);
  expect(value(s, "second['value']")).toBe(42n);
  expect(value(s, "third is second")).toBe(true);
  expect(value(s, "fourth['value']")).toBe(99n);
});

it("retains dict subclasses and overwrites nested successful cache writes", () => {
  const s = session();
  expect(s.exec(`def f():pass
class D(dict):pass
result=D(x=1)
def annotate(fmt):
 f.__annotations__={'nested':True}
 return result
f.__annotate__=annotate
first=f.__annotations__
second=f.__annotations__
`)).toEqual({ status: "ok" });
  expect(value(s, "first is result and second is result")).toBe(true);
  expect(value(s, "f.__annotate__ is None")).toBe(true);
  expect(s.exec("f.__annotations__=result\ndel f.__annotations__")).toEqual({ status: "ok" });
  expect(value(s, "f.__annotations__ == {} and f.__annotate__ is None")).toBe(true);
});

it("checks call-slot presence without evaluating descriptors when assigning annotators", () => {
  const s = session();
  expect(s.exec(`events=[]
def f():pass
class Slot:
 def __get__(self, instance, owner):
  events.append('get')
  return lambda fmt: {'format':fmt}
class Annotator:
 __call__=Slot()
f.__annotate__=Annotator()
`)).toEqual({ status: "ok" });
  expect(value(s, "len(events)")).toBe(0n);
  expect(value(s, "f.__annotations__['format']")).toBe(1n);
  expect(value(s, "events == ['get']")).toBe(true);
});

it("rechecks callability after type mutation and bounds invalid-result type names", () => {
  const s = session();
  expect(s.exec(`def f():pass
class A:
 def __call__(self, fmt):return {'x':1}
a=A()
f.__annotate__=a
del A.__call__
result=f.__annotations__
class B:pass
B.__name__='Z'*120
f.__annotate__=lambda fmt:B()
try:f.__annotations__
except TypeError as e:message=str(e)
`)).toEqual({ status: "ok" });
  expect(value(s, "result == {}")).toBe(true);
  expect(value(s, "message")).toBe(`__annotate__ returned non-dict of type '${"Z".repeat(100)}'`);
});
