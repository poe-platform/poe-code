import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const templates = [
  (expression: string) => `def f(x: ${expression}):pass`,
  (expression: string) => `def f() -> ${expression}:pass`,
  (expression: string) => `x: ${expression}`,
  (expression: string) => `def f():\n x: ${expression}`,
  (expression: string) => `class C:\n x: ${expression}`,
  (expression: string) => `obj.x: ${expression}`
];
it.each([false, true])("rejects forbidden annotation expressions before side effects (future=%s)", future => {
  for (const template of templates) for (const [expression, message] of [
    ["(a:=1)", "named expression cannot be used within an annotation"],
    ["(yield 1)", "yield expression cannot be used within an annotation"],
    ["(await f())", "await expression cannot be used within an annotation"],
    ["lambda a=(b:=1):a", "named expression cannot be used within an annotation"],
    ["[(x:=1) for x in xs]", "assignment expression cannot rebind comprehension iteration variable 'x'"],
    ["[await f() for x in xs]", "asynchronous comprehension outside of an asynchronous function"]
  ]) {
    const s = new PythonSession({ limits: { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
    const source = `${future ? "from __future__ import annotations\n" : ""}side_effect=1\n${template(expression)}`;
    expect(s.exec(source)).toMatchObject({ status: "diagnostic", diagnostic: { message } });
    expect(s.globals.get("side_effect")).toBeUndefined();
  }
});
