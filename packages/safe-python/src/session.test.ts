import { describe, expect, it } from "vitest";
import { PythonSession } from "./index.js";

const options = () => ({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] as const });
function scalar(session: PythonSession, source: string) {
  const result = session.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error(JSON.stringify(result));
  return result.value.primitive;
}
describe("public Python sessions", () => {
  it("executes source with retained functions, classes, aliasing and isolated namespaces", () => {
    const a = new PythonSession(options()), b = new PythonSession(options());
    expect(a.exec("items=[1]\nalias=items\ndef add(x):\n items.append(x)\n return sum(items)\nclass C:\n def value(self):return add(4)\n")).toEqual({ status: "ok" });
    expect(scalar(a, "C().value()")).toBe(5n);
    expect(scalar(a, "alias is items")).toBe(true);
    expect(b.eval("items").status).toBe("exception");
    expect(() => b.globals.set("foreign", a.globals.get("items")!)).toThrow("different session");
    expect(a.globals.get("items")?.kind).toBe("list");
  });
  it("returns guest exceptions without terminating the session", () => {
    const s = new PythonSession(options());
    const result = s.exec("saved=7\nraise ValueError('bad')", { filename: "guest.py" });
    expect(result.status).toBe("exception");
    if (result.status !== "exception") throw Error("expected exception");
    s.globals.set("caught", result.exception);
    expect(scalar(s, "caught.args[0]")).toBe("bad");
    expect(scalar(s, "saved")).toBe(7n);
    expect(s.exec("try:\n 1/0\nexcept ZeroDivisionError:\n recovered=True")).toEqual({ status: "ok" });
    expect(scalar(s, "recovered")).toBe(true);
  });
  it("retains compilation diagnostics and allows recovery", () => {
    const s = new PythonSession(options());
    expect(s.exec("if", { filename: "broken.py" })).toMatchObject({ status: "diagnostic", diagnostic: { filename: "broken.py", position: { line: 1 } } });
    expect(scalar(s, "6*7")).toBe(42n);
  });
  it("routes incremental output through explicit services", () => {
    const chunks: string[] = [];
    const s = new PythonSession({ ...options(), output: { write: text => { chunks.push(text); }, flush: () => { chunks.push("<flush>"); } } });
    expect(s.exec("print('hello',42,flush=True)")).toEqual({ status: "ok" });
    expect(chunks).toEqual(["hello", " ", "42", "\n", "<flush>"]);
    expect(new PythonSession(options()).exec("print('denied')")).toMatchObject({ status: "terminated", reason: "capability" });
  });
  it("latches cancellation and invalidates handles on close", () => {
    const controller = new AbortController();
    const s = new PythonSession({ ...options(), signal: controller.signal });
    expect(s.exec("x=1")).toEqual({ status: "ok" });
    const value = s.globals.get("x")!;
    controller.abort();
    expect(s.exec("try:\n while True:pass\nexcept BaseException:pass")).toMatchObject({ status: "terminated", reason: "cancelled" });
    expect(s.eval("1")).toMatchObject({ status: "terminated", reason: "cancelled" });
    s.close();
    expect(() => value.primitive).toThrow("closed");
  });
  it("terminates infinite loops outside guest exception handling", () => {
    const s = new PythonSession({ ...options(), limits: { ...options().limits, maxAllocatedBytes: 1_000_000_000 } });
    expect(s.exec("try:\n while True:pass\nexcept BaseException:pass")).toMatchObject({ status: "terminated", reason: "steps" });
    expect(s.exec("x=1")).toMatchObject({ status: "terminated", reason: "steps" });
  });
});

it("shares real guest namespace dictionaries with dynamic compilation", () => {
  const s = new PythonSession(options());
  expect(s.exec("globals()['x']=6\nexec('y=x*7')\ncode=compile('y+1','nested.py','eval')")).toEqual({ status: "ok" });
  expect(scalar(s, "eval(code)")).toBe(43n);
  expect(scalar(s, "globals() is locals()")).toBe(true);
});
it("supports explicit input, prompt output, EOF and guest file writes", () => {
  const output: string[] = [], lines = ["answer\n", null];
  const s = new PythonSession({ ...options(), output: { write: text => { output.push(text); }, flush() {} }, input: { readLine: () => lines.shift()! } });
  expect(scalar(s, "input('prompt: ')")).toBe("answer");
  expect(output.join("")).toBe("prompt: ");
  expect(s.exec("try:input()\nexcept EOFError:ended=True")).toEqual({ status: "ok" });
  expect(scalar(s, "ended")).toBe(true);
  expect(s.exec("class Sink:\n def write(self,s):\n  global written\n  written=s\nprint('x',file=Sink(),end='tail')")).toEqual({ status: "ok" });
  expect(scalar(s, "written")).toBe("tail");
  expect(new PythonSession(options()).eval("input()")).toMatchObject({ status: "terminated", reason: "capability" });
});
it("preserves cancellation when an output service throws", () => {
  const controller = new AbortController();
  const s = new PythonSession({ ...options(), signal: controller.signal, output: { write() { controller.abort(); throw Error("service failed"); }, flush() {} } });
  expect(s.exec("print(1)")).toMatchObject({ status: "terminated", reason: "cancelled" });
});
it("keeps separate explicit global and local namespaces without exporting host objects", () => {
  const s = new PythonSession(options()), globals = s.createNamespace(), locals = s.createNamespace();
  globals.set("x", s.value(6n));
  expect(s.exec("y=x*7", { globals, locals })).toEqual({ status: "ok" });
  expect(locals.get("y")?.primitive).toBe(42n);
  expect(globals.get("y")).toBeUndefined();
  expect(s.eval("y", { globals, locals })).toMatchObject({ status: "ok" });
  expect(() => s.value({ secret: 1 } as never)).toThrow("primitive");
  expect(() => s.exec("pass", { globals: new PythonSession(options()).globals })).toThrow("different session");
});
it("rejects reentrant execution from services and snapshots installed services", () => {
  const observed: string[] = [];
  const output = { write() { expect(() => s.exec("pass")).toThrow("running"); observed.push("original"); }, flush() {} };
  const s = new PythonSession({ ...options(), output });
  output.write = () => { throw Error("replaced"); };
  expect(s.exec("print('x')")).toEqual({ status: "ok" });
  expect(observed).toEqual(["original", "original"]);
});
it("rejects asynchronous services instead of reporting success before completion", () => {
  const s = new PythonSession({ ...options(), output: { write: async () => {}, flush() {} } });
  expect(s.exec("print('x')")).toMatchObject({ status: "terminated", reason: "capability", message: "services must complete synchronously" });
});
it("retains generators and native exception handling across public calls", () => {
  const s = new PythonSession(options());
  expect(s.exec("def source():\n yield 1\n return 7\ng=source()")).toEqual({ status: "ok" });
  expect(scalar(s, "next(g)")).toBe(1n);
  expect(s.exec("try:next(g)\nexcept StopIteration as e:result=e.value")).toEqual({ status: "ok" });
  expect(scalar(s, "result")).toBe(7n);
});
it("requires an explicit sink for unraisable errors instead of silently discarding them", () => {
  const source = "class I:\n def __iter__(self):return self\n def __next__(self):return 1\n def __getattribute__(self,name):\n  if name=='close':raise ValueError('close lookup')\n  return object.__getattribute__(self,name)\ndef f():yield from I()\ng=f()\nnext(g)\ng.close()";
  expect(new PythonSession(options()).exec(source)).toMatchObject({ status: "terminated", reason: "capability" });
  const errors: import("./index.js").PythonUnraisable[] = [];
  const s = new PythonSession({ ...options(), unraisable: error => { errors.push(error); } });
  expect(s.exec(source)).toEqual({ status: "ok" });
  expect(errors).toHaveLength(1);
  s.globals.set("error", errors[0].exception);
  expect(scalar(s, "str(error)")).toBe("close lookup");
});
