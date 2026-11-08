import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'Symbol("x")',
  'Symbol.iterator',
  '{value:Symbol("x")}',
  '[Symbol("x")]',
  'new Map([[Symbol("x"),1]])',
  'new Map([[1,Symbol("x")]])',
  'new Set([Symbol("x")])'
])("rejects uncloneable symbol values before detaching buffers: %s", async value => {
  const source = `const buffer=new ArrayBuffer(1);try { structuredClone(${value},{transfer:[buffer]});return "accepted"; } catch (error) { return [error.name,error.code,buffer.detached]; }`;
  expect(await run(source)).toMatchObject({ok:true,returnValue:Function(source)()});
});
