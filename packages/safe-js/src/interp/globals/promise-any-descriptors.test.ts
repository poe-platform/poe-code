import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { deepCopyFromSandbox } from "../values.js";

it.each(["[]", "[{then(resolve,reject){reject(1)}},{then(resolve,reject){reject(2)}}]"])(
  "preserves Promise.any AggregateError descriptors for %s", async input => {
    const source = `try{await Promise.any(${input});return "unexpected fulfillment"}catch(error){
      const descriptor=Object.getOwnPropertyDescriptor(error,"errors");
      return [Object.keys(error),descriptor.writable,descriptor.enumerable,descriptor.configurable,
        error.errors,error instanceof AggregateError]}`;
    const expected = await runInNewContext(`(async()=>{${source}})()`);
    const result = await run(source);
    expect(result.ok).toBe(true);
    expect(deepCopyFromSandbox(result.returnValue)).toEqual(expected);
  }
);

it("preserves Promise.any error descriptors through public replay", async () => {
  const source = `const capability=Promise.withResolvers();
    const result=Promise.any([capability.promise]).catch(error=>error);
    await 0;capability.reject(7);const error=await result;
    const descriptor=Object.getOwnPropertyDescriptor(error,"errors");
    return [Object.keys(error),descriptor.writable,descriptor.enumerable,descriptor.configurable,error.errors]`;
  const expected = await runInNewContext(`(async()=>{${source}})()`);
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  expect.soft(deepCopyFromSandbox(original.returnValue)).toEqual(expected);
  expect.soft(deepCopyFromSandbox(replayed.returnValue)).toEqual(expected);
});

it("keeps rejection element identity and an independently mutable errors property", async () => {
  const source = `const reason=Object.create(null);const error=await Promise.any([
    {then(resolve,reject){reject(reason)}}]).catch(error=>error);
    const same=error.errors[0]===reason;const nullPrototype=Object.getPrototypeOf(reason)===null;
    error.errors=9;const replaced=error.errors===9;const deleted=delete error.errors;
    return [same,nullPrototype,replaced,deleted,Object.hasOwn(error,"errors")]`;
  const result = await run(source);
  expect(result.ok).toBe(true);
  expect(deepCopyFromSandbox(result.returnValue)).toEqual(await runInNewContext(`(async()=>{${source}})()`));
});
