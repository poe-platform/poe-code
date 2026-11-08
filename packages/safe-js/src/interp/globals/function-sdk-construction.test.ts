import { expect, it } from "vitest";
import { run } from "../../run.js";
import { isSandboxClosure } from "../values.js";

it.each([1, 2])("preserves explicit newTarget through %s SDK-created bindings", async depth => {
  const result = await run('function A(x){this.own=new.target===B;this.x=x}function B(){}return [Function.prototype.bind,A,B]');
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1]) || !isSandboxClosure(values[2]))
    throw new Error("Missing SDK constructors");
  let bound = values[1];
  for (let index = 0; index < depth; index++) {
    const next = await values[0].call(index === 0 ? [null, 7] : [null], {stack: [], thisValue: bound});
    if (!isSandboxClosure(next)) throw new Error("Missing bound constructor");
    bound = next;
  }
  expect(await bound.construct!([], {stack: [], thisValue: undefined, newTarget: values[2]}))
    .toMatchObject({own: true, x: 7});
});

it("keeps the bound constructor's default newTarget substitution", async () => {
  const result = await run('function A(){this.own=new.target===A}return [Function.prototype.bind,A]');
  const values = result.returnValue;
  if (!Array.isArray(values) || !isSandboxClosure(values[0]) || !isSandboxClosure(values[1])) throw new Error("Missing SDK constructors");
  const bound = await values[0].call([null], {stack: [], thisValue: values[1]});
  if (!isSandboxClosure(bound)) throw new Error("Missing bound constructor");
  expect(await bound.construct!([], {stack: [], thisValue: undefined, newTarget: bound})).toMatchObject({own: true});
});
