import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

it("rejects invalid annotation scopes before execution through the public session", () => {
  const session = new PythonSession({
    limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 },
    hashSeed: [1n, 2n],
  });
  expect(session.exec("saved=42")).toEqual({ status: "ok" });
  expect(session.exec("saved=0\ndef f[T: (x:=1)](): pass", { filename: "audit.py" }))
    .toMatchObject({ status: "diagnostic", diagnostic: {
      filename: "audit.py", message: "named expression cannot be used within a TypeVar bound",
      position: { line: 2, column: 10 }, endPosition: { line: 2, column: 14 },
    } });
  const result = session.eval("saved");
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw Error("expected preserved binding");
  expect(result.value.primitive).toBe(42n);
  expect(session.exec("try:\n compile('type A = (x:=1)', 'alias.py', 'exec')\nexcept SyntaxError as e:\n message=e.msg\n"))
    .toEqual({ status: "ok" });
  const message = session.eval("message");
  expect(message.status).toBe("ok");
  if (message.status !== "ok") throw Error("expected guest diagnostic");
  expect(message.value.primitive).toBe("named expression cannot be used within a type alias");
});

it("rejects asynchronous type expressions through real public and guest compilation", () => {
  const session = new PythonSession({
    limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 },
    hashSeed: [1n, 2n],
  });
  expect(session.exec("saved=42")).toEqual({status:"ok"});
  expect(session.exec("saved=0\ntype A = [await x for x in xs]", {filename:"audit.py"}))
    .toMatchObject({status:"diagnostic", diagnostic:{
      message:"asynchronous comprehension outside of an asynchronous function",
      position:{line:2,column:9}, endPosition:{line:2,column:30},
    }});
  const saved=session.eval("saved");
  if(saved.status!=="ok") throw Error("expected preserved binding");
  expect(saved.value.primitive).toBe(42n);
  expect(session.exec("try:\n compile('type A = [x async for x in xs]', 'alias.py', 'exec')\nexcept SyntaxError as e:\n message=e.msg\n"))
    .toEqual({status:"ok"});
  const message=session.eval("message");
  if(message.status!=="ok") throw Error("expected guest diagnostic");
  expect(message.value.primitive).toBe("asynchronous comprehension outside of an asynchronous function");
});
