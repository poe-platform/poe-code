import { expect, it } from "vitest";
import { run } from "../run.js";
import { isSandboxClosure } from "./values.js";

it("a borrowed restricted accessor throws in its defining realm", async () => {
  const owner = await run(`return [Object.getOwnPropertyDescriptor(Function.prototype, 'caller').get, TypeError.prototype]`);
  const caller = await run(`return (restricted, prototype) => {
    const trace = [];
    try { restricted(); trace.push('escaped'); }
    catch (e) { trace.push(Object.getPrototypeOf(e) === prototype, e instanceof TypeError, e.name); }
    finally { trace.push('finally'); }
    return trace;
  }`);
  if (!Array.isArray(owner.returnValue) || !isSandboxClosure(caller.returnValue)) throw new Error("Expected realm exports");
  expect(await caller.returnValue.call(owner.returnValue)).toEqual([true, false, "TypeError", "finally"]);
});
