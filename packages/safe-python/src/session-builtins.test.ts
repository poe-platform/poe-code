import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const options = () => ({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] as const });
function scalar(s: PythonSession, source: string) {
  const result = s.eval(source);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error(JSON.stringify(result));
  return result.value.primitive;
}

it("selects globals builtins per public call and retains function builtin identities", () => {
  const s = new PythonSession(options());
  expect(s.exec("original=__builtins__\n__builtins__={'answer':42}")).toEqual({ status: "ok" });
  expect(scalar(s, "answer")).toBe(42n);
  expect(s.exec("def f():return answer\n__builtins__={'answer':91}")).toEqual({ status: "ok" });
  expect(scalar(s, "answer")).toBe(91n);
  expect(scalar(s, "f()")).toBe(42n);
  expect(s.eval("len([])").status).toBe("exception");
  expect(s.exec("__builtins__=original")).toEqual({ status: "ok" });
  expect(scalar(s, "len([])")).toBe(0n);
});

it("defers nonmapping builtins failure until a missing name is loaded", () => {
  const s = new PythonSession(options());
  expect(s.exec("__builtins__=None")).toEqual({ status: "ok" });
  expect(s.exec("def f():return 42")).toEqual({ status: "ok" });
  expect(scalar(s, "f()")).toBe(42n);
  const result = s.eval("missing");
  expect(result.status).toBe("exception");
  if (result.status !== "exception") throw Error("expected guest error");
  s.globals.set("error", result.exception);
  expect(scalar(s, "error.args[0]")).toBe("'NoneType' object is not subscriptable");
});

it("uses guest mapping slots and preserves non-KeyError lookup exceptions", () => {
  const s = new PythonSession(options());
  expect(s.exec("class B:\n def __getitem__(self,key):\n  if key=='answer':return 73\n  raise ValueError(key)\n__builtins__=B()")).toEqual({ status: "ok" });
  expect(scalar(s, "answer")).toBe(73n);
  expect(s.exec("def f():return answer")).toEqual({ status: "ok" });
  expect(scalar(s, "f()")).toBe(73n);
  const result = s.eval("missing");
  expect(result.status).toBe("exception");
  if (result.status !== "exception") throw Error("expected guest error");
  s.globals.set("error", result.exception);
  expect(scalar(s, "error.args[0]")).toBe("missing");
});

it("honors dictionary subclass missing hooks and converts only KeyError to NameError", () => {
  const s = new PythonSession(options());
  expect(s.exec("class B(dict):\n def __missing__(self,key):\n  if key=='answer':return 19\n  raise KeyError(key)\n__builtins__=B()")).toEqual({ status: "ok" });
  expect(scalar(s, "answer")).toBe(19n);
  expect(s.exec("def f():return answer")).toEqual({ status: "ok" });
  expect(scalar(s, "f()")).toBe(19n);
  const result = s.eval("missing");
  expect(result.status).toBe("exception");
  if (result.status !== "exception") throw Error("expected guest error");
  s.globals.set("error", result.exception);
  expect(scalar(s, "error.__class__.__name__")).toBe("NameError");
  expect(scalar(s, "error.args[0]")).toBe("name 'missing' is not defined");
});

it("keeps the active frame builtins while globals replace the next call's selection", () => {
  const s = new PythonSession(options());
  expect(s.exec("__builtins__={'answer':12}")).toEqual({ status: "ok" });
  expect(s.exec("__builtins__={'answer':34}\ncurrent=answer\ndef f():return answer")).toEqual({ status: "ok" });
  expect(scalar(s, "current")).toBe(12n);
  expect(scalar(s, "answer")).toBe(34n);
  expect(scalar(s, "f()")).toBe(34n);
});

it("restores canonical builtins when the binding is deleted without altering captured functions", () => {
  const s = new PythonSession(options());
  expect(s.exec("__builtins__={'answer':12}")).toEqual({ status: "ok" });
  expect(s.exec("def f():return answer\ndel __builtins__")).toEqual({ status: "ok" });
  expect(scalar(s, "len([])")).toBe(0n);
  expect(scalar(s, "f()")).toBe(12n);
});
