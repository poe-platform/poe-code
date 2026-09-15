import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

it("publishes ag_running as a live readonly member descriptor", () => {
  const s = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(s.exec("async def f(): yield 1\ng=f()\nd=type(g).__dict__['ag_running']")).toEqual({ status: "ok" });
  const evaluate = (source: string) => {
    const result = s.eval(source);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw Error("expected guest value");
    return result.value.primitive;
  };
  expect(evaluate("type(d).__name__")).toBe("member_descriptor");
  expect(evaluate("d.__get__(None,type(g)) is d and d.__get__(g) is False and d.__doc__ is None")).toBe(true);
  for (const operation of ["d.__set__(g,True)", "d.__delete__(g)"]) {
    expect(s.exec(`try: ${operation}\nexcept AttributeError as e: message=e.args[0]`)).toEqual({ status: "ok" });
    expect(evaluate("message")).toBe("readonly attribute");
  }
  expect(s.exec("try: d.__get__(object())\nexcept TypeError as e: message=e.args[0]")).toEqual({ status: "ok" });
  expect(evaluate("message")).toBe("descriptor 'ag_running' for 'async_generator' objects doesn't apply to a 'object' object");
  expect(s.exec("class A:\n def __await__(self): yield 9\nasync def active(): yield await A()\ng=active()\na=g.__anext__()\nwaiting=a.send(None)")).toEqual({ status: "ok" });
  expect(evaluate("waiting==9 and d.__get__(g) is True")).toBe(true);
  expect(s.exec("try: a.send(None)\nexcept StopIteration: pass")).toEqual({ status: "ok" });
  expect(evaluate("d.__get__(g) is False")).toBe(true);
});
